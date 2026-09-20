import json
import re
from pathlib import Path


# ============================================================
# SNIP AI — STORY EVENT MAP V3 OPTIMIZED
# ============================================================
#
# PURPOSE:
# Build a LARGE, diverse pool of standalone moments.
#
# PERFORMANCE FIX:
# - Do NOT create tens of thousands of combinations.
# - Events are paired only with nearby/useful events.
# - Each anchor gets a controlled number of combinations.
# - Candidate generation stays bounded.
# - Dedup uses timestamp buckets before expensive text checks.
#
# TARGET:
# 45–60 moments
#
# ============================================================


# ============================================================
# FILES
# ============================================================

TRANSCRIPT_FILE = Path(
    "/home/rajtyagi/Downloads/WhatsApp Video 2026-08-25 at 6.19.24 PM.transcript.json"
)

OUTPUT_FILE = Path(
    "/home/rajtyagi/Downloads/story-event-map.json"
)


# ============================================================
# CONFIG
# ============================================================

MIN_EVENT_SCORE = 3.0

MIN_CLIP_DURATION = 12.0
MAX_CLIP_DURATION = 48.0

TARGET_MIN = 45
TARGET_MAX = 60

MAX_COMBINATION_SPAN = 62.0

# Performance controls.
MAX_NEIGHBOR_EVENTS = 7
MAX_PAIR_COMBINATIONS_PER_EVENT = 8
MAX_TRIPLE_COMBINATIONS_PER_EVENT = 10

# Candidate generation control.
MAX_CANDIDATES_PER_COMBINATION = 5

# Dedup.
DUPLICATE_OVERLAP = 0.92
DUPLICATE_TIME_TOLERANCE = 1.75
DUPLICATE_TEXT_SIMILARITY = 0.78

# Final temporal distribution.
MAX_REGION_CANDIDATES = 12

# ============================================================
# VOCABULARY
# ============================================================

HOOK_WORDS = {
    "first",
    "finally",
    "now",
    "but",
    "why",
    "how",
    "what",
    "watch",
    "look",
    "listen",
    "real",
    "crazy",
    "never",
    "ever",
    "actually",
    "really",
    "here",
    "there",
}

CONFLICT_WORDS = {
    "fight",
    "fighting",
    "fighter",
    "box",
    "boxing",
    "boxer",
    "spar",
    "knock",
    "knocked",
    "knockout",
    "beat",
    "beating",
    "hit",
    "punch",
    "punching",
    "beef",
    "beefing",
    "hate",
    "hating",
    "disrespect",
    "disrespected",
    "tough",
    "muscle",
    "threat",
    "coming",
    "against",
    "rival",
    "enemy",
    "duck",
    "ducked",
    "smash",
    "hurt",
}

ACTION_WORDS = {
    "run",
    "ran",
    "pull",
    "pulled",
    "call",
    "called",
    "came",
    "come",
    "going",
    "went",
    "go",
    "get",
    "getting",
    "got",
    "show",
    "showed",
    "start",
    "started",
    "happen",
    "happened",
    "doing",
    "meet",
    "met",
    "walk",
    "walked",
    "send",
    "sent",
    "tell",
    "told",
    "said",
    "say",
    "bring",
    "brought",
    "leave",
    "left",
}

PAYOFF_WORDS = {
    "then",
    "finally",
    "ended",
    "end",
    "because",
    "said",
    "told",
    "came",
    "show",
    "showed",
    "knock",
    "knocked",
    "happen",
    "happened",
    "did",
    "didn't",
    "won",
    "lost",
    "real",
    "turn",
    "turned",
    "so",
    "until",
    "got",
    "went",
}

SETUP_PHRASES = [
    "months ago",
    "two months",
    "three months",
    "before",
    "my brother",
    "he said",
    "they said",
    "i met",
    "i run into",
    "i ran into",
    "he's like",
    "he was like",
    "they're like",
    "we're talking",
    "we started",
    "i want to",
    "i wanted to",
    "at the time",
    "a few months",
]

ESCALATION_PHRASES = [
    "but then",
    "then i'm",
    "then i",
    "now i'm",
    "now i",
    "started",
    "disrespect",
    "disrespected",
    "coming up",
    "coming to",
    "i'm coming",
    "i am coming",
    "they both",
    "calling",
    "call in",
    "muscle",
    "duck off",
    "won't do it",
    "you won't",
    "get at you",
    "coming there",
]

