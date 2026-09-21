#!/usr/bin/env python3

from pathlib import Path
import json
import re
import html
import sys


# ============================================================
# SNIP AI — CAPTION ENGINE V1
#
# Creates ASS subtitles from Whisper transcript segments.
#
# Supported styles:
#   Reveal
#   Snap
#   Headline
#   Hype
#   MrBeast
#   Minimal
#   Podcast
#   Highlight
#   Clean
#
# The engine does NOT render video itself.
# It creates an ASS file which FFmpeg can burn into video.
# ============================================================


# ============================================================
# DEFAULTS
# ============================================================

FONT = "Arial"

VIDEO_PLAYBACK_WIDTH = 1080
VIDEO_PLAYBACK_HEIGHT = 1920

MAX_WORDS_PER_LINE = 5
MAX_CHARS_PER_LINE = 34

# Word-by-word fade-in used by the common caption renderer.
WORD_FADE_PREFIX = (
    "{\\alpha&HFF&}"
    "{\\t(0,140,\\alpha&H00&)}"
)


# ASS uses BGR hexadecimal colors.
WHITE = "&H00FFFFFF"
BLACK = "&H00000000"
YELLOW = "&H0000FFFF"
CYAN = "&H00FFFF00"
PINK = "&H00FF66CC"
LIME = "&H0000FF66"
RED = "&H000000FF"
BLUE = "&H00FF9933"
GREEN = "&H0000CC66"
PURPLE = "&H00CC66FF"
GOLD = "&H0000CCFF"


# ============================================================
# STYLE CONFIG
# ============================================================

STYLE_CONFIG = {
    "Reveal": {
        "font": 'Poppins',
        "size": 64,
        "bold": True,
        "primary": "&H00F3E8FF",
        "outline": BLACK,
        "outline_width": 4,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "reveal",
    },

    "Reveal Cyan": {
        "font": 'Inter',
        "size": 64,
        "bold": True,
        "primary": "&H00E6F7FF",
        "outline": BLACK,
        "outline_width": 4,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "reveal",
    },

    "Reveal Pink": {
        "font": 'Bebas Neue',
        "size": 64,
        "bold": True,
        "primary": "&H00FFE6F2",
        "outline": BLACK,
        "outline_width": 4,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "reveal",
    },

    "Reveal Lime": {
        "font": 'DejaVu Sans',
        "size": 64,
        "bold": True,
        "primary": "&H00E9FFD9",
        "outline": BLACK,
        "outline_width": 4,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "reveal",
    },

    "Snap": {
        "font": 'Bebas Neue',
        "size": 64,
        "bold": True,
        "primary": WHITE,
        "outline": BLACK,
        "outline_width": 5,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "snap",
        "active": "&H00FFC4D6",
    },

    "Snap Gold": {
        "font": 'Anton',
        "size": 64,
        "bold": True,
        "primary": WHITE,
        "outline": BLACK,
        "outline_width": 5,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "snap",
        "active": "&H00FFE8B0",
    },

    "Snap Cyan": {
        "font": 'Oswald',
        "size": 64,
        "bold": True,
        "primary": WHITE,
        "outline": BLACK,
        "outline_width": 5,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "snap",
        "active": "&H00CFF7FF",
    },

    "Snap Lime": {
        "font": 'Rubik',
        "size": 64,
        "bold": True,
        "primary": WHITE,
        "outline": BLACK,
        "outline_width": 5,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "snap",
        "active": "&H00DFFFC2",
    },

    "Headline": {
        "font": 'Kanit',
        "size": 57,
        "bold": True,
        "primary": "&H00FFF0B8",
        "outline": BLACK,
        "outline_width": 4,
        "shadow": 2,
        "alignment": 8,
        "margin_v": 150,
        "animation": "headline",
    },

    "Headline Bottom": {
        "font": 'Teko',
        "size": 57,
        "bold": True,
        "primary": "&H00EAD9FF",
        "outline": BLACK,
        "outline_width": 4,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "headline",
    },

    "Headline Yellow": {
        "font": 'Anton SC',
        "size": 57,
        "bold": True,
        "primary": "&H00FFF0B8",
        "outline": BLACK,
        "outline_width": 4,
        "shadow": 2,
        "alignment": 8,
        "margin_v": 125,
        "animation": "headline",
    },

    "Headline Red": {
        "font": 'League Spartan',
        "size": 57,
        "bold": True,
        "primary": "&H00FFD6D6",
        "outline": BLACK,
        "outline_width": 4,
        "shadow": 2,
        "alignment": 8,
        "margin_v": 125,
        "animation": "headline",
    },

    "Hype": {
        "font": 'Cinzel Decorative',
        "size": 58,
        "bold": True,
        "primary": "&H00DCE6FF",
        "outline": RED,
        "outline_width": 7,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "hype",
    },

    "Hype Blue": {
        "font": 'Archivo Black',
        "size": 58,
        "bold": True,
        "primary": "&H00DCD8FF",
        "outline": BLUE,
        "outline_width": 7,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "hype",
    },

    "Hype Green": {
        "font": 'Sora',
        "size": 58,
        "bold": True,
        "primary": "&H00D9FFE5",
        "outline": GREEN,
        "outline_width": 7,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "hype",
    },

    "Hype Purple": {
        "font": 'Nunito',
        "size": 58,
        "bold": True,
        "primary": "&H00EEDBFF",
        "outline": PURPLE,
        "outline_width": 7,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "hype",
    },

    "MrBeast": {
        "font": 'Prompt',
        "size": 72,
        "bold": True,
        "primary": "&H00FFF1C7",
        "outline": BLACK,
        "outline_width": 6,
        "shadow": 3,
        "alignment": 2,
        "margin_v": 180,
        "animation": "mrbeast",
        "active": "&H00FFE3A3",
    },

    "Minimal": {
        "font": 'Changa',
        "size": 42,
        "bold": True,
        "primary": "&H00F1ECFF",
        "outline": BLACK,
        "outline_width": 2,
        "shadow": 1,
        "alignment": 2,
        "margin_v": 170,
        "animation": "minimal",
    },

    "Podcast": {
        "font": 'Cabin',
        "size": 48,
        "bold": True,
        "primary": "&H00E6F2FF",
        "outline": BLACK,
        "outline_width": 4,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "podcast",
    },

    "Highlight": {
        "font": 'Yanone Kaffeesatz',
        "size": 56,
        "bold": True,
        "primary": "&H00FFF0C9",
        "outline": PURPLE,
        "outline_width": 6,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "highlight",
    },

    "Clean": {
        "font": 'Alfa Slab One',
        "size": 45,
        "bold": True,
        "primary": "&H00E8F1FF",
        "outline": BLACK,
        "outline_width": 3,
        "shadow": 2,
        "alignment": 2,
        "margin_v": 180,
        "animation": "clean",
    },
}


