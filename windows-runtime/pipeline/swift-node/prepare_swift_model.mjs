import path from "node:path";
import { fileURLToPath } from "node:url";
import { env, LogLevel, pipeline } from "@huggingface/transformers";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const modelCache = path.join(
  scriptDir,
  "node_modules",
  "@huggingface",
  "transformers",
  ".cache",
);
const modelId = "ishaan-g/whisper-hinglish-swift_timestamped";

env.logLevel = LogLevel.ERROR;
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.localModelPath = modelCache;
env.cacheDir = modelCache;

console.log(`Preparing offline Hinglish model: ${modelId}`);
console.log(`Model cache: ${modelCache}`);

await pipeline("automatic-speech-recognition", modelId, {
  device: "cpu",
  dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
});

console.log("Offline Swift Hinglish model is ready.");
