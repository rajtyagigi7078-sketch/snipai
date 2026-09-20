#!/usr/bin/env python3

from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time


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
        else "Bold Pop"
    )

    different_captions = (
        sys.argv[5].strip().lower() == "true"
        if len(sys.argv) >= 6
        else False
    )

    allowed_caption_templates = {
        "Reveal",
        "Reveal Cyan",
        "Reveal Pink",
        "Reveal Lime",
        "Snap",
        "Snap Gold",
        "Snap Cyan",
        "Snap Lime",
        "Headline",
        "Headline Bottom",
        "Headline Yellow",
        "Headline Red",
        "Hype",
        "Hype Blue",
        "Hype Green",
        "Hype Purple",
        "MrBeast",
        "Minimal",
        "Podcast",
        "Highlight",
        "Clean",
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

    data = load_generation(
        generation_file
    )

    source = get_source(data)

    moments = get_moments(data)

    encoder_info = select_encoder()

    print()
    print("=" * 70)
    print("SNIP AI — PORTABLE SIMPLE GPU RENDERER")
    print("=" * 70)

    print()
    print(
        f"Generation JSON : "
        f"{generation_file}"
    )

    print(
        f"Output directory: "
        f"{output_dir}"
    )

    print(
        f"Canvas          : "
        f"{OUT_W}x{OUT_H}"
    )

    print(
        f"Canvas aspect   : "
        f"9:16"
    )

    print(
        f"Framing         : {framing}"
    )

    print(
        f"Caption template: {caption_template}"
    )

    print(
        f"Different caps  : {different_captions}"
    )

    print(
        "Detection       : OFF"
    )

    print(
        "Auto Pan        : OFF"
    )

    print(
        "Smart Crop      : OFF"
    )

    print()
    print("VIDEO ENCODER")
    print("-" * 70)

    print(
        f"Mode    : "
        f"{encoder_info['mode']}"
    )

    print(
        f"Encoder : "
        f"{encoder_info['encoder']}"
    )

    if encoder_info["device"]:
        print(
            f"Device  : "
            f"{encoder_info['device']}"
        )

    print()

    generation = data.get(
        "generation",
        data.get(
            "generation_number",
            "?",
        ),
    )

    print(
        f"Generation : {generation}"
    )

    print(
        f"Source     : {source}"
    )

    print(
        f"Clips      : {len(moments)}"
    )

    width, height, fps = (
        get_video_info(source)
    )

    if width and height:
        print(
            f"Source res : "
            f"{width}x{height}"
        )

    if fps:
        print(
            f"Source fps : "
            f"{fps:.2f}"
        )

    print()

    clean_old_outputs(
        output_dir
    )

    created = []

    for index, moment in enumerate(
        moments,
        start=1,
    ):
        start, end = get_clip_times(
            moment
        )

        output = (
            output_dir
            / f"snip_ai_simple_clip_{index:02d}.mp4"
        )

        print()
        print(
            "-" * 70
        )

        print(
            f"[Render] Clip {index:02d} | "
            f"{start:.2f}s -> {end:.2f}s"
        )

        clip_started = time.perf_counter()

        try:
            subtitle_file = None

            if caption_template:
                transcript = source.with_suffix(
                    ".transcript.json"
                )

                if not transcript.exists():
                    raise RuntimeError(
                        "Transcript file required "
                        "for captions was not found:\n"
                        f"{transcript}"
                    )

                temp_dir = (
                    output_dir
                    / ".snip_ai_tmp"
                )

                temp_dir.mkdir(
                    parents=True,
                    exist_ok=True,
                )

                subtitle_file = (
                    temp_dir
                    / f"{output.stem}.ass"
                )

                engine = (
                    Path(__file__).resolve().parent
                    / "caption_engine.py"
                )

                if not engine.exists():
                    raise RuntimeError(
                        "Caption engine not found:\n"
                        f"{engine}"
                    )

                template_map = {
                    "Reveal": "Reveal",
                    "Reveal Cyan": "Reveal Cyan",
                    "Reveal Pink": "Reveal Pink",
                    "Reveal Lime": "Reveal Lime",
                    "Snap": "Snap",
                    "Snap Gold": "Snap Gold",
                    "Snap Cyan": "Snap Cyan",
                    "Snap Lime": "Snap Lime",
                    "Headline": "Headline",
                    "Headline Bottom": "Headline Bottom",
                    "Headline Yellow": "Headline Yellow",
                    "Headline Red": "Headline Red",
                    "Hype": "Hype",
                    "Hype Blue": "Hype Blue",
                    "Hype Green": "Hype Green",
                    "Hype Purple": "Hype Purple",
                    "MrBeast": "MrBeast",
                    "Minimal": "Minimal",
                    "Podcast": "Podcast",
                    "Highlight": "Highlight",
                    "Clean": "Clean",
                }

                if caption_template not in template_map:
                    raise RuntimeError(
                        f"Unsupported caption template: "
                        f"{caption_template}"
                    )

                engine_template = template_map[
                    caption_template
                ]

                # ------------------------------------------------
                # Different captions mode
                #
                # When enabled, keep the selected caption family
                # but rotate through compatible visual variants.
                # When disabled, use the selected template exactly.
                # ------------------------------------------------
                if different_captions:
                    variant_groups = {
                        "Reveal": [
                            "Reveal",
                            "Reveal Cyan",
                            "Reveal Pink",
                            "Reveal Lime",
                        ],
                        "Snap": [
                            "Snap",
                            "Snap Gold",
                            "Snap Cyan",
                            "Snap Lime",
                        ],
                        "Headline": [
                            "Headline",
                            "Headline Bottom",
                            "Headline Yellow",
                            "Headline Red",
                        ],
                        "Hype": [
                            "Hype",
                            "Hype Blue",
                            "Hype Green",
                            "Hype Purple",
                        ],
                        "MrBeast": [
                            "MrBeast",
                            "Hype",
                            "Snap",
                            "Headline",
                        ],
                        "Minimal": [
                            "Minimal",
                            "Clean",
                        ],
                        "Podcast": [
                            "Podcast",
                            "Headline Bottom",
                            "Minimal",
                        ],
                        "Highlight": [
                            "Highlight",
                            "Headline Yellow",
                            "Headline Red",
                        ],
                        "Clean": [
                            "Clean",
                            "Minimal",
                        ],
                    }

                    selected_variants = variant_groups.get(
                        caption_template,
                        [caption_template],
                    )

                    variant_index = (
                        index - 1
                    ) % len(selected_variants)

                    engine_template = selected_variants[
                        variant_index
                    ]

                caption_command = [
                    sys.executable,
                    str(engine),
                    str(transcript),
                    f"{start:.3f}",
                    f"{end:.3f}",
                    engine_template,
                    str(subtitle_file),
                ]

                run_command(
                    caption_command,
                    "CAPTION GENERATION",
                )

                if (
                    not subtitle_file.exists()
                    or subtitle_file.stat().st_size == 0
                ):
                    raise RuntimeError(
                        "Caption engine did not create "
                        "a valid ASS subtitle file."
                    )

            info = render_clip(
                source,
                start,
                end,
                output,
                framing,
                encoder_info,
                subtitle_file,
            )

            elapsed = (
                time.perf_counter()
                - clip_started
            )

            size_mb = (
                output.stat().st_size
                / (1024 * 1024)
            )

            created.append(
                output
            )

            print(
                f"[OK] Clip {index:02d} | "
                f"{elapsed:.1f}s | "
                f"{size_mb:.1f} MB | "
                f"{info['codec']} | "
                f"{info['width']}x{info['height']}"
            )

        except Exception as exc:
            print(
                f"[ERROR] Clip {index:02d} failed:"
            )

            print(
                str(exc)
            )

            # Never leave an invalid final MP4
            # behind as if it were a valid result.
            try:
                if output.exists():
                    output.unlink()
            except Exception:
                pass

    total = (
        time.perf_counter()
        - started
    )

    print()
    print("=" * 70)
    print("SIMPLE RENDER COMPLETE")
    print("=" * 70)

    print(
        f"Created    : "
        f"{len(created)}/{len(moments)}"
    )

    print(
        f"Resolution : "
        f"{OUT_W}x{OUT_H}"
    )

    print(
        "Canvas     : 9:16"
    )

    print(
        f"Framing    : {framing}"
    )

    print(
        f"Captions   : {caption_template}"
    )

    print(
        f"Encoder    : "
        f"{encoder_info['encoder']}"
    )

    print(
        f"Total time : "
        f"{total:.1f}s"
    )

    print(
        f"Output     : "
        f"{output_dir}"
    )

    print("=" * 70)

    if not created:
        sys.exit(1)


if __name__ == "__main__":
    main()