# ============================================================
# TIME
# ============================================================

def ass_time(seconds):
    seconds = max(0.0, float(seconds))

    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60

    whole = int(secs)
    centiseconds = int(round((secs - whole) * 100))

    if centiseconds >= 100:
        whole += 1
        centiseconds = 0

    if whole >= 60:
        minutes += 1
        whole = 0

    if minutes >= 60:
        hours += 1
        minutes = 0

    return (
        f"{hours}:"
        f"{minutes:02d}:"
        f"{whole:02d}."
        f"{centiseconds:02d}"
    )


# ============================================================
# TEXT CLEANING
# ============================================================

def clean_text(value):
    text = str(value or "")

    text = html.unescape(text)

    text = text.replace("\n", " ")
    text = text.replace("\r", " ")
    text = text.replace("\\N", " ")

    text = re.sub(r"\s+", " ", text)

    return text.strip()


def ass_escape(text):
    text = clean_text(text)

    text = text.replace(
        "{",
        "\\{",
    )

    text = text.replace(
        "}",
        "\\}",
    )

    return text


# ============================================================
# TRANSCRIPT
# ============================================================

def load_transcript(path):
    path = Path(path)

    if not path.exists():
        raise FileNotFoundError(
            f"Transcript not found:\n{path}"
        )

    data = json.loads(
        path.read_text(
            encoding="utf-8"
        )
    )

    if isinstance(data, list):
        segments = data

    elif isinstance(data, dict):
        segments = (
            data.get("segments")
            or data.get("transcript")
            or data.get("results")
            or []
        )

    else:
        segments = []

    if not isinstance(
        segments,
        list
    ):
        segments = []

    normalized = []

    for item in segments:
        if not isinstance(item, dict):
            continue

        start = item.get(
            "start",
            item.get("start_time")
        )

        end = item.get(
            "end",
            item.get("end_time")
        )

        text = clean_text(
            item.get(
                "text",
                item.get(
                    "content",
                    ""
                )
            )
        )

        try:
            start = float(start)
            end = float(end)
        except (
            TypeError,
            ValueError,
        ):
            continue

        if end <= start:
            continue

        if not text:
            continue

        normalized.append({
            "start": start,
            "end": end,
            "text": text,
        })

    normalized.sort(
        key=lambda x: x["start"]
    )

    return normalized


