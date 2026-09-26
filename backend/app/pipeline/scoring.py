"""WHERE + WHETHER.

Candidates come from two sources: every scene boundary (Gemini) and every
intra-scene pause point (Gemini). Each cut is snapped to the nearest "pause" —
a silence gap (ffmpeg, precise) or a gap between speech passages (Gemini,
coarse but robust to music beds). Scores are built from explainable components
so the debug JSON says exactly why a break was kept or dropped. Pacing rules
then decide which candidates actually become breaks."""
from bisect import bisect_left

SNAP_WINDOW = 6.0        # seconds around a boundary we may move the cut
IDEAL_PAUSE = 1.2        # a pause this long or longer is "clean"
HARD_SILENCE = 1.0       # ffmpeg silence this long overrides a coarse speech passage


def _speech_gaps(speech: list[dict], duration: float) -> list[dict]:
    gaps, prev_end = [], 0.0
    for p in speech:
        if p["start"] - prev_end >= 0.8:
            gaps.append({"start": prev_end, "end": p["start"], "dur": round(p["start"] - prev_end, 2), "kind": "speech_gap"})
        prev_end = max(prev_end, p["end"])
    if duration - prev_end >= 0.8:
        gaps.append({"start": prev_end, "end": duration, "dur": round(duration - prev_end, 2), "kind": "speech_gap"})
    return gaps


def _nearest(t: float, gaps: list[dict]) -> tuple[dict | None, float]:
    best, best_d = None, None
    for g in gaps:
        d = 0.0 if g["start"] <= t <= g["end"] else min(abs(t - g["start"]), abs(t - g["end"]))
        if d <= SNAP_WINDOW and (best_d is None or d < best_d):
            best, best_d = g, d
    return best, (best_d if best_d is not None else 1e9)


def _in_speech(t: float, speech: list[dict], pad: float = 0.25) -> dict | None:
    for p in speech:
        if p["start"] + pad < t < p["end"] - pad:
            return p
    return None


def _near_shot_cut(t: float, cuts: list[float], tol: float = 0.75) -> bool:
    if not cuts:
        return False
    i = bisect_left(cuts, t)
    return any(0 <= j < len(cuts) and abs(cuts[j] - t) <= tol for j in (i - 1, i))


def _scene_at(t: float, scenes: list[dict]) -> dict | None:
    for s in scenes:
        if s["start"] <= t < s["end"]:
            return s
    return scenes[-1] if scenes and t >= scenes[-1]["end"] else None


def _score_point(t0: float, boundary_quality: float, source: str, scenes, speech, silences, speech_gaps, shot_cuts):
    sil, sil_d = _nearest(t0, silences)
    sgap, sgap_d = _nearest(t0, speech_gaps)
    # prefer the precise ffmpeg silence when it exists; fall back to the speech gap
    if sil and (sil_d <= sgap_d + 1.0 or not sgap):
        gap, gap_kind = sil, "silence"
    else:
        gap, gap_kind = sgap, "speech_gap"
    if gap:
        # cut where the pause is quietest: its midpoint, but never more than SNAP_WINDOW from t0
        cut = min(max((gap["start"] + gap["end"]) / 2, t0 - SNAP_WINDOW), t0 + SNAP_WINDOW)
        cut = min(max(cut, gap["start"] + 0.15), gap["end"] - 0.15) if gap["end"] - gap["start"] > 0.3 else cut
        gap_len = gap["dur"]
    else:
        cut, gap_len = t0, 0.0
    comp = {}
    pause = min(gap_len / IDEAL_PAUSE, 1.0)
    comp["pause"] = round(pause * (1.0 if gap_kind == "silence" else 0.8), 3)
    comp["boundary_quality"] = float(boundary_quality)
    comp["shot_cut"] = 1.0 if _near_shot_cut(cut, shot_cuts) else (0.5 if not shot_cuts else 0.0)
    sp = _in_speech(cut, speech)
    hard_silence = sil is not None and sil["start"] <= cut <= sil["end"] and sil["dur"] >= HARD_SILENCE
    mid_speech = bool(sp) and not hard_silence
    comp["mid_speech_penalty"] = -0.6 if mid_speech else 0.0
    comp["no_pause_penalty"] = -0.35 if gap is None else 0.0
    comp["source_penalty"] = -0.08 if source == "pause_point" else 0.0
    score = (0.45 * comp["pause"] + 0.35 * comp["boundary_quality"] + 0.20 * comp["shot_cut"]
             + comp["mid_speech_penalty"] + comp["no_pause_penalty"] + comp["source_penalty"])
    score = max(0.0, min(1.0, score))
    reasons = []
    if mid_speech:
        reasons.append(f"cut falls inside speech {sp['start']:.1f}-{sp['end']:.1f}s")
    elif sp and hard_silence:
        reasons.append(f"inside a coarse speech passage but on a {sil['dur']:.2f}s hard silence")
    if gap is None:
        reasons.append("no pause within snap window")
    else:
        reasons.append(f"{'clean' if gap_len >= IDEAL_PAUSE else 'short'} {gap_len:.2f}s {gap_kind.replace('_', ' ')}")
    if comp["shot_cut"] == 1.0:
        reasons.append("aligned with shot change")
    scene_before = _scene_at(cut - 0.01, scenes)
    scene_after = _scene_at(cut + 0.01, scenes)
    return cut, score, comp, reasons, mid_speech, scene_before, scene_after


