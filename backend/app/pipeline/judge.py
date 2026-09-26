"""Independent second-opinion judge (Claude).

Gemini perceives and proposes; Claude audits. For every selected break the judge
sees the keyframes just before and after the cut, the surrounding scene analysis,
why the cut was chosen, and the brand that was matched, and returns a structured
verdict. A "jarring" cut is removed and the next candidate takes its place; a brand
"violation"/"mismatch" excludes that brand for that slot and the matcher re-runs.
Skipped (with a log line) when ANTHROPIC_API_KEY is not configured."""
import base64
import os
import tempfile
from typing import Literal

from pydantic import BaseModel

from .. import config
from . import audio

MODEL = "claude-opus-5"


class Verdict(BaseModel):
    break_id: str
    cut_verdict: Literal["natural", "acceptable", "jarring"]
    brand_verdict: Literal["fit", "neutral", "mismatch", "violation"]
    confidence: float
    notes: str


class Verdicts(BaseModel):
    verdicts: list[Verdict]


def enabled() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def _frame_b64(video_path: str, t: float) -> str | None:
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            out = f.name
        audio.extract_frame(video_path, max(0.0, t), out, height=360)
        data = base64.standard_b64encode(open(out, "rb").read()).decode()
        os.unlink(out)
        return data
    except Exception:
        return None


def judge(video_path: str | None, breaks: list[dict], scenes_by_id: dict, log=print) -> list[Verdict]:
    if not enabled() or not breaks:
        return []
    import anthropic

    client = anthropic.Anthropic()
    content = [{"type": "text", "text": (
        "You are the final QC reviewer for ad-break insertion in a Bengali drama episode on a streaming service. "
        "Another system proposed the breaks below. For EACH break, judge two things independently:\n"
        "1. cut_verdict — would a viewer experience this cut as a natural pause (scene/location change, beat resolved), "
        "acceptable, or jarring (mid-conversation, mid-action, emotionally wrong moment)? Use the two keyframes (just before / just after the cut) and the scene context.\n"
        "2. brand_verdict — is the matched brand a fit, neutral, a mismatch (tonally wrong), or a violation "
        "(the surrounding content clearly conflicts with the brand's negative contexts / rules, e.g. a food ad after a funeral or a vehicle ad after a crash)?\n"
        "Be strict on violations — they are the worst outcome. Be practical on cuts — broadcasters interrupt scenes; only flag 'jarring' when the cut is clearly bad. "
        "Return one verdict per break_id, in order."
    )}]
    for b in breaks:
        before, after = scenes_by_id[b["scene_before"]], scenes_by_id[b["scene_after"]]
        brand = b["brand"]
        content.append({"type": "text", "text":
            f"\n### {b['id']} — cut at {b['time']:.1f}s (cut_safety {b['cut_safety']}, source {b['source']})\n"
            f"Cut reasons: {'; '.join(b['reasons'])}\n"
            f"Scene before: {before['title']} — {before['summary']} [activity: {before['dominant_activity']}; tags: {', '.join(before['tags'])}; mood: {before['mood']}; sensitive: {before['sensitive']}]\n"
            f"Scene after: {after['title']} — {after['summary']} [activity: {after['dominant_activity']}; tags: {', '.join(after['tags'])}; mood: {after['mood']}; sensitive: {after['sensitive']}]\n"
            f"Matched brand: {brand['name']} ({brand.get('category','')}) — tagline '{brand.get('tagline','')}'. "
            f"Negative contexts: {', '.join(brand.get('negative_contexts', [])) or 'none'}. Rule: {brand.get('negative_description') or 'none'}. "
            f"Matcher rationale: {b.get('rationale','')}"})
        if video_path and os.path.exists(video_path):
            for label, t in (("just before the cut", b["time"] - 1.5), ("just after the cut", b["time"] + 1.5)):
                img = _frame_b64(video_path, t)
                if img:
                    content.append({"type": "text", "text": f"Keyframe {label}:"})
                    content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": img}})

    response = client.messages.parse(
        model=MODEL,
        max_tokens=4000,
        messages=[{"role": "user", "content": content}],
        output_format=Verdicts,
    )
    if response.stop_reason == "refusal" or response.parsed_output is None:
        log(f"judge: no verdict (stop_reason={response.stop_reason})")
        return []
    u = response.usage
    log(f"judge: {MODEL} reviewed {len(breaks)} breaks ({u.input_tokens} in / {u.output_tokens} out)")
    return response.parsed_output.verdicts