# ============================================================
# CLIP SEGMENTS
# ============================================================

def get_clip_segments(
    segments,
    clip_start,
    clip_end,
):
    result = []

    for segment in segments:
        if segment["end"] <= clip_start:
            continue

        if segment["start"] >= clip_end:
            break

        start = max(
            segment["start"],
            clip_start
        )

        end = min(
            segment["end"],
            clip_end
        )

        if end <= start:
            continue

        result.append({
            "start": start - clip_start,
            "end": end - clip_start,
            "text": segment["text"],
        })

    return result


# ============================================================
# WORD CHUNKING
# ============================================================

def split_words(text):
    return [
        item
        for item in clean_text(text).split()
        if item
    ]


def chunk_words(words):
    chunks = []

    current = []

    for word in words:
        current.append(word)

        if len(current) >= MAX_WORDS_PER_LINE:
            chunks.append(current)
            current = []

    if current:
        chunks.append(current)

    return chunks


# ============================================================
# SMART TEXT WRAPPING
# ============================================================

def wrap_words(words):
    lines = []

    current = []

    for word in words:
        candidate = (
            " ".join(current + [word])
        )

        if (
            current
            and len(candidate)
            > MAX_CHARS_PER_LINE
        ):
            lines.append(
                " ".join(current)
            )

            current = [word]

        else:
            current.append(word)

    if current:
        lines.append(
            " ".join(current)
        )

    return lines


# ============================================================
# ASS HEADER
# ============================================================

def ass_header(config):
    font = config["font"]
    size = config["size"]
    bold = -1 if config["bold"] else 0

    primary = config["primary"]
    outline = config["outline"]

    outline_width = config[
        "outline_width"
    ]

    shadow = config["shadow"]

    alignment = config[
        "alignment"
    ]

    margin_v = config[
        "margin_v"
    ]

    return f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes
WrapStyle: 2
YCbCr Matrix: None

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Snip,{font},{size},{primary},{WHITE},{outline},&H99000000,{bold},0,0,0,100,100,0,0,1,{outline_width},{shadow},{alignment},40,40,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""



# ============================================================
# CAPTION LAYOUT ENGINE
# ============================================================

CAPTION_X = 540

# 1080x1920 canvas.
# The source footage is normally centered vertically, so these
# positions keep captions inside the visible video area instead
# of placing them in the black letterbox.
CAPTION_TOP_Y = 1170
CAPTION_BOTTOM_Y = 1220
CAPTION_SINGLE_TOP_Y = 1195
CAPTION_SINGLE_BOTTOM_Y = 1195


def position_tag(y):
    return (
        "{\\an5\\pos("
        + str(CAPTION_X)
        + ","
        + str(y)
        + ")}"
    )


def split_caption_layout(words, pattern_index):
    """
    Layout rules:

    5 words:
      pattern 0 -> 3 top / 2 bottom
      pattern 1 -> 2 top / 3 bottom

    4 words:
      2 top / 2 bottom

    1-3 words:
      single line
    """

    count = len(words)

    if count >= 5:
        if pattern_index % 2 == 0:
            return (
                words[:3],
                words[3:5],
            )

        return (
            words[:2],
            words[2:5],
        )

    if count == 4:
        return (
            words[:2],
            words[2:4],
        )

    return (
        None,
        words,
    )


def style_word(word, index, active_index, active_color=None):
    escaped = ass_escape(word.upper())

    if active_color and index == active_index:
        return (
            "{\\c"
            + active_color
            + "}"
            + escaped
            + "{\\c"
            + WHITE
            + "}"
        )

    return escaped


