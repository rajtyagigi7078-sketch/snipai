#!/usr/bin/env python3

from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import queue
import threading


# ============================================================
# SNIP AI — PORTABLE SIMPLE GPU RENDERER
#
# Input:
#   framing
#   selected-generation.json
#   output directory
#
# Supported framing:
#   1:1
#   16:9
#
# Rendering:
#   AMD/Intel VAAPI when available
#   libx264 fallback when VAAPI is unavailable
#
# IMPORTANT:
#   Video is first rendered into a temporary MKV.
#   It is then remuxed into the final MP4.
#
# This prevents incomplete/corrupt MP4 containers.
# Every final file is validated with ffprobe before
# being reported as successful.
# ============================================================


BASE_DIR = Path(__file__).resolve().parent

MAX_CLIPS = 10

OUT_W = 1080
OUT_H = 1920

SQUARE_ZOOM = 1.08

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


# ============================================================
# HELPERS
# ============================================================

def fail(message):
    print()
    print("=" * 70)
    print("SNIP AI — RENDER ERROR")
    print("=" * 70)
    print(message)
    print("=" * 70)
    sys.exit(1)


def run_command(command, description):
    print()
    print(f"[RUN] {description}")

    process = subprocess.run(
        [str(x) for x in command],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    # --------------------------------------------------------
    # FONT DIAGNOSTIC
    # Print libass/fontconfig information from successful
    # FFmpeg subtitle renders.
    # --------------------------------------------------------

    if process.returncode != 0:
        error = "\n".join(
            stream.strip()
            for stream in (process.stderr, process.stdout)
            if stream and stream.strip()
        )

        if len(error) > 8000:
            error = error[-8000:]

        raise RuntimeError(
            f"{description} failed (exit code {process.returncode}).\n\n"
            f"{error or 'FFmpeg did not provide diagnostic output.'}"
        )

    return process


def require_tools():
    if not FFMPEG:
        fail(
            "FFmpeg was not found in PATH."
        )

    if not FFPROBE:
        fail(
            "FFprobe was not found in PATH."
        )


def default_output_dir():
    downloads = Path.home() / "Downloads"

    if downloads.exists() and downloads.is_dir():
        return downloads / "Snip AI Clips"

    return Path.home() / "Snip AI Clips"


def parse_arguments():
    if len(sys.argv) < 2:
        fail(
            "Usage:\n"
            "python render_clips_simple.py "
            "<1:1|16:9> "
            "[selected-generation.json] "
            "[output-directory]"
        )

    framing = sys.argv[1].strip()

    if framing not in ("1:1", "16:9"):
        fail(
            f"Invalid framing: {framing}\n"
            "Use only 1:1 or 16:9."
        )

    if len(sys.argv) >= 3:
        generation_file = Path(sys.argv[2]).expanduser()
    else:
        generation_file = (
            default_output_dir().parent
            / "selected-generation.json"
        )

    if len(sys.argv) >= 4:
        output_dir = Path(sys.argv[3]).expanduser()
    else:
        output_dir = default_output_dir()

    caption_template = (
        sys.argv[4].strip()
        if len(sys.argv) >= 5
        else "pop"
    )

    different_captions = (
        sys.argv[5].strip().lower() == "true"
        if len(sys.argv) >= 6
        else False
    )

    allowed_caption_templates = {
        "pop", "karaoke", "bold-center", "punch", "minimal",
        "highlight-box", "typewriter", "bounce", "kinetic", "podcast",
    "yellow-stack", "violet-pill", "dual-line", "bold-karaoke", "soft-lyric",
    }

    if caption_template not in allowed_caption_templates:
        fail(
            f"Invalid caption template: "
            f"{caption_template}"
        )

    return (
        framing,
        generation_file,
        output_dir,
        caption_template,
        different_captions,
    )


# ============================================================
# GENERATION JSON
# ============================================================

def load_generation(path):
    if not path.exists():
        fail(
            f"Generation JSON not found:\n"
            f"{path}"
        )

    try:
        data = json.loads(
            path.read_text(
                encoding="utf-8"
            )
        )
    except Exception as exc:
        fail(
            f"Could not read generation JSON:\n"
            f"{exc}"
        )

    if not isinstance(data, dict):
        fail(
            "Generation JSON must contain an object."
        )

    return data


def get_source(data):
    source = data.get("video")

    if not source:
        fail(
            "No source video found in "
            "selected-generation.json."
        )

    source = Path(str(source)).expanduser()

    if not source.exists():
        fail(
            f"Source video not found:\n"
            f"{source}"
        )

    if not source.is_file():
        fail(
            f"Source video is not a file:\n"
            f"{source}"
        )

    return source


def get_moments(data):
    moments = data.get("clips")

    if not isinstance(moments, list):
        fail(
            "selected-generation.json does not "
            "contain a valid clips list."
        )

    if not moments:
        fail(
            "selected-generation.json contains "
            "zero clips."
        )

    return moments[:MAX_CLIPS]


def get_number(moment, keys):
    for key in keys:
        value = moment.get(key)

        if value is None:
            continue

        try:
            return float(value)
        except (TypeError, ValueError):
            continue

    return None


def get_clip_times(moment):
    start = get_number(
        moment,
        [
            "start",
            "start_time",
            "clip_start",
            "start_sec",
        ],
    )

    end = get_number(
        moment,
        [
            "end",
            "end_time",
            "clip_end",
            "end_sec",
        ],
    )

    if start is None or end is None:
        fail(
            "Moment is missing usable "
            "start/end values:\n"
            f"{moment}"
        )

    if start < 0:
        start = 0.0

    if end <= start:
        fail(
            f"Invalid clip range: "
            f"{start:.3f} -> {end:.3f}"
        )

    return start, end


# ============================================================
# VIDEO INFO
# ============================================================

def get_video_info(source):
    command = [
        FFPROBE,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate",
        "-of",
        "json",
        str(source),
    ]

    result = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    if result.returncode != 0:
        return None, None, None

    try:
        data = json.loads(
            result.stdout
        )

        stream = data["streams"][0]

        width = int(stream["width"])
        height = int(stream["height"])

        fps_raw = stream.get(
            "r_frame_rate",
            "0/1",
        )

        numerator, denominator = (
            fps_raw.split("/")
        )

        denominator = float(denominator)

        if denominator == 0:
            fps = None
        else:
            fps = (
                float(numerator)
                / denominator
            )

        return width, height, fps

    except Exception:
        return None, None, None


# ============================================================
# VAAPI DETECTION
# ============================================================

def detect_vaapi_device():
    """
    Detect an accessible DRM render node dynamically.

    Never assumes renderD128 or any particular GPU.
    """

    if os.name != "posix":
        return None

    drm_dir = Path("/dev/dri")

    if not drm_dir.exists():
        return None

    candidates = sorted(
        drm_dir.glob("renderD*")
    )

    for device in candidates:
        if os.access(
            device,
            os.R_OK | os.W_OK,
        ):
            return device

    return None


def ffmpeg_has_encoder(name):
    try:
        result = subprocess.run(
            [
                FFMPEG,
                "-hide_banner",
                "-encoders",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )

        return name in result.stdout

    except Exception:
        return False


def ffmpeg_can_encode(encoder, encoder_options=()):
    if not ffmpeg_has_encoder(encoder):
        return False

    command = [
        FFMPEG,
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=1280x720:r=30:d=0.04",
        "-frames:v",
        "1",
        "-an",
        "-c:v",
        encoder,
        *encoder_options,
        "-f",
        "null",
        "-",
    ]

    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
        return result.returncode == 0
    except Exception:
        return False


def select_encoder():
    device = detect_vaapi_device()

    if (
        device
        and ffmpeg_has_encoder("h264_vaapi")
    ):
        return {
            "mode": "vaapi",
            "encoder": "h264_vaapi",
            "device": device,
        }

    if os.name == "nt":
        for encoder, mode in (("h264_nvenc", "nvenc"), ("h264_qsv", "qsv"), ("h264_amf", "amf")):
            if ffmpeg_can_encode(encoder, ()):
                return {"mode": mode, "encoder": encoder, "device": None}

    return {
        "mode": "software",
        "encoder": "libx264",
        "device": None,
    }


# ============================================================
# FRAMING
# ============================================================

def build_filter(framing):
    """
    Final canvas is always 1080x1920.

    1:1:
        A centered 1080x1080 square is placed
        on the 1080x1920 canvas.

    16:9:
        The original 16:9 image is scaled to fit
        within the 1080x1920 canvas without cropping.
    """

    if framing == "1:1":
        return (
            f"scale=iw*{SQUARE_ZOOM}:"
            f"ih*{SQUARE_ZOOM}:"
            "force_original_aspect_ratio=decrease,"
            "crop='min(iw,ih)':'min(iw,ih)',"
            "scale=1080:1080,"
            "pad=1080:1920:0:440"
        )

    if framing == "16:9":
        return (
            "scale=1080:-2:"
            "force_original_aspect_ratio=decrease,"
            "pad=1080:1920:"
            "0:(1920-ih)/2"
        )

    raise ValueError(
        f"Unsupported framing: {framing}"
    )


# ============================================================
# FINAL FILE VALIDATION
# ============================================================

def validate_mp4(path):
    """
    A file is only considered successful if ffprobe
    can actually read a video stream from it.
    """

    if not path.exists():
        return False, "File does not exist."

    if path.stat().st_size <= 0:
        return False, "File is empty."

    command = [
        FFPROBE,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height,duration",
        "-of",
        "json",
        str(path),
    ]

    result = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    if result.returncode != 0:
        error = result.stderr.strip()

        if not error:
            error = (
                "ffprobe could not read the file."
            )

        return False, error

    try:
        data = json.loads(
            result.stdout
        )

        streams = data.get(
            "streams",
            [],
        )

        if not streams:
            return (
                False,
                "No video stream found."
            )

        stream = streams[0]

        codec = stream.get(
            "codec_name"
        )

        width = stream.get(
            "width"
        )

        height = stream.get(
            "height"
        )

        duration = stream.get(
            "duration"
        )

        if not codec:
            return (
                False,
                "Video codec could not be detected."
            )

        if not width or not height:
            return (
                False,
                "Video dimensions could not be detected."
            )

        if duration is not None:
            try:
                if float(duration) <= 0:
                    return (
                        False,
                        "Video duration is zero."
                    )
            except ValueError:
                pass

        return True, {
            "codec": codec,
            "width": width,
            "height": height,
            "duration": duration,
        }

    except Exception as exc:
        return (
            False,
            f"Could not parse ffprobe output: {exc}"
        )


# ============================================================
# RENDER TO TEMPORARY MKV
# ============================================================

def render_to_temp(
    source,
    start,
    end,
    temp_output,
    framing,
    encoder_info,
    subtitle_file=None,
):
    video_filter = build_filter(
        framing
    )

    if subtitle_file is not None:
        subtitle_path = (
            str(subtitle_file)
            .replace("\\", "/")
            .replace(":", "\\:")
            .replace("'", "\\'")
        )

        video_filter = (
            f"{video_filter},"
            f"subtitles='{subtitle_path}'"
        )

    if encoder_info["mode"] == "vaapi":
        """
        Software filter processing followed by
        VAAPI upload and GPU H.264 encoding.
        """

        video_filter = (
            f"{video_filter},"
            "format=nv12,"
            "hwupload"
        )

        command = [
            FFMPEG,

            "-hide_banner",
            "-loglevel",
            "error",

            "-y",

            "-vaapi_device",
            encoder_info["device"],

            "-ss",
            f"{start:.3f}",

            "-i",
            str(source),

            "-t",
            f"{end - start:.3f}",

            "-map",
            "0:v:0",

            "-map",
            "0:a?",

            "-vf",
            video_filter,

            "-c:v",
            "h264_vaapi",

            "-qp",
            "23",

            "-c:a",
            "aac",

            "-b:a",
            "128k",

            "-f",
            "matroska",

            str(temp_output),
        ]

    elif encoder_info["mode"] in {"amf", "nvenc", "qsv"}:
        encoder_name = {"amf": "h264_amf", "nvenc": "h264_nvenc", "qsv": "h264_qsv"}[encoder_info["mode"]]
        if encoder_info["mode"] == "amf":
            encoder_args = ["-quality", "speed", "-rc", "cqp", "-qp_i", "20", "-qp_p", "20"]
        elif encoder_info["mode"] == "nvenc":
            encoder_args = ["-preset", "p4", "-cq", "20"]
        else:
            encoder_args = ["-preset", "veryfast", "-global_quality", "20"]
        command = [
            FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
            "-ss", f"{start:.3f}", "-i", str(source),
            "-t", f"{end - start:.3f}", "-map", "0:v:0", "-map", "0:a?",
            "-vf", video_filter, "-c:v", encoder_name, *encoder_args,
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
            "-f", "matroska", str(temp_output),
        ]
    else:
        """
        Software fallback.

        libx264 is used when no supported hardware encoder initializes.
        """

        command = [
            FFMPEG,

            "-hide_banner",
            "-loglevel",
            "error",

            "-y",

            "-ss",
            f"{start:.3f}",

            "-i",
            str(source),

            "-t",
            f"{end - start:.3f}",

            "-map",
            "0:v:0",

            "-map",
            "0:a?",

            "-vf",
            video_filter,

            "-c:v",
            "libx264",

            "-preset",
            "veryfast",

            "-crf",
            "23",

            "-pix_fmt",
            "yuv420p",

            "-c:a",
            "aac",

            "-b:a",
            "128k",

            "-f",
            "matroska",

            str(temp_output),
        ]

    run_command(
        command,
        "Video rendering",
    )


# ============================================================
# REMUX MKV -> MP4
# ============================================================

def remux_to_mp4(
    temp_input,
    final_output,
):
    """
    Convert the already encoded streams into MP4.

    No video re-encoding happens here.

    This gives FFmpeg a clean opportunity to write
    the MP4 moov atom before the file is considered done.
    """

    command = [
        FFMPEG,

        "-hide_banner",
        "-loglevel",
        "error",

        "-y",

        "-i",
        str(temp_input),

        "-map",
        "0:v:0",

        "-map",
        "0:a?",

        "-c",
        "copy",

        "-movflags",
        "+faststart",

        str(final_output),
    ]

    run_command(
        command,
        "MP4 finalization",
    )


# ============================================================
# SINGLE CLIP
# ============================================================

def render_clip(
    source,
    start,
    end,
    output,
    framing,
    encoder_info,
    subtitle_file=None,
):
    output.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp_dir = output.parent / ".snip_ai_tmp"

    temp_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp_output = temp_dir / (
        f"{output.stem}.working.mkv"
    )

    try:
        if temp_output.exists():
            temp_output.unlink()

        if output.exists():
            output.unlink()

        # --------------------------------------------
        # Stage A — encode into MKV
        # --------------------------------------------

        render_to_temp(
            source,
            start,
            end,
            temp_output,
            framing,
            encoder_info,
            subtitle_file,
        )

        if (
            not temp_output.exists()
            or temp_output.stat().st_size == 0
        ):
            raise RuntimeError(
                "Temporary renderer output "
                "was not created."
            )

        # --------------------------------------------
        # Stage B — remux into MP4
        # --------------------------------------------

        remux_to_mp4(
            temp_output,
            output,
        )

        # --------------------------------------------
        # Stage C — actual validation
        # --------------------------------------------

        valid, info = validate_mp4(
            output
        )

        if not valid:
            raise RuntimeError(
                "Final MP4 validation failed:\n"
                f"{info}"
            )

        return info

    finally:
        try:
            if temp_output.exists():
                temp_output.unlink()
        except Exception:
            pass


# ============================================================
# CLEAN OLD OUTPUTS
# ============================================================

def clean_old_outputs(output_dir):
    output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    for old in output_dir.glob(
        "snip_ai_simple_clip_*.mp4"
    ):
        try:
            old.unlink()
        except Exception as exc:
            print(
                f"[WARN] Could not remove old file: "
                f"{old}\n{exc}"
            )



# ============================================================
# REMOTION CAPTION ENGINE
# ============================================================

FFMPEG_CAPTION_TEMPLATES = {
    "pop", "karaoke", "bold-center", "punch", "minimal",
    "highlight-box", "typewriter", "bounce", "kinetic", "podcast",
    "yellow-stack", "violet-pill", "dual-line", "bold-karaoke", "soft-lyric",
}


def resolve_caption_renderer():
    configured = os.environ.get("SNIP_AI_CAPTION_RENDERER_DIR")
    candidates = []

    if configured:
        candidates.append(
            Path(configured).expanduser().resolve()
        )

    # Development:
    # windows-runtime/pipeline/
    #       ↓ ../../..
    # clipping-app/snip-caption-renderer/
    candidates.extend([
        BASE_DIR / "caption-renderer",
        BASE_DIR.parent / "caption-renderer",
        BASE_DIR.parent.parent.parent / "snip-caption-renderer",
    ])

    for candidate in candidates:
        if (candidate / "src" / "render.ts").is_file():
            return candidate

    searched = "\n".join(
        f"  - {candidate}"
        for candidate in candidates
    )

    raise RuntimeError(
        "Remotion caption renderer was not found.\n\n"
        "Searched:\n"
        f"{searched}"
    )


def resolve_node():
    configured = os.environ.get("SNIP_AI_NODE")
    if configured:
        candidate = Path(configured).expanduser()
        if candidate.is_file():
            return candidate

    found = shutil.which("node")
    if found:
        return Path(found)

    raise RuntimeError(
        "Node.js was not found. Snip AI needs Node.js for FFmpeg caption generation."
    )


def write_relative_transcript(
    source_transcript,
    clip_start,
    clip_end,
    output_path,
    allow_empty=False,
):
    data = json.loads(
        Path(source_transcript).read_text(
            encoding="utf-8"
        )
    )

    segments = []

    MAX_WORDS_PER_LINE = 4

    for segment in data.get("segments", []):
        words = []

        for raw_word in segment.get("words", []):
            text = str(
                raw_word.get("text", "")
            ).strip()

            if not text:
                continue

            try:
                raw_start = float(
                    raw_word.get("start")
                )
                raw_end = float(
                    raw_word.get("end")
                )
            except (TypeError, ValueError):
                continue

            if raw_end <= clip_start:
                continue

            if raw_start >= clip_end:
                continue

            start_time = max(
                0.0,
                raw_start - clip_start,
            )

            end_time = min(
                clip_end - clip_start,
                raw_end - clip_start,
            )

            if end_time <= start_time:
                continue

            words.append(
                {
                    "text": text,
                    "start": round(start_time, 3),
                    "end": round(end_time, 3),
                }
            )

        if not words:
            continue

        for index in range(
            0,
            len(words),
            MAX_WORDS_PER_LINE,
        ):
            chunk = words[
                index:index + MAX_WORDS_PER_LINE
            ]

            if not chunk:
                continue

            segments.append(
                {
                    "start": chunk[0]["start"],
                    "end": chunk[-1]["end"],
                    "text": " ".join(
                        word["text"]
                        for word in chunk
                    ),
                    "words": chunk,
                }
            )

    if not segments and not allow_empty:
        raise RuntimeError(
            f"No Whisper words overlap clip "
            f"{clip_start:.3f}s -> "
            f"{clip_end:.3f}s."
        )

    Path(output_path).write_text(
        json.dumps(
            {
                "segments": segments
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

class PersistentRemotionWorker:
    """
    One long-lived Node/Remotion process.

    Remotion is bundled once when the worker starts.
    Every subsequent caption render reuses that bundle.
    """

    def __init__(self, renderer_dir, node, tsx_cli, worker_id):
        self.renderer_dir = Path(renderer_dir)
        self.node = Path(node)
        self.tsx_cli = Path(tsx_cli)
        self.worker_id = worker_id

        self.process = None
        self.lock = threading.Lock()

    def start(self):
        command = [
            str(self.node),
            str(self.tsx_cli),
            str(self.renderer_dir / "src" / "render.ts"),
            "--worker",
        ]

        print()
        print(
            f"[REMOTION WORKER {self.worker_id}] Starting..."
        )

        self.process = subprocess.Popen(
            command,
            cwd=str(self.renderer_dir),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,
            text=True,
            bufsize=1,
        )

        if self.process.stdin is None:
            raise RuntimeError(
                f"Remotion worker {self.worker_id}: "
                "stdin was not created."
            )

        if self.process.stdout is None:
            raise RuntimeError(
                f"Remotion worker {self.worker_id}: "
                "stdout was not created."
            )

        print(
            f"[REMOTION WORKER {self.worker_id}] Ready."
        )

    def render(
        self,
        video_path,
        transcript_path,
        start,
        end,
        theme,
        output_path,
    ):
        if self.process is None:
            raise RuntimeError(
                f"Remotion worker {self.worker_id} "
                "is not running."
            )

        if self.process.poll() is not None:
            raise RuntimeError(
                f"Remotion worker {self.worker_id} "
                f"already exited with code "
                f"{self.process.returncode}."
            )

        job_id = (
            f"worker-{self.worker_id}-"
            f"{Path(output_path).stem}"
        )

        job = {
            "id": job_id,
            "video": str(Path(video_path).resolve()),
            "transcript": str(
                Path(transcript_path).resolve()
            ),
            "start": 0,
            "end": float(end - start),
            "theme": theme,
            "output": str(
                Path(output_path).resolve()
            ),
        }

        with self.lock:
            try:
                payload = json.dumps(
                    job,
                    ensure_ascii=False,
                )

                self.process.stdin.write(
                    payload + "\n"
                )
                self.process.stdin.flush()

                response_line = (
                    self.process.stdout.readline()
                )

                if not response_line:
                    return_code = self.process.poll()

                    raise RuntimeError(
                        f"Remotion worker "
                        f"{self.worker_id} closed unexpectedly "
                        f"(exit code {return_code})."
                    )

                try:
                    response = json.loads(
                        response_line
                    )
                except json.JSONDecodeError as exc:
                    raise RuntimeError(
                        f"Remotion worker "
                        f"{self.worker_id} returned invalid "
                        f"response:\n"
                        f"{response_line}"
                    ) from exc

                if not response.get("ok"):
                    raise RuntimeError(
                        response.get(
                            "error",
                            "Unknown Remotion worker error.",
                        )
                    )

            except BrokenPipeError as exc:
                raise RuntimeError(
                    f"Remotion worker "
                    f"{self.worker_id} pipe closed."
                ) from exc

        valid, info = validate_mp4(
            Path(output_path)
        )

        if not valid:
            raise RuntimeError(
                f"Remotion output failed validation: {info}"
            )

        return info

    def stop(self):
        process = self.process

        if process is None:
            return

        print(
            f"[REMOTION WORKER {self.worker_id}] "
            "Stopping..."
        )

        try:
            if process.stdin:
                process.stdin.close()
        except Exception:
            pass

        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()

            try:
                process.wait(timeout=5)
            except Exception:
                pass

        self.process = None


class PersistentRemotionPool:
    """
    Fixed pool of persistent Remotion workers.

    Two Python render threads can acquire two workers
    simultaneously. Each worker bundles Remotion only once.
    """

    def __init__(self, worker_count):
        self.worker_count = worker_count
        self.workers = []
        self.available = queue.Queue()

    def start(self):
        renderer_dir = resolve_caption_renderer()
        node = resolve_node()

        tsx_cli_candidates = [
            renderer_dir
            / "node_modules"
            / "tsx"
            / "dist"
            / "cli.mjs",
            renderer_dir
            / "node_modules"
            / "tsx"
            / "dist"
            / "cli.js",
        ]

        tsx_cli = next(
            (
                candidate
                for candidate in tsx_cli_candidates
                if candidate.is_file()
            ),
            None,
        )

        if tsx_cli is None:
            raise RuntimeError(
                "tsx runtime was not found inside "
                "snip-caption-renderer/node_modules."
            )

        print()
        print("=" * 70)
        print("STARTING PERSISTENT REMOTION WORKERS")
        print("=" * 70)
        print(f"Workers : {self.worker_count}")
        print("Bundle  : once per worker")
        print("=" * 70)

        started_workers = []

        try:
            for worker_id in range(
                1,
                self.worker_count + 1,
            ):
                worker = PersistentRemotionWorker(
                    renderer_dir,
                    node,
                    tsx_cli,
                    worker_id,
                )

                worker.start()

                started_workers.append(worker)

                self.available.put(worker)

            self.workers = started_workers

            print()
            print(
                f"Persistent Remotion workers ready: "
                f"{len(self.workers)}"
            )

        except Exception:
            for worker in started_workers:
                worker.stop()

            raise

    def acquire(self):
        return self.available.get()

    def release(self, worker):
        self.available.put(worker)

    def render(
        self,
        video_path,
        transcript_path,
        start,
        end,
        theme,
        output_path,
    ):
        worker = self.acquire()

        try:
            print()
            print(
                f"[REMOTION POOL] "
                f"Worker {worker.worker_id} -> "
                f"{Path(output_path).name}"
            )

            return worker.render(
                video_path,
                transcript_path,
                start,
                end,
                theme,
                output_path,
            )

        finally:
            self.release(worker)

    def stop(self):
        for worker in self.workers:
            worker.stop()

        self.workers.clear()


def resolve_ffmpeg_caption_engine():
    configured = os.environ.get("SNIP_AI_FFMPEG_CAPTION_ENGINE")
    candidates = []
    if configured:
        candidates.append(Path(configured).expanduser().resolve())
    candidates.extend([
        BASE_DIR / "ffmpeg-captions" / "engine.cjs",
        BASE_DIR / "snip-caption-renderer" / "src" / "ffmpeg-captions" / "engine.cjs",
        BASE_DIR.parent / "snip-caption-renderer" / "src" / "ffmpeg-captions" / "engine.cjs",
        BASE_DIR.parent.parent / "snip-caption-renderer" / "src" / "ffmpeg-captions" / "engine.cjs",
    ])
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RuntimeError(
        "FFmpeg caption engine was not found. Expected snip-caption-renderer/src/ffmpeg-captions/engine.cjs."
    )


def _caption_video_encoder_args(encoder_info):
    if encoder_info["mode"] in {"amf", "nvenc", "qsv"}:
        hw_encoder = {"amf": "h264_amf", "nvenc": "h264_nvenc", "qsv": "h264_qsv"}[encoder_info["mode"]]
        args = ["-c:v", hw_encoder]
        if encoder_info["mode"] == "amf":
            args.extend(["-quality", "speed", "-rc", "cqp", "-qp_i", "20", "-qp_p", "20"])
        elif encoder_info["mode"] == "nvenc":
            args.extend(["-preset", "p4", "-cq", "20"])
        else:
            args.extend(["-preset", "veryfast", "-global_quality", "20"])
        args.extend(["-pix_fmt", "yuv420p"])
        return args
    return [
        "-c:v", "libx264",
        "-preset", os.environ.get("SNIP_AI_CAPTION_PRESET", "veryfast"),
        "-crf", os.environ.get("SNIP_AI_CAPTION_CRF", "20"),
        "-pix_fmt", "yuv420p",
    ]


def _render_uncaptioned_segment(video_path, start, end, output_path, encoder_info):
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        output_path.unlink()
    except FileNotFoundError:
        pass
    command = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y"]
    if start > 0:
        command.extend(["-ss", f"{start:.3f}"])
    command.extend([
        "-i", str(video_path),
        "-t", f"{end - start:.3f}",
        "-map", "0:v:0", "-map", "0:a?",
        *_caption_video_encoder_args(encoder_info),
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", str(output_path),
    ])
    print(f"No timed words in {start:.0f}-{end:.0f}s; rendering this section without captions.")
    run_command(command, "Uncaptioned Auto Caption section render")
    valid, info = validate_mp4(output_path)
    if not valid:
        raise RuntimeError(f"Uncaptioned video section failed validation: {info}")
    return output_path


def render_ffmpeg_captioned_clip(video_path, transcript_path, start, end, theme, output_path, encoder_info, framing=None):
    if theme not in FFMPEG_CAPTION_TEMPLATES:
        raise RuntimeError(f"Unsupported FFmpeg caption template: {theme}")
    node = resolve_node()
    engine = resolve_ffmpeg_caption_engine()
    temp_dir = Path(output_path).parent / ".snip_ai_tmp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    relative_transcript = temp_dir / (Path(output_path).stem + ".ffmpeg.transcript.json")
    filter_script = temp_dir / (Path(output_path).stem + ".caption-filter.txt")
    write_relative_transcript(
        transcript_path,
        start,
        end,
        relative_transcript,
        allow_empty=framing is None,
    )
    try:
        data = json.loads(relative_transcript.read_text(encoding="utf-8"))
        words = [word for segment in data.get("segments", []) for word in segment.get("words", [])]
        if not words:
            if framing is None:
                return _render_uncaptioned_segment(
                    video_path, start, end, output_path, encoder_info
                )
            raise RuntimeError("No word-level caption timings overlap this clip.")
        font_map = {
            "pop": "Poppins.ttf",
            "karaoke": "LeagueSpartan.ttf",
            "bold-center": "Anton.ttf",
            "punch": "AlfaSlabOne.ttf",
            "minimal": "Nunito.ttf",
            "highlight-box": "Kanit.ttf",
            "typewriter": "Teko.ttf",
            "bounce": "Rubik.ttf",
            "kinetic": "Oswald.ttf",
            "podcast": "BebasNeue.ttf",
            "yellow-stack": "Anton.ttf",
            "violet-pill": "Poppins.ttf",
            "dual-line": "Anton.ttf",
            "bold-karaoke": "Anton.ttf",
            "soft-lyric": "Nunito.ttf",
        }
        font_name = font_map.get(theme)
        if not font_name:
            raise RuntimeError(f"No bundled font mapping for caption template: {theme}")
        font_file = (Path(__file__).resolve().parent / "fonts" / font_name).resolve()
        if not font_file.is_file():
            raise RuntimeError(f"Bundled caption font not found: {font_file}")

        caption_width, caption_height = OUT_W, OUT_H
        if not framing:
            probe = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", str(video_path)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if probe.returncode != 0: raise RuntimeError("Could not read input video dimensions: " + probe.stderr[-2000:])
            streams = json.loads(probe.stdout).get("streams", [])
            if not streams: raise RuntimeError("Input video has no video stream.")
            caption_width, caption_height = int(streams[0]["width"]), int(streams[0]["height"])
        request = json.dumps({
            "words": words,
            "options": {
                "template": theme,
                "width": caption_width,
                "height": caption_height,
                "fontFile": str(font_file),
                **({"secondaryFontFile": str((Path(__file__).resolve().parent / "fonts" / "Nunito.ttf").resolve())} if theme == "dual-line" else {}),
            },
        }, ensure_ascii=False)
        built = subprocess.run(
            [str(node), str(engine)], input=request, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace",
        )
        if built.returncode != 0:
            raise RuntimeError("Caption filter generation failed:\n" + built.stderr[-6000:])
        result = json.loads(built.stdout)
        if not result.get("filter"):
            raise RuntimeError("Caption engine generated an empty FFmpeg filter.")
        frame_filter = f"{build_filter(framing)}," if framing else ""
        filter_script.write_text(
            "[0:v]" + frame_filter + result["filter"] + "[vout]\n",
            encoding="utf-8",
        )
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            output_path.unlink()
        except FileNotFoundError:
            pass
        render_description = (
            "FFmpeg frame+caption render"
            if framing
            else "FFmpeg caption render"
        )
        print(f"\n[RUN] {render_description.upper()}")
        print(f"Template : {theme}")
        print(f"Words    : {result.get('wordCount', len(words))}")
        print(f"Engine   : {engine}")
        video_encoder_args = _caption_video_encoder_args(encoder_info)

        command = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y"]
        if framing:
            command.extend([
                "-ss", f"{start:.3f}",
                "-i", str(video_path),
                "-t", f"{end - start:.3f}",
            ])
        else:
            if start > 0:
                command.extend(["-ss", f"{start:.3f}"])
            command.extend([
                "-i", str(video_path),
                "-t", f"{end - start:.3f}",
            ])
        command.extend([
            "-/filter_complex", str(filter_script),
            "-map", "[vout]", "-map", "0:a?",
            *video_encoder_args,
            "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart", str(output_path),
        ])
        run_command(command, render_description)
        valid, info = validate_mp4(output_path)
        if not valid:
            raise RuntimeError(f"Captioned MP4 failed validation: {info}")
        # Confirm audio remains present when the framed source had audio.
        probe = subprocess.run(
            [FFPROBE, "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", str(output_path)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        if probe.returncode != 0:
            raise RuntimeError("ffprobe could not inspect captioned output: " + probe.stderr[-2000:])
        stream_types = [item.get("codec_type") for item in json.loads(probe.stdout).get("streams", [])]
        source_probe = subprocess.run(
            [FFPROBE, "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", str(video_path)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        source_types = [item.get("codec_type") for item in json.loads(source_probe.stdout).get("streams", [])] if source_probe.returncode == 0 else []
        if "audio" in source_types and "audio" not in stream_types:
            raise RuntimeError("Audio was present in the input clip but is missing from the captioned output.")
        return {**info, "output": output_path, "word_count": len(words), "renderer": "ffmpeg"}
    finally:
        print(f"[DEBUG] Keeping caption filter: {filter_script}")
        print(f"[DEBUG] Keeping transcript: {relative_transcript}")


def render_remotion_captioned_clip(
    video_path,
    transcript_path,
    start,
    end,
    theme,
    output_path,
    remotion_pool,
):
    if theme not in FFMPEG_CAPTION_TEMPLATES:
        raise RuntimeError(
            f"Unsupported caption template: {theme}"
        )

    temp_dir = (
        Path(output_path).parent
        / ".snip_ai_tmp"
    )

    temp_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    relative_transcript = (
        temp_dir
        / (
            Path(output_path).stem
            + ".remotion.transcript.json"
        )
    )

    write_relative_transcript(
        transcript_path,
        start,
        end,
        relative_transcript,
    )

    try:
        print()
        print("[RUN] LEGACY REMOTION CAPTION RENDER (unused)")
        print(f"Theme    : {theme}")
        print(f"Duration : {end - start:.3f}s")
        print("Renderer : legacy compatibility path")

        return remotion_pool.render(
            video_path,
            relative_transcript,
            0,
            end - start,
            theme,
            output_path,
        )

    finally:
        try:
            relative_transcript.unlink()
        except FileNotFoundError:
            pass

def render_framed_source_clip(
    source,
    start,
    end,
    output,
    framing,
    encoder_info,
):
    temp_dir = output.parent / ".snip_ai_tmp"
    temp_dir.mkdir(parents=True, exist_ok=True)

    working_mkv = temp_dir / f"{output.stem}.framed.mkv"
    working_mp4 = temp_dir / f"{output.stem}.framed.mp4"

    for path in (working_mkv, working_mp4):
        try:
            if path.exists():
                path.unlink()
        except Exception:
            pass

    render_to_temp(
        source,
        start,
        end,
        working_mkv,
        framing,
        encoder_info,
        None,
    )

    remux_to_mp4(working_mkv, working_mp4)

    valid, info = validate_mp4(working_mp4)
    if not valid:
        raise RuntimeError(
            f"Framed temporary clip failed validation: {info}"
        )

    return working_mp4


# ============================================================
# MAIN
# ============================================================

def main():
    started = time.perf_counter()

    require_tools()

    (
        framing,
        generation_file,
        output_dir,
        caption_template,
        different_captions,
    ) = parse_arguments()

    data = load_generation(generation_file)
    source = get_source(data)
    moments = get_moments(data)
    encoder_info = select_encoder()

    print()
    print("=" * 70)
    print("SNIP AI — PORTABLE SIMPLE GPU RENDERER")
    print("=" * 70)

    print()
    print(f"Generation JSON : {generation_file}")
    print(f"Output directory: {output_dir}")
    print(f"Canvas          : {OUT_W}x{OUT_H}")
    print("Canvas aspect   : 9:16")
    print(f"Framing         : {framing}")
    print(f"Caption template: {caption_template}")
    print(f"Different caps  : {different_captions}")
    print("Detection       : OFF")
    print("Auto Pan        : OFF")
    print("Smart Crop      : OFF")

    print()
    print("VIDEO ENCODER")
    print("-" * 70)
    print(f"Mode    : {encoder_info['mode']}")
    print(f"Encoder : {encoder_info['encoder']}")

    if encoder_info["device"]:
        print(f"Device  : {encoder_info['device']}")

    print()

    generation = data.get(
        "generation",
        data.get("generation_number", "?"),
    )

    print(f"Generation : {generation}")
    print(f"Source     : {source}")
    print(f"Clips      : {len(moments)}")

    width, height, fps = get_video_info(source)

    if width and height:
        print(f"Source res : {width}x{height}")

    if fps:
        print(f"Source fps : {fps:.2f}")

    print()

    # Preserve clips from earlier runs; never delete prior user outputs automatically.

    transcript = source.with_suffix(".transcript.json")

    if not transcript.exists():
        print(
            "ERROR: Transcript file required for "
            "Remotion captions was not found:"
        )
        print(transcript)
        sys.exit(1)

    # ========================================================
    # PARALLEL RENDERING
    # ========================================================

    import concurrent.futures

    RENDER_WORKERS = 2

    print()
    print("=" * 70)
    print("PARALLEL RENDERING")
    print("=" * 70)
    print(f"Workers    : {RENDER_WORKERS}")
    print("Mode       : 2 clips simultaneously")
    print("Captions   : FFmpeg filter engine")
    print("=" * 70)

    # FFmpeg captions render directly in the production pipeline. No Remotion
    # worker pool is started for caption rendering.

    def render_one_clip(index, moment):
        start, end = get_clip_times(moment)

        output = (
            output_dir
            / f"snip_ai_simple_clip_{index:02d}.mp4"
        )

        clip_started = time.perf_counter()

        print()
        print("-" * 70)
        print(
            f"[START] Clip {index:02d} | "
            f"{start:.2f}s -> {end:.2f}s"
        )

        try:
            try:
                info = render_ffmpeg_captioned_clip(
                    source,
                    transcript,
                    start,
                    end,
                    caption_template,
                    output,
                    encoder_info,
                    framing=framing,
                )
            except Exception as one_pass_error:
                print(
                    "[WARN] One-pass frame+caption render failed; "
                    "retrying with the two-pass renderer."
                )
                print(str(one_pass_error)[-3000:])
                try:
                    output.unlink()
                except FileNotFoundError:
                    pass

                framed_clip = render_framed_source_clip(
                    source,
                    start,
                    end,
                    output,
                    framing,
                    encoder_info,
                )
                try:
                    info = render_ffmpeg_captioned_clip(
                        framed_clip,
                        transcript,
                        start,
                        end,
                        caption_template,
                        output,
                        encoder_info,
                    )
                finally:
                    try:
                        framed_clip.unlink()
                    except FileNotFoundError:
                        pass

            if not output.exists():
                raise RuntimeError(
                    "FFmpeg caption renderer completed but "
                    "final output file was not created."
                )

            elapsed = (
                time.perf_counter()
                - clip_started
            )

            size_mb = (
                output.stat().st_size
                / (1024 * 1024)
            )

            print()
            print(
                f"[OK] Clip {index:02d} | "
                f"{elapsed:.1f}s | "
                f"{size_mb:.1f} MB | "
                f"{info['codec']} | "
                f"{info['width']}x{info['height']}"
            )

            return {
                "index": index,
                "output": output,
                "info": info,
                "elapsed": elapsed,
                "error": None,
            }

        except Exception as exc:
            print()
            print(
                f"[ERROR] Clip {index:02d} failed:"
            )
            print(str(exc))

            try:
                if output.exists():
                    output.unlink()
            except Exception:
                pass

            return {
                "index": index,
                "output": output,
                "info": None,
                "elapsed": (
                    time.perf_counter()
                    - clip_started
                ),
                "error": str(exc),
            }

    results = []

    try:
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=RENDER_WORKERS
        ) as executor:

            futures = [
                executor.submit(
                    render_one_clip,
                    index,
                    moment,
                )
                for index, moment in enumerate(
                    moments,
                    start=1,
                )
            ]

            for future in concurrent.futures.as_completed(
                futures
            ):
                results.append(
                    future.result()
                )

    finally:
        pass

    results.sort(
        key=lambda item: item["index"]
    )

    created = [
        result["output"]
        for result in results
        if result["error"] is None
        and result["output"].exists()
    ]

    failed = [
        result
        for result in results
        if result["error"] is not None
    ]

    total = (
        time.perf_counter()
        - started
    )

    print()
    print("=" * 70)
    print("SIMPLE RENDER COMPLETE")
    print("=" * 70)

    print(f"Created    : {len(created)}/{len(moments)}")
    print(f"Failed     : {len(failed)}")
    print(f"Resolution : {OUT_W}x{OUT_H}")
    print("Canvas     : 9:16")
    print(f"Framing    : {framing}")
    print(f"Captions   : {caption_template}")
    print(f"Encoder    : {encoder_info['encoder']}")
    print(f"Workers    : {RENDER_WORKERS}")
    print(f"Total time : {total:.1f}s")
    print(f"Output     : {output_dir}")
    print("=" * 70)

    if failed:
        print()
        print("FAILED CLIPS")
        print("-" * 70)

        for result in failed:
            print(
                f"Clip {result['index']:02d}: "
                f"{result['error']}"
            )

        print("-" * 70)

    if not created:
        sys.exit(1)


if __name__ == "__main__":
    main()
