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
# Production settings:
# Model        : base
# Device       : CPU
# Compute      : int8
# CPU threads  : 8
# Beam size    : 1
# Best of      : 1
# VAD          : ON
# Word timings : OFF
#
# Runtime modes:
#
# 1. Windows bundled runtime
#    SNIP_AI_WHISPER_MODEL_DIR points to bundled model
#
# 2. Linux/local development
#    faster-whisper uses its normal local model cache
#
# ============================================================


MODEL_SIZE = "base"

CPU_THREADS = 8

COMPUTE_TYPE = "int8"

BEAM_SIZE = 1

BEST_OF = 1


# ============================================================
# RUNTIME PATHS
# ============================================================

WHISPER_MODEL_DIR_ENV = os.environ.get(
    "SNIP_AI_WHISPER_MODEL_DIR"
)


if WHISPER_MODEL_DIR_ENV:

    WHISPER_MODEL_DIR = (
        Path(
            WHISPER_MODEL_DIR_ENV
        )
        .expanduser()
        .resolve()
    )

else:

    WHISPER_MODEL_DIR = None


FFPROBE_ENV = os.environ.get(
    "SNIP_AI_FFPROBE"
)


if FFPROBE_ENV:

    FFPROBE = (
        Path(
            FFPROBE_ENV
        )
        .expanduser()
        .resolve()
    )

else:

    FFPROBE = None


# ============================================================
# FFMPEG / FFPROBE
# ============================================================

def resolve_ffprobe():

    if (
        FFPROBE is not None
        and FFPROBE.is_file()
    ):
        return FFPROBE

    runtime_root = os.environ.get(
        "SNIP_AI_RUNTIME_ROOT"
    )

    if runtime_root:

        runtime_path = (
            Path(runtime_root)
            / "ffmpeg"
            / (
                "ffprobe.exe"
                if os.name == "nt"
                else "ffprobe"
            )
        )

        if runtime_path.is_file():

            return runtime_path

    from_path = shutil_which(
        "ffprobe"
    )

    if from_path:

        return Path(from_path)

    return None


def shutil_which(command):

    import shutil

    return shutil.which(
        command
    )


# ============================================================
# VIDEO DURATION
# ============================================================

