# SNIP AI — WINDOWS

## Purpose

Windows is the production runtime for Snip AI.

Windows production must be independent from the Linux development environment.

## 1. WINDOWS RUNTIME

Main location:

`windows-runtime/`

Expected production runtime:

- `ffmpeg/`
- `node/`
- `pipeline/`
- `python/`
- `whisper-model/`
- `caption-renderer/`

## 2. WINDOWS PYTHON

Production Python must come from:

`windows-runtime/python/`

Windows must NOT use:

`.whisper-venv/`

The Linux Python environment is development-only.

## 3. WINDOWS FFMPEG

Production FFmpeg must be bundled inside:

`windows-runtime/ffmpeg/`

Windows production should use the bundled Windows executable.

## 4. WINDOWS FFPROBE

FFprobe belongs to the bundled FFmpeg runtime.

The correct Windows FFprobe path must be passed to the pipeline.

## 5. WINDOWS NODE

Production Node belongs inside:

`windows-runtime/node/`

Node is required by the Remotion caption renderer.

## 6. WINDOWS WHISPER

Whisper Python dependencies belong to:

`windows-runtime/python/`

The Whisper model belongs to:

`windows-runtime/whisper-model/`

Windows production must not depend on the Linux Whisper environment.

## 7. WINDOWS PIPELINE

Production pipeline location:

`windows-runtime/pipeline/`

Core components:

- `pipeline_runner.py`
- `whisper_transcribe.py`
- `story_event_map.py`
- `generation_selector.py`
- `render_clips_simple.py`

The active production pipeline must be clearly identified before cleanup of duplicate/backup copies.

## 8. WINDOWS REMOTION

Production Remotion renderer:

`windows-runtime/caption-renderer/`

Windows production must use this bundled renderer rather than the Linux development renderer.

## 9. WINDOWS CAPTION THEMES

The production renderer must use the same 13 themes as the UI:

1. pop
2. karaoke
3. kinetic-01
4. kinetic-02
5. hustle
6. grape
7. beast
8. poppin
9. aarit
10. soft-ai
11. gaming-stream
12. simple-one-word
13. podcast

## 10. WINDOWS FLOW

Windows Tauri App
→ Bundled Python
→ Whisper
→ Pipeline
→ Bundled FFmpeg / FFprobe
→ Bundled Node
→ Bundled Remotion Renderer
→ Caption Theme
→ Final MP4

## 11. BUILD

Windows production is assembled through GitHub Actions.

The Windows installer build has been produced successfully.

However, a successful installer build does not by itself prove the complete AI pipeline.

The full AI pipeline still requires real Windows testing.

## 12. IMPORTANT RULES

Windows must NOT depend on:

- `.whisper-venv/`
- Linux FFmpeg
- Linux Node
- Linux Remotion renderer
- Linux filesystem paths

Windows production must remain independently runnable.

## 13. CURRENT STATUS

See:

`CONTROL/STATUS.md`
