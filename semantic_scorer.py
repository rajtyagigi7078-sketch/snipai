import json
import re
import sys
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer


# ============================================================
# Snip AI — Fast Semantic Moment Scorer
# ============================================================

MODEL_NAME = "all-MiniLM-L6-v2"

MAX_CLIPS = 10

# We only send this many candidates to MiniLM.
SEMANTIC_CANDIDATES = 60

MIN_DURATION = 18.0
MAX_DURATION = 45.0


# ------------------------------------------------------------
# Fast lexical signals
# ------------------------------------------------------------

STRONG_WORDS = {
    "fight", "fighting", "box", "boxing",
    "spar", "sparring", "knock", "knocked",
    "knockout", "beat", "beaten",
    "challenge", "challenged",
    "disrespect", "disrespected",
    "respect", "hate", "hating",
    "crazy", "insane", "money",
    "truth", "problem", "started",
    "happened", "called", "dangerous",
    "hurt", "destroyed", "muscle",
}

EMOTION_WORDS = {
    "hate", "hating", "angry", "mad",
    "damn", "shit", "fuck", "fucking",
    "scared", "tough", "wild",
    "crazy", "insane",
}

STORY_WORDS = {
    "started", "happened", "ran",
    "met", "called", "text",
    "message", "came", "went",
    "showed", "said", "told",
    "asked", "wanted", "ended",
    "finally",
}

FILLER_PHRASES = {
    "what's up guys",
    "welcome back",
    "welcome to",
    "in this episode",
    "in this video",
    "today we're",
    "today we are",
    "make sure to subscribe",
    "like and subscribe",
    "crypto in it behind us",
}


# ------------------------------------------------------------
# Semantic concepts
# ------------------------------------------------------------

POSITIVE_CONCEPTS = [
    "a viral short form video moment with a strong hook",
    "a highly entertaining moment",
    "a surprising unexpected moment",
    "a funny moment that viewers would share",
    "a heated confrontation or argument",
    "a strong controversial opinion",
    "an intense fight or boxing story",
    "a compelling personal story",
    "a story with a clear setup and payoff",
    "a moment that makes sense as a standalone short clip",
    "a dramatic moment with tension",
    "a memorable statement that grabs attention",
]

NEGATIVE_CONCEPTS = [
    "a podcast introduction",
    "people greeting each other",
    "boring small talk",
    "irrelevant background information",
    "advertising or promotion",
    "a long setup without a payoff",
    "a repetitive conversation",
    "a clip that needs lots of previous context",
]


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def tokenize(text):
    return re.findall(
        r"\b[a-zA-Z']+\b",
        text.lower()
    )


def fast_score(text, duration):
    """
    Very cheap scoring.
    Used only to reduce 1000+ windows to a manageable
    number before semantic inference.
    """

    tokens = tokenize(text)
    token_set = set(tokens)

    score = 0.0

    strong_hits = token_set.intersection(
        STRONG_WORDS
    )

    emotion_hits = token_set.intersection(
        EMOTION_WORDS
    )

    story_hits = token_set.intersection(
        STORY_WORDS
    )

    score += min(
        len(strong_hits) * 2.5,
        18
    )

    score += min(
        len(emotion_hits) * 2.0,
        10
    )

    score += min(
        len(story_hits) * 1.5,
        7
    )

    if "?" in text:
        score += 3

    word_count = len(tokens)

    if word_count >= 35:
        score += 5

    elif word_count >= 25:
        score += 3

    elif word_count < 10:
        score -= 8

    # Ideal short-form duration.
    if 22 <= duration <= 38:
        score += 7

    elif 18 <= duration < 22:
        score += 3

    elif 38 < duration <= 45:
        score += 2

    # Intro/filler penalty.
    lower = text.lower()

    for phrase in FILLER_PHRASES:
        if phrase in lower:
            score -= 8

    # Combination bonuses.
    if strong_hits and story_hits:
        score += 5

    if strong_hits and emotion_hits:
        score += 5

    return score


