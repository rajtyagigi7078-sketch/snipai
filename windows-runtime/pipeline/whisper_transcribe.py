import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from hindi_romanize import romanize_hinglish


# ============================================================
# CONFIG
# ============================================================

MODEL_SIZE = os.environ.get("SNIP_AI_WHISPER_MODEL", "base")
COMPUTE_TYPE = os.environ.get("SNIP_AI_WHISPER_COMPUTE", "int8")

CPU_THREADS = int(
    os.environ.get("SNIP_AI_WHISPER_CPU_THREADS", "8")
)

BEAM_SIZE = int(
    os.environ.get("SNIP_AI_WHISPER_BEAM_SIZE", "3")
)

BEST_OF = int(
    os.environ.get("SNIP_AI_WHISPER_BEST_OF", "1")
)

# Opt-in comparison route for evaluating faster-whisper on Hinglish audio.
# The production default remains the timestamp-enabled Swift Hinglish model.
HINGLISH_ENGINE = os.environ.get("SNIP_AI_HINGLISH_ENGINE", "swift").strip().lower()

WHISPER_VERSION = "swift-hinglish-word-timestamps-v3-vad-speech-windows"

HINGLISH_INITIAL_PROMPT = (
    "Yeh ek Hinglish audio hai jisme Hindi aur English mix words use kiye gaye hain. "
    "Hindi ko Roman Hinglish mein likho, Devanagari ya Urdu script mein nahi. "
    "Common words: bhai, kya, kar rahe ho, hai, nahi, main, aap, ghar, ja raha hoon. "
    "Keep English words in English. Do not translate the speech."
)


# ============================================================
# PATHS
# ============================================================

BASE_DIR = Path(__file__).resolve().parent


def normalize_native_path(path):
    """Remove Windows extended-length prefixes unsupported by CTranslate2."""
    value = os.path.expanduser(os.fspath(path))
    if os.name == "nt":
        if value.startswith("\\\\?\\UNC\\"):
            value = "\\\\" + value[8:]
        elif value.startswith("\\\\?\\"):
            value = value[4:]
    return value


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