def score_candidates(analysis: dict, silences: list[dict], shot_cuts: list[float], duration: float) -> list[dict]:
    scenes = analysis["scenes"]
    speech = analysis["speech"]
    speech_gaps = _speech_gaps(speech, duration)
    for s in silences:
        s.setdefault("kind", "silence")
    points = []
    for i in range(len(scenes) - 1):
        points.append((scenes[i]["end"], float(scenes[i].get("boundary_quality", 0.5)), "scene_boundary",
                       scenes[i].get("ends_on_cliffhanger", False), scenes[i].get("chunk_edge", False), ""))
    for p in analysis.get("pause_points", []):
        points.append((p["time"], float(p.get("quality", 0.5)), "pause_point", False, False, p.get("reason", "")))
    points.sort(key=lambda x: x[0])
    cands = []
    for i, (t0, bq, source, cliff, chunk_edge, reason) in enumerate(points):
        cut, score, comp, reasons, mid_speech, before, after = _score_point(
            t0, bq, source, scenes, speech, silences, speech_gaps, shot_cuts)
        if before is None or after is None:
            continue
        comp["cliffhanger_bonus"] = 0.05 if cliff else 0.0
        comp["chunk_edge_penalty"] = -0.1 if chunk_edge else 0.0
        score = max(0.0, min(1.0, score + comp["cliffhanger_bonus"] + comp["chunk_edge_penalty"]))
        if reason:
            reasons.append(f"gemini: {reason}")
        cands.append({
            "id": f"c{i+1:03d}",
            "time": round(cut, 2),
            "anchor_time": round(t0, 2),
            "source": source,
            "scene_before": before["id"],
            "scene_after": after["id"],
            "cut_safety": round(score, 3),
            "components": {k: round(v, 3) for k, v in comp.items()},
            "reasons": reasons,
            "mid_speech": mid_speech,
        })
    # de-duplicate cuts that snapped to the same pause
    dedup, seen = [], []
    for c in sorted(cands, key=lambda c: -c["cut_safety"]):
        if any(abs(c["time"] - t) < 2.0 for t in seen):
            continue
        seen.append(c["time"]); dedup.append(c)
    return sorted(dedup, key=lambda c: c["time"])


def select_breaks(cands: list[dict], duration: float, pacing: dict, vetoed: dict | None = None) -> tuple[list[dict], list[dict]]:
    """Greedy: best-scoring candidates first, respecting all pacing rules.
    `vetoed` maps candidate id → reason (e.g. from the judge); those are rejected first.
    Returns (selected, rejected_with_reason)."""
    vetoed = vetoed or {}
    hours = max(duration / 3600.0, 1e-6)
    max_breaks = max(1, int(pacing["max_breaks_per_hour"] * hours + 0.5))
    ad_len = pacing["ad_duration_seconds"]
    if ad_len:
        max_breaks = min(max_breaks, max(1, int(duration * pacing["max_ad_load_pct"] / 100.0 // ad_len)))
    selected, rejected = [], []
    for c in sorted(cands, key=lambda c: -c["cut_safety"]):
        why = None
        if c["id"] in vetoed:
            why = vetoed[c["id"]]
        elif c["mid_speech"]:
            why = "mid-speech cut"
        elif c["cut_safety"] < pacing["min_cut_safety"]:
            why = f"cut_safety {c['cut_safety']} < min {pacing['min_cut_safety']}"
        elif c["time"] < pacing["no_break_before_seconds"]:
            why = "too close to start"
        elif c["time"] > duration - pacing["no_break_after_seconds"]:
            why = "too close to end"
        elif len(selected) >= max_breaks:
            why = f"break budget reached ({max_breaks} for {duration/60:.0f} min at {pacing['max_breaks_per_hour']}/hr, ad load ≤{pacing['max_ad_load_pct']}%)"
        elif any(abs(c["time"] - s["time"]) < pacing["min_gap_seconds"] for s in selected):
            why = f"within min gap {pacing['min_gap_seconds']}s of another break"
        if why:
            rejected.append({**c, "rejected_because": why})
        else:
            selected.append(c)
    selected.sort(key=lambda c: c["time"])
    return selected, rejected