def build_positioned_word_events(
    segments,
    config,
    animation,
    active_color=None,
):
    """
    Generic caption renderer.

    Every phrase is split into short word groups.
    The words advance one-by-one while preserving the
    3/2, 2/3, 2/2 or single-line layout.
    """

    events = []

    for segment in segments:
        words = split_words(segment["text"])

        if not words:
            continue

        chunks = chunk_words(words)

        chunk_duration = (
            segment["end"]
            - segment["start"]
        ) / len(chunks)

        for chunk_index, chunk in enumerate(chunks):
            chunk_start = (
                segment["start"]
                + chunk_index * chunk_duration
            )

            word_duration = (
                chunk_duration / len(chunk)
            )

            top_words, bottom_words = split_caption_layout(
                chunk,
                chunk_index,
            )

            # --------------------------------------------
            # Animation prefix
            # --------------------------------------------

            if animation == "reveal":
                prefix = (
                    "{\\alpha&HFF&\\fscx72\\fscy72}"
                    "{\\t(0,140,\\alpha&H00&\\fscx100\\fscy100)}"
                )

            elif animation == "snap":
                prefix = (
                    "{\\fscx120\\fscy120}"
                    "{\\t(0,90,\\fscx100\\fscy100)}"
                )

            elif animation == "headline":
                prefix = (
                    "{\\fscx82\\fscy82}"
                    "{\\t(0,160,\\fscx100\\fscy100)}"
                )

            elif animation == "hype":
                prefix = (
                    "{\\fscx88\\fscy88}"
                    "{\\t(0,110,\\fscx100\\fscy100)}"
                )

            elif animation == "mrbeast":
                prefix = (
                    "{\\fscx88\\fscy88}"
                    "{\\t(0,120,\\fscx100\\fscy100)}"
                )

            elif animation == "minimal":
                prefix = (
                    "{\\alpha&HFF&}"
                    "{\\t(0,180,\\alpha&H00&)}"
                )

            elif animation == "podcast":
                prefix = (
                    "{\\fscx94\\fscy94}"
                    "{\\t(0,130,\\fscx100\\fscy100)}"
                )

            elif animation == "highlight":
                prefix = (
                    "{\\fscx92\\fscy92}"
                    "{\\t(0,120,\\fscx100\\fscy100)}"
                )

            else:
                prefix = ""

            for word_index, _word in enumerate(chunk):
                start = (
                    chunk_start
                    + word_index * word_duration
                )

                end = start + word_duration

                active_index = word_index

                # ----------------------------------------
                # TOP LINE
                # ----------------------------------------

                if top_words:
                    top_parts = []

                    for i, word in enumerate(top_words):
                        top_parts.append(
                            style_word(
                                word,
                                i,
                                active_index,
                                active_color,
                            )
                        )

                    top_text = (
                        position_tag(CAPTION_TOP_Y)
                        + WORD_FADE_PREFIX
                        + prefix
                        + " ".join(top_parts)
                    )

                    events.append(
                        (
                            start,
                            end,
                            top_text,
                        )
                    )

                # ----------------------------------------
                # BOTTOM LINE / SINGLE LINE
                # ----------------------------------------

                if bottom_words:
                    bottom_parts = []

                    bottom_offset = (
                        len(top_words)
                        if top_words
                        else 0
                    )

                    for i, word in enumerate(bottom_words):
                        bottom_parts.append(
                            style_word(
                                word,
                                bottom_offset + i,
                                active_index,
                                active_color,
                            )
                        )

                    if top_words:
                        bottom_y = CAPTION_BOTTOM_Y
                    else:
                        # Keep every single-line caption at
                        # one consistent vertical position.
                        bottom_y = CAPTION_SINGLE_TOP_Y

                    bottom_text = (
                        position_tag(bottom_y)
                        + WORD_FADE_PREFIX
                        + prefix
                        + " ".join(bottom_parts)
                    )

                    events.append(
                        (
                            start,
                            end,
                            bottom_text,
                        )
                    )

    return events


# ============================================================
# REVEAL
# ============================================================

def build_reveal_events(
    segments,
    config,
):
    return build_positioned_word_events(
        segments,
        config,
        "reveal",
        config.get("active"),
    )

# ============================================================
# SNAP
# ============================================================

def build_snap_events(
    segments,
    config,
):
    return build_positioned_word_events(
        segments,
        config,
        "snap",
        config.get("active", PINK),
    )

# ============================================================
# HEADLINE
# ============================================================

