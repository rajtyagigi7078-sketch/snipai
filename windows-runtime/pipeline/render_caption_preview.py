import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(1)

if len(sys.argv) != 3:
    fail("Usage: render_caption_preview.py THEME OUTPUT.mp4")

theme, output_path = sys.argv[1], Path(sys.argv[2])
engine = Path(os.environ.get("SNIP_AI_CAPTION_ENGINE", ""))
if not engine.is_file():
    fail("Caption engine not found: " + str(engine))

ffmpeg = os.environ.get("SNIP_AI_FFMPEG") or shutil.which("ffmpeg")
node_env = os.environ.get("SNIP_AI_NODE")
node = node_env if node_env and Path(node_env).is_file() else shutil.which("node")
if not ffmpeg:
    fail("FFmpeg executable was not found.")
if not node:
    fail("Node.js executable was not found.")

allowed = {
    "pop", "karaoke", "bold-center", "punch", "minimal",
    "highlight-box", "typewriter", "bounce", "kinetic", "podcast",
    "yellow-stack", "violet-pill", "dual-line", "bold-karaoke", "soft-lyric"
}
if theme not in allowed:
    fail("Unknown caption theme: " + theme)

if theme == "typewriter":
    # Shorter sample keeps the animated characters readable in landscape cards.
    words = [{"text": "SNIP AI IN MOTION", "start": 0.18, "end": 3.95}]
else:
    words = [
        {"text": "THIS", "start": 0.18, "end": 1.05},
        {"text": "IS", "start": 1.05, "end": 1.45},
        {"text": "SNIP", "start": 1.45, "end": 2.05},
        {"text": "AI", "start": 2.05, "end": 2.50},
        {"text": "CAPTIONS", "start": 2.50, "end": 3.15},
        {"text": "IN", "start": 3.15, "end": 3.50},
        {"text": "MOTION", "start": 3.50, "end": 3.95},
    ]

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
    fail("No bundled font mapping for caption theme: " + theme)
font_path = (Path(__file__).resolve().parent / "fonts" / font_name).resolve()
if not font_path.is_file():
    fail("Bundled caption font not found: " + str(font_path))
font_file = str(font_path)

# Exact 16:7 landscape canvas for the template-card previews.
options = {
    "template": theme,
    "width": 1920,
    "height": 840,
    "fontSize": 168 if theme == "typewriter" else 192,
}
if font_file:
    options["fontFile"] = font_file
if theme == "dual-line":
    options["secondaryFontFile"] = str((Path(__file__).resolve().parent / "fonts" / "Nunito.ttf").resolve())

request = json.dumps({"words": words, "options": options})
result = subprocess.run(
    [node, str(engine)],
    input=request,
    text=True,
    capture_output=True,
    timeout=30,
)
if result.returncode != 0:
    fail("Caption engine failed: " + (result.stderr.strip() or result.stdout.strip()))

try:
    filter_result = json.loads(result.stdout)
except Exception as exc:
    fail("Caption engine returned invalid JSON: " + str(exc))

caption_filter = filter_result.get("filter", "")
if not caption_filter:
    fail("Caption engine returned an empty filter.")

output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.unlink(missing_ok=True)

cmd = [
    ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=#101116:s=1920x840:r=30:d=4",
    "-vf", caption_filter,
    "-t", "4", "-an", "-c:v", "libx264", "-preset", "fast",
    "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    str(output_path),
]
render = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
if render.returncode != 0 or not output_path.is_file() or output_path.stat().st_size < 1024:
    output_path.unlink(missing_ok=True)
    fail("FFmpeg preview render failed: " + (render.stderr.strip() or "no output"))

print(str(output_path))