# Cuepoint

**Context-aware ad-break placement for long-form video.**

Give Cuepoint an episode and it answers the three questions an ad-ops editor would: **where** a cut is non-jarring, **whether** a break is warranted under your pacing rules, and **what** brand belongs in that moment. Every decision is explained, exported as a standards-compliant **VMAP** manifest, and playable in-app — the player pauses at each cue, plays the matched creative, and resumes.

- Live demo: https://hoichoi-hackathon-sisanta.vercel.app
- API: https://hoichoi-hackathon-sisanta.onrender.com

---

## How it works

```mermaid
flowchart TD
    V([Episode.mp4]) --> U[Upload to storage]
    U --> F["ffmpeg (local, cheap)\nsilence map · shot cuts"]
    U --> G["Gemini Flash · Files API\nwhole video, 5-min chunks @ 1 fps"]
    G --> S["Scenes\ntitle · summary · dominant activity\ncontext tags (controlled vocabulary)\nmood · sensitive · boundary quality"]
    G --> P["Speech passages\n+ intra-scene pause points"]

    S & P & F --> W1

    subgraph W1 [WHERE — cut safety]
        C1["Candidates = scene boundaries + pause points\n(never a bare silence)"]
        C2["Snap each cut to the nearest real pause\n(ffmpeg silence, else gap between lines)"]
        C3["cut_safety = 0.45·pause + 0.35·boundary + 0.20·shot-cut\n− 0.6 if inside dialogue"]
        C1 --> C2 --> C3
    end

    W1 --> W2

    subgraph W2 [WHETHER — pacing]
        R["Breaks per hour · minimum gap · ad-load %\nno breaks near start/end · minimum cut safety\ngreedy best-first; every rejection carries its reason"]
    end

    W2 --> W3

    subgraph W3 [WHAT — brand match]
        B1["Hard block: brand.negative_contexts ∩ scene tags\n(before ∪ after) — pure set logic"]
        B2["LLM gate on the brand's free-text rule"]
        B3["Rank survivors by context affinity\n+ LLM choice with written rationale"]
        B4["Fallback: house promo"]
        B1 --> B2 --> B3 --> B4
    end

    W3 --> J

    subgraph J [Independent review gate]
        J1["Judge model sees the keyframes just before / after each cut,\nthe scene context and the matched brand"]
        J2["jarring cut → veto & re-select\nbrand violation → exclude & re-match\n(max 2 rounds; still-jarring breaks are dropped)"]
        J1 --> J2
    end

    J --> O1([VMAP 1.0 + VAST 3.0]) & O2([Decision report JSON]) & O3([Player with ad cut-overs])
```

### Perception
The episode is uploaded once to Gemini's Files API and analysed **in full**, in 5-minute chunks at one frame per second with audio — that is how the system knows what each scene is about, its mood, who is speaking and when. In parallel, ffmpeg produces two cheap, precise signals locally: a **silence map** (sub-second) and **shot changes**. Scene analysis is schema-constrained: every scene is tagged only from a controlled vocabulary (`backend/app/vocab.py`), which is what makes brand blocking deterministic later.

### Where
Only semantic points become candidates — scene boundaries and pause points Gemini flagged inside long scenes. A quiet moment in the middle of a tense scene never becomes a break because nothing proposes it. Each candidate cut is then snapped to the nearest real pause and scored from explainable components; a cut that lands inside dialogue is never used. All components are in the decision report.

### Whether
Pacing rules decide how many breaks an episode may carry and where they may not go. Selection is greedy best-first, and every rejected candidate keeps the rule that rejected it ("would cut mid-dialogue", "break budget reached", "less than 5 min from another break", …). Rules are adjustable per episode and re-run in seconds without re-analysing.

### What
Brand matching has two gates and a ranker. Gate 1 is a set intersection between the brand's *negative contexts* and the tags of the scenes on either side of the cut — no model can talk its way past it. Gate 2 lets a model enforce the brand's free-text rule. Survivors are ranked by context affinity with the *preceding* scene (dominant activity wins) and a model picks one with a one-sentence rationale. If everything is blocked, a house promo is used rather than a bad ad. Because brands and scenes share one vocabulary, a brand nobody has seen before is matched with zero code changes.

