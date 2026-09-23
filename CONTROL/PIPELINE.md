# SNIP AI — PIPELINE

## Purpose

This document defines the complete Snip AI video-processing pipeline.

The processing logic is shared conceptually between Linux and Windows.

Runtime dependencies remain platform-specific.

## 1. COMPLETE PIPELINE

Input Video
→ Whisper Transcription
→ Story Event Map
→ Generation Selector
→ Clip Selection
→ Video Renderer
→ Remotion Caption Renderer
→ Final MP4

## 2. INPUT VIDEO

The user provides a source video.

The React application passes the request to Tauri.

Tauri starts the processing pipeline.

## 3. WHISPER TRANSCRIPTION

Main component:

`whisper_transcribe.py`

Responsibilities:

- Transcribe speech
- Generate segment timestamps
- Generate word timestamps
- Produce transcript data

Transcript contains:

- segments
- words
- text
- start
- end

Word timestamps are required for accurate Remotion caption timing.

## 4. STORY EVENT MAP

Main component:

`story_event_map.py`

Purpose:

Analyze transcript information and identify meaningful story/event regions.

Input:

Whisper transcript.

Output:

Story/event information used by the Generation Selector.

This component should remain platform-independent.

## 5. GENERATION SELECTOR

Main component:

`generation_selector.py`

Purpose:

Select candidate clip ranges from the analyzed transcript/story events.

Input:

Story/event analysis.

Output:

Candidate clip ranges.

This component should remain platform-independent.

## 6. CLIP SELECTION

A selected clip contains:

- Source video
- Start timestamp
- End timestamp
- Duration
- Transcript timing
- Selected caption theme
- Requested aspect ratio

The caption theme comes from the application UI.

## 7. VIDEO RENDERER

Main component:

`render_clips_simple.py`

Responsibilities:

- Prepare clip ranges
- Apply requested aspect ratio
- Prepare the clip video
- Prepare transcript timing
- Pass the clip to Remotion
- Produce final output

## 8. TRANSCRIPT CONVERSION

Before Remotion rendering, transcript timestamps are converted from source-video time to clip-relative time.

Example:

Source word:

`start = 25.50`

`end = 26.20`

Clip start:

`20.00`

Remotion timing:

`start = 5.50`

`end = 6.20`

Words outside the selected clip are excluded.

## 9. REMOTION CAPTION RENDERING

The selected caption theme is passed to the Remotion renderer.

Example:

`theme = pop`

or:

`theme = karaoke`

or any other registered theme.

The renderer uses the selected theme to generate animated captions.

## 10. CAPTION THEME SOURCE OF TRUTH

Theme package:

`../remotion-captions-themes/`

Registry:

`remotion-captions-themes/src/registry.ts`

Current themes:

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

The UI and renderer must remain synchronized with this registry.

## 11. FINAL OUTPUT

The final MP4 contains:

- Selected video clip
- Requested aspect ratio
- Selected Remotion caption theme
- Synchronized captions

## 12. PLATFORM DIFFERENCE

### Linux

Linux development uses:

- `.whisper-venv`
- System FFmpeg
- System FFprobe
- Linux Node.js
- Local Remotion renderer
- Local theme package

### Windows

Windows production uses:

- Bundled Windows Python
- Bundled FFmpeg
- Bundled FFprobe
- Bundled Node
- Bundled Remotion renderer
- Bundled theme package

The platform runtime must never cross these boundaries.

## 13. TAURI CONNECTION

The intended connection is:

React UI
→ Tauri command
→ Runtime resolver
→ Pipeline process
→ Environment variables
→ Pipeline

Important runtime variables include:

- `SNIP_AI_PROJECT_ROOT`
- `SNIP_AI_RUNTIME_ROOT`
- `SNIP_AI_PYTHON`
- `SNIP_AI_FFMPEG`
- `SNIP_AI_FFPROBE`
- `SNIP_AI_WHISPER_MODEL_DIR`
- `SNIP_AI_CAPTION_RENDERER_DIR`
- `SNIP_AI_NODE`

The variables passed by Tauri must match the variables consumed by the pipeline.

## 14. CAPTION SELECTION

The user selects one Remotion theme in the UI.

The selected theme travels through:

UI
→ Tauri
→ Pipeline
→ Remotion Renderer
→ CaptionTheme

The generated clip must use the exact selected theme.

## 15. OLD CAPTION SYSTEM

The old Python/ASS caption template system is not part of the new architecture.

The new caption system is:

Remotion
+
13 registered themes

Old caption code should only be removed after the new pipeline is fully verified.

## 16. ERROR BOUNDARIES

Each major stage should have a clear failure boundary:

- Whisper failure
- Story Event Map failure
- Generation Selector failure
- Video renderer failure
- Remotion renderer failure
- Final output failure

Errors should identify the failed component instead of returning only a generic pipeline failure.

## 17. TEST ORDER

Pipeline testing should follow:

1. Whisper
2. Transcript
3. Story Event Map
4. Generation Selector
5. Video Renderer
6. Remotion Caption Renderer
7. Final MP4
8. Tauri integration

Linux should be stabilized before Windows production validation.

## 18. CURRENT PROBLEM AREA

The Linux pipeline previously failed during runtime Python path resolution.

Tauri was resolving the Linux Python environment correctly, but the pipeline was re-resolving Python internally.

The next debugging target is therefore:

`src-tauri/src/lib.rs`

and:

`windows-runtime/pipeline/pipeline_runner.py`

These two components must agree on the Python executable used by Linux.

Do not change unrelated components while fixing this issue.
