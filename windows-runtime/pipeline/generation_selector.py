import json
import sys
from pathlib import Path


# ============================================================
# SNIP AI — GENERATION SELECTOR V1
# ============================================================
#
# INPUT:
#   /home/rajtyagi/Downloads/story-event-map.json
#
# OUTPUT:
#   /home/rajtyagi/Downloads/selected-generation.json
#
# HISTORY:
#   /home/rajtyagi/Downloads/generation-history.json
#
# PURPOSE:
#   Select up to 10 NEW moments per generation.
#
# ============================================================


INPUT_FILE = Path(
    "/home/rajtyagi/Downloads/story-event-map.json"
)

OUTPUT_FILE = Path(
    "/home/rajtyagi/Downloads/selected-generation.json"
)

HISTORY_FILE = Path(
    "/home/rajtyagi/Downloads/generation-history.json"
)


# ============================================================
# CONFIG
# ============================================================

CLIPS_PER_GENERATION = 10

def get_requested_clip_count():
    if len(sys.argv) < 2:
        return 10

    try:
        value = int(sys.argv[1])
    except (TypeError, ValueError):
        print(
            "ERROR: Invalid clip count. Using 10."
        )
        return 10

    if value < 1 or value > 10:
        print(
            "ERROR: Clip count must be between 1 and 10. Using 10."
        )
        return 10

    return value


# Minimum useful temporal separation.
MIN_CENTER_GAP = 8.0

# Strong overlap means basically the same moment.
STRONG_OVERLAP = 0.72

# Maximum number from one broad 30-second region.
MAX_PER_REGION = 3

# Prefer clips from different regions.
REGION_SIZE = 30.0


# ============================================================
# JSON HELPERS
# ============================================================

def load_json(path, default=None):

    if not path.exists():

        if default is not None:
            return default

        raise FileNotFoundError(
            f"File not found: {path}"
        )

    with path.open(
        "r",
        encoding="utf-8",
    ) as f:

        return json.load(f)


def save_json(path, data):

    with path.open(
        "w",
        encoding="utf-8",
    ) as f:

        json.dump(
            data,
            f,
            indent=2,
            ensure_ascii=False,
        )


# ============================================================
# OVERLAP
# ============================================================