def transcribe(video_path: str, audio_language: str = "hinglish"):

    video = Path(video_path)

    if not video.exists():
        print(f"Video not found: {video}")
        sys.exit(1)

    audio_language = (audio_language or "hinglish").strip().lower()
    if audio_language not in {"english", "hinglish"}:
        raise ValueError("Audio language must be english or hinglish.")

    if HINGLISH_ENGINE not in {"swift", "faster-whisper"}:
        raise ValueError("SNIP_AI_HINGLISH_ENGINE must be 'swift' or 'faster-whisper'.")
    use_faster_whisper = (
        audio_language == "english"
        or (audio_language == "hinglish" and HINGLISH_ENGINE == "faster-whisper")
    )
    transcription_version = (
        f"faster-whisper-{MODEL_SIZE}-{audio_language}-prompt-v1"
        if use_faster_whisper
        else f"{WHISPER_VERSION}-{audio_language}"
    )
    output_path = Path(os.environ.get("SNIP_AI_TRANSCRIPT_PATH", str(video.with_suffix(".transcript.json")))).expanduser().resolve()
    source_stat = video.stat()
    source_identity = {
        "video": str(video.resolve()),
        "source_size": source_stat.st_size,
        "source_mtime_ns": source_stat.st_mtime_ns,
    }

    # --------------------------------------------------------
    # REUSE EXISTING TRANSCRIPT ONLY IF IT HAS WORD TIMING
    # --------------------------------------------------------

    if output_path.exists():

        try:
            with open(output_path, "r", encoding="utf-8") as f:
                existing = json.load(f)

            existing_segments = existing.get("segments", [])

            if (
                existing.get("whisper_version") == transcription_version
                and existing.get("video") == source_identity["video"]
                and existing.get("source_size") == source_identity["source_size"]
                and existing.get("source_mtime_ns") == source_identity["source_mtime_ns"]
                and (
                    transcript_has_word_timestamps(existing)
                    or existing.get("transcription_status") in {"no_speech", "no_words"}
                )
            ):

                print()
                print("=" * 70)
                print("SNIP AI â€” TRANSCRIPT CACHE")
                print("=" * 70)

                print(f"Existing transcript : {output_path}")
                print(f"Segments            : {len(existing_segments)}")
                if transcript_has_word_timestamps(existing):
                    print("Word timing         : ON")
                elif existing.get("transcription_status") == "no_speech":
                    print("Word timing         : NO SPEECH FOUND")
                else:
                    print("Word timing         : MODEL RETURNED NO WORDS")
                print("Status              : REUSING VALID TRANSCRIPT")

                print("=" * 70)

                return

            print()
            print("=" * 70)
            print("SNIP AI â€” TRANSCRIPT CACHE")
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
    print("SNIP AI â€” PRODUCTION WHISPER")
    print("=" * 70)

    print(f"Video        : {video}")
    print(f"Duration     : {duration:.2f}s")
    print(f"Model        : {MODEL_SIZE if use_faster_whisper else 'Swift Hinglish timestamped'}")
    print(f"Library      : {'faster-whisper' if use_faster_whisper else 'Hugging Face Transformers'}")
    print(f"Device       : {os.environ.get('SNIP_AI_WHISPER_DEVICE', 'auto').upper() + ' (CUDA when available, CPU fallback)' if use_faster_whisper else 'CPU'}")
    print(f"Compute      : {COMPUTE_TYPE + ' preferred' if use_faster_whisper else 'bundled quantized model'}")
    print(f"CPU threads  : {CPU_THREADS}")
    print(f"Beam size    : {BEAM_SIZE if use_faster_whisper else 'N/A (Swift model)'}")
    print(f"Best of      : {BEST_OF if use_faster_whisper else 'N/A (Swift model)'}")
    if audio_language == "hinglish" and use_faster_whisper:
        print("Hinglish prompt: ON (Hindi transcription; Romanized for captions)")
    print("VAD          : ON")
    print("Word timing  : ON")
    print("Previous text: OFF")
    print("=" * 70)

    # Hinglish defaults to the bundled timestamped Swift model. The faster-whisper
    # route is opt-in for model benchmarking and uses Hindi plus an initial prompt.
    if use_faster_whisper:
        from faster_whisper import WhisperModel

        # --------------------------------------------------------
        # LOAD MODEL
        # --------------------------------------------------------

        print()
        print("Loading Whisper model...")

        bundled_model_root = os.environ.get("SNIP_AI_WHISPER_MODEL_DIR")
        if bundled_model_root:
            normalized_root = normalize_native_path(bundled_model_root)
            model_path = Path(os.path.abspath(Path(normalized_root) / MODEL_SIZE))
            if model_path.is_dir() and (model_path / "model.bin").is_file():
                model_source = str(model_path)
            else:
                print(
                    f"Model '{MODEL_SIZE}' is not bundled; loading from the local "
                    "Faster-Whisper cache or downloading it on first use."
                )
                model_source = MODEL_SIZE
        else:
            model_source = MODEL_SIZE

        requested_device = os.environ.get("SNIP_AI_WHISPER_DEVICE", "auto").strip().lower()
        device, compute_type = "cpu", COMPUTE_TYPE
        if requested_device in {"auto", "cuda"}:
            try:
                import ctranslate2
                if ctranslate2.get_cuda_device_count() > 0:
                    device = "cuda"
                    compute_type = os.environ.get("SNIP_AI_WHISPER_GPU_COMPUTE", "float16")
            except Exception as error:
                print(f"CUDA unavailable; using CPU: {error}")
        try:
            model = WhisperModel(model_source, device=device, compute_type=compute_type, cpu_threads=CPU_THREADS, num_workers=1)
        except Exception as error:
            if device != "cuda": raise
            print(f"CUDA startup failed; retrying on CPU: {error}")
            device, compute_type = "cpu", COMPUTE_TYPE
            model = WhisperModel(model_source, device=device, compute_type=compute_type, cpu_threads=CPU_THREADS, num_workers=1)
        print(f"Transcription device: {device.upper()} ({compute_type})")

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

    # Use English without a language prompt. Hinglish benchmark runs force Hindi
    # recognition and pass a vocabulary/script hint; output is Romanized below.
        whisper_options = {
            "language": "en" if audio_language == "english" else "hi",
            "beam_size": BEAM_SIZE,
            "best_of": BEST_OF,
            "vad_filter": vad_filter,
            "condition_on_previous_text": False,
            "word_timestamps": True,
            "temperature": 0.0,
        }
        if audio_language == "hinglish":
            whisper_options["initial_prompt"] = HINGLISH_INITIAL_PROMPT
        segments, info = model.transcribe(str(video), **whisper_options)

    # Hindi-only Swift transcription remains the production default.
    if audio_language == "hinglish" and not use_faster_whisper:
        import tempfile

        print("Using speech-gated timestamp-enabled Swift Hinglish model...")

        from faster_whisper.audio import decode_audio
        from faster_whisper.vad import VadOptions, get_speech_timestamps

        print("Detecting speech regions before ASR...")
        vad_audio = decode_audio(str(video), sampling_rate=16000)
        vad_regions = get_speech_timestamps(
            vad_audio,
            VadOptions(
                threshold=0.35,
                neg_threshold=0.20,
                min_speech_duration_ms=250,
                max_speech_duration_s=25.0,
                min_silence_duration_ms=650,
                speech_pad_ms=250,
            ),
            sampling_rate=16000,
        )
        speech_regions = [
            {
                "start": round(region["start"] / 16000, 3),
                "end": round(region["end"] / 16000, 3),
            }
            for region in vad_regions
            if region.get("end", 0) > region.get("start", 0)
        ]
        speech_seconds = sum(
            region["end"] - region["start"]
            for region in speech_regions
        )
        print(
            f"Speech regions: {len(speech_regions)}; "
            f"speech audio: {speech_seconds:.1f}s of {duration:.1f}s."
        )

        configured_node = os.environ.get("SNIP_AI_NODE")
        node_exe = (
            configured_node
            if configured_node and Path(configured_node).is_file()
            else shutil.which("node")
        )

        if not node_exe:
            for candidate in (
                Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "nodejs" / "node.exe",
                Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "nodejs" / "node.exe",
            ):
                if candidate.is_file():
                    node_exe = str(candidate)
                    break
        helper = Path(__file__).resolve().parent / "swift-node" / "swift_hinglish.mjs"

        if speech_regions and (not node_exe or not helper.is_file()):
            raise RuntimeError(
                "Hindi Swift transcription requires Node.js and "
                "windows-runtime/pipeline/swift-node dependencies."
            )

        with tempfile.NamedTemporaryFile(
            prefix="snip-swift-result-",
            suffix=".json",
            delete=False,
        ) as temp_json:
            swift_json_path = Path(temp_json.name)

        speech_regions_path = None

        try:
            if speech_regions:
                with tempfile.NamedTemporaryFile(
                    prefix="snip-speech-regions-",
                    suffix=".json",
                    mode="w",
                    encoding="utf-8",
                    delete=False,
                ) as temp_regions:
                    speech_regions_path = Path(temp_regions.name)
                    json.dump(speech_regions, temp_regions)

                swift_env = os.environ.copy()
                swift_env.setdefault("PYTHONUTF8", "1")
                swift_env.setdefault("PYTHONIOENCODING", "utf-8")

                subprocess_result = subprocess.Popen(
                    [
                        node_exe,
                        str(helper),
                        str(video),
                        str(swift_json_path),
                        str(speech_regions_path),
                    ],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    env=swift_env,
                    bufsize=1,
                )

                if subprocess_result.stdout:
                    for output_line in subprocess_result.stdout:
                        print(output_line, end="", flush=True)
                return_code = subprocess_result.wait()

                if return_code != 0:
                    raise RuntimeError(
                        f"Swift Hinglish transcription failed with exit code {return_code}."
                    )

                with open(swift_json_path, "r", encoding="utf-8") as swift_file:
                    swift_data = json.load(swift_file)
            else:
                swift_data = {
                    "chunks": [],
                    "speech_regions": 0,
                    "speech_windows": 0,
                    "transcription_status": "no_speech",
                }
                print("No speech regions detected; skipping ASR to prevent game-audio hallucinations.")

        finally:
            try:
                swift_json_path.unlink()
            except OSError:
                pass
            if speech_regions_path is not None:
                try:
                    speech_regions_path.unlink()
                except OSError:
                    pass

        chunks = swift_data.get("chunks", [])
        swift_words = []

        for chunk in chunks:
            try:
                word_text = str(chunk.get("text", "")).strip()
                word_start = float(chunk.get("start"))
                word_end = float(chunk.get("end"))
            except (TypeError, ValueError, AttributeError):
                continue

            if word_text and 0 <= word_start < word_end <= duration + 2:
                swift_words.append({
                    "text": word_text,
                    "start": round(word_start, 3),
                    "end": round(word_end, 3),
                })

        transcription_status = swift_data.get("transcription_status", "complete")
        if not swift_words and transcription_status not in {"no_speech", "no_words"}:
            raise RuntimeError("Swift output contained no valid word timestamps.")

        # Group words for downstream event selection while preserving each word's timing.
        swift_segments = []
        current_words = []

        def flush_swift_segment():
            if not current_words:
                return
            swift_segments.append({
                "id": len(swift_segments),
                "start": current_words[0]["start"],
                "end": current_words[-1]["end"],
                "text": " ".join(w["text"] for w in current_words).strip(),
                "words": list(current_words),
            })
            current_words.clear()

        for word in swift_words:
            if current_words and word["start"] - current_words[-1]["end"] > 1.5:
                flush_swift_segment()
            current_words.append(word)
            text_now = word["text"].strip()
            closes_sentence = text_now.endswith((".", "!", "?", "।"))

            if closes_sentence or len(current_words) >= 8:
                flush_swift_segment()

        flush_swift_segment()

        swift_result = {
            **source_identity,
            "language": "hi",
            "language_probability": None,
            "duration": round(duration, 3),
            "whisper_version": transcription_version,
            "word_timestamps": True,
            "transcription_status": (
                "no_speech" if not speech_regions
                else "no_words" if not swift_words
                else "complete"
            ),
            "speech_regions": len(speech_regions),
            "speech_seconds": round(speech_seconds, 3),
            "segments": swift_segments,
        }

        with open(output_path, "w", encoding="utf-8") as swift_file:
            json.dump(swift_result, swift_file, indent=2, ensure_ascii=False)

        print("=" * 70)
        print("SWIFT HINGLISH TRANSCRIPTION COMPLETE")
        print(f"Words with timestamps : {len(swift_words)}")
        print(f"Segments              : {len(swift_segments)}")
        print(f"Status                : {swift_result['transcription_status']}")
        print(f"Saved                 : {output_path}")
        print("=" * 70)
        return

    result_segments = []

    for index, segment in enumerate(segments):

        # Romanize Hindi script without translating the spoken language.
        # English/Latin text is left unchanged by the helper.
        text = romanize_hinglish(segment.text.strip())

        if not text:
            continue

        words = []

        for word in getattr(segment, "words", []) or []:

            word_text = str(
                getattr(word, "word", "")
            ).strip()

            word_text = romanize_hinglish(word_text)

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
        **source_identity,
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": round(duration, 3),
        "whisper_version": transcription_version,
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
    if info.language == "hi":
        print("Text format    : Roman Hinglish (Hindi/Urdu script converted)")
    else:
        print("Text format    : Original language; Latin text unchanged")
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

    transcribe(sys.argv[1], sys.argv[2] if len(sys.argv) >= 3 else "hinglish")
