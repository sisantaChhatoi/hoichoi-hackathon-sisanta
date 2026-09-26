"""Job/user/brand persistence. Local JSON files always; mirrored to Postgres (Supabase) when
SUPABASE_DB_URL is set — Render's disk is ephemeral, so the DB is the source of
truth in production. We talk to Postgres directly (psycopg over the pooler) rather
than through PostgREST, which proved flaky on a fresh project.

Mirroring is throttled (progress/log updates at most every few seconds; status
changes always) and circuit-broken so a slow or failing DB can never stall a job.

Multi-tenancy: users and jobs.owner_id/brands are proper tables (see DDL below).
`docs(kind, key, data)` remains only as (a) the local-file-fallback format for
users/brands when there is no DB, and (b) the historical source the one-time
migration reads from in the DB case."""
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
create table if not exists public.users (
  id bigserial primary key,
  username text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.jobs (
  id text primary key,
  status text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.jobs add column if not exists owner_id bigint references public.users(id) on delete cascade;
create index if not exists jobs_owner_idx on public.jobs(owner_id);
create table if not exists public.brands (
  owner_id bigint not null references public.users(id) on delete cascade,
  id text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);
create table if not exists public.docs (
  kind text not null,
  key text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (kind, key)
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
        "insert into public.jobs (id, status, data, owner_id, updated_at) values (%s, %s, %s::jsonb, %s, now()) "
        "on conflict (id) do update set status = excluded.status, data = excluded.data, "
        "owner_id = excluded.owner_id, updated_at = now()",
        (job["id"], job.get("status"), json.dumps(job, ensure_ascii=False), job.get("owner_id"))))
    if ok is not None:
        _last_mirror[job["id"]] = (now, job.get("status"))


def save_job(job: dict, force_mirror: bool = False) -> None:
    job["updated_at"] = time.time()
    with _lock:
        _path(job["id"]).write_text(json.dumps(job, ensure_ascii=False))
    _mirror(job, force=force_mirror or job.get("status") in ("done", "error", "queued"))


def list_jobs(owner_id: int) -> list[dict]:
    """Strictly the jobs owned by `owner_id` — no public/sample jobs."""
    jobs: dict[str, Any] = {}
    rows = _run(lambda c: c.execute(
        "select data - 'analysis' - 'result' - 'log', "
        "(data->'analysis'->'media'->>'duration')::float, jsonb_array_length(data->'result'->'breaks') "
        "from public.jobs where owner_id = %s order by updated_at desc limit 200",
        (owner_id,)).fetchall())
    for data, duration, breaks in rows or []:
        jobs[data["id"]] = {**data, "duration": duration, "breaks": breaks}
    for p in config.JOBS_DIR.glob("*.json"):
        j = json.loads(p.read_text())
        if j.get("owner_id") == owner_id:
            jobs.setdefault(j["id"], _summary(j))
    out = sorted(jobs.values(), key=lambda j: j.get("created_at", 0), reverse=True)
    for j in out:
        j["editable"] = True
    return out


def list_jobs_all() -> list[dict]:
    """Every job regardless of owner (startup resume only)."""
    jobs: dict[str, Any] = {}
    rows = _run(lambda c: c.execute("select data - 'analysis' - 'result' - 'log' from public.jobs").fetchall())
    for (data,) in rows or []:
        jobs[data["id"]] = data
    for p in config.JOBS_DIR.glob("*.json"):
        j = json.loads(p.read_text())
        jobs.setdefault(j["id"], _summary(j))
    return list(jobs.values())


def can_view(job: dict, user: dict) -> bool:
    return job.get("owner_id") == user.get("id")


def can_edit(job: dict, user: dict) -> bool:
    return job.get("owner_id") == user.get("id")


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
    job = get_job(job_id) or {"id": job_id}
    update(job_id, status="running", stage=stage, progress=round(pct, 1), message=msg, eta_seconds=_eta(job, pct))


def _eta(job: dict, pct: float) -> int | None:
    """Seconds remaining. Before we know the video length it is unknown; then a
    duration-based estimate (~9 s per content minute + fixed overhead), refined by
    the observed rate once the run is well under way."""
    duration = job.get("duration")
    if not duration:
        return None
    expected_total = 45 + 9 * duration / 60
    est = expected_total * (1 - pct / 100)
    started = job.get("started_at") or job.get("created_at")
    if started and pct >= 20:
        elapsed = time.time() - started
        rate_based = elapsed / pct * (100 - pct)
        est = 0.5 * est + 0.5 * rate_based
    return max(5, int(est))


# ---------------------------------------------------------------- documents
# Small keyed JSON documents: DB (`docs` table) when configured, local files
# otherwise. Only used today as (a) the local-file fallback shape for users
# (kind="user") and the local user-id counter (kind="meta"), and (b) the
# historical source table the one-time migration below reads from.
def _doc_path(kind: str, key: str):
    d = config.DATA_DIR / "docs" / kind
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{key}.json"


def get_doc(kind: str, key: str) -> dict | None:
    if config.SUPABASE_DB_URL:
        row = _run(lambda c: c.execute("select data from public.docs where kind = %s and key = %s", (kind, key)).fetchone())
        return row[0] if row else None
    p = _doc_path(kind, key)
    return json.loads(p.read_text()) if p.exists() else None


def put_doc(kind: str, key: str, data: dict) -> None:
    if config.SUPABASE_DB_URL:
        ok = _run(lambda c: c.execute(
            "insert into public.docs (kind, key, data, updated_at) values (%s, %s, %s::jsonb, now()) "
            "on conflict (kind, key) do update set data = excluded.data, updated_at = now()",
            (kind, key, json.dumps(data, ensure_ascii=False))))
        if ok is not None:
            return
        raise RuntimeError("database unavailable")
    _doc_path(kind, key).write_text(json.dumps(data, ensure_ascii=False))


# -------------------------------------------------------------------- users
def get_user(username: str) -> dict | None:
    """{"id", "username", "password_hash"} or None."""
    if config.SUPABASE_DB_URL:
        row = _run(lambda c: c.execute(
            "select id, username, password_hash from public.users where username = %s", (username,)).fetchone())
        return {"id": row[0], "username": row[1], "password_hash": row[2]} if row else None
    doc = get_doc("user", username)
    return {"id": doc["id"], "username": doc["username"], "password_hash": doc["password_hash"]} if doc else None


def get_user_by_id(user_id: int) -> dict | None:
    """{"id", "username"} or None. Used by current_user to confirm the user still exists."""
    if config.SUPABASE_DB_URL:
        row = _run(lambda c: c.execute("select id, username from public.users where id = %s", (user_id,)).fetchone())
        return {"id": row[0], "username": row[1]} if row else None
    for p in (config.DATA_DIR / "docs" / "user").glob("*.json"):
        d = json.loads(p.read_text())
        if d.get("id") == user_id:
            return {"id": d["id"], "username": d["username"]}
    return None


def _next_local_user_id() -> int:
    meta = get_doc("meta", "user_seq") or {"next": 1}
    put_doc("meta", "user_seq", {"next": meta["next"] + 1})
    return meta["next"]


def create_user(username: str, password_hash: str) -> int:
    """Returns the new user's id. Caller must have already checked the username is free."""
    if config.SUPABASE_DB_URL:
        row = _run(lambda c: c.execute(
            "insert into public.users (username, password_hash) values (%s, %s) returning id",
            (username, password_hash)).fetchone())
        if row is None:
            raise RuntimeError("database unavailable")
        return row[0]
    uid = _next_local_user_id()
    put_doc("user", username, {"id": uid, "username": username, "password_hash": password_hash, "created_at": time.time()})
    return uid


def delete_user(user_id: int) -> None:
    """Cascade-deletes the user's jobs and brands too (FKs are ON DELETE CASCADE)."""
    _run(lambda c: c.execute("delete from public.users where id = %s", (user_id,)))


# ------------------------------------------------------------------ brands
def get_brand_rows(owner_id: int) -> list[dict]:
    """A user's brand rows, oldest first (insertion order)."""
    if config.SUPABASE_DB_URL:
        rows = _run(lambda c: c.execute(
            "select data from public.brands where owner_id = %s order by updated_at asc", (owner_id,)).fetchall())
        return [r[0] for r in rows] if rows is not None else []
    d = config.DATA_DIR / "docs" / "brands" / str(owner_id)
    if not d.exists():
        return []
    return [json.loads(p.read_text()) for p in sorted(d.glob("*.json"), key=lambda p: p.stat().st_mtime)]


def upsert_brand(owner_id: int, brand: dict) -> None:
    if config.SUPABASE_DB_URL:
        ok = _run(lambda c: c.execute(
            "insert into public.brands (owner_id, id, data, updated_at) values (%s, %s, %s::jsonb, now()) "
            "on conflict (owner_id, id) do update set data = excluded.data, updated_at = now()",
            (owner_id, brand["id"], json.dumps(brand, ensure_ascii=False))))
        if ok is not None:
            return
        raise RuntimeError("database unavailable")
    d = config.DATA_DIR / "docs" / "brands" / str(owner_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{brand['id']}.json").write_text(json.dumps(brand, ensure_ascii=False))


def delete_brand_row(owner_id: int, brand_id: str) -> None:
    if config.SUPABASE_DB_URL:
        _run(lambda c: c.execute("delete from public.brands where owner_id = %s and id = %s", (owner_id, brand_id)))
        return
    p = config.DATA_DIR / "docs" / "brands" / str(owner_id) / f"{brand_id}.json"
    if p.exists():
        p.unlink()


# --------------------------------------------------------------- migration
def migrate_once() -> dict:
    """One-time (but idempotent — safe to call on every startup) migration from the
    old generic docs(kind, key, data) shape to proper users/jobs.owner_id/brands
    tables. No-ops when there is no DB. Returns row counts for reporting."""
    counts = {"users": 0, "jobs_from_owner_field": 0, "jobs_to_migrate_owner": 0, "brands": 0}
    if config.SUPABASE_DB_URL:
        def fn(c):
            cur = c.execute(
                "insert into public.users (username, password_hash, created_at) "
                "select key, data->>'password', "
                "coalesce(to_timestamp((data->>'created_at')::double precision), now()) "
                "from public.docs where kind = 'user' "
                "on conflict (username) do nothing")
            counts["users"] = cur.rowcount

            cur = c.execute(
                "update public.jobs j set owner_id = u.id "
                "from public.users u where j.owner_id is null and j.data->>'owner' = u.username")
            counts["jobs_from_owner_field"] = cur.rowcount

            cur = c.execute(
                "update public.jobs j set owner_id = u.id "
                "from public.users u where j.owner_id is null and u.username = %s",
                (config.MIGRATE_OWNER,))
            counts["jobs_to_migrate_owner"] = cur.rowcount

            # Keep the embedded JSON in sync with the owner_id column for display.
            c.execute(
                "update public.jobs j set data = data || jsonb_build_object('owner_id', j.owner_id, 'owner', u.username) "
                "from public.users u where j.owner_id = u.id")

            cur = c.execute(
                "insert into public.brands (owner_id, id, data) "
                "select u.id, b->>'id', b "
                "from public.docs d join public.users u on u.username = d.key "
                "cross join lateral jsonb_array_elements(d.data->'brands') as b "
                "where d.kind = 'catalogue' "
                "on conflict (owner_id, id) do nothing")
            counts["brands"] = cur.rowcount
        _run(fn)
    _mirror_local_job_files()
    return counts


def _mirror_local_job_files() -> None:
    """Backfill owner_id into the local JSON job cache so it can't leak ownerless
    jobs if the DB is briefly unreachable and a file-cache read wins."""
    username_to_id: dict[str, int] = {}
    if config.SUPABASE_DB_URL:
        rows = _run(lambda c: c.execute("select id, username from public.users").fetchall())
        username_to_id = {u: i for i, u in (rows or [])}
    else:
        for p in (config.DATA_DIR / "docs" / "user").glob("*.json"):
            d = json.loads(p.read_text())
            username_to_id[d["username"]] = d["id"]
    fallback_id = username_to_id.get(config.MIGRATE_OWNER)
    for p in config.JOBS_DIR.glob("*.json"):
        try:
            j = json.loads(p.read_text())
        except Exception:
            continue
        if j.get("owner_id") is not None:
            continue
        owner_id = username_to_id.get(j.get("owner")) or fallback_id
        if owner_id is None:
            continue
        j["owner_id"] = owner_id
        j["owner"] = j.get("owner") or config.MIGRATE_OWNER
        p.write_text(json.dumps(j, ensure_ascii=False))