def get_video_duration(
    video: Path,
) -> float:

    ffprobe = resolve_ffprobe()

    if ffprobe is None:

        return 0.0

    try:

        result = subprocess.run(
            [
                str(ffprobe),
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

        return float(
            result.stdout.strip()
        )

    except Exception:

        return 0.0


# ============================================================
# WHISPER MODEL
# ============================================================

def load_whisper_model():

    # --------------------------------------------------------
    # Bundled model
    # --------------------------------------------------------

    if (
        WHISPER_MODEL_DIR is not None
        and WHISPER_MODEL_DIR.exists()
    ):

        print(
            f"Whisper model directory: "
            f"{WHISPER_MODEL_DIR}"
        )

        print(
            "Loading bundled local Whisper model..."
        )

        return WhisperModel(
            str(WHISPER_MODEL_DIR),
            device="cpu",
            compute_type=COMPUTE_TYPE,
            cpu_threads=CPU_THREADS,
            num_workers=1,
            local_files_only=True,
        )

    # --------------------------------------------------------
    # Development fallback
    # --------------------------------------------------------

    print(
        "No bundled Whisper model directory configured."
    )

    print(
        "Using faster-whisper local/default model cache."
    )

    return WhisperModel(
        MODEL_SIZE,
        device="cpu",
        compute_type=COMPUTE_TYPE,
        cpu_threads=CPU_THREADS,
        num_workers=1,
    )


# ============================================================
# TRANSCRIPTION
# ============================================================

def transcribe(
    video_path: str,
):

    video = Path(
        video_path
    )

    if not video.exists():

        print(
            f"Video not found: {video}"
        )

        sys.exit(1)

    output_path = (
        video.with_suffix(
            ".transcript.json"
        )
    )

    # --------------------------------------------------------
    # REUSE EXISTING TRANSCRIPT
    # --------------------------------------------------------

    if output_path.exists():

        try:

            with open(
                output_path,
                "r",
                encoding="utf-8",
            ) as f:

                existing = json.load(f)

            existing_segments = (
                existing.get(
                    "segments",
                    [],
                )
            )

            if existing_segments:

                print()
                print("=" * 70)
                print(
                    "SNIP AI — TRANSCRIPT CACHE"
                )
                print("=" * 70)

                print(
                    f"Existing transcript : "
                    f"{output_path}"
                )

                print(
                    f"Segments            : "
                    f"{len(existing_segments)}"
                )

                print(
                    "Status              : "
                    "REUSING EXISTING TRANSCRIPT"
                )

                print(
                    "=" * 70
                )

                return

        except Exception:

            pass

    # --------------------------------------------------------
    # VIDEO INFO
    # --------------------------------------------------------

    duration = get_video_duration(
        video
    )

    print()
    print("=" * 70)
    print(
        "SNIP AI — PRODUCTION WHISPER"
    )
    print("=" * 70)

    print(
        f"Video        : {video}"
    )

    print(
        f"Duration     : {duration:.2f}s"
    )

    print(
        f"Model        : {MODEL_SIZE}"
    )

    print(
        "Library      : faster-whisper"
    )

    print(
        "Device       : CPU"
    )

    print(
        f"Compute      : {COMPUTE_TYPE}"
    )

    print(
        f"CPU threads  : {CPU_THREADS}"
    )

    print(
        f"Beam size    : {BEAM_SIZE}"
    )

    print(
        f"Best of      : {BEST_OF}"
    )

    print(
        "VAD          : ON"
    )

    print(
        "Word timing  : OFF"
    )

    print(
        "Previous text: OFF"
    )

    if WHISPER_MODEL_DIR is not None:

        print(
            f"Model path   : "
            f"{WHISPER_MODEL_DIR}"
        )

    else:

        print(
            "Model path   : "
            "faster-whisper cache"
        )

    print("=" * 70)

    # --------------------------------------------------------
    # LOAD MODEL
    # --------------------------------------------------------

    print()
    print(
        "Loading Whisper model..."
    )

    try:

        model = load_whisper_model()

    except Exception as exc:

        print()
        print(
            "Could not load Whisper model."
        )

        print(
            f"Error: {exc}"
        )

        if WHISPER_MODEL_DIR is not None:

            print()
            print(
                "Configured bundled model directory:"
            )

            print(
                WHISPER_MODEL_DIR
            )

        sys.exit(1)

    print(
        "Model loaded."
    )

    print()
    print(
        "Transcribing..."
    )

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

    for index, segment in enumerate(
        segments
    ):

        text = segment.text.strip()

        if not text:

            continue

        result_segments.append(
            {
                "id": index,
                "start": round(
                    float(
                        segment.start
                    ),
                    2,
                ),
                "end": round(
                    float(
                        segment.end
                    ),
                    2,
                ),
                "text": text,
            }
        )

    # --------------------------------------------------------
    # SAVE RESULT
    # --------------------------------------------------------

    result = {
        "video": str(video),
        "language": info.language,
        "language_probability": (
            info.language_probability
        ),
        "duration": round(
            duration,
            3,
        ),
        "segments": result_segments,
    }

    with open(
        output_path,
        "w",
        encoding="utf-8",
    ) as f:

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
    print(
        "SNIP AI — TRANSCRIPTION COMPLETE"
    )
    print("=" * 70)

    print(
        f"Transcript : {output_path}"
    )

    print(
        f"Segments   : {len(result_segments)}"
    )

    print(
        f"Language   : {info.language}"
    )

    print("=" * 70)


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":

    if len(sys.argv) < 2:

        print(
            "Usage: "
            "python whisper_transcribe.py "
            "/path/to/video.mp4"
        )

        sys.exit(1)

    transcribe(
        sys.argv[1]
    )
