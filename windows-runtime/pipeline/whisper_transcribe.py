import json
import os
import subprocess
import sys
from pathlib import Path

from faster_whisper import WhisperModel


# ============================================================
# CONFIG
# ============================================================

MODEL_SIZE = os.environ.get("SNIP_AI_WHISPER_MODEL", "base")
COMPUTE_TYPE = os.environ.get("SNIP_AI_WHISPER_COMPUTE", "int8")

CPU_THREADS = int(
    os.environ.get("SNIP_AI_WHISPER_CPU_THREADS", "8")
)

BEAM_SIZE = int(
    os.environ.get("SNIP_AI_WHISPER_BEAM_SIZE", "5")
)

BEST_OF = int(
    os.environ.get("SNIP_AI_WHISPER_BEST_OF", "5")
)

WHISPER_VERSION = "word-timestamps-v1"


# ============================================================
# PATHS
# ============================================================

BASE_DIR = Path(__file__).resolve().parent


def resolve_ffprobe():
    configured = os.environ.get("SNIP_AI_FFPROBE")

    if configured:
        candidate = Path(configured).expanduser()

        if candidate.is_file():
            return str(candidate)

    found = shutil_which("ffprobe")

    if found:
        return found

    return "ffprobe"


def shutil_which(name):
    import shutil

    return shutil.which(name)


# ============================================================
# VIDEO INFO
# ============================================================

def get_video_duration(video):
    ffprobe = resolve_ffprobe()

    try:
        result = subprocess.run(
            [
                ffprobe,
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
# CACHE VALIDATION
# ============================================================

def transcript_has_word_timestamps(data):
    segments = data.get("segments", [])

    if not segments:
        return False

    for segment in segments:
        words = segment.get("words")

        if isinstance(words, list) and words:
            return True

    return False


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
    # REUSE EXISTING TRANSCRIPT ONLY IF IT HAS WORD TIMING
    # --------------------------------------------------------

    if output_path.exists():

        try:
            with open(output_path, "r", encoding="utf-8") as f:
                existing = json.load(f)

            existing_segments = existing.get("segments", [])

            if (
                existing.get("whisper_version") == WHISPER_VERSION
                and transcript_has_word_timestamps(existing)
            ):

                print()
                print("=" * 70)
                print("SNIP AI — TRANSCRIPT CACHE")
                print("=" * 70)

                print(f"Existing transcript : {output_path}")
                print(f"Segments            : {len(existing_segments)}")
                print("Word timing         : ON")
                print("Status              : REUSING VALID TRANSCRIPT")

                print("=" * 70)

                return

            print()
            print("=" * 70)
            print("SNIP AI — TRANSCRIPT CACHE")
            print("=" * 70)

            print(f"Existing transcript : {output_path}")
            print("Status              : OLD TRANSCRIPT DETECTED")
            print("Action              : RE-TRANSCRIBING WITH WORD TIMING")

            print("=" * 70)

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
    print("Word timing  : ON")
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

    vad_filter = os.environ.get(
        "SNIP_AI_VAD_FILTER",
        "true",
    ).strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }

    segments, info = model.transcribe(
        str(video),

        beam_size=BEAM_SIZE,
        best_of=BEST_OF,

        vad_filter=vad_filter,

        condition_on_previous_text=False,

        word_timestamps=True,

        temperature=0.0,
    )

    result_segments = []

    for index, segment in enumerate(segments):

        text = segment.text.strip()

        if not text:
            continue

        words = []

        for word in getattr(segment, "words", []) or []:

            word_text = str(
                getattr(word, "word", "")
            ).strip()

            if not word_text:
                continue

            try:
                word_start = float(
                    getattr(word, "start")
                )

                word_end = float(
                    getattr(word, "end")
                )

            except (TypeError, ValueError):
                continue

            if word_end <= word_start:
                continue

            words.append(
                {
                    "text": word_text,
                    "start": round(word_start, 3),
                    "end": round(word_end, 3),
                }
            )

        result_segments.append(
            {
                "id": index,
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "text": text,
                "words": words,
            }
        )

    # --------------------------------------------------------
    # VALIDATE WORD TIMING
    # --------------------------------------------------------

    total_words = sum(
        len(segment.get("words", []))
        for segment in result_segments
    )

    if total_words == 0:

        print()
        print("=" * 70)
        print("WHISPER ERROR")
        print("=" * 70)

        print("Word timestamps were requested,")
        print("but Whisper returned zero words.")

        print("=" * 70)

        sys.exit(1)

    # --------------------------------------------------------
    # SAVE RESULT
    # --------------------------------------------------------

    result = {
        "video": str(video),
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": round(duration, 3),
        "whisper_version": WHISPER_VERSION,
        "word_timestamps": True,
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
    print(f"Words          : {total_words}")
    print(f"Duration       : {duration:.2f}s")
    print("Word timing    : ON")
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
