"""Job persistence. Local JSON files always; mirrored to Supabase when configured
(Render's disk is ephemeral, so Supabase is the source of truth in production).

Mirroring is throttled (progress/log updates at most every few seconds; status
changes always) and circuit-broken so a slow or failing Supabase can never stall
the pipeline."""
import json
import threading
import time
from typing import Any

from . import config

_lock = threading.Lock()
_sb = None
_sb_down_until = 0.0
_last_mirror: dict[str, tuple[float, str]] = {}   # job id → (time, status)
MIRROR_INTERVAL = 4.0


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
    if sb and time.time() > _sb_down_until:
        try:
            r = sb.table("jobs").select("data").eq("id", job_id).limit(1).execute()
            if r.data:
                job = r.data[0]["data"]
                p.write_text(json.dumps(job, ensure_ascii=False))
                return job
        except Exception as e:
            print("supabase get failed:", e)
    return None


def _mirror(job: dict, force: bool) -> None:
    global _sb_down_until
    sb = _supabase()
    if not sb or time.time() < _sb_down_until:
        return
    now = time.time()
    last_t, last_status = _last_mirror.get(job["id"], (0.0, None))
    if not force and job.get("status") == last_status and now - last_t < MIRROR_INTERVAL:
        return
    try:
        sb.table("jobs").upsert({"id": job["id"], "status": job.get("status"), "data": job}).execute()
        _last_mirror[job["id"]] = (now, job.get("status"))
    except Exception as e:  # never let persistence kill the pipeline
        print("supabase upsert failed, pausing mirroring 60s:", str(e)[:160])
        _sb_down_until = now + 60


def save_job(job: dict, force_mirror: bool = False) -> None:
    job["updated_at"] = time.time()
    with _lock:
        _path(job["id"]).write_text(json.dumps(job, ensure_ascii=False))
    _mirror(job, force=force_mirror or job.get("status") in ("done", "error", "queued"))


def list_jobs() -> list[dict]:
    jobs: dict[str, Any] = {}
    sb = _supabase()
    if sb and time.time() > _sb_down_until:
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
    return [{k: v for k, v in j.items() if k not in ("analysis", "result", "log")} for j in out]


def update(job_id: str, **fields) -> dict:
    job = get_job(job_id) or {"id": job_id}
    job.update(fields)
    save_job(job, force_mirror="result" in fields or "analysis" in fields)
    return job


def set_progress(job_id: str, stage: str, pct: float, msg: str = "") -> None:
    update(job_id, status="running", stage=stage, progress=round(pct, 1), message=msg)