def build_candidates(segments):
    """
    Generate 18–45 second windows.
    """

    candidates = []

    for i in range(len(segments)):

        start = float(
            segments[i]["start"]
        )

        text_parts = []

        for j in range(
            i,
            len(segments)
        ):

            end = float(
                segments[j]["end"]
            )

            duration = end - start

            if duration > MAX_DURATION:
                break

            text_parts.append(
                segments[j]["text"]
            )

            if duration < MIN_DURATION:
                continue

            text = " ".join(
                text_parts
            ).strip()

            score = fast_score(
                text,
                duration
            )

            if score < 3:
                continue

            candidates.append(
                {
                    "start": round(
                        start,
                        2
                    ),
                    "end": round(
                        end,
                        2
                    ),
                    "duration": round(
                        duration,
                        2
                    ),
                    "text": text,
                    "fast_score": round(
                        score,
                        2
                    ),
                }
            )

    return candidates


def overlap_ratio(a, b):
    start = max(
        a["start"],
        b["start"]
    )

    end = min(
        a["end"],
        b["end"]
    )

    overlap = max(
        0,
        end - start
    )

    if overlap <= 0:
        return 0.0

    shortest = min(
        a["duration"],
        b["duration"]
    )

    if shortest <= 0:
        return 0.0

    return overlap / shortest


def light_deduplicate(candidates):
    """
    Light deduplication.

    Important:
    We deliberately keep more candidates here so the
    semantic model gets actual choices.
    """

    ranked = sorted(
        candidates,
        key=lambda x: x["fast_score"],
        reverse=True
    )

    selected = []

    for candidate in ranked:

        duplicate = False

        for existing in selected:

            if overlap_ratio(
                candidate,
                existing
            ) >= 0.70:
                duplicate = True
                break

        if not duplicate:
            selected.append(
                candidate
            )

    return selected


def duration_quality(duration):
    """
    Returns 0–1 quality for clip duration.
    """

    if 22 <= duration <= 38:
        return 1.0

    if 20 <= duration < 22:
        return 0.8

    if 38 < duration <= 40:
        return 0.8

    if 18 <= duration < 20:
        return 0.6

    if 40 < duration <= 45:
        return 0.6

    return 0.3


def final_selection(candidates):
    """
    Select diverse moments after semantic scoring.
    """

    ranked = sorted(
        candidates,
        key=lambda x: x["final_score"],
        reverse=True
    )

    selected = []

    for candidate in ranked:

        reject = False

        for existing in selected:

            overlap = overlap_ratio(
                candidate,
                existing
            )

            if overlap >= 0.40:
                reject = True
                break

            # Don't pick two moments from almost
            # the same local section.
            distance = min(
                abs(
                    candidate["start"]
                    - existing["end"]
                ),
                abs(
                    existing["start"]
                    - candidate["end"]
                )
            )

            if distance < 6:
                reject = True
                break

        if reject:
            continue

        selected.append(
            candidate
        )

        if len(selected) >= MAX_CLIPS:
            break

    return sorted(
        selected,
        key=lambda x: x["start"]
    )


