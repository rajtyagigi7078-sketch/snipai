#!/usr/bin/env python3

import json
import os
import subprocess
import sys
from pathlib import Path

from faster_whisper import WhisperModel


# ============================================================
# SNIP AI — PRODUCTION WHISPER TRANSCRIBER
# ============================================================
#
# LOCKED PRODUCTION SETTINGS
#
# Library      : faster-whisper
# Model        : base
# Device       : CPU
# Compute      : int8
# CPU threads  : 8
# Beam size    : 1
# Best of      : 1
# VAD          : ON
# Word timings : OFF
#
# Tested on 71.5 minute video:
# Base + int8 = ~232.62 seconds
#
# int8_float32 benchmark = ~243.92 seconds
# Therefore production uses int8.
# ============================================================

MODEL_SIZE = "base"

CPU_THREADS = 8

COMPUTE_TYPE = "int8"

BEAM_SIZE = 1
BEST_OF = 1


# ============================================================
# VIDEO DURATION
# ============================================================

def get_video_duration(video: Path) -> float:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(video),
            ],
            capture_output=True,
            text=True,
            check=True,
        )

        return float(result.stdout.strip())

    except Exception:
        return 0.0


# ============================================================
# TRANSCRIPTION
# ============================================================

def transcribe(video_path: str):

    video = Path(video_path)

    if not video.exists():
        print(f"Video not found: {video}")
        sys.exit(1)

    output_path = video.with_suffix(".transcript.json")

    # --------------------------------------------------------
    # REUSE EXISTING TRANSCRIPT
    # --------------------------------------------------------

    if output_path.exists():

        try:
            with open(output_path, "r", encoding="utf-8") as f:
                existing = json.load(f)

            existing_segments = existing.get("segments", [])

            if existing_segments:

                print()
                print("=" * 70)
                print("SNIP AI — TRANSCRIPT CACHE")
                print("=" * 70)

                print(f"Existing transcript : {output_path}")
                print(f"Segments            : {len(existing_segments)}")
                print("Status              : REUSING EXISTING TRANSCRIPT")
                print("=" * 70)

                return

        except Exception:
            pass

    # --------------------------------------------------------
    # VIDEO INFO
    # --------------------------------------------------------

    duration = get_video_duration(video)

    print()
    print("=" * 70)
    print("SNIP AI — PRODUCTION WHISPER")
    print("=" * 70)

    print(f"Video        : {video}")
    print(f"Duration     : {duration:.2f}s")
    print(f"Model        : {MODEL_SIZE}")
    print("Library      : faster-whisper")
    print("Device       : CPU")
    print(f"Compute      : {COMPUTE_TYPE}")
    print(f"CPU threads  : {CPU_THREADS}")
    print(f"Beam size    : {BEAM_SIZE}")
    print(f"Best of      : {BEST_OF}")
    print("VAD          : ON")
    print("Word timing  : OFF")
    print("Previous text: OFF")
    print("=" * 70)

    # --------------------------------------------------------
    # LOAD MODEL
    # --------------------------------------------------------

    print()
    print("Loading Whisper model...")

    model = WhisperModel(
        MODEL_SIZE,
        device="cpu",
        compute_type=COMPUTE_TYPE,
        cpu_threads=CPU_THREADS,
        num_workers=1,
    )

    print("Model loaded.")
    print()
    print("Transcribing...")

    # --------------------------------------------------------
    # TRANSCRIBE
    # --------------------------------------------------------

    segments, info = model.transcribe(
        str(video),

        beam_size=BEAM_SIZE,
        best_of=BEST_OF,

        vad_filter=True,

        condition_on_previous_text=False,

        word_timestamps=False,

        temperature=0.0,
    )

    result_segments = []

    for index, segment in enumerate(segments):

        text = segment.text.strip()

        if not text:
            continue

        result_segments.append(
            {
                "id": index,
                "start": round(float(segment.start), 2),
                "end": round(float(segment.end), 2),
                "text": text,
            }
        )

    # --------------------------------------------------------
    # SAVE RESULT
    # --------------------------------------------------------

    result = {
        "video": str(video),
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": round(duration, 3),
        "segments": result_segments,
    }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(
            result,
            f,
            indent=2,
            ensure_ascii=False,
        )

    # --------------------------------------------------------
    # COMPLETE
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("TRANSCRIPTION COMPLETE")
    print("=" * 70)

    print(f"Language       : {info.language}")
    print(f"Segments       : {len(result_segments)}")
    print(f"Duration       : {duration:.2f}s")
    print(f"Saved          : {output_path}")

    print("=" * 70)


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    if len(sys.argv) < 2:

        print()
        print("Usage:")
        print(
            "python whisper_transcribe.py "
            "/path/to/video.mp4"
        )

        sys.exit(1)

    transcribe(sys.argv[1])
