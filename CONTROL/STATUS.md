# SNIP AI — CONTROL CENTER

## Purpose

This folder is the master control center for Snip AI.

Do not make platform-specific changes without first checking this folder.

---

# PLATFORM STATUS

## Linux

| Component | Status | Source |
|---|---|---|
| Tauri App | 🟢 | src-tauri |
| React UI | 🟢 | src |
| Python | 🟢 | .whisper-venv |
| Whisper | 🟡 | needs end-to-end test |
| FFmpeg | 🟢 | system |
| FFprobe | 🟢 | system |
| Remotion UI Preview | 🟢 | CaptionThemePreview |
| Remotion Rendering | 🟢 | standalone renderer tested |
| Full Pipeline | 🔴 | currently being repaired |
| Final MP4 Generation | 🔴 | not yet proven end-to-end |

## Windows

| Component | Status | Source |
|---|---|---|
| Tauri App | 🟢 | src-tauri |
| Python Runtime | 🟡 | windows-runtime/python |
| Whisper Model | 🟡 | windows-runtime/whisper-model |
| FFmpeg | 🟡 | windows-runtime/ffmpeg |
| Node | 🟡 | windows-runtime/node |
| Remotion Renderer | 🟡 | windows-runtime/caption-renderer |
| Pipeline | 🟡 | windows-runtime/pipeline |
| Installer | 🟢 | GitHub Actions |
| Full AI Pipeline | ⚪ | must be tested on Windows |

---

# SHARED COMPONENTS

These components are conceptually shared:

- Whisper transcription
- Story Event Map
- Generation Selector
- Video renderer
- Remotion caption themes

Platform runtime dependencies must NOT be mixed.

---

# CAPTION THEMES

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

Old caption template system is not part of the new architecture.

---

# RULES

1. Linux must use Linux development dependencies.
2. Windows must use bundled Windows dependencies.
3. Do not use windows-runtime Python on Linux.
4. Do not use Linux .whisper-venv in Windows production.
5. Do not create another copy of the pipeline without documenting why.
6. Do not modify backup files as active source.
7. Test Linux before changing Windows.
8. Test Windows separately after Linux is stable.
9. Caption UI and caption renderer must use the same theme registry.
10. Every new dependency must be recorded here.

---

# CURRENT PRIORITY

1. Finish architecture cleanup.
2. Fix Linux end-to-end pipeline.
3. Verify Remotion captions in real generated clips.
4. Freeze Linux architecture.
5. Build/test Windows runtime.
6. Create production release.
