import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  selectComposition,
} from "@remotion/renderer";

const THIS_FILE = fileURLToPath(import.meta.url);
const RENDERER_DIR = path.dirname(path.dirname(THIS_FILE));
const ENTRY_POINT = path.resolve(
  RENDERER_DIR,
  "src/index.ts",
);
const PUBLIC_DIR = path.resolve(
  RENDERER_DIR,
  "public",
);

type RemotionWord = {
  text: string;
  start: number;
  end: number;
  emphasis?: boolean;
};

type RemotionLine = {
  words: RemotionWord[];
};

type CaptionsData = {
  lines: RemotionLine[];
};

type WhisperWord = {
  text?: string;
  start?: number;
  end?: number;
};

type WhisperSegment = {
  start?: number;
  end?: number;
  text?: string;
  words?: WhisperWord[];
};

type WhisperTranscript = {
  segments?: WhisperSegment[];
};

type WorkerJob = {
  id: string;
  video: string;
  transcript: string;
  start: number;
  end: number;
  theme: string;
  output: string;
};

const THEMES = [
  "pop",
  "karaoke",
  "hustle",
  "grape",
  "beast",
  "poppin",
  "aarit",
  "soft-ai",
  "gaming-stream",
  "simple-one-word",
  "kinetic-01",
  "kinetic-02",
  "podcast",
] as const;

function log(...args: unknown[]) {
  console.error(...args);
}

function fail(message: string): never {
  log("");
  log("==============================================");
  log("SNIP AI — REMOTION RENDER FAILED");
  log("==============================================");
  log(message);
  log("==============================================");
  process.exit(1);
}

function parseNumber(
  value: string,
  name: string,
): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    fail(`Invalid ${name}: ${value}`);
  }

  return parsed;
}

function loadTranscript(
  transcriptPath: string,
): WhisperTranscript {
  if (!fs.existsSync(transcriptPath)) {
    throw new Error(
      `Transcript not found:\n${transcriptPath}`,
    );
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        transcriptPath,
        "utf8",
      ),
    ) as WhisperTranscript;
  } catch (error) {
    throw new Error(
      `Could not read transcript:\n${String(error)}`,
    );
  }
}

function buildClipCaptionData(
  transcript: WhisperTranscript,
  clipStart: number,
  clipEnd: number,
): CaptionsData {
  const lines: RemotionLine[] = [];
  const duration = Math.max(
    0,
    clipEnd - clipStart,
  );

  for (const segment of transcript.segments ?? []) {
    const words: RemotionWord[] = [];

    for (const rawWord of segment.words ?? []) {
      const text = String(
        rawWord.text ?? "",
      ).trim();

      if (!text) {
        continue;
      }

      const rawStart = Number(
        rawWord.start,
      );
      const rawEnd = Number(
        rawWord.end,
      );

      if (
        !Number.isFinite(rawStart) ||
        !Number.isFinite(rawEnd)
      ) {
        continue;
      }

      if (
        rawEnd <= clipStart ||
        rawStart >= clipEnd
      ) {
        continue;
      }

      const start = Math.max(
        0,
        rawStart - clipStart,
      );

      const end = Math.min(
        duration,
        rawEnd - clipStart,
      );

      if (end <= start) {
        continue;
      }

      words.push({
        text,
        start: Number(
          start.toFixed(3),
        ),
        end: Number(
          end.toFixed(3),
        ),
      });
    }

    if (words.length > 0) {
      lines.push({ words });
    }
  }

  return { lines };
}

function validateCaptionData(
  data: CaptionsData,
) {
  const wordCount =
    data.lines.reduce(
      (total, line) =>
        total + line.words.length,
      0,
    );

  if (wordCount === 0) {
    throw new Error(
      "No caption words overlap the requested clip range.",
    );
  }

  log(
    `Caption lines : ${data.lines.length}`,
  );

  log(
    `Caption words : ${wordCount}`,
  );
}

