#!/usr/bin/env python3
"""Offline full-video caption renderer for Snip AI."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
import render_clips_simple as renderer


def main():
    if len(sys.argv) != 5:
        raise SystemExit("Usage: auto_caption.py INPUT LANGUAGE TEMPLATE OUTPUT_DIR")
    video = Path(sys.argv[1]).resolve()
    language, theme = sys.argv[2], sys.argv[3]
    output_dir = Path(sys.argv[4]).resolve()
    if not video.is_file():
        raise RuntimeError(f"Video file not found: {video}")
    if language not in {"english", "hinglish"}:
        raise RuntimeError("Audio language must be English or Hinglish.")
    output_dir.mkdir(parents=True, exist_ok=True)
    python = os.environ.get("SNIP_AI_PYTHON", sys.executable)
    renderer.FFMPEG = os.environ.get("SNIP_AI_FFMPEG", renderer.FFMPEG)
    renderer.FFPROBE = os.environ.get("SNIP_AI_FFPROBE", renderer.FFPROBE)
    transcriber = BASE / "whisper_transcribe.py"
    transcript = output_dir / (video.stem + ".transcript.json")
    print("AUTO CAPTION: local transcription; no GPT or API required.", flush=True)
    transcription_env = os.environ.copy()
    transcription_env["SNIP_AI_TRANSCRIPT_PATH"] = str(transcript)
    subprocess.run([python, str(transcriber), str(video), language], check=True, cwd=str(BASE), env=transcription_env)
    if not transcript.is_file():
        raise RuntimeError(f"Transcription output was not created: {transcript}")
    data = json.loads(transcript.read_text(encoding="utf-8"))
    if not any(word for segment in data.get("segments", []) for word in segment.get("words", [])):
        raise RuntimeError("Transcription returned no word timings.")
    probe = subprocess.run(
        [renderer.FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(video)],
        check=True, stdout=subprocess.PIPE, text=True,
    )
    duration = float(probe.stdout.strip())
    output = output_dir / f"{video.stem}.captioned.mp4"
    chunk_seconds = int(os.environ.get("SNIP_AI_AUTO_CAPTION_CHUNK_SECONDS", "60"))
    chunk_seconds = max(15, min(chunk_seconds, 120))
    chunk_count = max(1, int((duration + chunk_seconds - 1) // chunk_seconds))
    chunk_dir = output_dir / ".auto-caption-chunks"
    chunk_dir.mkdir(parents=True, exist_ok=True)
    encoder_info = renderer.select_encoder()
    chunks = []

    for index in range(chunk_count):
        start = index * chunk_seconds
        end = min(duration, start + chunk_seconds)
        chunk_path = (
            output
            if chunk_count == 1
            else chunk_dir / f"caption-part-{index + 1:04d}.mp4"
        )
        print(
            f"AUTO CAPTION RENDER: section {index + 1}/{chunk_count} "
            f"({start:.0f}-{end:.0f}s)",
            flush=True,
        )
        renderer.render_ffmpeg_captioned_clip(
            video, transcript, start, end, theme, chunk_path,
            encoder_info, framing=None,
        )
        chunks.append(chunk_path)

    if chunk_count > 1:
        concat_list = chunk_dir / "concat-list.txt"
        concat_list.write_text(
            "".join(
                "file '" + path.resolve().as_posix().replace("'", "'\\''") + "'\n"
                for path in chunks
            ),
            encoding="utf-8",
        )
        print("AUTO CAPTION: joining rendered sections without re-encoding.", flush=True)
        renderer.run_command(
            [
                renderer.FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
                "-f", "concat", "-safe", "0", "-i", str(concat_list),
                "-map", "0", "-c", "copy", "-movflags", "+faststart",
                str(output),
            ],
            "Auto Caption section join",
        )
        valid, info = renderer.validate_mp4(output)
        if not valid:
            raise RuntimeError(f"Joined captioned video failed validation: {info}")
        shutil.rmtree(chunk_dir, ignore_errors=True)

    print(f"AUTO CAPTION COMPLETE: {output}", flush=True)


if __name__ == "__main__":
    main()