def build_headline_events(
    segments,
    config,
):
    events = []

    for segment in segments:
        words = split_words(
            segment["text"]
        )

        if not words:
            continue

        chunks = chunk_words(words)

        chunk_duration = (
            segment["end"]
            - segment["start"]
        ) / len(chunks)

        for index, chunk in enumerate(
            chunks
        ):
            start = (
                segment["start"]
                + index * chunk_duration
            )

            end = (
                start
                + chunk_duration
            )

            # Keep every Headline caption at the
            # same upper-video position and wrap
            # longer captions into multiple lines.
            lines = wrap_words(chunk)

            content = "\\N".join(
                line.upper()
                for line in lines
            )

            text = (
                "{\\an8\\pos(540,430)\\fscx85\\fscy85}"
                "{\\t(0,160,\\fscx100\\fscy100)}"
                + ass_escape(content)
            )

            events.append(
                (
                    start,
                    end,
                    text
                )
            )

    return events


# ============================================================
# HYPE
# ============================================================

def build_hype_events(
    segments,
    config,
):
    return build_positioned_word_events(
        segments,
        config,
        "hype",
        config.get("active"),
    )

# ============================================================
# MRBEAST
# ============================================================

def build_mrbeast_events(
    segments,
    config,
):
    return build_positioned_word_events(
        segments,
        config,
        "mrbeast",
        config.get("active", YELLOW),
    )

# ============================================================
# SIMPLE STYLES
# ============================================================

def build_simple_events(
    segments,
    config,
):
    animation = config.get(
        "animation",
        "clean",
    )

    return build_positioned_word_events(
        segments,
        config,
        animation,
        config.get("active"),
    )

# ============================================================
# BUILD ASS
# ============================================================

def build_ass(
    transcript_path,
    clip_start,
    clip_end,
    output_path,
    template,
):
    if template not in STYLE_CONFIG:
        raise ValueError(
            f"Unknown caption template: {template}"
        )

    config = STYLE_CONFIG[
        template
    ]

    all_segments = load_transcript(
        transcript_path
    )

    segments = get_clip_segments(
        all_segments,
        clip_start,
        clip_end,
    )

    if not segments:
        raise RuntimeError(
            "No transcript segments overlap "
            "the selected clip."
        )

    animation = config.get(
        "animation"
    )

    if animation == "reveal":
        events = build_reveal_events(
            segments,
            config
        )

    elif animation == "snap":
        events = build_snap_events(
            segments,
            config
        )

    elif animation == "headline":
        events = build_headline_events(
            segments,
            config
        )

    elif animation == "hype":
        events = build_hype_events(
            segments,
            config
        )

    elif animation == "mrbeast":
        events = build_mrbeast_events(
            segments,
            config
        )

    else:
        events = build_simple_events(
            segments,
            config
        )

    if not events:
        raise RuntimeError(
            "Caption engine generated zero events."
        )

    lines = [
        ass_header(config)
    ]

    for start, end, text in events:
        lines.append(
            "Dialogue: 0,"
            + ass_time(start)
            + ","
            + ass_time(end)
            + ",Snip,,0,0,0,,"
            + text
        )

    content = "\n".join(lines)
    content += "\n"

    output_path = Path(
        output_path
    )

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    output_path.write_text(
        content,
        encoding="utf-8"
    )

    return {
        "template": template,
        "transcript": str(
            transcript_path
        ),
        "clip_start": clip_start,
        "clip_end": clip_end,
        "events": len(events),
        "output": str(output_path),
    }


# ============================================================
# CLI
# ============================================================

def main():
    if len(sys.argv) < 6:
        print(
            "Usage:"
        )
        print(
            "python caption_engine.py "
            "<transcript.json> "
            "<clip_start> "
            "<clip_end> "
            "<template> "
            "<output.ass>"
        )
        sys.exit(1)

    transcript = Path(
        sys.argv[1]
    ).expanduser()

    clip_start = float(
        sys.argv[2]
    )

    clip_end = float(
        sys.argv[3]
    )

    template = sys.argv[4]

    output = Path(
        sys.argv[5]
    ).expanduser()

    result = build_ass(
        transcript,
        clip_start,
        clip_end,
        output,
        template,
    )

    print(
        json.dumps(
            result,
            indent=2
        )
    )


if __name__ == "__main__":
    main()
