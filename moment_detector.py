import json
import re
import sys
from pathlib import Path


# ============================================================
# Snip AI - Improved Moment Detector
# ============================================================

MAX_CLIPS = 10

MIN_DURATION = 18.0
IDEAL_MIN = 22.0
IDEAL_MAX = 38.0
MAX_DURATION = 45.0

# Words that often introduce a strong statement or transition.
HOOK_WORDS = {
    "but",
    "now",
    "finally",
    "actually",
    "because",
    "never",
    "always",
    "really",
    "first",
    "truth",
    "problem",
    "story",
    "remember",
    "started",
    "happened",
    "then",
    "so",
}

# Conflict / tension / drama.
CONFLICT_WORDS = {
    "fight",
    "fighting",
    "fight",
    "box",
    "boxing",
    "spar",
    "sparring",
    "knock",
    "knocked",
    "knockout",
    "beat",
    "beaten",
    "hit",
    "hurt",
    "challenge",
    "challenged",
    "disrespect",
    "disrespected",
    "hate",
    "hating",
    "angry",
    "mad",
    "tough",
    "scared",
    "dangerous",
    "destroy",
    "destroyed",
    "war",
    "confrontation",
    "muscle",
}

# Strong emotional / expressive language.
EMOTION_WORDS = {
    "crazy",
    "insane",
    "damn",
    "shit",
    "fuck",
    "fucking",
    "hate",
    "hating",
    "angry",
    "mad",
    "scared",
    "embarrassing",
    "embarrassed",
    "disrespect",
    "disrespected",
    "respect",
    "destroy",
    "destroyed",
    "knocked",
    "hurt",
}

# Question / interview signals.
QUESTION_WORDS = {
    "why",
    "how",
    "what",
    "when",
    "where",
    "who",
    "did",
    "do",
    "does",
    "can",
    "could",
    "would",
    "should",
}

# Generic YouTube/podcast intro language.
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
    "hit the like button",
    "crypto in it behind us",
}

# Words that indicate a concrete story/event.
STORY_WORDS = {
    "started",
    "happened",
    "ran",
    "run",
    "met",
    "called",
    "text",
    "message",
    "came",
    "went",
    "walked",
    "pulled",
    "showed",
    "said",
    "told",
    "asked",
    "wanted",
    "ended",
    "finally",
}