def main():

    if len(sys.argv) < 2:
        print(
            "Usage:"
        )
        print(
            "python semantic_scorer.py "
            "/path/to/transcript.json"
        )
        sys.exit(1)

    transcript_path = Path(
        sys.argv[1]
    )

    if not transcript_path.exists():
        print(
            f"Transcript not found: "
            f"{transcript_path}"
        )
        sys.exit(1)

    data = load_json(
        transcript_path
    )

    segments = data.get(
        "segments",
        []
    )

    if not segments:
        print(
            "No transcript segments found."
        )
        sys.exit(1)

    print()
    print(
        "Loading semantic model..."
    )

    model = SentenceTransformer(
        MODEL_NAME,
        device="cpu"
    )

    # Keep CPU inference efficient.
    try:
        import torch

        torch.set_num_threads(8)

    except Exception:
        pass

    print(
        f"Loaded {len(segments)} "
        f"transcript segments."
    )

    # ========================================================
    # PHASE 1 — Fast candidate generation
    # ========================================================

    print(
        "Building fast candidates..."
    )

    candidates = build_candidates(
        segments
    )

    print(
        f"Fast candidates: "
        f"{len(candidates)}"
    )

    # ========================================================
    # PHASE 2 — Light deduplication
    # ========================================================

    candidates = light_deduplicate(
        candidates
    )

    print(
        f"After light deduplication: "
        f"{len(candidates)}"
    )

    # Keep the strongest candidates.
    candidates = sorted(
        candidates,
        key=lambda x: x["fast_score"],
        reverse=True
    )

    candidates = candidates[
        :SEMANTIC_CANDIDATES
    ]

    print(
        f"Semantic candidates: "
        f"{len(candidates)}"
    )

    if not candidates:
        print(
            "No suitable candidates found."
        )
        sys.exit(1)

    # ========================================================
    # PHASE 3 — Semantic embeddings
    # ========================================================

    print(
        "Encoding semantic concepts..."
    )

    positive_embeddings = model.encode(
        POSITIVE_CONCEPTS,
        normalize_embeddings=True,
        batch_size=16,
        show_progress_bar=False
    )

    negative_embeddings = model.encode(
        NEGATIVE_CONCEPTS,
        normalize_embeddings=True,
        batch_size=16,
        show_progress_bar=False
    )

    texts = [
        c["text"]
        for c in candidates
    ]

    print(
        "Scoring candidates..."
    )

    candidate_embeddings = model.encode(
        texts,
        normalize_embeddings=True,
        batch_size=32,
        show_progress_bar=True
    )

    # ========================================================
    # PHASE 4 — Final scoring
    # ========================================================

    for index, candidate in enumerate(
        candidates
    ):

        embedding = candidate_embeddings[
            index
        ]

        positive_similarity = float(
            np.mean(
                positive_embeddings
                @ embedding
            )
        )

        negative_similarity = float(
            np.mean(
                negative_embeddings
                @ embedding
            )
        )

        semantic_score = (
            positive_similarity
            - negative_similarity
        )

        duration_score = (
            duration_quality(
                candidate["duration"]
            )
        )

        # Normalize fast score roughly into
        # a useful range.
        fast_component = min(
            candidate["fast_score"],
            40
        ) / 40.0

        # Main weighting.
        final_score = (
            semantic_score * 70
            + duration_score * 15
            + fast_component * 15
        )

        candidate[
            "semantic_score"
        ] = round(
            semantic_score,
            4
        )

        candidate[
            "final_score"
        ] = round(
            final_score,
            2
        )

    # ========================================================
    # PHASE 5 — Top unique clips
    # ========================================================

    selected = final_selection(
        candidates
    )

    # ========================================================
    # Save output
    # ========================================================

    output = {
        "video": data.get("video"),
        "duration": data.get("duration"),
        "language": data.get("language"),
        "model": MODEL_NAME,
        "semantic_candidates": len(
            candidates
        ),
        "selected_count": len(
            selected
        ),
        "selected_clips": [],
    }

    for number, clip in enumerate(
        selected,
        start=1
    ):

        output[
            "selected_clips"
        ].append(
            {
                "clip_number": number,
                "start": clip["start"],
                "end": clip["end"],
                "duration": clip["duration"],
                "score": clip[
                    "final_score"
                ],
                "semantic_score": clip[
                    "semantic_score"
                ],
                "fast_score": clip[
                    "fast_score"
                ],
                "text": clip["text"],
            }
        )

    output_path = transcript_path.with_name(
        transcript_path.stem.replace(
            ".transcript",
            ""
        )
        + ".semantic-moments.json"
    )

    with open(
        output_path,
        "w",
        encoding="utf-8"
    ) as f:

        json.dump(
            output,
            f,
            indent=2,
            ensure_ascii=False
        )

    # ========================================================
    # Display
    # ========================================================

    print()
    print(
        "=" * 70
    )

    print(
        "SNIP AI — SEMANTIC MOMENTS"
    )

    print(
        "=" * 70
    )

    for clip in selected:

        print()

        print(
            f"#{clip['start']:.2f}s → "
            f"{clip['end']:.2f}s "
            f"({clip['duration']:.1f}s)"
        )

        print(
            f"Score: "
            f"{clip['final_score']}"
        )

        print(
            f"Semantic: "
            f"{clip['semantic_score']}"
        )

        print(
            f"Fast: "
            f"{clip['fast_score']}"
        )

        text = clip["text"].replace(
            "\n",
            " "
        )

        if len(text) > 320:
            text = text[:320] + "..."

        print(
            f"Text: {text}"
        )

    print()
    print(
        "=" * 70
    )

    print(
        f"Selected: "
        f"{len(selected)} / {MAX_CLIPS}"
    )

    print(
        f"Saved: {output_path}"
    )

    print(
        "=" * 70
    )


if __name__ == "__main__":
    main()