### Review gate
A second, stronger model independently audits each placement from the keyframes around the cut plus the scene and brand context. It can veto a jarring cut (the next-best candidate takes its place) or reject a brand for that slot (the matcher re-runs without it). Anything still judged jarring after two rounds is dropped — fewer breaks beat a bad one.

---

## Product

- **Episodes** — upload (browser → Vercel Blob) or paste a URL; progress with stage, percent and time remaining; toast on completion with a View action.
- **Episode view** — custom player with break markers on the seek bar, scene strip (colour = mood; hover for summary and tags), each break with its brand, rationale, why-this-cut, blocked brands and the reviewer's verdict; pacing sliders that re-place in seconds; a list of every other cut considered and why it lost.
- **Brands** — a fictional catalogue per user, seeded with eight brands; add one in a dialog (contexts to seek, contexts to avoid, a free-text rule, creative colours); click a row to preview its creative.
- **Outputs** — VMAP manifest and decision report per episode.

## Accounts

Sign up with a username and password (unique usernames, scrypt-hashed passwords). Sessions are HS256 JWTs with a 7-day expiry sent as a bearer token. Everything — episodes, analyses, placements and the brand catalogue — is private to the account. Postgres tables: `users`, `jobs (owner_id → users)`, `brands (owner_id → users)`.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (app router), Tailwind v4, shadcn/ui, lucide icons — Vercel |
| Video storage | Vercel Blob (browser uploads, streamed playback) |
| Backend | FastAPI + ffmpeg, Docker — Render |
| Perception | Gemini Flash (video understanding, Files API) |
| Judgement | Gemini Pro for matching and the review gate (Claude via API/Bedrock if configured) |
| Persistence | Postgres (Supabase) |

## Repo layout

```
backend/   FastAPI service (Python 3.12, uv)
  app/pipeline/audio.py     ffprobe, silence map, shot cuts, keyframes
  app/pipeline/gemini.py    Files API upload, chunked analysis with JSON schema, cache, retries
  app/pipeline/scoring.py   WHERE (cut safety) + WHETHER (pacing)
  app/pipeline/matching.py  WHAT (hard block → rule gate → rank)
  app/pipeline/judge.py     independent review gate
  app/pipeline/vmap.py      VMAP / VAST emitter
  app/auth.py, app/store.py accounts, persistence, migrations
  scripts/run_local.py      run the pipeline on a local file, no server
frontend/  Next.js app
docs/      reference material
```

## Run locally

```bash
# backend
cd backend && cp .env.example .env      # GEMINI_API_KEY, optional SUPABASE_DB_URL / JWT_SECRET
uv sync && uv run uvicorn app.main:app --reload --port 8000
uv run python scripts/run_local.py ~/Downloads/episode.mp4

# frontend
cd frontend && pnpm install && pnpm dev  # http://localhost:3000  (NEXT_PUBLIC_API_URL in .env.local)
```

## Deploy

- **Backend → Render** (Docker, `render.yaml`): `GEMINI_API_KEY`, `SUPABASE_DB_URL`, `JWT_SECRET`, `CREATIVE_BASE_URL` (`https://<frontend>/creatives`). Render's disk is ephemeral; jobs live in Postgres and interrupted runs resume on restart.
- **Frontend → Vercel**: root `frontend/`, `NEXT_PUBLIC_API_URL`, a connected Blob store (`BLOB_READ_WRITE_TOKEN`).

## API

All `/jobs` and `/brands` routes require `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/signup` · `/auth/login` | `{username, password}` → `{token}` |
| GET | `/auth/me` | current user |
| POST | `/jobs` `{url,title}` · `/jobs/upload` (multipart) | analyse an episode |
| GET | `/jobs` · `/jobs/{id}` | list / detail (scenes, breaks, rejected candidates) |
| POST | `/jobs/{id}/place` `{pacing}` | re-run scoring + matching only |
| POST | `/jobs/{id}/retry` · DELETE `/jobs/{id}` | retry / remove |
| GET | `/jobs/{id}/vmap.xml` · `/jobs/{id}/debug.json` | outputs (accept `?token=`) |
| GET/POST/DELETE | `/brands` | the caller's catalogue |
| GET | `/vocab` | context tag vocabulary |