function createLocalVideoServer(
  videoPath: string,
) {
  const server = http.createServer(
    (request, response) => {
      try {
        const requestUrl = new URL(
          request.url ?? "/",
          "http://127.0.0.1",
        );

        if (
          requestUrl.pathname !==
          "/video"
        ) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }

        const stat = fs.statSync(
          videoPath,
        );

        const fileSize = stat.size;
        const range =
          request.headers.range;

        if (!range) {
          response.writeHead(200, {
            "Content-Type":
              "video/mp4",
            "Content-Length":
              fileSize,
            "Accept-Ranges":
              "bytes",
            "Cache-Control":
              "no-store",
          });

          fs.createReadStream(
            videoPath,
          ).pipe(response);

          return;
        }

        const match =
          /^bytes=(\d*)-(\d*)$/.exec(
            range,
          );

        if (!match) {
          response.writeHead(416, {
            "Content-Range":
              `bytes */${fileSize}`,
          });

          response.end();
          return;
        }

        const start = match[1]
          ? Number(match[1])
          : Math.max(
              0,
              fileSize -
                Number(match[2]),
            );

        const end = match[2]
          ? Number(match[2])
          : fileSize - 1;

        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end >= fileSize ||
          start > end
        ) {
          response.writeHead(416, {
            "Content-Range":
              `bytes */${fileSize}`,
          });

          response.end();
          return;
        }

        const chunkSize =
          end - start + 1;

        response.writeHead(206, {
          "Content-Type":
            "video/mp4",
          "Content-Length":
            chunkSize,
          "Content-Range":
            `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges":
            "bytes",
          "Cache-Control":
            "no-store",
        });

        fs.createReadStream(
          videoPath,
          {
            start,
            end,
          },
        ).pipe(response);
      } catch (error) {
        response.writeHead(500);
        response.end(
          String(error),
        );
      }
    },
  );

  return new Promise<{
    server: http.Server;
    url: string;
  }>((resolve, reject) => {
    server.once(
      "error",
      reject,
    );

    server.listen(
      0,
      "127.0.0.1",
      () => {
        const address =
          server.address();

        if (
          !address ||
          typeof address ===
            "string"
        ) {
          reject(
            new Error(
              "Could not determine local video server port.",
            ),
          );

          return;
        }

        resolve({
          server,
          url:
            `http://127.0.0.1:${address.port}/video`,
        });
      },
    );
  });
}

async function bundleRemotion() {
  log("");
  log("Bundling Remotion...");

  const started =
    performance.now();

  const serveUrl =
    await bundle({
      entryPoint:
        ENTRY_POINT,
      publicDir:
        PUBLIC_DIR,
      webpackOverride:
        (config) => config,
    });

  const seconds =
    (performance.now() -
      started) /
    1000;

  log(
    `Remotion bundle ready in ${seconds.toFixed(2)}s.`,
  );

  return serveUrl;
}