PAYOFF_PHRASES = [
    "so i",
    "so i'm",
    "i tell them",
    "i told them",
    "i came",
    "we start",
    "let's go",
    "knock out",
    "knock me out",
    "came to spar",
    "came to box",
    "let's box",
    "get knocked",
    "happens",
    "he comes",
    "he's coming",
    "come here",
    "getting knocked",
]

QUESTION_WORDS = {
    "why",
    "how",
    "what",
    "who",
    "when",
    "where",
    "did",
    "does",
    "do",
    "can",
    "would",
}


# ============================================================
# JSON
# ============================================================

def load_json(path):
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


# ============================================================
# TEXT
# ============================================================

def normalize(text):
    text = str(text or "").lower()

    text = re.sub(
        r"[^a-z0-9\s']",
        " ",
        text,
    )

    text = re.sub(
        r"\s+",
        " ",
        text,
    )

    return text.strip()


def tokenize(text):
    return normalize(text).split()


def phrase_count(text, phrases):
    text = normalize(text)

    return sum(
        1
        for phrase in phrases
        if phrase in text
    )


# ============================================================
# SEGMENTS
# ============================================================

def get_segments(data):
    if isinstance(data, list):
        return data

    if not isinstance(data, dict):
        return []

    for key in (
        "segments",
        "transcript",
        "results",
    ):
        value = data.get(key)

        if isinstance(value, list):
            return value

    return []


def seg_start(segment):
    return float(
        segment.get("start", 0)
    )


def seg_end(segment):
    return float(
        segment.get(
            "end",
            seg_start(segment),
        )
    )


def seg_text(segment):
    return str(
        segment.get("text", "")
    ).strip()


# ============================================================
# EVENT SCORING
# ============================================================

def score_event(text):
    normalized = normalize(text)
    words = tokenize(normalized)

    hook = sum(
        1
        for word in words
        if word in HOOK_WORDS
    )

    conflict = sum(
        1
        for word in words
        if word in CONFLICT_WORDS
    )

    action = sum(
        1
        for word in words
        if word in ACTION_WORDS
    )

    payoff = sum(
        1
        for word in words
        if word in PAYOFF_WORDS
    )

    setup = phrase_count(
        normalized,
        SETUP_PHRASES,
    )

    escalation = phrase_count(
        normalized,
        ESCALATION_PHRASES,
    )

    payoff_signal = phrase_count(
        normalized,
        PAYOFF_PHRASES,
    )

    question = sum(
        1
        for word in words
        if word in QUESTION_WORDS
    )

    score = 0.0

    score += hook * 2.0
    score += conflict * 4.0
    score += action * 3.0
    score += payoff * 2.0

    score += setup * 4.0
    score += escalation * 6.0
    score += payoff_signal * 7.0

    score += min(question, 3) * 1.0

    return {
        "score": round(score, 2),
        "hook": hook,
        "conflict": conflict,
        "action": action,
        "payoff": payoff,
        "setup": setup,
        "escalation": escalation,
        "payoff_signal": payoff_signal,
        "question": question,
    }


# ============================================================
# EVENT TYPE
# ============================================================

def event_type(event):
    if event["payoff_signal"] >= 1:
        return "payoff"

    if event["escalation"] >= 1:
        return "escalation"

    if event["conflict"] >= 2:
        return "conflict"

    if event["action"] >= 2:
        return "action"

    if event["setup"] >= 1:
        return "setup"

    if event["question"] >= 1:
        return "question"

    return "hook"


# ============================================================
# EVENT DETECTION
# ============================================================

def detect_events(segments):
    events = []

    for index, segment in enumerate(segments):

        text = seg_text(segment)

        if not text:
            continue

        signals = score_event(text)

        if signals["score"] < MIN_EVENT_SCORE:
            continue

        event = {
            "event_index": len(events),
            "segment_index": index,
            "start": seg_start(segment),
            "end": seg_end(segment),
            "text": text,
            **signals,
        }

        event["event_type"] = event_type(event)

        events.append(event)

    return events


# ============================================================
# EVENT COMBINATION VALUE
# ============================================================

