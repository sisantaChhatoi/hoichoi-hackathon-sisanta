import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
def _models(env: str, default: str) -> list[str]:
    return [m.strip() for m in os.environ.get(env, default).split(",") if m.strip()]

# Video understanding (speed matters for a live demo → Flash first)
GEMINI_MODELS = _models("GEMINI_MODELS", "gemini-3.8-flash,gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite")
# Brand matching / negative-context judgement (small text call → strongest model first)
GEMINI_TEXT_MODELS = _models("GEMINI_TEXT_MODELS", "gemini-3.1-pro-preview,gemini-3.8-flash,gemini-3.7-flash")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET", "media")

DATA_DIR = Path(os.environ.get("DATA_DIR", "./data_local")).resolve()
CACHE_DIR = DATA_DIR / "cache"
JOBS_DIR = DATA_DIR / "jobs"
MEDIA_DIR = DATA_DIR / "media"
for d in (CACHE_DIR, JOBS_DIR, MEDIA_DIR):
    d.mkdir(parents=True, exist_ok=True)

CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")]
SHOT_DETECT = os.environ.get("SHOT_DETECT", "1") == "1"

BRANDS_FILE = Path(__file__).resolve().parent.parent / "data" / "brands.json"
# Where the generated ad creatives (frontend/public/creatives/<brand_id>.mp4) are served from
CREATIVE_BASE_URL = os.environ.get("CREATIVE_BASE_URL", "http://localhost:3000/creatives").rstrip("/")

# Pacing rules ("whether" a break is warranted at all). Overridable per job.
DEFAULT_PACING = {
    "max_breaks_per_hour": 6,     # a 20-min episode gets 2, a 26-min one 3
    "min_gap_seconds": 300,       # between consecutive breaks
    "max_ad_load_pct": 10.0,      # total ad seconds / content seconds
    "ad_duration_seconds": 20,    # each break carries one creative of this length
    "no_break_before_seconds": 120,
    "no_break_after_seconds": 120,
    "min_cut_safety": 0.55,       # candidates below this are never used
}

# Gemini chunking: keep each request small so free-tier TPM is never hit and a
# failed chunk can be retried alone.
CHUNK_SECONDS = 300
VIDEO_FPS = 1.0
