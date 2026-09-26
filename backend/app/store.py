"""Job persistence. Local JSON files always; mirrored to Postgres (Supabase) when
SUPABASE_DB_URL is set — Render's disk is ephemeral, so the DB is the source of
truth in production. We talk to Postgres directly (psycopg over the pooler) rather
than through PostgREST, which proved flaky on a fresh project.

Mirroring is throttled (progress/log updates at most every few seconds; status
changes always) and circuit-broken so a slow or failing DB can never stall a job."""
import json
import threading
import time
from typing import Any

from . import config

_lock = threading.Lock()
_db_down_until = 0.0
_last_mirror: dict[str, tuple[float, str]] = {}   # job id → (time, status)
MIRROR_INTERVAL = 4.0

DDL = """
create table if not exists public.jobs (
  id text primary key,
  status text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
"""


_conn = None
_db_lock = threading.Lock()


def _connect():
    import psycopg
    conn = psycopg.connect(
        config.SUPABASE_DB_URL, autocommit=True, prepare_threshold=None, connect_timeout=5,
        options="-c statement_timeout=8000",
        keepalives=1, keepalives_idle=20, keepalives_interval=5, keepalives_count=3,
    )
    conn.execute(DDL)
    return conn


def _run(fn):
    """Run fn(conn) on a persistent connection under a circuit breaker; None on failure.
    Keepalives + a statement timeout mean a dead socket surfaces as an error (and a
    reconnect) instead of a hang; the lock has a timeout so callers never pile up."""
    global _conn, _db_down_until
    if not config.SUPABASE_DB_URL or time.time() < _db_down_until:
        return None
    if not _db_lock.acquire(timeout=3):
        return None
    try:
        if _conn is None or _conn.closed:
            _conn = _connect()
        return fn(_conn)
    except Exception as e:
        print("db error, reconnecting on next call:", str(e)[:160])
        try:
            if _conn:
                _conn.close()
        except Exception:
            pass
        _conn = None
        _db_down_until = time.time() + 10
        return None
    finally:
        _db_lock.release()


def _path(job_id: str):
    return config.JOBS_DIR / f"{job_id}.json"


def get_job(job_id: str) -> dict | None:
    p = _path(job_id)
    if p.exists():
        return json.loads(p.read_text())
    row = _run(lambda c: c.execute("select data from public.jobs where id = %s", (job_id,)).fetchone())
    if row:
        job = row[0]
        p.write_text(json.dumps(job, ensure_ascii=False))
        return job
    return None


def _mirror(job: dict, force: bool) -> None:
    now = time.time()
    last_t, last_status = _last_mirror.get(job["id"], (0.0, None))
    if not force and job.get("status") == last_status and now - last_t < MIRROR_INTERVAL:
        return
    ok = _run(lambda c: c.execute(
        "insert into public.jobs (id, status, data, updated_at) values (%s, %s, %s::jsonb, now()) "
        "on conflict (id) do update set status = excluded.status, data = excluded.data, updated_at = now()",
        (job["id"], job.get("status"), json.dumps(job, ensure_ascii=False))))
    if ok is not None:
        _last_mirror[job["id"]] = (now, job.get("status"))


def save_job(job: dict, force_mirror: bool = False) -> None:
    job["updated_at"] = time.time()
    with _lock:
        _path(job["id"]).write_text(json.dumps(job, ensure_ascii=False))
    _mirror(job, force=force_mirror or job.get("status") in ("done", "error", "queued"))


def list_jobs() -> list[dict]:
    jobs: dict[str, Any] = {}
    rows = _run(lambda c: c.execute(
        "select data - 'analysis' - 'result' - 'log', "
        "(data->'analysis'->'media'->>'duration')::float, jsonb_array_length(data->'result'->'breaks') "
        "from public.jobs order by updated_at desc limit 200").fetchall())
    for data, duration, breaks in rows or []:
        jobs[data["id"]] = {**data, "duration": duration, "breaks": breaks}
    for p in config.JOBS_DIR.glob("*.json"):
        j = json.loads(p.read_text())
        jobs.setdefault(j["id"], _summary(j))
    return sorted(jobs.values(), key=lambda j: j.get("created_at", 0), reverse=True)


def _summary(j: dict) -> dict:
    """List view of a job: no analysis/result/log, plus a few derived fields."""
    s = {k: v for k, v in j.items() if k not in ("analysis", "result", "log")}
    s["duration"] = ((j.get("analysis") or {}).get("media") or {}).get("duration")
    s["breaks"] = len((j.get("result") or {}).get("breaks") or []) if j.get("result") else None
    return s


def delete_job(job_id: str) -> None:
    p = _path(job_id)
    if p.exists():
        p.unlink()
    _run(lambda c: c.execute("delete from public.jobs where id = %s", (job_id,)))


def update(job_id: str, **fields) -> dict:
    job = get_job(job_id) or {"id": job_id}
    job.update(fields)
    save_job(job, force_mirror="result" in fields or "analysis" in fields)
    return job


def set_progress(job_id: str, stage: str, pct: float, msg: str = "") -> None:
    update(job_id, status="running", stage=stage, progress=round(pct, 1), message=msg)
