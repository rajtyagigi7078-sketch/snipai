import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

type Props = { theme: string };

const previewCache = new Map<string, string>();
const previewRequests = new Map<string, Promise<string>>();

let previewQueue: Promise<unknown> = Promise.resolve();

function queuedRender(theme: string): Promise<string> {
  const cached = previewCache.get(theme);
  if (cached) return Promise.resolve(cached);

  const existing = previewRequests.get(theme);
  if (existing) return existing;

  const job = previewQueue.then(() =>
    invoke<string>("render_caption_preview", { theme }),
  );

  previewQueue = job.then(
    () => undefined,
    () => undefined,
  );

  const request = job
    .then((path) => {
      previewCache.set(theme, path);
      return path;
    })
    .finally(() => {
      previewRequests.delete(theme);
    });

  previewRequests.set(theme, request);
  return request;
}

export default function CaptionThemePreview({ theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [previewPath, setPreviewPath] = useState(
    () => previewCache.get(theme) ?? "",
  );
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let started = false;

    setPreviewPath(previewCache.get(theme) ?? "");
    setError(false);

    const startRendering = () => {
      if (started || cancelled || previewCache.has(theme)) {
        if (previewCache.has(theme)) {
          setPreviewPath(previewCache.get(theme) ?? "");
        }
        return;
      }

      started = true;
      setLoading(true);

      void queuedRender(theme)
        .then((path) => {
          if (!cancelled) setPreviewPath(path);
        })
        .catch((reason) => {
          console.error("Caption preview render failed:", theme, reason);
          if (!cancelled) setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    const element = containerRef.current;

    if (!element || typeof IntersectionObserver === "undefined") {
      startRendering();
    } else {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            startRendering();
            observer.disconnect();
          }
        },
        {
          root: null,
          rootMargin: "80px",
          threshold: 0.01,
        },
      );

      observer.observe(element);

      return () => {
        cancelled = true;
        observer.disconnect();
      };
    }

    return () => {
      cancelled = true;
    };
  }, [theme]);

  if (previewPath) {
    return (
      <div
        ref={containerRef}
        className="caption-engine-preview"
      >
        <video
          ref={videoRef}
          className="caption-engine-preview-video"
          src={convertFileSrc(previewPath)}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="caption-engine-preview caption-engine-preview-placeholder"
    >
      <div className="caption-engine-preview-copy">
        {loading
          ? "Preparing preview…"
          : error
            ? "Preview failed — check renderer"
            : "Preview loads when visible"}
      </div>
    </div>
  );
}