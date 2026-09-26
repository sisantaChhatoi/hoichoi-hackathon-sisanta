"""WHAT: pick the brand for each break.

Two gates, then a ranker:
  1. deterministic hard block: brand.negative_contexts ∩ (tags of scene before ∪ scene after)
  2. LLM gate on the brand's free-text negative_description (conservative)
  3. ranking = tag overlap with the dominant (preceding) scene, weighted, plus an
     LLM tie-break with a written rationale.
Fully data-driven: a brand never seen before works if it uses the vocabulary."""
import json
from pathlib import Path

from .. import config
from .gemini import generate

RANK_SCHEMA = {
    "type": "object",
    "properties": {
        "choices": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "break_id": {"type": "string"},
                    "brand_id": {"type": "string"},
                    "rationale": {"type": "string"},
                    "conflicts": {"type": "array", "items": {"type": "string"},
                                  "description": "brand_ids among the allowed list that you judge to violate their own negative_description for this slot"},
                },
                "required": ["break_id", "brand_id", "rationale", "conflicts"],
            },
        }
    },
    "required": ["choices"],
}


def load_brands(path: Path | None = None) -> dict:
    return json.loads((path or config.BRANDS_FILE).read_text())


def _ctx_tags(scene_before: dict, scene_after: dict) -> tuple[set, set]:
    return set(scene_before.get("tags", [])), set(scene_after.get("tags", []))


def hard_block(brand: dict, before_tags: set, after_tags: set) -> list[str]:
    neg = set(brand.get("negative_contexts", []))
    hits = sorted(neg & (before_tags | after_tags))
    return hits


def affinity(brand: dict, before: dict, after: dict) -> float:
    tgt = set(brand.get("target_contexts", []))
    if not tgt:
        return 0.0
    b, a = set(before.get("tags", [])), set(after.get("tags", []))
    score = 1.0 * len(tgt & b) + 0.4 * len(tgt & a)
    if before.get("dominant_activity", "").lower() in {t.lower() for t in tgt}:
        score += 0.5
    if before.get("mood") in tgt:
        score += 0.3
    return round(score / max(len(tgt), 1) * 3, 3)


def match(breaks: list[dict], scenes_by_id: dict, catalogue: dict, log=print, use_llm: bool = True,
          exclusions: dict | None = None) -> list[dict]:
    """`exclusions` maps break id → {brand_id: reason} for brands vetoed on that slot (e.g. by the judge)."""
    brands = catalogue["brands"]
    fallback = catalogue.get("fallback")
    exclusions = exclusions or {}
    per_break = []
    for br in breaks:
        before, after = scenes_by_id[br["scene_before"]], scenes_by_id[br["scene_after"]]
        bt, at = _ctx_tags(before, after)
        rows = []
        for b in brands:
            hits = hard_block(b, bt, at)
            if b["id"] in exclusions.get(br["id"], {}):
                hits = hits + [exclusions[br["id"]][b["id"]]]
            rows.append({"brand_id": b["id"], "blocked_by": hits, "affinity": affinity(b, before, after)})
        allowed = [r for r in rows if not r["blocked_by"]]
        per_break.append({"break": br, "before": before, "after": after, "rows": rows, "allowed": allowed})

    llm = {}
    if use_llm and any(pb["allowed"] for pb in per_break):
        slots = []
        for pb in per_break:
            if not pb["allowed"]:
                continue
            allowed_ids = {r["brand_id"] for r in pb["allowed"]}
            slots.append({
                "break_id": pb["break"]["id"],
                "time_seconds": pb["break"]["time"],
                "scene_before": {k: pb["before"].get(k) for k in ("title", "summary", "dominant_activity", "tags", "mood", "sensitive")},
                "scene_after": {k: pb["after"].get(k) for k in ("title", "summary", "dominant_activity", "tags", "mood", "sensitive")},
                "allowed_brands": [
                    {k: b.get(k) for k in ("id", "name", "category", "target_contexts", "negative_description")}
                    for b in brands if b["id"] in allowed_ids
                ],
                "tag_affinity": {r["brand_id"]: r["affinity"] for r in pb["allowed"]},
            })
        prompt = (
            "You are placing ads inside a Bengali drama. For each ad slot, choose the ONE brand from allowed_brands whose creative "
            "fits most naturally with what the viewer has just watched (scene_before dominates; scene_after matters a little). "
            "The dominant scene activity wins over incidental details. tag_affinity is a hint, not a rule.\n"
            "First, for each slot, list in `conflicts` every allowed brand whose own negative_description would be violated by "
            "this slot — be strict and conservative; a food ad after a funeral or illness is never acceptable. Never choose a conflicting brand.\n"
            "Prefer variety across slots: do not pick the same brand for adjacent slots unless it is clearly the only good fit.\n"
            "Write a one-sentence rationale in English that cites the specific scene content.\n\n"
            f"SLOTS:\n{json.dumps(slots, ensure_ascii=False)}"
        )
        try:
            res = generate([{"text": prompt}], RANK_SCHEMA, models=config.GEMINI_TEXT_MODELS, log=log, temperature=0.3)
            for c in res.get("choices", []):
                llm[c["break_id"]] = c
        except Exception as e:
            log(f"matching: llm ranking failed, falling back to tag affinity: {e}")

    results, last_brand = [], None
    for pb in per_break:
        br = pb["break"]
        allowed = list(pb["allowed"])
        choice = llm.get(br["id"], {})
        conflicts = set(choice.get("conflicts", []))
        for r in pb["rows"]:
            if r["brand_id"] in conflicts and not r["blocked_by"]:
                r["blocked_by"] = ["llm:negative_description"]
        allowed = [r for r in allowed if r["brand_id"] not in conflicts]
        allowed_ids = {r["brand_id"] for r in allowed}
        chosen_id, rationale, method = None, "", ""
        if choice.get("brand_id") in allowed_ids:
            chosen_id, rationale, method = choice["brand_id"], choice.get("rationale", ""), "llm"
        elif allowed:
            ranked = sorted(allowed, key=lambda r: (-r["affinity"], r["brand_id"] == last_brand))
            chosen_id, method = ranked[0]["brand_id"], "tag_affinity"
            rationale = f"Highest tag affinity ({ranked[0]['affinity']}) with the preceding scene."
        if chosen_id is None:
            brand = fallback
            method, rationale = "fallback", "Every catalogue brand is blocked by the surrounding context; house promo used."
        else:
            brand = next(b for b in brands if b["id"] == chosen_id)
        last_brand = brand["id"] if brand else None
        results.append({
            **br,
            "brand": brand,
            "match_method": method,
            "rationale": rationale,
            "brand_rows": pb["rows"],
        })
    return results
