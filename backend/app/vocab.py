"""Controlled context vocabulary shared by scene analysis and the brand catalogue.

Gemini must label every scene using only these tags (enforced via response
schema), and brands declare target_contexts / negative_contexts from the same
list. That makes the negative-context block a deterministic set intersection
and lets a brand nobody has seen before be matched with zero code changes.
"""

CONTEXT_TAGS = [
    # settings / activities
    "family", "home", "kitchen", "cooking", "eating", "food", "tea",
    "romance", "wedding", "festival", "celebration", "party", "music", "dance",
    "travel", "road", "vehicle", "train", "nature", "rain", "village", "city",
    "office", "business", "money", "shopping", "market", "phone",
    "study", "school", "children", "sports", "comedy",
    "religious", "night", "morning",
    # sensitive / negative-leaning
    "hospital", "illness", "injury", "death", "funeral", "grief", "sadness",
    "violence", "fight", "crime", "theft", "fraud", "police", "accident",
    "argument", "tension", "horror", "alcohol", "smoking", "intimacy",
    "poverty", "hunger", "disaster",
]

MOODS = ["joyful", "warm", "neutral", "romantic", "tense", "suspenseful", "sad", "grim", "comic", "dramatic"]

TAG_SET = set(CONTEXT_TAGS)