def combination_value(events):
    """
    Estimate whether combining these events is useful.

    We prefer:
    setup -> escalation
    escalation -> payoff
    conflict -> action
    hook -> payoff
    and combinations containing different event types.
    """

    if not events:
        return -999.0

    value = sum(
        event["score"]
        for event in events
    )

    types = {
        event["event_type"]
        for event in events
    }

    if (
        "setup" in types
        and "escalation" in types
    ):
        value += 18

    if (
        "escalation" in types
        and "payoff" in types
    ):
        value += 22

    if (
        "conflict" in types
        and "action" in types
    ):
        value += 15

    if (
        "hook" in types
        and "payoff" in types
    ):
        value += 12

    if len(types) >= 2:
        value += 5

    if len(types) >= 3:
        value += 8

    return value


# ============================================================
# EVENT COMBINATIONS — OPTIMIZED
# ============================================================

def build_event_combinations(events):
    """
    PERFORMANCE-SAFE combination builder.

    Old V3:
        ~14,000 combinations
        -> ~67,500 candidates

    New version:
        each event looks only at nearby events
        and keeps the strongest useful pairs/triples.

    This preserves story variety without creating a
    combinatorial explosion.
    """

    combinations = []

    count = len(events)

    # --------------------------------------------------------
    # Singles
    # --------------------------------------------------------

    for first in events:

        combinations.append({
            "events": [first],
            "kind": "single_event",
        })

    # --------------------------------------------------------
    # Pairs + triples
    # --------------------------------------------------------

    for i in range(count):

        first = events[i]

        nearby = []

        for j in range(i + 1, count):

            second = events[j]

            span = (
                second["end"]
                - first["start"]
            )

            if span > MAX_COMBINATION_SPAN:
                break

            gap = max(
                0.0,
                second["start"] - first["end"],
            )

            # Events too far apart are less useful.
            if gap > 45.0:
                continue

            pair_value = combination_value(
                [first, second]
            )

            nearby.append(
                (
                    pair_value,
                    j,
                    second,
                )
            )

        # Strongest nearby events only.
        nearby.sort(
            key=lambda item: item[0],
            reverse=True,
        )

        nearby = nearby[
            :MAX_NEIGHBOR_EVENTS
        ]

        # ----------------------------------------------------
        # Pairs
        # ----------------------------------------------------

        pair_items = nearby[
            :MAX_PAIR_COMBINATIONS_PER_EVENT
        ]

        for _, j, second in pair_items:

            combinations.append({
                "events": [
                    first,
                    second,
                ],
                "kind": "event_pair",
            })

        # ----------------------------------------------------
        # Triples
        # ----------------------------------------------------

        triple_candidates = []

        for a in range(
            len(nearby)
        ):

            _, j, second = nearby[a]

            for b in range(
                a + 1,
                len(nearby),
            ):

                _, k, third = nearby[b]

                if k <= j:
                    continue

                three_span = (
                    third["end"]
                    - first["start"]
                )

                if (
                    three_span
                    > MAX_COMBINATION_SPAN
                ):
                    continue

                value = combination_value(
                    [
                        first,
                        second,
                        third,
                    ]
                )

                triple_candidates.append(
                    (
                        value,
                        second,
                        third,
                    )
                )

        triple_candidates.sort(
            key=lambda item: item[0],
            reverse=True,
        )

        for (
            _,
            second,
            third,
        ) in triple_candidates[
            :MAX_TRIPLE_COMBINATIONS_PER_EVENT
        ]:

            combinations.append({
                "events": [
                    first,
                    second,
                    third,
                ],
                "kind": "three_event_arc",
            })

    return combinations


# ============================================================
# NATURAL BOUNDARY HELPERS
# ============================================================

def nearest_segment_start(segments, target):
    best = None
    best_distance = float("inf")

    for index, segment in enumerate(segments):

        distance = abs(
            seg_start(segment) - target
        )

        if distance < best_distance:
            best_distance = distance
            best = index

    return best


def nearest_segment_end(segments, target):
    best = None
    best_distance = float("inf")

    for index, segment in enumerate(segments):

        distance = abs(
            seg_end(segment) - target
        )

        if distance < best_distance:
            best_distance = distance
            best = index

    return best


