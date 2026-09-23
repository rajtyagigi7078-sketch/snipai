#!/usr/bin/env python3

from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import time


# ============================================================
# SNIP AI — PORTABLE PIPELINE RUNNER V4
#
# Pipeline:
#
# Video
#   ↓
# Whisper
#   ↓
# Story Event Map V3
#   ↓
# Generation Selector
#   ↓
# Simple Renderer
#   ↓
# Final clips
#
# Supports:
#   1. Windows bundled runtime
#   2. Linux development runtime
#   3. Legacy local pipeline
# ============================================================


# ============================================================
# PROJECT / RUNTIME PATHS
# ============================================================

REMOTION_THEMES = {
    "pop",
    "karaoke",
    "hustle",
    "grape",
    "beast",
    "poppin",
    "aarit",
    "soft-ai",
    "gaming-stream",
    "simple-one-word",
    "kinetic-01",
    "kinetic-02",
    "podcast",
}


BASE_DIR = Path(
    os.environ.get(
        "SNIP_AI_PROJECT_ROOT",
        Path(__file__).resolve().parent,
    )
).expanduser().resolve()


RUNTIME_ROOT_ENV = os.environ.get(
    "SNIP_AI_RUNTIME_ROOT"
)


if RUNTIME_ROOT_ENV:
    RUNTIME_ROOT = (
        Path(RUNTIME_ROOT_ENV)
        .expanduser()
        .resolve()
    )
else:
    RUNTIME_ROOT = None


# ------------------------------------------------------------
# Detect bundled runtime
# ------------------------------------------------------------

BUNDLED_RUNTIME = (
    RUNTIME_ROOT is not None
    and (RUNTIME_ROOT / "pipeline").is_dir()
)


if BUNDLED_RUNTIME:

    PIPELINE_DIR = (
        RUNTIME_ROOT / "pipeline"
    )

    if os.name == "nt":
        # Windows production runtime uses the bundled Python.
        BUNDLED_PYTHON = (
            RUNTIME_ROOT
            / "python"
            / "Scripts"
            / "python.exe"
        )
    else:
        # Linux development uses the exact Python environment
        # supplied by Tauri through SNIP_AI_PYTHON.
        supplied_python = os.environ.get("SNIP_AI_PYTHON")

        if supplied_python:
            BUNDLED_PYTHON = (
                Path(supplied_python)
                .expanduser()
                .resolve()
            )
        else:
            # Fallback for direct pipeline execution from the
            # Snip AI project.
            project_root = Path(__file__).resolve().parents[1]

            BUNDLED_PYTHON = (
                project_root
                / ".whisper-venv"
                / "bin"
                / "python"
            )

    BUNDLED_FFMPEG = (
        RUNTIME_ROOT
        / "ffmpeg"
        / (
            "ffmpeg.exe"
            if os.name == "nt"
            else "ffmpeg"
        )
    )

    BUNDLED_FFPROBE = (
        RUNTIME_ROOT
        / "ffmpeg"
        / (
            "ffprobe.exe"
            if os.name == "nt"
            else "ffprobe"
        )
    )

    BUNDLED_WHISPER_MODEL = (
        RUNTIME_ROOT
        / "whisper-model"
    )

else:

    PIPELINE_DIR = BASE_DIR

    BUNDLED_PYTHON = None

    BUNDLED_FFMPEG = None

    BUNDLED_FFPROBE = None

    BUNDLED_WHISPER_MODEL = None


# ============================================================
# LEGACY / DEVELOPMENT PATHS
# ============================================================

CLIPPER_DIR = (
    BASE_DIR / "clipper"
)


if os.name == "nt":
    # Windows production ALWAYS uses the bundled runtime.
    WHISPER_PYTHON = BUNDLED_PYTHON

else:
    # Linux development ALWAYS reuses the exact Python
    # interpreter that launched pipeline_runner.py.
    #
    # This is intentionally sys.executable.
    #
    # Do NOT resolve .whisper-venv/bin/python because on this
    # Linux installation it is a symlink to /usr/bin/python3.14.
    #
    # sys.executable preserves the active virtual environment
    # and therefore preserves faster-whisper and all other
    # installed packages.
    WHISPER_PYTHON = Path(sys.executable)



