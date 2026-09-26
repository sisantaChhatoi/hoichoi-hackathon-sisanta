"""Job persistence. Local JSON files always; mirrored to Supabase when configured
(Render's disk is ephemeral, so Supabase is the source of truth in production)."""
import json
import threading
import time
from typing import Any

from . import config

_lock = threading.Lock()
_sb = None


def _supabase():
    global _sb
    if _sb is None and config.SUPABASE_URL and config.SUPABASE_SERVICE_KEY:
        from supabase import create_client
        _sb = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)
    return _sb


def _path(job_id: str):
    return config.JOBS_DIR / f"{job_id}.json"


def get_job(job_id: str) -> dict | None:
    p = _path(job_id)
    if p.exists():
        return json.loads(p.read_text())
    sb = _supabase()
    if sb:
        r = sb.table("jobs").select("data").eq("id", job_id).limit(1).execute()
        if r.data:
            job = r.data[0]["data"]
            p.write_text(json.dumps(job))
            return job
    return None


def save_job(job: dict) -> None:
    job["updated_at"] = time.time()
    with _lock:
        _path(job["id"]).write_text(json.dumps(job, ensure_ascii=False))
    sb = _supabase()
    if sb:
        try:
            sb.table("jobs").upsert({"id": job["id"], "status": job["status"], "data": job}).execute()
        except Exception as e:  # never let persistence kill the pipeline
            print("supabase upsert failed:", e)


def list_jobs() -> list[dict]:
    jobs: dict[str, Any] = {}
    sb = _supabase()
    if sb:
        try:
            r = sb.table("jobs").select("data").order("updated_at", desc=True).limit(50).execute()
            for row in r.data:
                jobs[row["data"]["id"]] = row["data"]
        except Exception as e:
            print("supabase list failed:", e)
    for p in config.JOBS_DIR.glob("*.json"):
        j = json.loads(p.read_text())
        jobs.setdefault(j["id"], j)
    out = sorted(jobs.values(), key=lambda j: j.get("created_at", 0), reverse=True)
    # summaries only — results can be large
    return [{k: v for k, v in j.items() if k not in ("analysis", "result")} for j in out]


def update(job_id: str, **fields) -> dict:
    job = get_job(job_id) or {"id": job_id}
    job.update(fields)
    save_job(job)
    return job


def set_progress(job_id: str, stage: str, pct: float, msg: str = "") -> None:
    update(job_id, status="running", stage=stage, progress=round(pct, 1), message=msg)


def upload_public(local_path, dest_name: str, content_type: str) -> str | None:
    """Upload a file to Supabase Storage and return its public URL (None if not configured)."""
    sb = _supabase()
    if not sb:
        return None
    with open(local_path, "rb") as f:
        sb.storage.from_(config.SUPABASE_BUCKET).upload(
            dest_name, f, {"content-type": content_type, "upsert": "true"}
        )
    return sb.storage.from_(config.SUPABASE_BUCKET).get_public_url(dest_name)
