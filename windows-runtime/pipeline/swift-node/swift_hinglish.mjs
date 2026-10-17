import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { env, pipeline } from "@huggingface/transformers";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = path.join(scriptDir, "node_modules", "@huggingface", "transformers", ".cache");

const [video, output, speechRegionsPath] = process.argv.slice(2);
if (!video || !output || !speechRegionsPath) {
  throw new Error("Usage: node swift_hinglish.mjs <video> <output.json> <speech-regions.json>");
}

const speechRegions = JSON.parse(fs.readFileSync(speechRegionsPath, "utf8"));
if (!Array.isArray(speechRegions) || speechRegions.length === 0) {
  throw new Error("Swift Hinglish transcription requires at least one speech region.");
}

const ffmpeg = process.env.SNIP_AI_FFMPEG || "ffmpeg";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "snip-swift-"));
const rawPath = path.join(tempDir, "audio-f32le.raw");

try {
  console.log("Extracting audio for Swift model...");
  const extract = spawnSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", video, "-vn", "-ac", "1", "-ar", "16000",
    "-f", "f32le", rawPath
  ], { encoding: "utf8", windowsHide: true });

  if (extract.error) throw extract.error;
  if (extract.status !== 0) {
    throw new Error(`FFmpeg audio extraction failed: ${extract.stderr || extract.status}`);
  }

  const raw = fs.readFileSync(rawPath);
  if (raw.length < 4 || raw.length % 4 !== 0) {
    throw new Error("Extracted audio is empty or invalid.");
  }
  // The Buffer already owns this audio allocation; use a view instead of
  // copying another complete 16 kHz Float32 version into the Node heap.
  const audio = new Float32Array(
    raw.buffer,
    raw.byteOffset,
    raw.byteLength / Float32Array.BYTES_PER_ELEMENT
  );

  console.log("Loading timestamp-enabled Swift Hinglish model...");
  const asr = await pipeline(
    "automatic-speech-recognition",
    "ishaan-g/whisper-hinglish-swift_timestamped",
    {
      device: "cpu",
      dtype: { encoder_model: "q8", decoder_model_merged: "q8" }
    }
  );

  console.log("Preparing speech-only windows for Hinglish transcription...");
  const duration = audio.length / 16000;
  const maxWindowSeconds = 26;
  const windows = [];
  for (const region of speechRegions) {
    const start = Number(region.start);
    const end = Number(region.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration + 0.1) continue;
    const previous = windows.at(-1);
    if (previous && start - previous.end <= 1.0 && end - previous.start <= maxWindowSeconds) {
      previous.end = end;
    } else {
      windows.push({ start, end });
    }
  }
  if (!windows.length) throw new Error("Speech detector returned no valid transcription windows.");

  console.log(`Transcribing ${windows.length} speech-only windows (maximum ${maxWindowSeconds}s each)...`);
  const chunks = [];
  let rejectedInvalid = 0;
  let rejectedLong = 0;

  for (let section = 0; section < windows.length; section += 1) {
    const window = windows[section];
    const sectionAudio = audio.subarray(
      Math.floor(window.start * 16000),
      Math.floor(window.end * 16000)
    );
    const result = await asr(sectionAudio, {
      sampling_rate: 16000,
      language: "en",
      task: "transcribe",
      return_timestamps: "word"
    });

    const resultChunks = result.chunks ?? [];
    for (let index = 0; index < resultChunks.length; index += 1) {
      const chunk = resultChunks[index];
      const t = chunk.timestamp;
      const text = typeof chunk.text === "string" ? chunk.text.trim() : "";
      if (!text || !/[\p{L}\p{N}]/u.test(text) || !Array.isArray(t) || !Number.isFinite(t[0])) {
        rejectedInvalid += 1;
        continue;
      }

      let localEnd = t[1];
      if (!Number.isFinite(localEnd)) {
        const nextTimestamp = resultChunks[index + 1]?.timestamp?.[0];
        localEnd = Number.isFinite(nextTimestamp) && nextTimestamp > t[0] && nextTimestamp - t[0] <= 1.5
          ? nextTimestamp
          : Math.min(sectionAudio.length / 16000, t[0] + 0.45);
      }
      if (localEnd <= t[0] || localEnd > sectionAudio.length / 16000 + 0.05) {
        rejectedInvalid += 1;
        continue;
      }

      const start = window.start + t[0];
      const end = window.start + localEnd;
      // Word-level alignment occasionally stretches the final token across a
      // long pause. Such timings are unusable for captions and clip scoring.
      if (end - start > 2.5) {
        rejectedLong += 1;
        continue;
      }
      const midpoint = (start + end) / 2;
      if (midpoint >= window.start && midpoint < window.end && start >= 0 && end <= duration + 0.05) {
        chunks.push({
          text,
          start: Math.max(0, start),
          end: Math.min(duration, end)
        });
      }
    }

    console.log(`Transcription progress: ${section + 1}/${windows.length} speech windows`);
  }

  chunks.sort((a, b) => a.start - b.start);
  const uniqueChunks = [];
  for (const chunk of chunks) {
    const previous = uniqueChunks.at(-1);
    if (previous && chunk.text.toLowerCase() === previous.text.toLowerCase() &&
        Math.abs(chunk.start - previous.start) < 0.25) continue;
    uniqueChunks.push(chunk);
  }

  fs.writeFileSync(output, JSON.stringify({
    model: "ishaan-g/whisper-hinglish-swift_timestamped",
    duration,
    speech_regions: speechRegions.length,
    speech_windows: windows.length,
    transcription_status: uniqueChunks.length ? "complete" : "no_words",
    text: uniqueChunks.map(chunk => chunk.text).join(" "),
    chunks: uniqueChunks
  }, null, 2), "utf8");

  console.log(`Speech regions: ${speechRegions.length}; inference windows: ${windows.length}`);
  console.log(`Rejected invalid timestamps: ${rejectedInvalid}`);
  console.log(`Rejected words spanning over 2.5s: ${rejectedLong}`);
  console.log(`Swift transcription saved. Valid word timestamps: ${uniqueChunks.length}`);
} finally {
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
}
