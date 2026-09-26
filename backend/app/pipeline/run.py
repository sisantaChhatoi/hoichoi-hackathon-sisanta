"""Orchestration: video path → analysis → scored candidates → breaks → brands → judge → VMAP."""
import time
import traceback

from .. import config, store
from . import audio, gemini, judge, matching, scoring, vmap


def _logger(job_id: str):
    def log(msg: str):
        line = f"[{time.strftime('%H:%M:%S')}] {msg}"
        print(job_id[:8], line)
        job = store.get_job(job_id) or {"id": job_id}
        job.setdefault("log", []).append(line)
        job["log"] = job["log"][-200:]
        store.save_job(job)
    return log


def analyze(job_id: str, video_path: str) -> dict:
    """Expensive half (ffmpeg + Gemini). Cached on disk by content hash."""
    log = _logger(job_id)
    store.set_progress(job_id, "probe", 2, "Reading media info")
    info = audio.probe(video_path)
    store.update(job_id, duration=info["duration"], started_at=time.time())
    log(f"media: {info['duration']:.1f}s {info['width']}x{info['height']} {info['size_bytes']/1e6:.0f}MB")

    store.set_progress(job_id, "silence", 5, "Mapping silences")
    silences = audio.silence_map(video_path)
    log(f"silence: {len(silences)} gaps")

    cuts = []
    if config.SHOT_DETECT:
        store.set_progress(job_id, "shots", 10, "Detecting shot changes")
        cuts = audio.shot_cuts(video_path)
        log(f"shots: {len(cuts)} cuts")

    store.set_progress(job_id, "upload", 15, "Uploading to the vision model")
    file = gemini.upload_video(video_path, log=log)

    store.set_progress(job_id, "gemini", 20, "Analysing scenes")
    analysis = gemini.analyze_video(
        file, info["duration"], log=log,
        on_progress=lambda f: store.set_progress(job_id, "gemini", 20 + 60 * f, f"Analysing scenes · {int(f*100)}%"),
    )
    log(f"gemini: {len(analysis['scenes'])} scenes, {len(analysis['speech'])} speech passages")
    return {"media": info, "silences": silences, "shot_cuts": cuts, **analysis}


def place(job_id: str, analysis: dict, catalogue: dict, pacing: dict, creative_base_url: str,
          use_llm: bool = True, video_path: str | None = None, use_judge: bool = True) -> dict:
    """Cheap half: scoring, pacing, brand matching, judge, VMAP. Re-runnable in seconds
    (e.g. after adding a 9th brand or changing pacing)."""
    log = _logger(job_id)
    duration = analysis["media"]["duration"]
    cands = scoring.score_candidates(analysis, analysis["silences"], analysis["shot_cuts"], duration)
    scenes_by_id = {s["id"]: s for s in analysis["scenes"]}

    vetoed: dict[str, str] = {}          # candidate id → reason
    exclusions: dict[str, dict] = {}     # break id → {brand_id: reason}
    judge_log: list[dict] = []
    placed, rejected = [], []
    for round_no in range(2):
        selected, rejected = scoring.select_breaks(cands, duration, pacing, vetoed)
        log(f"scoring: {len(cands)} candidates → {len(selected)} breaks" + (f" (round {round_no+1})" if round_no else ""))
        placed = matching.match(selected, scenes_by_id, catalogue, log=log, use_llm=use_llm, exclusions=exclusions)
        if not (use_judge and judge.enabled()):
            if round_no == 0:
                log("judge: skipped")
            break
        try:
            verdicts = judge.judge(video_path, placed, scenes_by_id, log=log)
        except Exception as e:
            log(f"judge: failed, keeping placement as-is: {type(e).__name__}: {e}"[:300])
            break
        by_id = {v.break_id: v for v in verdicts}
        changed = False
        for p in placed:
            v = by_id.get(p["id"])
            if not v:
                continue
            p["judge"] = v.model_dump()
            judge_log.append({"round": round_no + 1, **v.model_dump(), "brand_id": p["brand"]["id"], "time": p["time"]})
            if v.cut_verdict == "jarring":
                vetoed[p["id"]] = f"judge: jarring cut — {v.notes}"
                changed = True
            elif v.brand_verdict in ("violation", "mismatch") and p["match_method"] != "fallback":
                exclusions.setdefault(p["id"], {})[p["brand"]["id"]] = f"judge:{v.brand_verdict}"
                changed = True
        if not changed:
            break
        log("judge: requested changes, re-placing")

    # Never ship a break the judge still calls jarring: fewer breaks beats a bad one.
    still_bad = [p for p in placed if p.get("judge", {}).get("cut_verdict") == "jarring"]
    if still_bad:
        for p in still_bad:
            rejected.append({**{k: v for k, v in p.items() if k not in ("brand", "brand_rows")},
                             "rejected_because": f"judge: jarring cut — {p['judge']['notes']}"})
            log(f"judge: dropping break @{p['time']:.1f}s (still jarring after re-placement)")
        placed = [p for p in placed if p not in still_bad]

    for p in placed:
        log(f"break @{p['time']:.1f}s → {p['brand']['name']} ({p['match_method']})"
            + (f" · judge: cut={p['judge']['cut_verdict']} brand={p['judge']['brand_verdict']}" if p.get("judge") else ""))
    xml = vmap.build_vmap(job_id, placed, pacing["ad_duration_seconds"], creative_base_url)
    return {
        "pacing": pacing,
        "candidates": cands,
        "rejected": rejected,
        "breaks": placed,
        "judge": judge_log,
        "vmap": xml,
        "brand_ids": [b["id"] for b in catalogue["brands"]],
    }


def run_job(job_id: str, video_path: str, pacing: dict | None = None, owner_id: int | None = None) -> None:
    try:
        analysis = analyze(job_id, video_path)
        store.update(job_id, analysis=analysis)
        store.set_progress(job_id, "placement", 85, "Scoring breaks and matching brands")
        result = place(job_id, analysis, matching.load_brands(owner_id), {**config.DEFAULT_PACING, **(pacing or {})},
                       config.CREATIVE_BASE_URL, video_path=video_path)
        store.update(job_id, result=result, status="done", stage="done", progress=100, message="")
    except Exception as e:
        traceback.print_exc()
        store.update(job_id, status="error", message=f"{type(e).__name__}: {e}"[:500])