if BUNDLED_RUNTIME:

    WHISPER_SCRIPT = (
        PIPELINE_DIR
        / "whisper_transcribe.py"
    )

    STORY_EVENT_MAP_SCRIPT = (
        PIPELINE_DIR
        / "story_event_map.py"
    )

    GENERATION_SELECTOR_SCRIPT = (
        PIPELINE_DIR
        / "generation_selector.py"
    )

    RENDER_SCRIPT = (
        PIPELINE_DIR
        / "render_clips_simple.py"
    )

else:

    WHISPER_SCRIPT = (
        CLIPPER_DIR
        / "whisper_transcribe.py"
    )

    STORY_EVENT_MAP_SCRIPT = (
        BASE_DIR
        / "story_event_map.py"
    )

    GENERATION_SELECTOR_SCRIPT = (
        BASE_DIR
        / "generation_selector.py"
    )

    RENDER_SCRIPT = (
        BASE_DIR
        / "render_clips_simple.py"
    )


# ============================================================
# FFMPEG / FFPROBE
# ============================================================

def resolve_ffmpeg():

    configured = os.environ.get(
        "SNIP_AI_FFMPEG"
    )

    if configured:
        path = Path(
            configured
        ).expanduser().resolve()

        if path.is_file():
            return path

    if (
        BUNDLED_FFMPEG is not None
        and BUNDLED_FFMPEG.is_file()
    ):
        return BUNDLED_FFMPEG

    found = shutil.which(
        "ffmpeg"
    )

    if found:
        return Path(found)

    return None


def resolve_ffprobe():

    configured = os.environ.get(
        "SNIP_AI_FFPROBE"
    )

    if configured:
        path = Path(
            configured
        ).expanduser().resolve()

        if path.is_file():
            return path

    if (
        BUNDLED_FFPROBE is not None
        and BUNDLED_FFPROBE.is_file()
    ):
        return BUNDLED_FFPROBE

    found = shutil.which(
        "ffprobe"
    )

    if found:
        return Path(found)

    return None


FFMPEG = resolve_ffmpeg()
FFPROBE = resolve_ffprobe()


# ============================================================
# USER DIRECTORIES
# ============================================================

HOME_DIR = Path.home()


DOWNLOADS_DIR = Path(
    os.environ.get(
        "SNIP_AI_DOWNLOADS_DIR",
        HOME_DIR / "Downloads",
    )
).expanduser().resolve()


OUTPUT_DIR = Path(
    os.environ.get(
        "SNIP_AI_OUTPUT_DIR",
        DOWNLOADS_DIR / "Snip AI Clips",
    )
).expanduser().resolve()


WORK_DIR = Path(
    os.environ.get(
        "SNIP_AI_WORK_DIR",
        HOME_DIR / ".snip-ai",
    )
).expanduser().resolve()


# ============================================================
# WORK FILES
# ============================================================

STORY_EVENT_MAP_FILE = (
    WORK_DIR
    / "story-event-map.json"
)


SELECTED_GENERATION_FILE = (
    WORK_DIR
    / "selected-generation.json"
)


HISTORY_FILE = (
    WORK_DIR
    / "generation-history.json"
)


# ============================================================
# SUBPROCESS ENVIRONMENT
# ============================================================

def build_process_environment():

    environment = os.environ.copy()

    path_entries = []

    # Bundled FFmpeg directory
    if FFMPEG is not None:
        path_entries.append(
            str(FFMPEG.parent)
        )

    # Bundled Python directory
    if BUNDLED_PYTHON is not None:
        path_entries.append(
            str(BUNDLED_PYTHON.parent)
        )

    existing_path = environment.get(
        "PATH",
        ""
    )

    path_entries.append(
        existing_path
    )

    environment["PATH"] = os.pathsep.join(
        path_entries
    )

    # Runtime root
    if RUNTIME_ROOT is not None:
        environment[
            "SNIP_AI_RUNTIME_ROOT"
        ] = str(RUNTIME_ROOT)

    # FFmpeg
    if FFMPEG is not None:
        environment[
            "SNIP_AI_FFMPEG"
        ] = str(FFMPEG)

    # FFprobe
    if FFPROBE is not None:
        environment[
            "SNIP_AI_FFPROBE"
        ] = str(FFPROBE)

    # Whisper model
    if BUNDLED_WHISPER_MODEL is not None:
        environment[
            "SNIP_AI_WHISPER_MODEL_DIR"
        ] = str(
            BUNDLED_WHISPER_MODEL
        )

    return environment


