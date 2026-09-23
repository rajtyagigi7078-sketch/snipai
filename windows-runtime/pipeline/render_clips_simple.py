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
        error = process.stderr.strip()

        if len(error) > 8000:
            error = error[-8000:]

        raise RuntimeError(
            f"{description} failed.\n\n{error}"
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

    else:
        """
        Software fallback.

        libx264 is used when no accessible VAAPI
        encoder/device is available.
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

REMOTION_THEMES = {
    "pop", "karaoke", "hustle", "grape", "beast", "poppin", "aarit",
    "soft-ai", "gaming-stream", "simple-one-word", "kinetic-01",
    "kinetic-02", "podcast",
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
        "Node.js was not found. Snip AI needs Node.js for Remotion captions."
    )


def write_relative_transcript(
    source_transcript,
    clip_start,
    clip_end,
    output_path,
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

    if not segments:
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


def render_remotion_captioned_clip(
    video_path,
    transcript_path,
    start,
    end,
    theme,
    output_path,
    remotion_pool,
):
    if theme not in REMOTION_THEMES:
        raise RuntimeError(
            f"Unsupported Remotion theme: {theme}"
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
        print("[RUN] REMOTION CAPTION RENDER")
        print(f"Theme    : {theme}")
        print(f"Duration : {end - start:.3f}s")
        print("Renderer : persistent worker")

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
    print(f"Remotion theme  : {caption_template}")
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

    clean_old_outputs(output_dir)

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
    print("Remotion   : persistent workers")
    print("=" * 70)

    remotion_pool = PersistentRemotionPool(
        RENDER_WORKERS
    )

    remotion_pool.start()

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
            framed_clip = render_framed_source_clip(
                source,
                start,
                end,
                output,
                framing,
                encoder_info,
            )

            try:
                info = render_remotion_captioned_clip(
                    framed_clip,
                    transcript,
                    start,
                    end,
                    caption_template,
                    output,
                    remotion_pool,
                )

            finally:
                try:
                    framed_clip.unlink()
                except FileNotFoundError:
                    pass

            if not output.exists():
                raise RuntimeError(
                    "Remotion renderer completed but "
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
        remotion_pool.stop()

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