def clamp_clip(
    segments,
    start,
    end,
):
    if end <= start:
        return None

    duration = end - start

    if duration < MIN_CLIP_DURATION:

        center = (
            start + end
        ) / 2.0

        start = (
            center
            - MIN_CLIP_DURATION / 2.0
        )

        end = (
            center
            + MIN_CLIP_DURATION / 2.0
        )

    if duration > MAX_CLIP_DURATION:

        center = (
            start + end
        ) / 2.0

        start = (
            center
            - MAX_CLIP_DURATION / 2.0
        )

        end = (
            center
            + MAX_CLIP_DURATION / 2.0
        )

    start_index = nearest_segment_start(
        segments,
        start,
    )

    end_index = nearest_segment_end(
        segments,
        end,
    )

    if (
        start_index is None
        or end_index is None
    ):
        return None

    if end_index < start_index:
        return None

    start = seg_start(
        segments[start_index]
    )

    end = seg_end(
        segments[end_index]
    )

    duration = end - start

    if duration < MIN_CLIP_DURATION:
        return None

    if duration > MAX_CLIP_DURATION + 1.5:
        return None

    return (
        start,
        end,
        start_index,
        end_index,
    )


def collect_text(
    segments,
    start_index,
    end_index,
):
    parts = []

    for index in range(
        start_index,
        end_index + 1,
    ):
        text = seg_text(
            segments[index]
        )

        if text:
            parts.append(text)

    return " ".join(parts).strip()


# ============================================================
# BUILD CANDIDATE
# ============================================================

def build_candidate(
    segments,
    combination,
):
    events = combination["events"]

    first = events[0]
    last = events[-1]

    first_start = first["start"]
    first_end = first["end"]

    last_end = last["end"]

    first_mid = (
        first_start + first_end
    ) / 2.0

    span = (
        last_end - first_start
    )

    candidates = []

    # --------------------------------------------------------
    # 1 — EVENT LED
    # --------------------------------------------------------

    result = clamp_clip(
        segments,
        first_mid - 8.0,
        first_mid + 14.0,
    )

    if result:
        candidates.append(
            ("event_led", result)
        )

    # --------------------------------------------------------
    # 2 — SETUP TO EVENT
    # --------------------------------------------------------

    result = clamp_clip(
        segments,
        first_start - 8.0,
        first_end + 10.0,
    )

    if result:
        candidates.append(
            ("setup_to_event", result)
        )

    # --------------------------------------------------------
    # 3 — EVENT TO PAYOFF
    # --------------------------------------------------------

    result = clamp_clip(
        segments,
        first_start - 4.0,
        last_end + 7.0,
    )

    if result:
        candidates.append(
            ("event_to_payoff", result)
        )

    # --------------------------------------------------------
    # 4 — WIDE CONTEXT
    # --------------------------------------------------------

    if span <= MAX_COMBINATION_SPAN:

        result = clamp_clip(
            segments,
            first_start - 7.0,
            last_end + 7.0,
        )

        if result:
            candidates.append(
                ("wide_context", result)
            )

    # --------------------------------------------------------
    # 5 — TIGHT ARC
    # --------------------------------------------------------

    if len(events) >= 2:

        result = clamp_clip(
            segments,
            first_start - 2.0,
            last_end + 3.0,
        )

        if result:
            candidates.append(
                ("tight_arc", result)
            )

    # --------------------------------------------------------
    # CONVERT
    # --------------------------------------------------------

    output = []

    types = {
        event["event_type"]
        for event in events
    }

    anchor_event = max(
        events,
        key=lambda x: x["score"]
    )

    for style, result in candidates:

        (
            start,
            end,
            start_index,
            end_index,
        ) = result

        text = collect_text(
            segments,
            start_index,
            end_index,
        )

        if not text:
            continue

        signals = score_event(text)

        score = (
            signals["score"]
            + anchor_event["score"] * 0.75
        )

        # Multi-event bonus.
        if len(events) >= 2:
            score += 12

        if len(events) >= 3:
            score += 15

        # Narrative bonuses.
        if (
            "setup" in types
            and "escalation" in types
        ):
            score += 15

        if (
            "escalation" in types
            and "payoff" in types
        ):
            score += 18

        if (
            "conflict" in types
            and "action" in types
        ):
            score += 12

        # Duration penalty.
        duration = end - start

        if duration > 43:
            score -= 8
        elif duration > 38:
            score -= 3

        # Boundary style preference.
        style_bonus = {
            "event_led": 7,
            "setup_to_event": 8,
            "event_to_payoff": 12,
            "wide_context": 6,
            "tight_arc": 10,
        }.get(
            style,
            0,
        )

        score += style_bonus

        output.append({
            "start": round(start, 3),
            "end": round(end, 3),
            "duration": round(
                end - start,
                3,
            ),
            "anchor_time": round(
                (
                    anchor_event["start"]
                    + anchor_event["end"]
                ) / 2.0,
                3,
            ),
            "anchor_event_index":
                anchor_event["event_index"],
            "anchor_text":
                anchor_event["text"],
            "event_indices": [
                event["event_index"]
                for event in events
            ],
            "event_types": [
                event["event_type"]
                for event in events
            ],
            "combination_kind":
                combination["kind"],
            "boundary_style":
                style,
            "score": round(
                score,
                2,
            ),
            **signals,
            "text": text,
        })

    return output[:MAX_CANDIDATES_PER_COMBINATION]


