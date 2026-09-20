from faster_whisper import WhisperModel
import sys
from pathlib import Path

if len(sys.argv) < 2:
    print("Usage: python whisper_test.py /path/to/video.mp4")
    sys.exit(1)

video_path = Path(sys.argv[1])

if not video_path.exists():
    print(f"Video not found: {video_path}")
    sys.exit(1)

print("Loading Whisper model...")

model = WhisperModel(
    "small",
    device="cpu",
    compute_type="int8",
)

print("Transcribing video...")
print()

segments, info = model.transcribe(
    str(video_path),
    beam_size=5,
    vad_filter=True,
)

print(f"Detected language: {info.language}")
print(f"Language probability: {info.language_probability:.2f}")
print()
print("=" * 70)

all_segments = []

for segment in segments:
    start = segment.start
    end = segment.end
    text = segment.text.strip()

    all_segments.append(
        {
            "start": start,
            "end": end,
            "text": text,
        }
    )

    print(
        f"[{start:8.2f}s → {end:8.2f}s] {text}"
    )

print("=" * 70)
print()
print(f"Total segments: {len(all_segments)}")
print("Whisper transcription complete.")