def overlap_seconds(a, b):

    left = max(
        float(a["start"]),
        float(b["start"]),
    )

    right = min(
        float(a["end"]),
        float(b["end"]),
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

    duration_a = float(
        a["end"]
    ) - float(
        a["start"]
    )

    duration_b = float(
        b["end"]
    ) - float(
        b["start"]
    )

    shortest = min(
        duration_a,
        duration_b,
    )

    if shortest <= 0:
        return 0.0

    return overlap / shortest


# ============================================================
# CENTER
# ============================================================

def center(moment):

    return (
        float(moment["start"])
        +
        float(moment["end"])
    ) / 2.0


# ============================================================
# REGION
# ============================================================

def region(moment):

    return int(
        center(moment)
        // REGION_SIZE
    )


# ============================================================
# MOMENT ID
# ============================================================

def moment_id(moment):

    value = moment.get(
        "moment_id"
    )

    if value:
        return str(value)

    return (
        f'{float(moment["start"]):.3f}_'
        f'{float(moment["end"]):.3f}_'
        f'{moment.get("boundary_style", "unknown")}'
    )


# ============================================================
# HISTORY
# ============================================================

def load_history():

    if not HISTORY_FILE.exists():

        return {
            "generations": [],
            "used_moment_ids": [],
        }

    history = load_json(
        HISTORY_FILE,
        {
            "generations": [],
            "used_moment_ids": [],
        },
    )

    if not isinstance(
        history,
        dict,
    ):
        history = {
            "generations": [],
            "used_moment_ids": [],
        }

    history.setdefault(
        "generations",
        [],
    )

    history.setdefault(
        "used_moment_ids",
        [],
    )

    return history


def used_ids(history):

    return set(
        str(value)
        for value in history.get(
            "used_moment_ids",
            [],
        )
    )


# ============================================================
# HARD DUPLICATE
# ============================================================

def is_same_or_overlapping(
    candidate,
    selected,
):

    candidate_id = moment_id(
        candidate
    )

    selected_id = moment_id(
        selected
    )

    if candidate_id == selected_id:
        return True

    overlap = overlap_ratio(
        candidate,
        selected,
    )

    if overlap >= STRONG_OVERLAP:
        return True

    gap = abs(
        center(candidate)
        -
        center(selected)
    )

    if (
        gap < MIN_CENTER_GAP
        and
        overlap > 0.45
    ):
        return True

    return False


# ============================================================
# QUALITY
# ============================================================

def quality_score(moment):

    score = float(
        moment.get(
            "score",
            0,
        )
    )

    duration = float(
        moment.get(
            "duration",
            0,
        )
    )

    style = moment.get(
        "boundary_style",
        "",
    )

    combination = moment.get(
        "combination_kind",
        "",
    )

    # Prefer healthy clip lengths.
    if 18 <= duration <= 38:
        score += 8

    elif 15 <= duration <= 42:
        score += 4

    elif duration > 44:
        score -= 6

    # Boundary style diversity.
    style_bonus = {
        "event_to_payoff": 5,
        "tight_arc": 4,
        "setup_to_event": 4,
        "event_led": 3,
        "wide_context": 2,
    }

    score += style_bonus.get(
        style,
        0,
    )

    if combination == "three_event_arc":
        score += 5

    elif combination == "event_pair":
        score += 3

    return score


# ============================================================
# SELECTION
# ============================================================

def select_generation(
    moments,
    history,
):

    already_used = used_ids(
        history
    )

    # --------------------------------------------------------
    # Remove previously generated moments.
    # --------------------------------------------------------

    unused = []

    for moment in moments:

        if moment_id(moment) in already_used:
            continue

        unused.append(moment)

    # --------------------------------------------------------
    # Sort by quality.
    # --------------------------------------------------------

    unused.sort(
        key=quality_score,
        reverse=True,
    )

    selected = []

    region_counts = {}

    style_counts = {}

    # --------------------------------------------------------
    # PASS 1
    #
    # Prefer high quality + temporal diversity.
    # --------------------------------------------------------

    for moment in unused:

        if len(selected) >= CLIPS_PER_GENERATION:
            break

        r = region(moment)

        if (
            region_counts.get(r, 0)
            >= MAX_PER_REGION
        ):
            continue

        duplicate = False

        for existing in selected:

            if is_same_or_overlapping(
                moment,
                existing,
            ):
                duplicate = True
                break

        if duplicate:
            continue

        selected.append(
            moment
        )

        region_counts[r] = (
            region_counts.get(r, 0)
            + 1
        )

        style = moment.get(
            "boundary_style",
            "unknown",
        )

        style_counts[style] = (
            style_counts.get(style, 0)
            + 1
        )

    # --------------------------------------------------------
    # PASS 2
    #
    # If fewer than 10, relax region limit.
    # --------------------------------------------------------

    if len(selected) < CLIPS_PER_GENERATION:

        for moment in unused:

            if len(selected) >= CLIPS_PER_GENERATION:
                break

            if moment in selected:
                continue

            duplicate = False

            for existing in selected:

                if is_same_or_overlapping(
                    moment,
                    existing,
                ):
                    duplicate = True
                    break

            if duplicate:
                continue

            selected.append(
                moment
            )

    # --------------------------------------------------------
    # PASS 3
    #
    # Try to introduce styles that are missing.
    # --------------------------------------------------------

    preferred_styles = [
        "event_to_payoff",
        "tight_arc",
        "setup_to_event",
        "event_led",
        "wide_context",
    ]

    for style in preferred_styles:

        if len(selected) >= CLIPS_PER_GENERATION:
            break

        if style in style_counts:
            continue

        for moment in unused:

            if moment in selected:
                continue

            if moment.get(
                "boundary_style"
            ) != style:
                continue

            duplicate = False

            for existing in selected:

                if is_same_or_overlapping(
                    moment,
                    existing,
                ):
                    duplicate = True
                    break

            if duplicate:
                continue

            selected.append(
                moment
            )

            style_counts[style] = 1

            break

    # --------------------------------------------------------
    # Final quality order.
    # --------------------------------------------------------

    selected.sort(
        key=quality_score,
        reverse=True,
    )

    return selected[
        :CLIPS_PER_GENERATION
    ]


# ============================================================
# GENERATION NUMBER
# ============================================================

def next_generation_number(
    history
):

    generations = history.get(
        "generations",
        [],
    )

    if not generations:
        return 1

    numbers = []

    for generation in generations:

        try:

            numbers.append(
                int(
                    generation.get(
                        "generation",
                        0,
                    )
                )
            )

        except Exception:
            pass

    if not numbers:
        return 1

    return max(numbers) + 1


# ============================================================
# MAIN
# ============================================================

def main():

    global CLIPS_PER_GENERATION

    CLIPS_PER_GENERATION = get_requested_clip_count()

    print("=" * 70)
    print(
        "SNIP AI — GENERATION SELECTOR V1"
    )
    print("=" * 70)

    print()

    if not INPUT_FILE.exists():

        print(
            "ERROR: Story event map not found:"
        )

        print(
            INPUT_FILE
        )

        return

    data = load_json(
        INPUT_FILE
    )

    moments = data.get(
        "moments",
        [],
    )

    if not isinstance(
        moments,
        list,
    ):

        print(
            "ERROR: No moment list found."
        )

        return

    history = load_history()

    generation_number = (
        next_generation_number(
            history
        )
    )

    previously_used = used_ids(
        history
    )

    unused_count = sum(
        1
        for moment in moments
        if moment_id(moment)
        not in previously_used
    )

    print(
        f"Total moment pool: "
        f"{len(moments)}"
    )

    print(
        f"Previously used: "
        f"{len(previously_used)}"
    )

    print(
        f"Unused moments: "
        f"{unused_count}"
    )

    print()

    recycled = False

    # --------------------------------------------------------
    # RECYCLE MOMENT POOL
    #
    # If the remaining unused pool cannot fill one complete
    # generation, start the selection cycle again.
    #
    # The generation history remains intact.
    # Only used_moment_ids is cleared.
    # --------------------------------------------------------

    if moments and unused_count < CLIPS_PER_GENERATION:

        print(
            "Not enough unused moments for a full generation."
        )

        print(
            "Recycling moment pool..."
        )

        history["used_moment_ids"] = []

        save_json(
            HISTORY_FILE,
            history,
        )

        recycled = True

        previously_used = set()

        unused_count = len(moments)

        print(
            f"Recycled pool: "
            f"{unused_count} moments available."
        )

        print()

    selected = select_generation(
        moments,
        history,
    )

    if not selected:

        print(
            "NO NEW MOMENTS AVAILABLE."
        )

        print(
            "Generation selection stopped."
        )

        return

    # --------------------------------------------------------
    # Add generation metadata.
    # --------------------------------------------------------

    generation_clips = []

    for rank, moment in enumerate(
        selected,
        start=1,
    ):

        clip = dict(moment)

        clip["generation"] = (
            generation_number
        )

        clip["generation_rank"] = rank

        generation_clips.append(
            clip
        )

    # --------------------------------------------------------
    # Update history.
    # --------------------------------------------------------

    new_ids = [
        moment_id(moment)
        for moment in generation_clips
    ]

    history["used_moment_ids"].extend(
        new_ids
    )

    history["used_moment_ids"] = list(
        dict.fromkeys(
            history["used_moment_ids"]
        )
    )

    history["generations"].append({
        "generation": generation_number,
        "clip_count": len(
            generation_clips
        ),
        "moment_ids": new_ids,
    })

    save_json(
        HISTORY_FILE,
        history,
    )

    # --------------------------------------------------------
    # Output.
    # --------------------------------------------------------

    output = {
        "video": data.get(
            "video"
        ),
        "generation": generation_number,
        "source_moment_pool": str(
            INPUT_FILE
        ),
        "total_moment_pool": len(
            moments
        ),
        "previously_used": len(
            previously_used
        ),
        "selected_count": len(
            generation_clips
        ),
        "requested_count": CLIPS_PER_GENERATION,
        "recycled_pool": recycled,
        "clips": generation_clips,
    }

    save_json(
        OUTPUT_FILE,
        output,
    )

    # --------------------------------------------------------
    # Terminal preview.
    # --------------------------------------------------------

    print(
        "-" * 70
    )

    print(
        f"GENERATION {generation_number}"
    )

    print(
        "-" * 70
    )

    for clip in generation_clips:

        print(
            f'#{clip["generation_rank"]:02} | '
            f'{clip["start"]:.2f}s → '
            f'{clip["end"]:.2f}s | '
            f'{clip["duration"]:.1f}s | '
            f'Q {clip["score"]:.1f} | '
            f'{clip["boundary_style"]}'
        )

        text = str(
            clip.get(
                "text",
                "",
            )
        ).replace(
            "\n",
            " ",
        )

        if len(text) > 100:
            text = (
                text[:100]
                + "..."
            )

        print(
            f'     "{text}"'
        )

    print()

    print("=" * 70)

    print(
        f"REQUESTED: "
        f"{CLIPS_PER_GENERATION}"
    )

    print(
        f"SELECTED: "
        f"{len(generation_clips)}/"
        f"{CLIPS_PER_GENERATION}"
    )

    if recycled:
        print(
            "POOL: RECYCLED"
        )

    print(
        f"History saved: "
        f"{HISTORY_FILE}"
    )

    print(
        f"Selection saved: "
        f"{OUTPUT_FILE}"
    )

    print("=" * 70)


if __name__ == "__main__":
    main()