async function renderJob(
  job: WorkerJob,
  serveUrl: string,
) {
  const videoPath =
    path.resolve(job.video);

  const transcriptPath =
    path.resolve(
      job.transcript,
    );

  const outputPath =
    path.resolve(job.output);

  const clipStart =
    Number(job.start);

  const clipEnd =
    Number(job.end);

  const theme = String(
    job.theme,
  );

  if (
    !THEMES.includes(
      theme as (typeof THEMES)[number],
    )
  ) {
    throw new Error(
      `Invalid Remotion theme: ${theme}`,
    );
  }

  if (
    !Number.isFinite(
      clipStart,
    ) ||
    !Number.isFinite(
      clipEnd,
    ) ||
    clipStart < 0 ||
    clipEnd <= clipStart
  ) {
    throw new Error(
      `Invalid clip range: ${clipStart} -> ${clipEnd}`,
    );
  }

  if (
    !fs.existsSync(
      videoPath,
    ) ||
    !fs.statSync(
      videoPath,
    ).isFile()
  ) {
    throw new Error(
      `Video file not found:\n${videoPath}`,
    );
  }

  const transcript =
    loadTranscript(
      transcriptPath,
    );

  const captionData =
    buildClipCaptionData(
      transcript,
      clipStart,
      clipEnd,
    );

  validateCaptionData(
    captionData,
  );

  fs.mkdirSync(
    path.dirname(outputPath),
    {
      recursive: true,
    },
  );

  log("");
  log(
    `[REMOTION] Job ${job.id}`,
  );

  log(
    `Video      : ${videoPath}`,
  );

  log(
    `Transcript : ${transcriptPath}`,
  );

  log(
    `Clip range : ${clipStart.toFixed(3)}s -> ${clipEnd.toFixed(3)}s`,
  );

  log(
    `Duration   : ${(clipEnd - clipStart).toFixed(3)}s`,
  );

  log(
    `Theme      : ${theme}`,
  );

  log(
    `Output     : ${outputPath}`,
  );

  const localVideo =
    await createLocalVideoServer(
      videoPath,
    );

  try {
    log(
      `Video server: ${localVideo.url}`,
    );

    const inputProps = {
      data: captionData,
      videoSrc:
        localVideo.url,
      theme,
      primaryColor:
        "#ffffff",
      secondaryColor:
        "#ffff00",
      fontSize: 64,
    };

    const compositionStarted =
      performance.now();

    const composition =
      await selectComposition({
        serveUrl,
        id: "SnipCaption",
        inputProps,
      });

    const compositionSeconds =
      (performance.now() -
        compositionStarted) /
      1000;

    log(
      `Composition selection : ${compositionSeconds.toFixed(2)}s`,
    );

    const fps =
      composition.fps;

    const durationInFrames =
      Math.max(
        1,
        Math.ceil(
          (clipEnd -
            clipStart) *
            fps,
        ),
      );

    const finalComposition =
      {
        ...composition,
        durationInFrames,
      };

    const renderConcurrency =
      Math.min(
        4,
        Math.max(
          1,
          Number(
            process.env
              .SNIP_AI_RENDER_CONCURRENCY ||
              4,
          ),
        ),
      );

    log("");
    log(
      "Rendering Remotion captions...",
    );

    log(
      `Frames : ${durationInFrames}`,
    );

    log(
      `Concurrency : ${renderConcurrency}`,
    );

    log(
      "Hardware acceleration : disabled",
    );

    log(
      "x264 preset : ultrafast",
    );

    const renderStarted =
      performance.now();

    await renderMedia({
      composition:
        finalComposition,
      serveUrl,
      codec: "h264",
      outputLocation:
        outputPath,
      inputProps,
      overwrite: true,
      concurrency:
        renderConcurrency,
      hardwareAcceleration:
        "disable",
      x264Preset:
        "ultrafast",
    });

    const renderSeconds =
      (performance.now() -
        renderStarted) /
      1000;

    log(
      `Caption render         : ${renderSeconds.toFixed(2)}s`,
    );

    log(
      "SNIP AI — REMOTION RENDER COMPLETE",
    );

    return {
      renderSeconds,
      output: outputPath,
    };
  } finally {
    await new Promise<void>(
      (resolve) => {
        localVideo.server.close(
          () => resolve(),
        );
      },
    );
  }
}

async function startWorker() {
  log("");
  log(
    "==============================================",
  );
  log(
    "SNIP AI — PERSISTENT REMOTION WORKER",
  );
  log(
    "==============================================",
  );

  log(
    "Bundling Remotion once...",
  );

  let serveUrl: string;

  try {
    serveUrl =
      await bundleRemotion();
  } catch (error) {
    log(
      "Worker bundle failed:",
    );

    log(
      String(error),
    );

    process.exit(1);
  }

  log(
    "Worker ready. Waiting for jobs...",
  );

  const input =
    readline.createInterface({
      input:
        process.stdin,
      crlfDelay:
        Infinity,
    });

  for await (
    const line of input
  ) {
    const trimmed =
      line.trim();

    if (!trimmed) {
      continue;
    }

    let job: WorkerJob;

    try {
      job = JSON.parse(
        trimmed,
      ) as WorkerJob;
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          ok: false,
          error:
            `Invalid worker job JSON: ${String(error)}`,
        }) + "\n",
      );

      continue;
    }

    try {
      const result =
        await renderJob(
          job,
          serveUrl,
        );

      process.stdout.write(
        JSON.stringify({
          id: job.id,
          ok: true,
          renderSeconds:
            result.renderSeconds,
        }) + "\n",
      );

      process.stdout.write("");
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          id: job.id,
          ok: false,
          error: String(error),
        }) + "\n",
      );
    }
  }

  log(
    "Worker input closed. Shutting down.",
  );

  input.close();
}

