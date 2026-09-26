"""Orchestration: video path → analysis → scored candidates → breaks → brands → VMAP."""
import time
import traceback
from pathlib import Path

from .. import config, store
from . import audio, gemini, matching, scoring, vmap


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
    store.set_progress(job_id, "probe", 2, "reading media info")
    info = audio.probe(video_path)
    log(f"media: {info['duration']:.1f}s {info['width']}x{info['height']} {info['size_bytes']/1e6:.0f}MB")

    store.set_progress(job_id, "silence", 5, "mapping silences (ffmpeg)")
    silences = audio.silence_map(video_path)
    log(f"silence: {len(silences)} gaps")

    cuts = []
    if config.SHOT_DETECT:
        store.set_progress(job_id, "shots", 10, "detecting shot changes (ffmpeg)")
        cuts = audio.shot_cuts(video_path)
        log(f"shots: {len(cuts)} cuts")

    store.set_progress(job_id, "upload", 15, "uploading to Gemini Files API")
    file = gemini.upload_video(video_path, log=log)

    store.set_progress(job_id, "gemini", 20, "scene analysis")
    analysis = gemini.analyze_video(
        file, info["duration"], log=log,
        on_progress=lambda f: store.set_progress(job_id, "gemini", 20 + 60 * f, f"scene analysis {int(f*100)}%"),
    )
    log(f"gemini: {len(analysis['scenes'])} scenes, {len(analysis['speech'])} speech passages")
    return {"media": info, "silences": silences, "shot_cuts": cuts, **analysis}


def place(job_id: str, analysis: dict, catalogue: dict, pacing: dict, creative_base_url: str, use_llm: bool = True) -> dict:
    """Cheap half: scoring, pacing, brand matching, VMAP. Re-runnable in seconds
    (e.g. after adding a 9th brand or changing pacing)."""
    log = _logger(job_id)
    duration = analysis["media"]["duration"]
    cands = scoring.score_candidates(analysis, analysis["silences"], analysis["shot_cuts"], duration)
    selected, rejected = scoring.select_breaks(cands, duration, pacing)
    log(f"scoring: {len(cands)} candidates → {len(selected)} breaks")
    scenes_by_id = {s["id"]: s for s in analysis["scenes"]}
    placed = matching.match(selected, scenes_by_id, catalogue, log=log, use_llm=use_llm)
    for p in placed:
        log(f"break @{p['time']:.1f}s → {p['brand']['name']} ({p['match_method']})")
    xml = vmap.build_vmap(job_id, placed, pacing["ad_duration_seconds"], creative_base_url)
    return {
        "pacing": pacing,
        "candidates": cands,
        "rejected": rejected,
        "breaks": placed,
        "vmap": xml,
        "brand_ids": [b["id"] for b in catalogue["brands"]],
    }


def run_job(job_id: str, video_path: str, pacing: dict | None = None) -> None:
    try:
        analysis = analyze(job_id, video_path)
        store.update(job_id, analysis=analysis)
        store.set_progress(job_id, "placement", 85, "scoring breaks and matching brands")
        result = place(job_id, analysis, matching.load_brands(), {**config.DEFAULT_PACING, **(pacing or {})}, config.CREATIVE_BASE_URL)
        store.update(job_id, result=result, status="done", stage="done", progress=100, message="")
    except Exception as e:
        traceback.print_exc()
        store.update(job_id, status="error", message=f"{type(e).__name__}: {e}"[:500])
