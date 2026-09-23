# SNIP AI — ARCHITECTURE

## 1. SYSTEM OVERVIEW

Snip AI consists of:

1. Desktop Application
2. Video Processing Pipeline
3. Whisper Transcription
4. Story Event Map
5. Generation Selector
6. Video Renderer
7. Remotion Caption Renderer
8. Caption Theme Registry
9. Platform-specific Runtime Dependencies

The application UI controls the pipeline.
The pipeline performs the actual video processing.
Platform runtimes provide the dependencies required by each operating system.

---

# 2. PLATFORM MODEL

Snip AI has two separate runtime environments.

## Linux Development

Linux is the development environment.

Linux uses:

- System FFmpeg
- System FFprobe
- Linux Node.js
- Linux development Python environment
- Linux Whisper environment
- Local Remotion renderer
- Local Remotion theme package

Linux must NOT depend on the Windows runtime.

---

## Windows Production

Windows is the production runtime.

Windows uses bundled dependencies:

- Windows Python
- Windows FFmpeg
- Windows FFprobe
- Windows Node.js
- Windows Whisper model
- Windows pipeline
- Windows Remotion caption renderer
- Windows caption themes

Windows production must NOT depend on Linux development paths.

---

# 3. DESKTOP APP

Location:

`src/`

Main technology:

- React
- TypeScript
- Vite
- Tauri

Responsibilities:

- User interface
- Video input
- Clip settings
- Caption theme selection
- Generation controls
- Gallery/output handling
- Payment/authentication
- Communication with Tauri backend

The UI must not contain the actual video-processing implementation.

---

# 4. TAURI BACKEND

Location:

`src-tauri/`

Responsibilities:

- Start the processing pipeline
- Resolve platform-specific runtime paths
- Pass environment variables to the pipeline
- Locate FFmpeg/FFprobe
- Locate Python
- Locate Node
- Locate Remotion renderer
- Locate Whisper model
- Return pipeline status/errors to the application

Tauri is the bridge between:

`React UI`

and

`Processing Pipeline`

---

# 5. PROCESSING PIPELINE

Main pipeline components:

```text
Input Video
     ↓
Whisper Transcription
     ↓
Story Event Map
     ↓
Generation Selector
     ↓
Clip Selection
     ↓
Video Renderer
     ↓
Remotion Caption Renderer
     ↓
Final MP4
PY