PROCESS_ENV = build_process_environment()


# ============================================================
# HELPERS
# ============================================================

def fail(message):

    print()
    print("=" * 72)
    print("SNIP AI PIPELINE ERROR")
    print("=" * 72)
    print(message)
    print("=" * 72)

    sys.exit(1)


def check_file(
    path,
    description,
):

    if not path.exists():

        fail(
            f"{description} not found:\n"
            f"{path}"
        )

    if not path.is_file():

        fail(
            f"{description} is not a file:\n"
            f"{path}"
        )


def run_command(
    command,
    stage,
):

    print()
    print("=" * 72)
    print(f"SNIP AI — {stage}")
    print("=" * 72)

    print()
    print(
        " ".join(
            str(item)
            for item in command
        )
    )

    print()

    started = time.perf_counter()

    try:

        process = subprocess.Popen(
            [
                str(item)
                for item in command
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=PROCESS_ENV,
        )

    except Exception as exc:

        fail(
            f"Could not start {stage}:\n"
            f"{exc}"
        )

    if process.stdout is not None:

        for line in process.stdout:

            print(
                line.rstrip()
            )

    return_code = process.wait()

    elapsed = (
        time.perf_counter()
        - started
    )

    print()

    print(
        f"{stage} finished in "
        f"{elapsed:.1f}s"
    )

    if return_code != 0:

        fail(
            f"{stage} failed.\n"
            f"Exit code: {return_code}"
        )


def run_command_capture(
    command,
):

    try:

        return subprocess.run(
            [
                str(item)
                for item in command
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=PROCESS_ENV,
        )

    except Exception:

        return None


# ============================================================
# VIDEO INFO
# ============================================================

def get_video_duration(
    video_path,
):

    if FFPROBE is None:

        fail(
            "ffprobe was not found.\n"
            "Expected bundled ffprobe or "
            "a system ffprobe."
        )

    result = run_command_capture(
        [
            FFPROBE,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            video_path,
        ]
    )

    if result is None:

        fail(
            "ffprobe could not be started."
        )

    if result.returncode != 0:

        fail(
            "Could not determine video duration.\n"
            + result.stderr
        )

    try:

        duration = float(
            result.stdout.strip()
        )

    except ValueError:

        fail(
            "ffprobe returned an invalid duration:\n"
            + result.stdout
        )

    if duration <= 0:

        fail(
            "Video duration is zero or negative."
        )

    return duration


# ============================================================
# TRANSCRIPT
# ============================================================

def transcript_path_for(
    video_path,
):

    return video_path.with_suffix(
        ".transcript.json"
    )


def validate_transcript(
    transcript_path,
    video_path,
    duration,
):

    check_file(
        transcript_path,
        "Whisper transcript",
    )

    try:

        with transcript_path.open(
            "r",
            encoding="utf-8",
        ) as file:

            data = json.load(file)

    except Exception as exc:

        fail(
            "Could not read Whisper transcript:\n"
            f"{exc}"
        )

    if not isinstance(
        data,
        dict,
    ):

        fail(
            "Whisper transcript has an invalid structure."
        )

    data["video"] = str(
        video_path
    )

    data["duration"] = round(
        duration,
        3,
    )

    with transcript_path.open(
        "w",
        encoding="utf-8",
    ) as file:

        json.dump(
            data,
            file,
            indent=2,
            ensure_ascii=False,
        )

    print()
    print(
        "Transcript verified."
    )

    print(
        f"Duration: {duration:.3f}s"
    )


# ============================================================
# STORY EVENT MAP
# ============================================================

def prepare_story_event_map(
    transcript_path,
):

    source = STORY_EVENT_MAP_SCRIPT.read_text(
        encoding="utf-8"
    )

    marker = "TRANSCRIPT_FILE ="

    start = source.find(
        marker
    )

    if start == -1:

        fail(
            "Could not locate TRANSCRIPT_FILE "
            "in story_event_map.py."
        )

    end = source.find(
        "\n\n",
        start,
    )

    if end == -1:

        fail(
            "Could not determine the end of "
            "TRANSCRIPT_FILE configuration."
        )

    replacement = (
        "TRANSCRIPT_FILE = Path("
        + repr(
            str(transcript_path)
        )
        + ")"
    )

    patched = (
        source[:start]
        + replacement
        + source[end:]
    )

    WORK_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp_script = (
        WORK_DIR
        / "story_event_map_runtime.py"
    )

    temp_script.write_text(
        patched,
        encoding="utf-8",
    )

    return temp_script


def run_story_event_map(
    transcript_path,
):

    temp_script = (
        prepare_story_event_map(
            transcript_path
        )
    )

    try:

        run_command(
            [
                WHISPER_PYTHON,
                temp_script,
            ],
            "STORY EVENT MAP V3",
        )

    finally:

        try:

            temp_script.unlink()

        except FileNotFoundError:

            pass

    legacy_output = (
        DOWNLOADS_DIR
        / "story-event-map.json"
    )

    if legacy_output.exists():

        shutil.copy2(
            legacy_output,
            STORY_EVENT_MAP_FILE,
        )

    if not STORY_EVENT_MAP_FILE.exists():

        fail(
            "Story Event Map V3 completed but "
            "story-event-map.json was not found."
        )


# ============================================================
# GENERATION SELECTOR
# ============================================================

def prepare_generation_selector(
    requested_clips=10,
):

    source = (
        GENERATION_SELECTOR_SCRIPT.read_text(
            encoding="utf-8"
        )
    )

    lines = source.splitlines()

    output = []

    i = 0

    while i < len(lines):

        line = lines[i]

        stripped = line.strip()

        if stripped.startswith(
            "INPUT_FILE = Path("
        ):

            output.append(
                "INPUT_FILE = Path("
                + repr(
                    str(
                        STORY_EVENT_MAP_FILE
                    )
                )
                + ")"
            )

            i += 1

            while (
                i < len(lines)
                and lines[i].strip() != ")"
            ):

                i += 1

            if i < len(lines):

                i += 1

            continue

        if stripped.startswith(
            "OUTPUT_FILE = Path("
        ):

            output.append(
                "OUTPUT_FILE = Path("
                + repr(
                    str(
                        SELECTED_GENERATION_FILE
                    )
                )
                + ")"
            )

            i += 1

            while (
                i < len(lines)
                and lines[i].strip() != ")"
            ):

                i += 1

            if i < len(lines):

                i += 1

            continue

        if stripped.startswith(
            "HISTORY_FILE = Path("
        ):

            output.append(
                "HISTORY_FILE = Path("
                + repr(
                    str(HISTORY_FILE)
                )
                + ")"
            )

            i += 1

            while (
                i < len(lines)
                and lines[i].strip() != ")"
            ):

                i += 1

            if i < len(lines):

                i += 1

            continue

        output.append(
            line
        )

        i += 1

    patched = (
        "\n".join(output)
        + "\n"
    )

    runtime_header = (
        "import sys\n"
        f"sys.argv = "
        f"[sys.argv[0], "
        f"\"{int(requested_clips)}\"]\n"
    )

    patched = (
        runtime_header
        + patched
    )

    temp_script = (
        WORK_DIR
        / "generation_selector_runtime.py"
    )

    temp_script.write_text(
        patched,
        encoding="utf-8",
    )

    return temp_script


def run_generation_selector(
    requested_clips=10,
):

    temp_script = (
        prepare_generation_selector(
            requested_clips
        )
    )

    try:

        run_command(
            [
                WHISPER_PYTHON,
                temp_script,
            ],
            "GENERATION SELECTOR",
        )

    finally:

        try:

            temp_script.unlink()

        except FileNotFoundError:

            pass

    if not SELECTED_GENERATION_FILE.exists():

        fail(
            "Generation Selector completed but "
            "selected-generation.json was not created."
        )


# ============================================================
# RENDERER
# ============================================================

def run_renderer(
    framing,
    caption_template="pop",
    different_captions=False,
):

    if framing not in (
        "1:1",
        "16:9",
    ):

        fail(
            "Invalid framing mode.\n"
            "Allowed: 1:1 or 16:9"
        )

    allowed_caption_templates = {
        "pop",
        "karaoke",
        "hustle",
        "grape",
        "beast",
        "poppin",
        "aarit",
        "soft-ai",
        "gaming-stream",
        "simple-one-word",
        "kinetic-01",
        "kinetic-02",
        "podcast",
    }

    if caption_template not in REMOTION_THEMES:

        fail(
            f"Invalid Remotion caption theme: "
            f"{caption_template}"
        )

    run_command(
        [
            WHISPER_PYTHON,
            RENDER_SCRIPT,
            framing,
            SELECTED_GENERATION_FILE,
            OUTPUT_DIR,
            caption_template,
            (
                "true"
                if different_captions
                else "false"
            ),
        ],
        "GPU VIDEO RENDER",
    )


# ============================================================
# OUTPUT
# ============================================================

def collect_outputs():

    if not OUTPUT_DIR.exists():

        fail(
            "Output directory was not created:\n"
            f"{OUTPUT_DIR}"
        )

    files = sorted(
        OUTPUT_DIR.glob(
            "snip_ai_simple_clip_*.mp4"
        )
    )

    valid = [
        path
        for path in files
        if path.is_file()
        and path.stat().st_size > 0
    ]

    if not valid:

        fail(
            "Renderer completed but no valid "
            "clips were found."
        )

    return valid


# ============================================================
# CLEAN WORKSPACE
# ============================================================

def prepare_workspace():

    WORK_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    OUTPUT_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )


# ============================================================
# MAIN
# ============================================================

def main():

    if len(sys.argv) < 2:

        print()
        print("Usage:")
        print(
            "python pipeline_runner.py "
            "/path/to/video.mp4 "
            "[1:1|16:9] "
            "[clips] "
            "[caption template] "
            "[different captions]"
        )

        print()

        sys.exit(1)

    video_path = (
        Path(sys.argv[1])
        .expanduser()
        .resolve()
    )

    framing = (
        sys.argv[2]
        if len(sys.argv) >= 3
        else "1:1"
    )

    try:

        requested_clips = int(
            sys.argv[3]
            if len(sys.argv) >= 4
            else "5"
        )

    except ValueError:

        fail(
            "Clip count must be a whole number from 1 to 10."
        )

    caption_template = (
        sys.argv[4]
        if len(sys.argv) >= 5
        else "pop"
    )

    different_captions = (
        sys.argv[5].strip().lower()
        == "true"
        if len(sys.argv) >= 6
        else False
    )

    allowed_caption_templates = {
        "pop",
        "karaoke",
        "hustle",
        "grape",
        "beast",
        "poppin",
        "aarit",
        "soft-ai",
        "gaming-stream",
        "simple-one-word",
        "kinetic-01",
        "kinetic-02",
        "podcast",
    }

    if caption_template not in allowed_caption_templates:

        fail(
            f"Invalid caption template: "
            f"{caption_template}"
        )

    if requested_clips < 1 or requested_clips > 10:

        fail(
            "Clip count must be between 1 and 10."
        )

    if framing not in (
        "1:1",
        "16:9",
    ):

        fail(
            "Invalid framing mode.\n"
            "Allowed: 1:1 or 16:9"
        )

    started = time.perf_counter()

    print()
    print("=" * 72)
    print("SNIP AI — PORTABLE PIPELINE V4")
    print("=" * 72)

    print()
    print(
        f"Input video : {video_path}"
    )

    print(
        f"Framing     : {framing}"
    )

    print(
        f"Project     : {BASE_DIR}"
    )

    print(
        f"Work folder : {WORK_DIR}"
    )

    print(
        f"Output      : {OUTPUT_DIR}"
    )

    print(
        f"Runtime     : "
        f"{RUNTIME_ROOT if RUNTIME_ROOT else 'LOCAL'}"
    )

    print(
        f"Python      : {WHISPER_PYTHON}"
    )

    print(
        f"FFmpeg      : "
        f"{FFMPEG if FFMPEG else 'SYSTEM/PATH'}"
    )

    print(
        f"FFprobe     : "
        f"{FFPROBE if FFPROBE else 'SYSTEM/PATH'}"
    )

    # --------------------------------------------------------
    # Input validation
    # --------------------------------------------------------

    if not video_path.exists():

        fail(
            f"Video not found:\n"
            f"{video_path}"
        )

    if not video_path.is_file():

        fail(
            f"Input is not a file:\n"
            f"{video_path}"
        )

    # --------------------------------------------------------
    # Environment validation
    # --------------------------------------------------------

    check_file(
        WHISPER_PYTHON,
        "Whisper Python environment",
    )

    check_file(
        WHISPER_SCRIPT,
        "Whisper transcription script",
    )

    check_file(
        STORY_EVENT_MAP_SCRIPT,
        "Story Event Map script",
    )

    check_file(
        GENERATION_SELECTOR_SCRIPT,
        "Generation Selector script",
    )

    check_file(
        RENDER_SCRIPT,
        "Simple renderer",
    )

    if FFPROBE is None:

        fail(
            "ffprobe was not found."
        )

    if FFMPEG is None:

        fail(
            "ffmpeg was not found."
        )

    # --------------------------------------------------------
    # Prepare
    # --------------------------------------------------------

    prepare_workspace()

    duration = get_video_duration(
        video_path
    )

    print()
    print(
        f"Video duration: {duration:.3f}s"
    )

    # --------------------------------------------------------
    # 1. Whisper
    # --------------------------------------------------------

    transcript_path = (
        transcript_path_for(
            video_path
        )
    )

    run_command(
        [
            WHISPER_PYTHON,
            WHISPER_SCRIPT,
            video_path,
        ],
        "WHISPER TRANSCRIPTION",
    )

    validate_transcript(
        transcript_path,
        video_path,
        duration,
    )

    # --------------------------------------------------------
    # 2. Story Event Map V3
    # --------------------------------------------------------

    run_story_event_map(
        transcript_path
    )

    # --------------------------------------------------------
    # 3. Generation Selector
    # --------------------------------------------------------

    run_generation_selector(
        requested_clips
    )

    # --------------------------------------------------------
    # Validate selected generation
    # --------------------------------------------------------

    try:

        generation_data = json.loads(
            SELECTED_GENERATION_FILE.read_text(
                encoding="utf-8"
            )
        )

    except Exception as exc:

        fail(
            "Could not read selected generation:\n"
            f"{exc}"
        )

    clips = generation_data.get(
        "clips",
        [],
    )

    if not clips:

        fail(
            "Generation Selector returned zero clips."
        )

    print()

    print(
        f"Generation: "
        f"{generation_data.get('generation', '?')}"
    )

    print(
        f"Selected clips: {len(clips)}"
    )

    # --------------------------------------------------------
    # 4. Renderer
    # --------------------------------------------------------

    run_renderer(
        framing,
        caption_template,
        different_captions,
    )

    # --------------------------------------------------------
    # 5. Collect
    # --------------------------------------------------------

    outputs = collect_outputs()

    # --------------------------------------------------------
    # Final
    # --------------------------------------------------------

    total_time = (
        time.perf_counter()
        - started
    )

    print()
    print("=" * 72)
    print("SNIP AI — PIPELINE COMPLETE")
    print("=" * 72)

    print()

    print(
        f"Generation : "
        f"{generation_data.get('generation', '?')}"
    )

    print(
        f"Framing    : {framing}"
    )

    print(
        f"Clips      : {len(outputs)}"
    )

    print(
        f"Output     : {OUTPUT_DIR}"
    )

    print(
        f"Total time : {total_time:.1f}s"
    )

    print()
    print("FILES")
    print("-" * 72)

    for index, path in enumerate(
        outputs,
        start=1,
    ):

        size_mb = (
            path.stat().st_size
            / (1024 * 1024)
        )

        print(
            f"{index:02d}. "
            f"{path.name} "
            f"({size_mb:.1f} MB)"
        )

    print()
    print("=" * 72)


if __name__ == "__main__":
    main()