# ============================================================
# BUILD ALL CANDIDATES
# ============================================================

def build_candidates(
    segments,
    combinations,
):
    candidates = []

    for combination in combinations:

        generated = build_candidate(
            segments,
            combination,
        )

        candidates.extend(
            generated
        )

    return candidates


# ============================================================
# OVERLAP
# ============================================================

def overlap_seconds(a, b):
    left = max(
        a["start"],
        b["start"],
    )

    right = min(
        a["end"],
        b["end"],
    )

    return max(
        0.0,
        right - left,
    )


def overlap_ratio(a, b):
    overlap = overlap_seconds(
        a,
        b,
    )

    if overlap <= 0:
        return 0.0

    shortest = min(
        a["duration"],
        b["duration"],
    )

    if shortest <= 0:
        return 0.0

    return overlap / shortest


# ============================================================
# TEXT SIMILARITY
# ============================================================

def text_similarity(a, b):
    a_words = set(
        normalize(
            a.get("text", "")
        ).split()
    )

    b_words = set(
        normalize(
            b.get("text", "")
        ).split()
    )

    if not a_words or not b_words:
        return 0.0

    return (
        len(a_words & b_words)
        /
        len(a_words | b_words)
    )


# ============================================================
# DUPLICATE CHECK
# ============================================================

def is_obvious_duplicate(
    candidate,
    existing,
):
    start_diff = abs(
        candidate["start"]
        - existing["start"]
    )

    end_diff = abs(
        candidate["end"]
        - existing["end"]
    )

    if (
        start_diff <= DUPLICATE_TIME_TOLERANCE
        and
        end_diff <= DUPLICATE_TIME_TOLERANCE
    ):
        return True

    overlap = overlap_ratio(
        candidate,
        existing,
    )

    if overlap < 0.70:
        return False

    similarity = text_similarity(
        candidate,
        existing,
    )

    if (
        overlap >= DUPLICATE_OVERLAP
        and
        similarity >= DUPLICATE_TEXT_SIMILARITY
    ):
        return True

    same_events = (
        candidate.get("event_indices")
        ==
        existing.get("event_indices")
    )

    if (
        same_events
        and
        overlap >= 0.96
    ):
        return True

    return False


# ============================================================
# FAST DEDUP
# ============================================================

def strict_deduplicate(candidates):
    """
    Same behavior as before, but avoids comparing every
    candidate against every kept candidate.

    Candidates are grouped by a coarse timestamp bucket.
    Only nearby buckets need detailed comparison.
    """

    ranked = sorted(
        candidates,
        key=lambda x: (
            x["score"],
            x["payoff_signal"],
            x["conflict"],
            x["action"],
        ),
        reverse=True,
    )

    kept = []

    # 30-second buckets.
    buckets = {}

    for candidate in ranked:

        start_bucket = int(
            candidate["start"] // 30
        )

        end_bucket = int(
            candidate["end"] // 30
        )

        possible = []

        for bucket in range(
            max(0, start_bucket - 1),
            end_bucket + 2,
        ):
            possible.extend(
                buckets.get(bucket, [])
            )

        duplicate = False

        for existing in possible:

            if is_obvious_duplicate(
                candidate,
                existing,
            ):
                duplicate = True
                break

        if duplicate:
            continue

        kept.append(candidate)

        for bucket in range(
            start_bucket,
            end_bucket + 1,
        ):
            buckets.setdefault(
                bucket,
                [],
            ).append(candidate)

    return kept


# ============================================================
# REGION
# ============================================================

def region_key(candidate):
    center = (
        candidate["start"]
        + candidate["end"]
    ) / 2.0

    return int(
        center // 30
    )


# ============================================================
# FINAL DIVERSITY
# ============================================================

