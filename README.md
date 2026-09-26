# AdBreak AI — Context-Aware Video Segmentation & Intelligent Ad Placement

Submission for **hoichoi Hackathon '26 — Problem 1**. Ingests a long-form Bengali drama episode, segments it into
semantically coherent scenes, scores every possible break point for *where* / *whether*, matches each surviving break
to the most contextually appropriate brand from a synthetic catalogue (*what*), and emits a **VMAP 1.0 manifest**,
a **debug JSON**, and a **playable demo** that cuts to the ad and resumes.

- Live demo: _TBD_ · Backend API: _TBD_ · Video walkthrough: _TBD_

## How it works

```
episode.mp4 ─┬─ ffmpeg: silence map + shot cuts (precise, local, cheap)
             └─ Gemini Flash (Files API, 5-min chunks @1fps, JSON schema):
                  scenes {title, summary, dominant_activity, tags∈vocab, mood, sensitive, boundary_quality}
                  speech passages, intra-scene pause points
                          │
 WHERE    candidates = scene boundaries + pause points (semantic only — silence never proposes a cut).
          Cut snapped to nearest pause (ffmpeg silence, else speech gap).
          cut_safety = .45·pause + .35·boundary_quality + .20·shot_cut − 0.6·mid_speech − …   (all terms in debug JSON)
 WHETHER  pacing rules: breaks/hour, min gap, ad-load %, no break near start/end, min cut_safety → greedy best-first.
 WHAT     gate 1  brand.negative_contexts ∩ scene_tags(before ∪ after)  → HARD BLOCK (set logic, not an LLM opinion)
          gate 2  LLM checks the brand's free-text negative_description → block
          rank    tag affinity with the dominant (preceding) scene + LLM choice with written rationale
          fallback house promo when every brand is blocked
                          │
          VMAP 1.0 + inline VAST 3.0 (+ <Extension> with cutSafety/scenes/rationale) · debug.json · player
```

**Generalises to unseen brands with zero code changes**: scene tags come from a controlled vocabulary
(`backend/app/vocab.py`) that Gemini is schema-forced to use, and brands declare `target_contexts` /
`negative_contexts` from the same vocabulary. Add a brand in the UI (`/brands`) or `POST /brands`, then
"Re-run placement" on any job — only scoring + matching re-run (seconds), analysis is reused.

All brands in `backend/data/brands.json` are fictional.

## Repo layout

```
backend/   FastAPI + ffmpeg + Gemini pipeline (Python 3.12, uv). Docker for Render.
  app/pipeline/audio.py     ffprobe, silencedetect, scene-change shot cuts
  app/pipeline/gemini.py    Files API upload, chunked analysis, disk cache, retry + model fallback
  app/pipeline/scoring.py   WHERE (cut_safety) + WHETHER (pacing)
  app/pipeline/matching.py  WHAT (hard block → LLM gate → rank)
  app/pipeline/vmap.py      VMAP/VAST emitter
  scripts/run_local.py      run the whole pipeline on a local file, no server
frontend/  Next.js 16 (app router) — upload, progress, scene timeline, break explanations, VMAP/debug download,
           HTML5 player that pauses at cue points, plays the creative, resumes.
docs/      handbook, Supabase schema
```

## Run locally

```bash
# backend
cd backend && cp .env.example .env   # add GEMINI_API_KEY
uv sync && uv run uvicorn app.main:app --reload --port 8000
uv run python scripts/run_local.py ~/Downloads/feluda.mp4      # CLI run, prints breaks + writes VMAP

# frontend
cd frontend && pnpm install && pnpm dev                          # http://localhost:3000
```

## Deploy

- **Backend → Render** (Docker, `render.yaml`): set `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
  Render's disk is ephemeral; jobs are mirrored to Supabase (`docs/supabase.sql`).
- **Frontend → Vercel**: set `NEXT_PUBLIC_API_URL`; connect a Blob store (adds `BLOB_READ_WRITE_TOKEN`) so browser
  uploads go straight to Vercel Blob and the player streams from there.

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/jobs` `{url,title}` | analyse a video by URL |
| POST | `/jobs/upload` (multipart) | analyse an uploaded file |
| GET | `/jobs/{id}` | status, scenes, breaks, rejected candidates |
| POST | `/jobs/{id}/place` `{pacing}` | re-run scoring + matching only |
| GET | `/jobs/{id}/vmap.xml` · `/jobs/{id}/debug.json` | outputs |
| GET/POST/DELETE | `/brands` | synthetic catalogue (add the 9th brand here) |
| GET | `/vocab` | context tag vocabulary |