async function runSingleCli() {
  const args =
    process.argv.slice(2);

  if (args.length < 6) {
    fail(
      [
        "Usage:",
        "tsx src/render.ts <video> <transcript> <start> <end> <theme> <output>",
        "",
        "Example:",
        "tsx src/render.ts input.mp4 input.transcript.json 10 25 pop output.mp4",
      ].join("\n"),
    );
  }

  const [
    videoArgument,
    transcriptArgument,
    startArgument,
    endArgument,
    theme,
    outputArgument,
  ] = args;

  if (
    !THEMES.includes(
      theme as (typeof THEMES)[number],
    )
  ) {
    fail(
      `Invalid Remotion theme: ${theme}\n\nAllowed themes:\n${THEMES.join(
        "\n",
      )}`,
    );
  }

  const videoPath =
    path.resolve(
      videoArgument,
    );

  const transcriptPath =
    path.resolve(
      transcriptArgument,
    );

  const outputPath =
    path.resolve(
      outputArgument,
    );

  const clipStart =
    parseNumber(
      startArgument,
      "clip start",
    );

  const clipEnd =
    parseNumber(
      endArgument,
      "clip end",
    );

  if (
    clipStart < 0 ||
    clipEnd <= clipStart
  ) {
    fail(
      `Invalid clip range: ${clipStart.toFixed(
        3,
      )} -> ${clipEnd.toFixed(
        3,
      )}`,
    );
  }

  if (
    !fs.existsSync(
      videoPath,
    ) ||
    !fs.statSync(
      videoPath,
    ).isFile()
  ) {
    fail(
      `Video file not found:\n${videoPath}`,
    );
  }

  const transcript =
    loadTranscript(
      transcriptPath,
    );

  const captionData =
    buildClipCaptionData(
      transcript,
      clipStart,
      clipEnd,
    );

  validateCaptionData(
    captionData,
  );

  fs.mkdirSync(
    path.dirname(outputPath),
    {
      recursive: true,
    },
  );

  log(
    "==============================================",
  );

  log(
    "SNIP AI — REMOTION PRODUCTION RENDERER",
  );

  log(
    "==============================================",
  );

  log(
    `Video      : ${videoPath}`,
  );

  log(
    `Transcript : ${transcriptPath}`,
  );

  log(
    `Clip range : ${clipStart.toFixed(
      3,
    )}s -> ${clipEnd.toFixed(
      3,
    )}s`,
  );

  log(
    `Duration   : ${(clipEnd - clipStart).toFixed(
      3,
    )}s`,
  );

  log(
    `Theme      : ${theme}`,
  );

  log(
    `Output     : ${outputPath}`,
  );

  const localVideo =
    await createLocalVideoServer(
      videoPath,
    );

  try {
    const serveUrl =
      await bundleRemotion();

    await renderJob(
      {
        id: "single-cli",
        video:
          videoPath,
        transcript:
          transcriptPath,
        start:
          clipStart,
        end:
          clipEnd,
        theme,
        output:
          outputPath,
      },
      serveUrl,
    );

    log("");
    log(
      "==============================================",
    );

    log(
      "SNIP AI — REMOTION RENDER COMPLETE",
    );

    log(
      "==============================================",
    );

    log(
      `Rendered : ${outputPath}`,
    );

    log(
      "==============================================",
    );
  } catch (error) {
    fail(String(error));
  } finally {
    await new Promise<void>(
      (resolve) => {
        localVideo.server.close(
          () => resolve(),
        );
      },
    );
  }
}

async function main() {
  const args =
    process.argv.slice(2);

  if (args[0] === "--worker") {
    await startWorker();
    return;
  }

  await runSingleCli();
}

main().catch(
  (error) => {
    fail(String(error));
  },
);