def diversity_select(
    candidates,
):
    ranked = sorted(
        candidates,
        key=lambda x: x["score"],
        reverse=True,
    )

    selected = []

    region_counts = {}

    # --------------------------------------------------------
    # PASS 1
    # --------------------------------------------------------

    for candidate in ranked:

        if len(selected) >= TARGET_MAX:
            break

        region = region_key(
            candidate
        )

        count = region_counts.get(
            region,
            0,
        )

        if count >= MAX_REGION_CANDIDATES:
            continue

        too_close = False

        for existing in selected:

            overlap = overlap_ratio(
                candidate,
                existing,
            )

            center_a = (
                candidate["start"]
                + candidate["end"]
            ) / 2.0

            center_b = (
                existing["start"]
                + existing["end"]
            ) / 2.0

            center_gap = abs(
                center_a - center_b
            )

            if (
                overlap >= 0.82
                and
                center_gap < 5.0
            ):
                too_close = True
                break

        if too_close:
            continue

        selected.append(
            candidate
        )

        region_counts[region] = (
            count + 1
        )

    # --------------------------------------------------------
    # PASS 2
    # Relax temporal spacing if needed.
    # --------------------------------------------------------

    if len(selected) < TARGET_MIN:

        for candidate in ranked:

            if len(selected) >= TARGET_MAX:
                break

            if candidate in selected:
                continue

            duplicate = False

            for existing in selected:

                if is_obvious_duplicate(
                    candidate,
                    existing,
                ):
                    duplicate = True
                    break

            if duplicate:
                continue

            selected.append(
                candidate
            )

    # --------------------------------------------------------
    # PASS 3
    # Guarantee styles where available.
    # --------------------------------------------------------

    styles = {
        "event_led",
        "setup_to_event",
        "event_to_payoff",
        "wide_context",
        "tight_arc",
    }

    existing_styles = {
        item["boundary_style"]
        for item in selected
    }

    for style in styles - existing_styles:

        for candidate in ranked:

            if candidate in selected:
                continue

            if (
                candidate["boundary_style"]
                != style
            ):
                continue

            duplicate = False

            for existing in selected:

                if is_obvious_duplicate(
                    candidate,
                    existing,
                ):
                    duplicate = True
                    break

            if not duplicate:

                selected.append(
                    candidate
                )

                break

    selected.sort(
        key=lambda x: x["score"],
        reverse=True,
    )

    return selected[:TARGET_MAX]


# ============================================================
# STABLE ID
# ============================================================

def make_id(
    start,
    end,
    style,
):
    style_code = {
        "event_led": "e",
        "setup_to_event": "s",
        "event_to_payoff": "p",
        "wide_context": "w",
        "tight_arc": "t",
    }.get(
        style,
        "x",
    )

    return (
        f"m_{int(start * 100)}_"
        f"{int(end * 100)}_"
        f"{style_code}"
    )


# ============================================================
# MAIN
# ============================================================