def load_transcript(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def tokenize(text):
    return re.findall(r"\b[a-zA-Z']+\b", text.lower())


def unique_hits(tokens, vocabulary):
    return set(tokens).intersection(vocabulary)


def score_window(text, duration):
    lower = text.lower()
    tokens = tokenize(text)
    token_set = set(tokens)

    score = 0.0
    reasons = []

    # --------------------------------------------------------
    # 1. Strong language
    # --------------------------------------------------------

    hook_hits = unique_hits(tokens, HOOK_WORDS)
    conflict_hits = unique_hits(tokens, CONFLICT_WORDS)
    emotion_hits = unique_hits(tokens, EMOTION_WORDS)
    question_hits = unique_hits(tokens, QUESTION_WORDS)
    story_hits = unique_hits(tokens, STORY_WORDS)

    if hook_hits:
        points = min(len(hook_hits) * 1.5, 8)
        score += points
        reasons.append(
            "hook:" + ",".join(sorted(hook_hits))
        )

    if conflict_hits:
        points = min(len(conflict_hits) * 3.0, 18)
        score += points
        reasons.append(
            "conflict:" + ",".join(sorted(conflict_hits))
        )

    if emotion_hits:
        points = min(len(emotion_hits) * 2.5, 14)
        score += points
        reasons.append(
            "emotion:" + ",".join(sorted(emotion_hits))
        )

    if story_hits:
        points = min(len(story_hits) * 1.5, 8)
        score += points
        reasons.append(
            "story:" + ",".join(sorted(story_hits))
        )

    # --------------------------------------------------------
    # 2. Questions
    # --------------------------------------------------------

    if "?" in text:
        score += 3
        reasons.append("explicit_question")

    if question_hits:
        score += min(len(question_hits) * 0.75, 4)
        reasons.append("question_language")

    # --------------------------------------------------------
    # 3. Specific details
    # --------------------------------------------------------

    numbers = re.findall(
        r"\b\d+(?:\.\d+)?\b",
        text
    )

    if numbers:
        score += min(len(numbers) * 1.5, 5)
        reasons.append("specific_detail")

    # Names / proper-name-like words aren't perfectly detectable
    # from Whisper output, but capitalized words in the original
    # transcript can still indicate concrete storytelling.
    capitalized = re.findall(
        r"\b[A-Z][a-z]{2,}\b",
        text
    )

    if len(capitalized) >= 2:
        score += 2
        reasons.append("named_entities")

    # --------------------------------------------------------
    # 4. Text density
    # --------------------------------------------------------

    word_count = len(tokens)

    if word_count < 8:
        score -= 8
        reasons.append("very_low_density")

    elif word_count < 15:
        score -= 4
        reasons.append("low_density")

    elif word_count >= 30:
        score += 4
        reasons.append("high_density")

    # --------------------------------------------------------
    # 5. Duration quality
    # --------------------------------------------------------

    if IDEAL_MIN <= duration <= IDEAL_MAX:
        score += 8
        reasons.append("ideal_duration")

    elif MIN_DURATION <= duration < IDEAL_MIN:
        score += 3
        reasons.append("short_but_valid")

    elif IDEAL_MAX < duration <= MAX_DURATION:
        score += 3
        reasons.append("long_but_valid")

    else:
        score -= 5
        reasons.append("duration_penalty")

    # --------------------------------------------------------
    # 6. Filler / intro penalty
    # --------------------------------------------------------

    filler_hits = []

    for phrase in FILLER_PHRASES:
        if phrase in lower:
            filler_hits.append(phrase)

    if filler_hits:
        score -= min(len(filler_hits) * 8, 18)
        reasons.append(
            "filler:" + ",".join(filler_hits)
        )

    # --------------------------------------------------------
    # 7. Generic small-talk penalty
    # --------------------------------------------------------

    small_talk = [
        "yeah",
        "you know",
        "like",
        "okay",
        "right",
    ]

    small_talk_count = sum(
        tokens.count(word)
        for word in small_talk
    )

    if word_count > 0:
        small_talk_ratio = small_talk_count / word_count

        if small_talk_ratio > 0.18:
            score -= 5
            reasons.append("small_talk_penalty")

    # --------------------------------------------------------
    # 8. Strong combination bonus
    # --------------------------------------------------------

    # Conflict + story = usually a meaningful event.
    if conflict_hits and story_hits:
        score += 6
        reasons.append("conflict_story_bonus")

    # Emotion + conflict = potentially viral moment.
    if emotion_hits and conflict_hits:
        score += 5
        reasons.append("emotion_conflict_bonus")

    # Question + story = question followed by an answer/story.
    if question_hits and story_hits:
        score += 4
        reasons.append("question_story_bonus")

    return round(score, 2), reasons


def build_windows(segments):
    """
    Build a much smaller set of candidate windows.

    Instead of starting a window at every possible segment,
    start from meaningful transcript boundaries.
    """

    candidates = []

    for start_index in range(len(segments)):
        start_segment = segments[start_index]

        start_time = float(start_segment["start"])

        text_parts = []

        for end_index in range(
            start_index,
            len(segments)
        ):
            segment = segments[end_index]

            end_time = float(segment["end"])
            duration = end_time - start_time

            if duration > MAX_DURATION:
                break

            text_parts.append(segment["text"])

            if duration < MIN_DURATION:
                continue

            text = " ".join(text_parts).strip()

            score, reasons = score_window(
                text,
                duration
            )

            candidates.append(
                {
                    "start": round(start_time, 2),
                    "end": round(end_time, 2),
                    "duration": round(duration, 2),
                    "score": score,
                    "reasons": reasons,
                    "text": text,
                    "start_index": start_index,
                    "end_index": end_index,
                }
            )

    return candidates


def overlap_seconds(a, b):
    start = max(a["start"], b["start"])
    end = min(a["end"], b["end"])

    return max(0.0, end - start)


def overlap_ratio(a, b):
    overlap = overlap_seconds(a, b)

    if overlap <= 0:
        return 0.0

    a_duration = a["end"] - a["start"]
    b_duration = b["end"] - b["start"]

    shorter = min(
        a_duration,
        b_duration
    )

    if shorter <= 0:
        return 0.0

    return overlap / shorter


def temporal_distance(a, b):
    if a["end"] < b["start"]:
        return b["start"] - a["end"]

    if b["end"] < a["start"]:
        return a["start"] - b["end"]

    return 0.0


def remove_near_duplicates(candidates):
    """
    First pass:
    Remove candidates that represent almost the same moment.
    """

    ranked = sorted(
        candidates,
        key=lambda x: x["score"],
        reverse=True
    )

    selected = []

    for candidate in ranked:
        duplicate = False

        for existing in selected:
            ratio = overlap_ratio(
                candidate,
                existing
            )

            distance = temporal_distance(
                candidate,
                existing
            )

            # Heavy overlap = same moment.
            if ratio >= 0.50:
                duplicate = True
                break

            # Nearly identical boundaries.
            if (
                abs(
                    candidate["start"]
                    - existing["start"]
                ) <= 6
                and
                abs(
                    candidate["end"]
                    - existing["end"]
                ) <= 6
            ):
                duplicate = True
                break

            # Same local section.
            if (
                distance < 4
                and ratio > 0.25
            ):
                duplicate = True
                break

        if not duplicate:
            selected.append(candidate)

    return selected


def select_best(candidates):
    """
    Select up to 10 distinct high-quality moments.
    """

    deduplicated = remove_near_duplicates(
        candidates
    )

    # Keep only reasonably strong moments.
    deduplicated = [
        c for c in deduplicated
        if c["score"] >= 10
    ]

    ranked = sorted(
        deduplicated,
        key=lambda x: x["score"],
        reverse=True
    )

    selected = []

    for candidate in ranked:

        # Avoid clips that are too close to already
        # selected moments.
        reject = False

        for existing in selected:

            ratio = overlap_ratio(
                candidate,
                existing
            )

            distance = temporal_distance(
                candidate,
                existing
            )

            if ratio >= 0.35:
                reject = True
                break

            if distance < 8:
                reject = True
                break

        if reject:
            continue

        selected.append(candidate)

        if len(selected) >= MAX_CLIPS:
            break

    # Return chronological order for easier inspection.
    return sorted(
        selected,
        key=lambda x: x["start"]
    )


def save_results(
    transcript_path,
    transcript,
    selected
):
    output = {
        "video": transcript.get("video"),
        "duration": transcript.get("duration"),
        "language": transcript.get("language"),
        "max_clips": MAX_CLIPS,
        "selected_count": len(selected),
        "selected_clips": [],
    }

    for index, clip in enumerate(
        selected,
        start=1
    ):
        output["selected_clips"].append(
            {
                "clip_number": index,
                "start": clip["start"],
                "end": clip["end"],
                "duration": clip["duration"],
                "score": clip["score"],
                "reasons": clip["reasons"],
                "text": clip["text"],
            }
        )

    output_path = transcript_path.with_name(
        transcript_path.stem.replace(
            ".transcript",
            ""
        )
        + ".moments.json"
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

    return output_path


def main():

    if len(sys.argv) < 2:
        print(
            "Usage:"
        )
        print(
            "python moment_detector.py "
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

    transcript = load_transcript(
        transcript_path
    )

    segments = transcript.get(
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
        f"Loaded {len(segments)} "
        f"transcript segments."
    )

    print(
        "Building candidate moments..."
    )

    candidates = build_windows(
        segments
    )

    print(
        f"Generated {len(candidates)} "
        f"raw candidates."
    )

    print(
        "Removing duplicate/overlapping moments..."
    )

    deduplicated = remove_near_duplicates(
        candidates
    )

    print(
        f"After deduplication: "
        f"{len(deduplicated)} candidates."
    )

    print(
        "Selecting strongest unique moments..."
    )

    selected = select_best(
        candidates
    )

    output_path = save_results(
        transcript_path,
        transcript,
        selected
    )

    print()
    print("=" * 70)
    print("SNIP AI — SELECTED MOMENTS")
    print("=" * 70)

    for clip in selected:

        print()

        print(
            f"#{clip['start']:.2f}s → "
            f"{clip['end']:.2f}s "
            f"({clip['duration']:.1f}s)"
        )

        print(
            f"Score: {clip['score']}"
        )

        print(
            "Reasons: "
            + ", ".join(
                clip["reasons"]
            )
        )

        text = clip["text"].replace(
            "\n",
            " "
        )

        if len(text) > 300:
            text = text[:300] + "..."

        print(
            f"Text: {text}"
        )

    print()
    print("=" * 70)
    print(
        f"Selected: {len(selected)} / "
        f"{MAX_CLIPS}"
    )
    print(
        f"Saved: {output_path}"
    )
    print("=" * 70)
    print()


if __name__ == "__main__":
    main()
