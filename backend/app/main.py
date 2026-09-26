import json
import shutil
import time
import uuid
from pathlib import Path

import httpx
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config, store
from .pipeline import matching, run
from .vocab import CONTEXT_TAGS, MOODS

app = FastAPI(title="hoichoi contextual ad-break API")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS + ["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/media", StaticFiles(directory=str(config.MEDIA_DIR), follow_symlink=True), name="media")


@app.get("/health")
def health():
    from .pipeline import judge
    return {"ok": True, "models": config.GEMINI_MODELS, "text_models": config.GEMINI_TEXT_MODELS,
            "judge": judge.provider(), "db": bool(config.SUPABASE_DB_URL)}


@app.get("/vocab")
def vocab():
    return {"tags": CONTEXT_TAGS, "moods": MOODS}


# ------------------------------------------------------------------ brands
@app.get("/brands")
def brands():
    return matching.load_brands()


class Brand(BaseModel):
    id: str
    name: str
    category: str = ""
    tagline: str = ""
    target_contexts: list[str] = []
    negative_contexts: list[str] = []
    negative_description: str = ""
    creative: dict = {}


@app.post("/brands")
def add_brand(brand: Brand):
    """Add a (9th, unseen) brand at runtime. Nothing else changes; re-run placement on a job to see it matched."""
    bad = [t for t in brand.target_contexts + brand.negative_contexts if t not in CONTEXT_TAGS]
    if bad:
        raise HTTPException(400, f"unknown context tags: {bad}. See GET /vocab")
    cat = matching.load_brands()
    cat["brands"] = [b for b in cat["brands"] if b["id"] != brand.id] + [brand.model_dump()]
    config.BRANDS_FILE.write_text(json.dumps(cat, ensure_ascii=False, indent=2))
    return cat


@app.delete("/brands/{brand_id}")
def delete_brand(brand_id: str):
    cat = matching.load_brands()
    cat["brands"] = [b for b in cat["brands"] if b["id"] != brand_id]
    config.BRANDS_FILE.write_text(json.dumps(cat, ensure_ascii=False, indent=2))
    return cat


# -------------------------------------------------------------------- jobs
def _new_job(title: str, video_url: str | None) -> dict:
    job = {"id": uuid.uuid4().hex[:12], "title": title, "status": "queued", "stage": "queued",
           "progress": 0, "message": "", "created_at": time.time(), "video_url": video_url, "log": []}
    store.save_job(job)
    return job


def _local_video_path(job_id: str) -> Path:
    return config.MEDIA_DIR / f"{job_id}.mp4"


@app.post("/jobs/upload")
async def create_job_upload(bg: BackgroundTasks, file: UploadFile = File(...), title: str = Form("")):
    job = _new_job(title or file.filename or "untitled", None)
    dest = _local_video_path(job["id"])
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    store.update(job["id"], video_url=f"/media/{dest.name}")
    bg.add_task(run.run_job, job["id"], str(dest))
    return store.get_job(job["id"])


class JobFromUrl(BaseModel):
    url: str
    title: str = ""
    pacing: dict | None = None


def _download_and_run(job_id: str, url: str, pacing: dict | None):
    dest = _local_video_path(job_id)
    try:
        store.set_progress(job_id, "download", 1, "downloading video")
        with httpx.stream("GET", url, follow_redirects=True, timeout=600) as r:
            r.raise_for_status()
            with dest.open("wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
    except Exception as e:
        store.update(job_id, status="error", message=f"download failed: {e}"[:300])
        return
    run.run_job(job_id, str(dest), pacing)


@app.post("/jobs")
def create_job_url(body: JobFromUrl, bg: BackgroundTasks):
    """Start a job from a video URL (e.g. a Supabase Storage public URL the frontend uploaded to)."""
    job = _new_job(body.title or body.url.rsplit("/", 1)[-1], body.url)
    bg.add_task(_download_and_run, job["id"], body.url, body.pacing)
    return job


@app.get("/jobs")
def jobs():
    return store.list_jobs()


@app.delete("/jobs/{job_id}")
def delete_job(job_id: str):
    store.delete_job(job_id)
    p = _local_video_path(job_id)
    if p.exists() or p.is_symlink():
        p.unlink()
    return {"ok": True}


@app.get("/jobs/{job_id}")
def job(job_id: str, full: bool = False):
    j = store.get_job(job_id)
    if not j:
        raise HTTPException(404)
    if not full:
        j = {k: v for k, v in j.items() if k != "analysis"} | {"analysis": _analysis_summary(j.get("analysis"))}
    return j


def _analysis_summary(a: dict | None):
    if not a:
        return None
    return {"media": a["media"], "scenes": a["scenes"], "speech": a["speech"],
            "silence_count": len(a["silences"]), "shot_cut_count": len(a["shot_cuts"])}


class Replace(BaseModel):
    pacing: dict | None = None
    use_llm: bool = True
    use_judge: bool = True


@app.post("/jobs/{job_id}/place")
def replace(job_id: str, body: Replace):
    """Re-run scoring + matching only (seconds). Use after adding a brand or changing pacing."""
    j = store.get_job(job_id)
    if not j or not j.get("analysis"):
        raise HTTPException(404, "job has no analysis yet")
    pacing = {**config.DEFAULT_PACING, **(body.pacing or {})}
    video = _local_video_path(job_id)
    result = run.place(job_id, j["analysis"], matching.load_brands(), pacing, config.CREATIVE_BASE_URL,
                       use_llm=body.use_llm, video_path=str(video) if video.exists() else None, use_judge=body.use_judge)
    store.update(job_id, result=result)
    return job(job_id)


@app.get("/jobs/{job_id}/vmap.xml")
def vmap_xml(job_id: str):
    j = store.get_job(job_id)
    if not j or not j.get("result"):
        raise HTTPException(404)
    return Response(j["result"]["vmap"], media_type="application/xml",
                    headers={"Content-Disposition": f'inline; filename="{job_id}.vmap.xml"'})


@app.get("/jobs/{job_id}/debug.json")
def debug_json(job_id: str):
    j = store.get_job(job_id)
    if not j or not j.get("result"):
        raise HTTPException(404)
    r = j["result"]
    a = j["analysis"]
    return {"job_id": job_id, "media": a["media"], "pacing": r["pacing"],
            "scenes": a["scenes"], "speech": a["speech"], "silences": a["silences"], "shot_cuts": a["shot_cuts"],
            "candidates": r["candidates"], "rejected": r["rejected"], "breaks": r["breaks"], "log": j.get("log", [])}