def main():

    print("=" * 70)
    print("SNIP AI — STORY EVENT MAP V3 OPTIMIZED")
    print("=" * 70)

    print()

    if not TRANSCRIPT_FILE.exists():

        print(
            "ERROR: Transcript file not found:"
        )

        print(
            TRANSCRIPT_FILE
        )

        return

    data = load_json(
        TRANSCRIPT_FILE
    )

    segments = get_segments(
        data
    )

    if not segments:

        print(
            "ERROR: No transcript segments found."
        )

        return

    print(
        f"Transcript segments: "
        f"{len(segments)}"
    )

    # --------------------------------------------------------
    # Duration
    # --------------------------------------------------------

    try:

        duration = float(
            data.get(
                "duration",
                0,
            )
        )

    except Exception:

        duration = 0

    if duration <= 0:

        duration = max(
            seg_end(segment)
            for segment in segments
        )

    print(
        f"Video duration: "
        f"{duration:.2f}s"
    )

    print()

    # --------------------------------------------------------
    # Events
    # --------------------------------------------------------

    events = detect_events(
        segments
    )

    print(
        f"Raw event anchors: "
        f"{len(events)}"
    )

    # --------------------------------------------------------
    # Combinations
    # --------------------------------------------------------

    combinations = (
        build_event_combinations(
            events
        )
    )

    print(
        f"Event combinations: "
        f"{len(combinations)}"
    )

    # --------------------------------------------------------
    # Candidates
    # --------------------------------------------------------

    raw_candidates = build_candidates(
        segments,
        combinations,
    )

    print(
        f"Raw standalone candidates: "
        f"{len(raw_candidates)}"
    )

    # --------------------------------------------------------
    # Strict dedup
    # --------------------------------------------------------

    clean_candidates = strict_deduplicate(
        raw_candidates
    )

    print(
        f"After strict dedup: "
        f"{len(clean_candidates)}"
    )

    # --------------------------------------------------------
    # Diversity
    # --------------------------------------------------------

    final_clips = diversity_select(
        clean_candidates
    )

    print(
        f"After diversity selection: "
        f"{len(final_clips)}"
    )

    # --------------------------------------------------------
    # Stable IDs
    # --------------------------------------------------------

    final_clips.sort(
        key=lambda x: x["score"],
        reverse=True,
    )

    for rank, clip in enumerate(
        final_clips,
        start=1,
    ):

        clip["moment_id"] = make_id(
            clip["start"],
            clip["end"],
            clip["boundary_style"],
        )

        clip["rank"] = rank

    # --------------------------------------------------------
    # Event summary
    # --------------------------------------------------------

    event_type_counts = {}

    for event in events:

        name = event[
            "event_type"
        ]

        event_type_counts[name] = (
            event_type_counts.get(
                name,
                0,
            )
            + 1
        )

    # --------------------------------------------------------
    # Boundary summary
    # --------------------------------------------------------

    boundary_counts = {}

    for clip in final_clips:

        style = clip[
            "boundary_style"
        ]

        boundary_counts[style] = (
            boundary_counts.get(
                style,
                0,
            )
            + 1
        )

    # --------------------------------------------------------
    # Output
    # --------------------------------------------------------

    output = {
        "video": data.get("video"),
        "duration": round(
            duration,
            3,
        ),
        "language": data.get(
            "language"
        ),
        "source_transcript": str(
            TRANSCRIPT_FILE
        ),
        "transcript_segments": len(
            segments
        ),
        "event_anchors": len(
            events
        ),
        "event_type_counts":
            event_type_counts,
        "event_combinations":
            len(combinations),
        "raw_standalone_clips":
            len(raw_candidates),
        "strict_unique_candidates":
            len(clean_candidates),
        "unique_standalone_clips":
            len(final_clips),
        "boundary_style_counts":
            boundary_counts,
        "events": events,
        "moments": final_clips,
    }

    with OUTPUT_FILE.open(
        "w",
        encoding="utf-8",
    ) as f:

        json.dump(
            output,
            f,
            indent=2,
            ensure_ascii=False,
        )

    # ========================================================
    # TERMINAL PREVIEW
    # ========================================================

    print()

    print("-" * 70)
    print("EVENT TYPES")
    print("-" * 70)

    for name, count in sorted(
        event_type_counts.items()
    ):

        print(
            f"{name:14} : {count}"
        )

    print()

    print("-" * 70)
    print("BOUNDARY STYLES")
    print("-" * 70)

    for name, count in sorted(
        boundary_counts.items()
    ):

        print(
            f"{name:18} : {count}"
        )

    print()

    print("-" * 70)
    print("FINAL MOMENT POOL")
    print("-" * 70)

    for index, clip in enumerate(
        final_clips,
        start=1,
    ):

        text = clip[
            "text"
        ].replace(
            "\n",
            " ",
        )

        if len(text) > 100:
            text = (
                text[:100]
                + "..."
            )

        print(
            f'#{index:02} | '
            f'{clip["start"]:.2f}s → '
            f'{clip["end"]:.2f}s | '
            f'{clip["duration"]:.1f}s | '
            f'Q {clip["score"]:.1f} | '
            f'{clip["boundary_style"]} | '
            f'{clip["combination_kind"]}'
        )

        print(
            f'     '
            f'"{text}"'
        )

    print()

    print("=" * 70)

    print(
        f"FINAL MOMENT POOL: "
        f"{len(final_clips)}"
    )

    if len(final_clips) >= TARGET_MIN:

        print(
            "STATUS: HEALTHY — "
            "MOMENT DISCOVERY COMPLETE"
        )

    else:

        print(
            "STATUS: BELOW TARGET — "
            "DO NOT FORCE GENERATION"
        )

    print(
        f"Saved: {OUTPUT_FILE}"
    )

    print("=" * 70)


if __name__ == "__main__":
    main()
