# SNIP AI — LINUX

## Purpose

Linux is the primary development environment for Snip AI.

Linux development must use Linux-native dependencies and must not depend on the Windows production runtime.

## 1. DESKTOP APP

Location: `src/`

Technology:
- React
- TypeScript
- Vite
- Tauri

Development command:

`npm run tauri dev`

## 2. TAURI BACKEND

Location: `src-tauri/`

Responsibilities:
- Start the pipeline
- Resolve Linux runtime paths
- Pass runtime environment variables
- Start Python
- Start Node/Remotion
- Locate FFmpeg/FFprobe
- Locate Whisper resources
- Return pipeline errors/status

## 3. LINUX PYTHON

Primary development environment:

`.whisper-venv/`

Python executable:

`.whisper-venv/bin/python`

This environment is used for Linux development.

It must NOT be bundled into Windows production.

## 4. FFMPEG

Linux uses the system installation.

Expected:
- `ffmpeg`
- `ffprobe`

Current development installation:
- `/usr/bin/ffmpeg`
- `/usr/bin/ffprobe`

## 5. NODE

Linux uses the development Node.js installation.

Node is required by the Remotion caption renderer.

## 6. WHISPER

Whisper transcription runs through the Linux Python environment.

Output contains:
- segments
- words
- text
- start timestamps
- end timestamps

Word timestamps are required by the Remotion caption system.

## 7. REMOTION DEVELOPMENT RENDERER

Location:

`../snip-caption-renderer/`

This is the Linux development Remotion renderer.

## 8. REMOTION THEMES

Source package:

`../remotion-captions-themes/`

Current registry contains exactly 13 themes:

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

## 9. LINUX FLOW

React UI
→ Tauri
→ Linux Python
→ Whisper
→ Story Event Map
→ Generation Selector
→ Video Renderer
→ Linux Remotion Renderer
→ Remotion Theme
→ Final MP4

## 10. IMPORTANT RULE

Linux must NOT resolve:
- `windows-runtime/python`
- `windows-runtime/node`
- `windows-runtime/ffmpeg`

for normal development.

Linux must remain independently runnable.

## 11. CURRENT STATUS

The full Linux AI pipeline still requires an end-to-end successful test.

See `CONTROL/STATUS.md`.
