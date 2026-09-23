import { useEffect, useState } from "react";
import CaptionThemePreview from "./CaptionThemePreview";
import "./App.css";

import {
  ArrowLeft,
  Captions,
  Check,
  Clapperboard,
  Clock3,
  ExternalLink,
  FileVideo,
  Film,
  FolderOpen,
  History as HistoryIcon,
  LayoutTemplate,
  Link2,
  LoaderCircle,
  Play,
  RotateCcw,
  Scissors,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  WandSparkles,
} from "lucide-react";

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { supabase } from "./lib/supabase";

import {
  getBillingState,
  startLifetimePayment,
  type BillingState,
} from "./lib/billing";

type Format = "1:1" | "16:9";

const REMOTION_CAPTION_THEMES = [
  { name: "pop", label: "Pop", description: "Clean popup animation with scaling and bounce." },
  { name: "karaoke", label: "Karaoke", description: "Smooth karaoke-style highlight sweep." },
  { name: "hustle", label: "Hustle", description: "Energetic, fast-paced kinetic entrance." },
  { name: "grape", label: "Grape", description: "Rounded purple/accent boxed caption style." },
  { name: "beast", label: "Beast", description: "Bold highlighted style with high-contrast shadows." },
  { name: "poppin", label: "Poppin", description: "Vibrant uppercase Poppins font theme." },
  { name: "aarit", label: "Aarit", description: "Cinematic letter-by-letter zoom and gradient sweep." },
  { name: "soft-ai", label: "Soft AI", description: "Frosted glass and blur-in caption typography." },
  { name: "gaming-stream", label: "Gaming Stream", description: "Neon glowing gaming typography." },
  { name: "simple-one-word", label: "Simple One Word", description: "Clean, single-word focal-point highlight." },
  { name: "kinetic-01", label: "Kinetic 01", description: "Advanced calculated kinetic typography." },
  { name: "kinetic-02", label: "Kinetic 02", description: "Advanced kinetic caption theme." },
  { name: "podcast", label: "Podcast", description: "Podcast-focused caption theme." },
] as const;

type CaptionThemeName =
  (typeof REMOTION_CAPTION_THEMES)[number]["name"];

function isCaptionThemeName(value: string): value is CaptionThemeName {
  return REMOTION_CAPTION_THEMES.some((item) => item.name === value);
}

const processingStages = [
  {
    title: "Preparing video",
    description: "Getting your video ready for processing",
    icon: FileVideo,
  },
  {
    title: "Analyzing content",
    description: "Preparing the source video",
    icon: WandSparkles,
  },
  {
    title: "Finding best moments",
    description: "Selecting initial clip positions",
    icon: Sparkles,
  },
  {
    title: "Creating clips",
    description: "Rendering your clips with FFmpeg",
    icon: Scissors,
  },
  {
    title: "Applying captions",
    description: "Preparing your selected caption style",
    icon: Captions,
  },
  {
    title: "Finalizing",
    description: "Preparing your clips for export",
    icon: Check,
  },
];

function getFileName(path: string) {
  return (
    path.split("/").pop()?.split("\\").pop() ||
    "Selected video"
  );
}


type LocalVideoPreviewProps = {
  path: string;
  index: number;
  onPlay: () => void;
  onPause: () => void;
};

function LocalVideoPreview({
  path,
  index,
  onPlay,
  onPause,
}: LocalVideoPreviewProps) {
  const [blobUrl, setBlobUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";

    async function loadVideo() {
      setLoading(true);
      setError("");
      setBlobUrl("");

      try {
        const assetUrl = convertFileSrc(path);

        console.log(
          `[Snip AI] Loading clip ${index + 1}`,
          assetUrl,
        );

        const response = await fetch(assetUrl, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(
            `HTTP ${response.status} while loading video`,
          );
        }

        const blob = await response.blob();

        if (!blob.size) {
          throw new Error("Video response was empty.");
        }

        if (cancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(
          new Blob([blob], {
            type: blob.type || "video/mp4",
          }),
        );

        console.log(
          `[Snip AI] Clip ${index + 1} loaded`,
          {
            size: blob.size,
            type: blob.type,
          },
        );

        setBlobUrl(objectUrl);
        setLoading(false);
      } catch (err) {
        if (cancelled) {
          return;
        }

        console.error(
          `[Snip AI] Clip ${index + 1} failed`,
          err,
        );

        setLoading(false);
        setError(
          err instanceof Error
            ? err.message
            : "Unable to load preview.",
        );
      }
    }

    loadVideo();

    return () => {
      cancelled = true;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [path, index, retry]);

  if (loading) {
    return (
      <div className="clip-video-loading">
        <div className="clip-video-loading-spinner" />
        <span>Loading preview…</span>
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div className="clip-video-error">
        <div className="clip-video-error-icon">
          <FileVideo size={20} />
        </div>

        <strong>Preview couldn't load</strong>

        <span>{error || "Video preview unavailable."}</span>

        <button
          type="button"
          className="clip-video-retry"
          onClick={(event) => {
            event.stopPropagation();
            setRetry((value) => value + 1);
          }}
        >
          Retry preview
        </button>
      </div>
    );
  }

  return (
    <video
      key={blobUrl}
      src={blobUrl}
      controls
      preload="metadata"
      playsInline
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;

        console.log(
          `[Snip AI] Clip ${index + 1} ready`,
          {
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
          },
        );
      }}
      onCanPlay={() => {
        console.log(
          `[Snip AI] Clip ${index + 1} can play`,
        );
      }}
      onError={(event) => {
        const video = event.currentTarget;

        console.error(
          `[Snip AI] Clip ${index + 1} playback error`,
          {
            code: video.error?.code,
            message: video.error?.message,
          },
        );
      }}
      onPlay={onPlay}
      onPause={onPause}
      onEnded={onPause}
    />
  );
}

const downloadAnimationStyle = `
@keyframes snipDownloadPulse {
  0% { transform: translateX(-180%); opacity: 0.35; }
  50% { transform: translateX(120%); opacity: 1; }
  100% { transform: translateX(280%); opacity: 0.35; }
}
`;


type WorkspacePage = "create" | "projects" | "templates" | "history" | "settings";

type GenerationRecord = {
  id: string;
  createdAt: string;
  videoName: string;
  format: Format;
  template: string;
  clipCount: number;
  paths: string[];
};

const HISTORY_STORAGE_KEY = "snip-ai-generation-history-v1";
const SETTINGS_STORAGE_KEY = "snip-ai-settings-v1";

function readStoredHistory(): GenerationRecord[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatHistoryDate(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function ProjectsPage({
  history,
  onOpenRecord,
  onOpenFolder,
}: {
  history: GenerationRecord[];
  onOpenRecord: (record: GenerationRecord) => void;
  onOpenFolder: (paths: string[]) => void;
}) {
  return (
    <section className="workspace-page">
      <div className="page-header-row">
        <div>
          <p className="eyebrow">PROJECTS</p>
          <h1>Your clipping projects.</h1>
          <p className="subtitle">Every generation is kept locally so you can return to it later.</p>
        </div>
        <div className="page-header-badge"><FolderOpen size={15} /> Local projects</div>
      </div>

      <div className="project-summary-card">
        <div className="project-summary-icon"><Film size={20} /></div>
        <div>
          <strong>{history.length ? `${history.length} saved generation${history.length === 1 ? "" : "s"}` : "No saved generations yet"}</strong>
          <span>{history.length ? "Your recent clip sessions are listed below." : "Generate your first clips from Create and they will appear here."}</span>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="page-empty-state">
          <div className="page-empty-icon"><Clapperboard size={24} /></div>
          <h2>No projects yet</h2>
          <p>Generate a clip set and Snip AI will automatically save the session here.</p>
        </div>
      ) : (
        <div className="project-list">
          {history.map((record) => (
            <article className="project-card" key={record.id}>
              <div className="project-card-icon"><Film size={19} /></div>
              <div className="project-card-main">
                <strong>{record.videoName || "Untitled video"}</strong>
                <span>{record.clipCount} clips · {record.format} · {record.template}</span>
                <small>{formatHistoryDate(record.createdAt)}</small>
              </div>
              <div className="project-card-actions">
                <button type="button" className="secondary-page-button" onClick={() => onOpenRecord(record)}><Play size={14} /> Preview</button>
                <button type="button" className="ghost-page-button" onClick={() => onOpenFolder(record.paths)}><FolderOpen size={14} /> Folder</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function TemplatesPage({
  template,
  onSelect,
  onUse,
}: {
  template: string;
  onSelect: (name: CaptionThemeName) => void;
  onUse: () => void;
}) {
  return (
    <section className="workspace-page">
      <div className="page-header-row">
        <div>
          <p className="eyebrow">TEMPLATES</p>
          <h1>Caption templates.</h1>
          <p className="subtitle">
            Browse all Remotion caption styles and choose the active design for your next generation.
          </p>
        </div>
        <div className="page-header-badge">
          <LayoutTemplate size={15} /> {REMOTION_CAPTION_THEMES.length} styles
        </div>
      </div>

      <div className="remotion-template-library-grid">
        {REMOTION_CAPTION_THEMES.map((item) => (
          <button
            key={item.name}
            type="button"
            className={`remotion-template-library-card ${template === item.name ? "selected" : ""}`}
            onClick={() => onSelect(item.name)}
          >
            <div className="remotion-template-library-preview">
              <CaptionThemePreview theme={item.name} />
            </div>

            <div className="remotion-template-library-footer">
              <div>
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </div>

              {template === item.name && (
                <span className="template-selected-pill">
                  <Check size={11} /> Selected
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      <div className="template-library-action">
        <div>
          <strong>
            Selected:{" "}
            {REMOTION_CAPTION_THEMES.find((item) => item.name === template)?.label ?? template}
          </strong>
          <span>This exact Remotion theme will be used when you generate clips.</span>
        </div>

        <button type="button" className="generate-button" onClick={onUse}>
          <Sparkles size={17} /> Use in Create <span className="button-arrow">→</span>
        </button>
      </div>
    </section>
  );
}


function HistoryPage({
  history,
  onOpenRecord,
  onOpenFolder,
  onClear,
}: {
  history: GenerationRecord[];
  onOpenRecord: (record: GenerationRecord) => void;
  onOpenFolder: (paths: string[]) => void;
  onClear: () => void;
}) {
  return (
    <section className="workspace-page">
      <div className="page-header-row">
        <div>
          <p className="eyebrow">HISTORY</p>
          <h1>Generation history.</h1>
          <p className="subtitle">A local record of the clip sets you have generated in Snip AI.</p>
        </div>
        {history.length > 0 && <button type="button" className="danger-page-button" onClick={onClear}>Clear history</button>}
      </div>

      {history.length === 0 ? (
        <div className="page-empty-state">
          <div className="page-empty-icon"><HistoryIcon size={24} /></div>
          <h2>No generation history</h2>
          <p>Your completed generations will appear here automatically.</p>
        </div>
      ) : (
        <div className="history-list">
          {history.map((record, index) => (
            <article className="history-row" key={record.id}>
              <div className="history-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="history-main">
                <strong>{record.videoName || "Untitled video"}</strong>
                <span>{formatHistoryDate(record.createdAt)} · {record.clipCount} clips · {record.format} · {record.template}</span>
              </div>
              <div className="history-actions">
                <button type="button" className="secondary-page-button" onClick={() => onOpenRecord(record)}><Play size={14} /> Preview</button>
                <button type="button" className="ghost-page-button" onClick={() => onOpenFolder(record.paths)}><FolderOpen size={14} /></button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SettingsPage({
  defaultFormat,
  setDefaultFormat,
  defaultClipCount,
  setDefaultClipCount,
  welcomeTitle,
  setWelcomeTitle,
  welcomeSubtitle,
  setWelcomeSubtitle,
  onReset,
}: {
  defaultFormat: Format;
  setDefaultFormat: (value: Format) => void;
  defaultClipCount: number;
  setDefaultClipCount: (value: number) => void;
  welcomeTitle: string;
  setWelcomeTitle: (value: string) => void;
  welcomeSubtitle: string;
  setWelcomeSubtitle: (value: string) => void;
  onReset: () => void;
}) {
  return (
    <section className="workspace-page settings-page">
      <div className="page-header-row">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>Snip AI settings.</h1>
          <p className="subtitle">Choose the defaults used when you start a new generation. Changes are saved on this computer.</p>
        </div>
        <div className="page-header-badge"><ShieldCheck size={15} /> Local settings</div>
      </div>

      <div className="settings-grid">
        <div className="settings-card">
          <div className="settings-card-title"><div className="settings-card-icon"><Film size={17} /></div><div><strong>Generation defaults</strong><span>Starting values for Create.</span></div></div>
          <label className="settings-label">Default video format</label>
          <div className="settings-choice-row">
            {(["1:1", "16:9"] as Format[]).map((item) => <button type="button" key={item} className={`settings-choice ${defaultFormat === item ? "selected" : ""}`} onClick={() => setDefaultFormat(item)}>{item}</button>)}
          </div>

          <label className="settings-label">Default clip count <strong>{defaultClipCount}</strong></label>
          <input className="settings-range" type="range" min="1" max="10" value={defaultClipCount} onChange={(event) => setDefaultClipCount(Number(event.target.value))} />

          <div className="settings-switch-row">
            <div className="settings-info-note">
              <LayoutTemplate size={16} />
              <div>
                <strong>Remotion caption themes</strong>
                <span>The selected caption theme is used consistently for generated clips.</span>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-card welcome-settings-card">
          <div className="settings-card-title"><div className="settings-card-icon"><Sparkles size={17} /></div><div><strong>Welcome message</strong><span>Customize the message shown when Snip AI opens.</span></div></div>

          <label className="settings-label">Main message</label>
          <input className="welcome-settings-input" value={welcomeTitle} maxLength={42} onChange={(event) => setWelcomeTitle(event.target.value)} placeholder="Welcome master" />

          <label className="settings-label">Today's plan line</label>
          <input className="welcome-settings-input" value={welcomeSubtitle} maxLength={70} onChange={(event) => setWelcomeSubtitle(event.target.value)} placeholder="Aaj ka kya plan hai?" />

          <div className="welcome-settings-preview">
            <span>PREVIEW</span>
            <strong>{welcomeTitle || "Welcome master"}</strong>
            <p>{welcomeSubtitle || "Aaj ka kya plan hai?"}</p>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-title"><div className="settings-card-icon"><FolderOpen size={17} /></div><div><strong>Storage</strong><span>Where Snip AI keeps generated files.</span></div></div>
          <div className="storage-path-box"><span>Generated clips</span><strong>~/Downloads/Snip AI Clips</strong><small>Output location is managed by the local Tauri backend.</small></div>
          <div className="storage-path-box"><span>Downloaded YouTube videos</span><strong>~/Downloads/Snip AI Downloads</strong><small>Downloaded source videos stay on this computer.</small></div>
        </div>
      </div>

      <div className="settings-footer"><span><ShieldCheck size={14} /> Settings are stored locally on this device.</span><button type="button" className="ghost-page-button" onClick={onReset}>Reset defaults</button></div>
    </section>
  );
}

function App() {
  const [accountName, setAccountName] = useState("User");
  const [accountEmail, setAccountEmail] = useState("");

  useEffect(() => {
    let mounted = true;

    const loadAccount = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!mounted || !user) {
          return;
        }

        const metadata = user.user_metadata ?? {};

        const metadataName =
          typeof metadata.full_name === "string"
            ? metadata.full_name.trim()
            : typeof metadata.name === "string"
              ? metadata.name.trim()
              : "";

        const email = user.email ?? "";

        setAccountEmail(email);
        setAccountName(
          metadataName ||
            email.split("@")[0] ||
            "User",
        );
      } catch (error) {
        console.error(
          "[Account] Could not load account:",
          error,
        );
      }
    };

    void loadAccount();

    return () => {
      mounted = false;
    };
  }, []);

  const [format, setFormat] = useState<Format>(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      return raw && JSON.parse(raw).defaultFormat === "16:9" ? "16:9" : "1:1";
    } catch {
      return "1:1";
    }
  });
  const [template, setTemplate] = useState<CaptionThemeName>("pop");
  const [differentCaptions] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      return raw ? JSON.parse(raw).defaultDifferentCaptions !== false : true;
    } catch {
      return true;
    }
  });

  const [dragging, setDragging] = useState(false);
  const [youtubeLink, setYoutubeLink] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [videoName, setVideoName] = useState("");
  const [videoPath, setVideoPath] = useState("");

  const [isProcessing, setIsProcessing] = useState(false);
  const [requestedClips, setRequestedClips] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      const value = Number(raw ? JSON.parse(raw).defaultClipCount : 5);
      return Number.isFinite(value) ? Math.min(10, Math.max(1, value)) : 5;
    } catch {
      return 5;
    }
  });
  const [processingProgress, setProcessingProgress] =
    useState(0);
  const [processingStage, setProcessingStage] = useState(0);

  const [processingComplete, setProcessingComplete] =
    useState(false);

  const [outputPaths, setOutputPaths] = useState<string[]>(
    [],
  );

  const [errorMessage, setErrorMessage] = useState("");
  const [showGallery, setShowGallery] = useState(false);
  const [playingClip, setPlayingClip] = useState<number | null>(
    null,
  );

  const [selectedClips, setSelectedClips] = useState<Set<number>>(
    new Set(),
  );

  const [isExporting, setIsExporting] = useState(false);

  // ----------------------------------------------------------
  // BILLING STATE
  // ----------------------------------------------------------

  const [billing, setBilling] =
    useState<BillingState>({
      active: false,
      status: null,
      priceInr: 100,
      planName: "Snip AI Lifetime",
      isAdmin: false,
    });

  const [billingLoading, setBillingLoading] =
    useState(true);

  const [billingBusy, setBillingBusy] =
    useState(false);


  const [workspacePage, setWorkspacePage] = useState<WorkspacePage>("create");
  const [historyRecords, setHistoryRecords] = useState<GenerationRecord[]>(() => readStoredHistory());
  const [defaultFormat, setDefaultFormat] = useState<Format>(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      return raw && JSON.parse(raw).defaultFormat === "16:9" ? "16:9" : "1:1";
    } catch {
      return "1:1";
    }
  });
  const [defaultClipCount, setDefaultClipCount] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      const value = Number(raw ? JSON.parse(raw).defaultClipCount : 5);
      return Number.isFinite(value) ? Math.min(10, Math.max(1, value)) : 5;
    } catch {
      return 5;
    }
  });
  const [welcomeTitle, setWelcomeTitle] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      const value = raw ? JSON.parse(raw).welcomeTitle : "";
      return typeof value === "string" && value.trim() ? value : "Welcome master";
    } catch {
      return "Welcome master";
    }
  });

  const [welcomeSubtitle, setWelcomeSubtitle] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      const value = raw ? JSON.parse(raw).welcomeSubtitle : "";
      return typeof value === "string" && value.trim() ? value : "Aaj ka kya plan hai?";
    } catch {
      return "Aaj ka kya plan hai?";
    }
  });

  const [showWelcome, setShowWelcome] = useState(true);

  useEffect(() => {
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(historyRecords.slice(0, 30)));
    } catch (error) {
      console.warn("Could not save Snip AI history:", error);
    }
  }, [historyRecords]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
        defaultFormat,
        defaultClipCount,
        welcomeTitle,
        welcomeSubtitle,
      }));
    } catch (error) {
      console.warn("Could not save Snip AI settings:", error);
    }
  }, [defaultFormat, defaultClipCount, welcomeTitle, welcomeSubtitle]);

  const selectedTemplate =
    REMOTION_CAPTION_THEMES.find(
      (item) => item.name === template,
    ) ?? REMOTION_CAPTION_THEMES[0];

  // ----------------------------------------------------------
  // BILLING HELPERS
  // ----------------------------------------------------------

  const refreshBilling = async () => {
    try {
      const nextBilling = await getBillingState();
      setBilling(nextBilling);
      return nextBilling;
    } catch (error) {
      console.error(
        "Could not refresh billing state:",
        error,
      );

      return null;
    } finally {
      setBillingLoading(false);
    }
  };

  useEffect(() => {
    void refreshBilling();

    const interval = window.setInterval(() => {
      void refreshBilling();
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  const handleUpgrade = async () => {
    if (billingBusy || billing.active || billing.isAdmin) {
      return;
    }

    setBillingBusy(true);
    setErrorMessage("");

    try {
      const result = await startLifetimePayment();

      if (result?.active) {
        await refreshBilling();
        return;
      }

      setErrorMessage(
        "Payment is still being verified. Please wait a moment and try again.",
      );
    } catch (error) {
      console.error("[Billing] Lifetime payment failed:", error);

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      setErrorMessage(`Payment error: ${message}`);
    } finally {
      setBillingBusy(false);
      await refreshBilling();
    }
  };

  const navigateTo = (page: WorkspacePage) => {
    if (isProcessing) return;
    setShowGallery(false);
    setProcessingComplete(false);
    setWorkspacePage(page);
    setPlayingClip(null);
  };

  const openHistoryRecord = (record: GenerationRecord) => {
    if (!record.paths.length) return;
    setOutputPaths(record.paths);
    setVideoName(record.videoName);
    setFormat(record.format);
    setTemplate(
      isCaptionThemeName(record.template)
        ? record.template
        : "pop",
    );
    setWorkspacePage("create");
    setShowGallery(true);
    setProcessingComplete(false);
    setPlayingClip(null);
    setSelectedClips(new Set(record.paths.map((_, index) => index)));
  };

  const openHistoryFolder = async (paths: string[]) => {
    if (!paths.length) return;
    try {
      const firstPath = paths[0];
      const lastSlash = Math.max(firstPath.lastIndexOf("/"), firstPath.lastIndexOf("\\"));
      const folderPath = lastSlash > 0 ? firstPath.substring(0, lastSlash) : firstPath;
      await openPath(folderPath);
    } catch (error) {
      console.error("Could not open history folder:", error);
    }
  };

  const clearHistory = () => {
    setHistoryRecords([]);
  };

  const selectVideo = (path: string) => {
    if (!path) {
      return;
    }

    setVideoName(getFileName(path));
    setVideoPath(path);
    setYoutubeLink("");
    setProcessingComplete(false);
    setOutputPaths([]);
    setErrorMessage("");
    setProcessingProgress(0);
    setProcessingStage(0);
    setShowGallery(false);
    setPlayingClip(null);
    setSelectedClips(new Set());
  };

  const handleBrowse = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Choose a video",
        filters: [
          {
            name: "Video",
            extensions: [
              "mp4",
              "mov",
              "mkv",
              "webm",
              "avi",
              "m4v",
              "flv",
            ],
          },
        ],
      });

      if (typeof selected === "string") {
        selectVideo(selected);
      }
    } catch (error) {
      console.error("File picker error:", error);
      window.alert("Could not open the video picker.");
    }
  };

  const handleDrop = (
    event: React.DragEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    setDragging(false);

    const file = event.dataTransfer.files?.[0];

    if (!file) {
      return;
    }

    const tauriFile = file as File & {
      path?: string;
    };

    if (tauriFile.path) {
      selectVideo(tauriFile.path);
      return;
    }

    window.alert(
      "Drag & drop could not read the local file path. Please use Browse file.",
    );
  };

  const handleYoutubeLink = async () => {
    const link = youtubeLink.trim();

    if (!link || isDownloading) {
      return;
    }

    if (
      !link.startsWith("https://www.youtube.com/") &&
      !link.startsWith("https://youtube.com/") &&
      !link.startsWith("https://m.youtube.com/") &&
      !link.startsWith("https://youtu.be/")
    ) {
      setErrorMessage("Please enter a valid YouTube URL.");
      return;
    }

    setErrorMessage("");
    setProcessingComplete(false);
    setOutputPaths([]);
    setProcessingProgress(0);
    setProcessingStage(0);
    setShowGallery(false);
    setPlayingClip(null);
    setSelectedClips(new Set());
    setIsDownloading(true);
    setVideoName("Downloading YouTube video…");
    setVideoPath("");

    // Give React/Tauri time to paint the downloading state before
    // starting the native yt-dlp process.
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 120);
    });

    try {
      const downloadedPath = await invoke<string>("download_youtube", {
        url: link,
      });

      if (!downloadedPath) {
        throw new Error("YouTube download finished without returning a file.");
      }

      selectVideo(downloadedPath);
    } catch (error) {
      console.error("[Snip AI] YouTube download error:", error);

      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "Could not download the YouTube video.";

      setVideoName("");
      setVideoPath("");
      setErrorMessage(message);
    } finally {
      setIsDownloading(false);
    }
  };

  const resetVideo = () => {
    setIsDownloading(false);
    setFormat(defaultFormat);
    setRequestedClips(defaultClipCount);
    setWorkspacePage("create");
    setVideoName("");
    setVideoPath("");
    setYoutubeLink("");
    setProcessingComplete(false);
    setOutputPaths([]);
    setErrorMessage("");
    setProcessingProgress(0);
    setProcessingStage(0);
    setShowGallery(false);
    setPlayingClip(null);
  };

  const startProcessing = async () => {
  if (isDownloading) {
    return;
  }

  if (!videoPath) {
    window.alert(
      "Please select a local video file or paste a YouTube link first.",
    );
    return;
  }

  setErrorMessage("");
  setProcessingComplete(false);
  setOutputPaths([]);
  setShowGallery(false);
  setPlayingClip(null);
  setIsProcessing(true);

  try {
    // --------------------------------------------------------
    // LIFETIME BILLING CHECK
    // --------------------------------------------------------

    const currentBilling = await getBillingState();

    if (!currentBilling.active && !currentBilling.isAdmin) {
      setIsProcessing(false);
      setProcessingProgress(0);
      setProcessingStage(0);

      try {
        const paymentResult = await startLifetimePayment();

        if (!paymentResult?.active) {
          setErrorMessage(
            "Payment was not confirmed yet. Please complete the ₹100 lifetime payment and try again.",
          );
          return;
        }
      } catch (paymentError) {
        console.error(
          "Lifetime payment error:",
          paymentError,
        );

        const paymentMessage =
          paymentError instanceof Error
            ? paymentError.message
            : "Payment could not be started.";

        setErrorMessage(paymentMessage);
        return;
      }
    }

    // --------------------------------------------------------
    // EXISTING SNIP AI PROCESSING PIPELINE
    // --------------------------------------------------------

    setIsProcessing(true);

    setProcessingStage(0);
    setProcessingProgress(8);

    await new Promise((resolve) =>
      setTimeout(resolve, 300),
    );

    setProcessingStage(1);
    setProcessingProgress(20);

    await new Promise((resolve) =>
      setTimeout(resolve, 300),
    );

    setProcessingStage(2);
    setProcessingProgress(35);

    await new Promise((resolve) =>
      setTimeout(resolve, 300),
    );

    setProcessingStage(3);
    setProcessingProgress(50);

    const result = await invoke<string[]>(
      "create_clips",
      {
        inputPath: videoPath,
        format,
        requestedClips,
        captionTemplate: template,
        differentCaptions,
      },
    );

    if (!result || result.length === 0) {
      throw new Error(
        "The pipeline finished without generating any valid clips.",
      );
    }

    setOutputPaths(result);

    setProcessingStage(4);
    setProcessingProgress(82);

    await new Promise((resolve) =>
      setTimeout(resolve, 400),
    );

    setProcessingStage(5);
    setProcessingProgress(96);

    await new Promise((resolve) =>
      setTimeout(resolve, 400),
    );

    setProcessingProgress(100);

    setHistoryRecords((previous) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        videoName: videoName || "Untitled video",
        format,
        template,
        clipCount: result.length,
        paths: result,
      },
      ...previous.filter(
        (item) =>
          item.paths.join("|") !== result.join("|"),
      ),
    ].slice(0, 30));

    await new Promise((resolve) =>
      setTimeout(resolve, 500),
    );

    setIsProcessing(false);
    setProcessingComplete(true);
  } catch (error) {
    console.error(
      "Clip generation error:",
      error,
    );

    const message =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "Something went wrong while generating the clips.";

    setErrorMessage(message);
    setIsProcessing(false);
    setProcessingProgress(0);
    setProcessingStage(0);
  }
};;

  const openClipsFolder = async () => {
    if (outputPaths.length === 0) {
      return;
    }

    try {
      const firstPath = outputPaths[0];

      const lastSlash = Math.max(
        firstPath.lastIndexOf("/"),
        firstPath.lastIndexOf("\\"),
      );

      const folderPath =
        lastSlash > 0
          ? firstPath.substring(0, lastSlash)
          : firstPath;

      await openPath(folderPath);
    } catch (error) {
      console.error(
        "Could not open clips folder:",
        error,
      );
    }
  };

  const openGallery = () => {
    if (outputPaths.length === 0) {
      return;
    }

    setProcessingComplete(false);
    setShowGallery(true);
    setPlayingClip(null);
    setSelectedClips(
      new Set(outputPaths.map((_, index) => index)),
    );
  };

  const closeGallery = () => {
    setShowGallery(false);
    setPlayingClip(null);
  };

  const toggleClipSelection = (index: number) => {
    setSelectedClips((previous) => {
      const next = new Set(previous);

      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }

      return next;
    });
  };

  const selectAllClips = () => {
    setSelectedClips(
      new Set(outputPaths.map((_, index) => index)),
    );
  };

  const clearClipSelection = () => {
    setSelectedClips(new Set());
  };

  const exportSelectedClips = async () => {
    const selectedPaths = outputPaths.filter((_, index) =>
      selectedClips.has(index),
    );

    if (selectedPaths.length === 0) {
      return;
    }

    try {
      setIsExporting(true);

      const destination = await open({
        directory: true,
        multiple: false,
        title: "Choose export folder",
      });

      if (typeof destination !== "string" || !destination) {
        return;
      }

      await invoke("export_clips", {
        inputPaths: selectedPaths,
        destinationDir: destination,
      });

      window.alert(
        `${selectedPaths.length} clip${
          selectedPaths.length === 1 ? "" : "s"
        } exported successfully.`,
      );
    } catch (error) {
      console.error("Clip export error:", error);

      window.alert(
        "Could not export the selected clips.",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleVideoPlay = (index: number) => {
    setPlayingClip(index);
  };

  const handleVideoPause = () => {
    setPlayingClip(null);
  };

  const createAnother = () => {
    resetVideo();
  };

  return (
    <>
      <style>{downloadAnimationStyle}</style>
      <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles
              size={17}
              strokeWidth={2.4}
            />
          </div>

          <span>Snip AI</span>
        </div>

        <div className="sidebar-section">
          <p className="section-label">
            WORKSPACE
          </p>

          <button type="button" className={`nav-item ${workspacePage === "create" ? "active" : ""}`} onClick={() => navigateTo("create")}>
            <Clapperboard size={18} />
            <span>Create</span>
          </button>

          <button type="button" className={`nav-item ${workspacePage === "projects" ? "active" : ""}`} onClick={() => navigateTo("projects")}>
            <FolderOpen size={18} />
            <span>Projects</span>
          </button>

          <button type="button" className={`nav-item ${workspacePage === "templates" ? "active" : ""}`} onClick={() => navigateTo("templates")}>
            <LayoutTemplate size={18} />
            <span>Templates</span>
          </button>

          <button type="button" className={`nav-item ${workspacePage === "history" ? "active" : ""}`} onClick={() => navigateTo("history")}>
            <HistoryIcon size={18} />
            <span>History</span>
          </button>
        </div>

        <div className="sidebar-bottom">
          <button type="button" className={`nav-item ${workspacePage === "settings" ? "active" : ""}`} onClick={() => navigateTo("settings")}>
            <Settings size={18} />
            <span>Settings</span>
          </button>

          <div
            className={`access-card ${
              billing.active
                ? "access-card-active"
                : "access-card-locked"
            }`}
          >
            <div className="access-top">
              <span
                className={`status-dot ${
                  billing.active
                    ? "status-dot-active"
                    : "status-dot-locked"
                }`}
              />

              <span>
                {billingLoading
                  ? "Checking access…"
                  : billing.isAdmin
                    ? "Unlimited generation"
                    : billing.active
                      ? "Generation active"
                      : "Generation locked"}
              </span>
            </div>

            {billing.isAdmin ? (
              <>
                <div className="access-admin-title">
                  Unlimited
                </div>

                <div className="access-admin-subtitle">
                  Admin / Owner account
                </div>
              </>
            ) : billing.active ? (
              <>
                <div className="access-days">
                  <strong>Lifetime</strong>
                  <span>access active</span>
                </div>

                <div className="access-plan-name">
                  {billing.planName}
                </div>
              </>
            ) : (
              <>
                <div className="access-days">
                  <strong>
                    ₹{billing.priceInr}
                  </strong>

                  <span>one-time payment</span>
                </div>

                <div className="access-plan-name">
                  {billing.planName}
                </div>

                <button
                  type="button"
                  className="access-upgrade-button"
                  onClick={handleUpgrade}
                  disabled={billingBusy}
                >
                  {billingBusy
                    ? "Opening payment…"
                    : "Pay ₹100 & Activate Lifetime"}
                </button>
              </>
            )}
          </div>

          <div className="profile">
            <div className="avatar">
              {(accountName.trim().charAt(0) || "U").toUpperCase()}
            </div>

            <div className="profile-info">
              <strong>{accountName}</strong>
              <span>{accountEmail || "Personal account"}</span>
            </div>

            <button
              type="button"
              className="profile-logout-button"
              onClick={async () => {
                const { error } =
                  await supabase.auth.signOut();

                if (error) {
                  console.error(
                    "[Account] Logout failed:",
                    error,
                  );
                  window.alert(
                    "Could not log out. Please try again.",
                  );
                }
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {showGallery ? (
          <section className="gallery-view">
            <header className="gallery-header">
              <div>
                <button
                  className="gallery-back-button"
                  onClick={closeGallery}
                >
                  <ArrowLeft size={16} />
                  Back to create
                </button>

                <p className="eyebrow gallery-eyebrow">
                  OUTPUT
                </p>

                <h1>Your clips are ready.</h1>

                <p className="subtitle">
                  Preview your generated clips
                  directly inside Snip AI.
                </p>
              </div>

              <div className="gallery-header-actions">
                <button
                  type="button"
                  className="gallery-header-action-button gallery-header-export"
                  onClick={exportSelectedClips}
                  disabled={
                    selectedClips.size === 0 ||
                    isExporting
                  }
                >
                  {isExporting ? (
                    <>
                      <LoaderCircle
                        size={14}
                        className="button-spinner"
                      />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <ExternalLink size={14} />
                      Export all
                    </>
                  )}
                </button>

                <button
                  type="button"
                  className="gallery-header-action-button gallery-header-generate"
                  onClick={createAnother}
                >
                  <Sparkles size={14} />
                  Generate another
                </button>

                <div className="gallery-count">
                  <Film size={15} />
                  {outputPaths.length} clips
                </div>

                <button
                  className="gallery-select-button"
                  onClick={selectAllClips}
                  disabled={
                    selectedClips.size ===
                    outputPaths.length
                  }
                >
                  <Check size={14} />
                  Select all
                </button>

                <button
                  className="gallery-clear-button"
                  onClick={clearClipSelection}
                  disabled={
                    selectedClips.size === 0
                  }
                >
                  Clear
                </button>

                <button
                  className="folder-action-button"
                  onClick={openClipsFolder}
                >
                  <FolderOpen size={15} />
                  Open folder
                </button>
              </div>
            </header>

            <div className="gallery-grid">
              {outputPaths.map(
                (path, index) => {
                  return (
                    <article
                      className={`clip-card ${
                        playingClip === index
                          ? "playing"
                          : ""
                      } ${
                        selectedClips.has(index)
                          ? "selected"
                          : ""
                      }`}
                      key={path}
                    >
                      <div className="clip-preview">
                        <LocalVideoPreview
                          path={path}
                          index={index}
                          onPlay={() =>
                            handleVideoPlay(index)
                          }
                          onPause={() =>
                            handleVideoPause()
                          }
                        />

                        <button
                          type="button"
                          className={`clip-select-control ${
                            selectedClips.has(index)
                              ? "selected"
                              : ""
                          }`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleClipSelection(index);
                          }}
                          aria-label={`${
                            selectedClips.has(index)
                              ? "Deselect"
                              : "Select"
                          } clip ${index + 1}`}
                          title={
                            selectedClips.has(index)
                              ? "Deselect clip"
                              : "Select clip"
                          }
                        >
                          {selectedClips.has(index) && (
                            <Check size={12} />
                          )}
                        </button>

                        <div className="clip-number">
                          CLIP{" "}
                          {String(index + 1).padStart(
                            2,
                            "0",
                          )}
                        </div>

                        <button
                          type="button"
                          className={`clip-play-hint ${
                            playingClip === index
                              ? "playing"
                              : ""
                          }`}
                          onClick={async (event) => {
                            event.stopPropagation();

                            const preview =
                              event.currentTarget
                                .parentElement;

                            const video =
                              preview?.querySelector(
                                "video",
                              ) as HTMLVideoElement | null;

                            if (!video) {
                              console.error(
                                `[Snip AI] Clip ${index + 1}: video element not found`,
                              );
                              return;
                            }

                            try {
                              if (
                                video.paused ||
                                video.ended
                              ) {
                                await video.play();
                              } else {
                                video.pause();
                              }
                            } catch (error) {
                              console.error(
                                `[Snip AI] Clip ${index + 1}: play() failed`,
                                error,
                              );
                            }
                          }}
                          aria-label={
                            playingClip === index
                              ? `Pause clip ${index + 1}`
                              : `Play clip ${index + 1}`
                          }
                          title={
                            playingClip === index
                              ? "Pause"
                              : "Play"
                          }
                        >
                          <div>
                            {playingClip === index ? (
                              <>
                                <span className="clip-pause-bar" />
                                <span className="clip-pause-bar" />
                              </>
                            ) : (
                              <Play
                                size={19}
                                fill="currentColor"
                              />
                            )}
                          </div>
                        </button>
                      </div>

                      <div className="clip-card-footer">
                        <div>
                          <strong>
                            Clip{" "}
                            {String(index + 1).padStart(
                              2,
                              "0",
                            )}
                          </strong>

                          <span>
                            {format} ·{" "}
                            {selectedTemplate.name}
                          </span>
                        </div>

                        <button
                          className="clip-folder-button"
                          onClick={
                            openClipsFolder
                          }
                          title="Open output folder"
                        >
                          <ExternalLink
                            size={14}
                          />
                        </button>
                      </div>
                    </article>
                  );
                },
              )}
            </div>

            <div className="gallery-bottom">
              <button
                className="gallery-export-visible-button"
                onClick={exportSelectedClips}
                disabled={selectedClips.size === 0 || isExporting}
              >
                {isExporting ? (
                  <>
                    <LoaderCircle
                      size={16}
                      className="button-spinner"
                    />
                    Exporting...
                  </>
                ) : (
                  <>
                    <ExternalLink size={16} />
                    Export all
                  </>
                )}
              </button>

              <button
                className="primary-complete-button"
                onClick={createAnother}
              >
                <Sparkles size={15} />
                Generate another
              </button>
            </div>

            <div className="gallery-export-bar">
              <div className="gallery-export-info">
                <div className="gallery-export-icon">
                  <Film size={17} />
                </div>

                <div>
                  <strong>
                    {selectedClips.size ===
                    outputPaths.length
                      ? "All clips selected"
                      : `${selectedClips.size} clip${
                          selectedClips.size === 1
                            ? ""
                            : "s"
                        } selected`}
                  </strong>

                  <span>
                    Choose where to save your generated clips
                  </span>
                </div>
              </div>

              <div className="gallery-export-actions">
                <button
                  className="gallery-export-clear"
                  onClick={clearClipSelection}
                  disabled={
                    selectedClips.size === 0 ||
                    isExporting
                  }
                >
                  Clear selection
                </button>

                <button
                  className="gallery-export-button"
                  onClick={exportSelectedClips}
                  disabled={
                    selectedClips.size === 0 ||
                    isExporting
                  }
                >
                  {isExporting ? (
                    <>
                      <LoaderCircle
                        size={16}
                        className="button-spinner"
                      />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <ExternalLink size={16} />
                      {selectedClips.size ===
                      outputPaths.length
                        ? "Export all"
                        : `Export ${selectedClips.size} selected`}
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>
        ) : (workspacePage === "create" ? (
          <>
            <header className="topbar">
              <div>
                <p className="eyebrow">
                  CREATE
                </p>

                <h1>
                  Turn long videos into clips.
                </h1>

                <p className="subtitle">
                  Snip AI finds the moments worth
                  sharing and turns them into
                  ready-to-post shorts.
                </p>
              </div>

              <div className="topbar-actions">
                <button
                  className="icon-button"
                  aria-label="notifications"
                >
                  <span className="notification-dot" />
                  <Clock3 size={18} />
                </button>

                <div className="secure-badge">
                  <ShieldCheck size={15} />
                  Local processing
                </div>
              </div>
            </header>

            <section className="workspace">
              <div
                className={`drop-zone ${
                  dragging ? "dragging" : ""
                } ${
                  videoName ? "has-video" : ""
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() =>
                  setDragging(false)
                }
                onDrop={handleDrop}
              >
                <div className="drop-icon">
                  {isDownloading ? (
                    <LoaderCircle
                      size={23}
                      className="button-spinner"
                    />
                  ) : videoName ? (
                    <Check size={23} />
                  ) : (
                    <Upload size={23} />
                  )}
                </div>

                <h2>
                  {isDownloading
                    ? "Downloading YouTube video…"
                    : videoName
                      ? "Video ready"
                      : "Drop your video here"}
                </h2>

                <p>
                  {isDownloading
                    ? "Fetching your video from YouTube. Please wait…"
                    : videoName
                      ? videoName
                      : "Drag & drop a video file, or paste a YouTube link"}
                </p>

                {!videoName && (
                  <>
                    <div className="youtube-input-wrap">
                      {isDownloading ? (
                        <LoaderCircle
                          size={15}
                          className="button-spinner"
                        />
                      ) : (
                        <Link2 size={15} />
                      )}

                      <input
                        type="text"
                        value={youtubeLink}
                        onChange={(event) =>
                          setYoutubeLink(
                            event.target.value,
                          )
                        }
                        onKeyDown={(event) => {
                          if (
                            event.key ===
                            "Enter"
                          ) {
                            void handleYoutubeLink();
                          }
                        }}
                        placeholder={
                          isDownloading
                            ? "Downloading YouTube video…"
                            : "Paste YouTube link"
                        }
                        aria-label="Paste YouTube link"
                        disabled={isDownloading}
                      />
                    </div>

                    <div className="upload-divider">
                      <span>or</span>
                    </div>

                    <div className="browse-row">
                      <button
                        className="primary-small"
                        onClick={handleBrowse}
                        disabled={isDownloading}
                      >
                        <FolderOpen size={16} />
                        Browse file
                      </button>
                    </div>
                  </>
                )}

                {videoName && !isDownloading && (
                  <button
                    className="change-video-button"
                    onClick={resetVideo}
                  >
                    Choose another video
                  </button>
                )}

                {isDownloading && (
                  <div
                    className="youtube-download-status"
                    style={{
                      width: "100%",
                      maxWidth: "430px",
                      margin: "14px auto 0",
                      padding: "12px 14px",
                      border: "1px solid rgba(143, 125, 255, 0.18)",
                      borderRadius: "10px",
                      background: "rgba(143, 125, 255, 0.06)",
                      textAlign: "left",
                      boxSizing: "border-box",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "9px",
                        fontSize: "12px",
                        fontWeight: 600,
                      }}
                    >
                      <LoaderCircle
                        size={14}
                        className="button-spinner"
                      />
                      <span>Downloading from YouTube…</span>
                    </div>

                    <div
                      style={{
                        marginTop: "9px",
                        height: "4px",
                        overflow: "hidden",
                        borderRadius: "999px",
                        background: "rgba(255,255,255,0.08)",
                      }}
                    >
                      <div
                        style={{
                          width: "38%",
                          height: "100%",
                          borderRadius: "999px",
                          background: "linear-gradient(90deg, #8f7dff, #b6a9ff, #8f7dff)",
                          animation: "snipDownloadPulse 1.35s ease-in-out infinite",
                        }}
                      />
                    </div>

                    <span
                      style={{
                        display: "block",
                        marginTop: "7px",
                        fontSize: "10px",
                        color: "rgba(255,255,255,0.46)",
                      }}
                    >
                      Fetching video file. This may take a moment.
                    </span>
                  </div>
                )}

                <div className="upload-note">
                  Processing happens locally
                  on your computer
                </div>
              </div>

              <div className="options-grid">
                <div className="option-card">
                  <div className="option-heading">
                    <div>
                      <span className="option-title">
                        Video format
                      </span>

                      <span className="option-description">
                        Choose your final frame
                      </span>
                    </div>
                  </div>

                  <div className="format-options">
                    {(
                      ["1:1", "16:9"] as Format[]
                    ).map((item) => (
                      <button
                        key={item}
                        className={`format-button ${
                          format === item
                            ? "selected"
                            : ""
                        }`}
                        onClick={() =>
                          setFormat(item)
                        }
                      >
                        <div
                          className={`format-preview format-${item.replace(
                            ":",
                            "-",
                          )}`}
                        >
                          <span />
                        </div>

                        <span>{item}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="option-card caption-card remotion-caption-card">
                  <div className="option-heading">
                    <div>
                      <span className="option-title">Caption template</span>
                      <span className="option-description">
                        Choose one of the 13 Remotion caption themes
                      </span>
                    </div>

                    <div className="selected-template-name">
                      {selectedTemplate.label}
                    </div>
                  </div>

                  <div className="remotion-create-template-carousel">
                    <div className="remotion-create-template-track">
                      {REMOTION_CAPTION_THEMES.map((item) => (
                        <button
                          key={item.name}
                          type="button"
                          className={`remotion-create-template-card ${template === item.name ? "selected" : ""}`}
                          onClick={() => setTemplate(item.name as CaptionThemeName)}
                        >
                          <div className="remotion-create-template-preview">
                            <CaptionThemePreview theme={item.name} />
                          </div>

                          <div className="remotion-create-template-footer">
                            <span>{item.label}</span>
                            {template === item.name && (
                              <span className="template-check">
                                <Check size={10} />
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="template-scroll-hint">
                    ← Scroll to explore all 13 Remotion styles →
                  </div>

                  <div className="caption-theme-selected-note">
                    <LayoutTemplate size={17} />
                    <div>
                      <strong>{selectedTemplate.label} selected</strong>
                      <span>
                        The exact selected theme will be rendered on every generated clip.
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {errorMessage && (
                <div className="processing-error">
                  <strong>
                    Processing failed
                  </strong>
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="clip-count-selector">
                <div className="clip-count-header">
                  <div>
                    <strong>Number of clips</strong>
                    <span>Choose how many AI clips to generate</span>
                  </div>

                  <div className="clip-count-value">
                    {requestedClips}
                  </div>
                </div>

                <div className="clip-count-options">
                  {Array.from(
                    { length: 10 },
                    (_, index) => {
                      const count = index + 1;

                      return (
                        <button
                          key={count}
                          type="button"
                          className={
                            requestedClips === count
                              ? "clip-count-button active"
                              : "clip-count-button"
                          }
                          onClick={() =>
                            setRequestedClips(count)
                          }
                          disabled={isProcessing}
                        >
                          {count}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>

              <div className="generate-row">
                <div className="generation-info">
                  <div className="mini-icon">
                    <Sparkles size={15} />
                  </div>

                  <div>
                    <strong>
                      Up to 10 clips
                    </strong>
                    <span>
                      AI-selected moments
                    </span>
                  </div>
                </div>

                <button
                  className="generate-button"
                  onClick={startProcessing}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <LoaderCircle
                        size={18}
                        className="button-spinner"
                      />
                      Processing
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      {billing.active
                        ? "Generate clips"
                        : "Unlock & generate"}
                      <span className="button-arrow">
                        →
                      </span>
                    </>
                  )}
                </button>
              </div>
            </section>

            <div className="bottom-hint">
              <Play size={13} />
              Your original video stays on
              your computer.
            </div>
          </>
        ) : (workspacePage === "projects" ? (
          <ProjectsPage
            history={historyRecords}
            onOpenRecord={openHistoryRecord}
            onOpenFolder={openHistoryFolder}
          />
        ) : workspacePage === "templates" ? (
          <TemplatesPage
            template={template}
            onSelect={setTemplate}
            onUse={() => navigateTo("create")}
          />
        ) : workspacePage === "history" ? (
          <HistoryPage
            history={historyRecords}
            onOpenRecord={openHistoryRecord}
            onOpenFolder={openHistoryFolder}
            onClear={clearHistory}
          />
        ) : workspacePage === "settings" ? (
          <SettingsPage
            defaultFormat={defaultFormat}
            setDefaultFormat={setDefaultFormat}
            defaultClipCount={defaultClipCount}
            setDefaultClipCount={setDefaultClipCount}
            welcomeTitle={welcomeTitle}
            setWelcomeTitle={setWelcomeTitle}
            welcomeSubtitle={welcomeSubtitle}
            setWelcomeSubtitle={setWelcomeSubtitle}
            onReset={() => {
              setDefaultFormat("1:1");
              setDefaultClipCount(5);
              setWelcomeTitle("Welcome master");
              setWelcomeSubtitle("Aaj ka kya plan hai?");
            }}
          />
        ) : null))}

        {isProcessing && (
          <div className="processing-overlay">
            <div className="processing-panel">
              <div className="processing-top">
                <div className="processing-logo">
                  <Sparkles size={21} />
                </div>

                <div className="processing-heading">
                  <span>SNIP AI</span>

                  <h2>
                    Creating your clips
                  </h2>

                  <p>
                    Snip AI is processing your
                    video locally on your
                    computer.
                  </p>
                </div>

                <div className="processing-percent">
                  {processingProgress}%
                </div>
              </div>

              <div className="processing-progress">
                <div
                  className="processing-progress-fill"
                  style={{
                    width: `${processingProgress}%`,
                  }}
                />
              </div>

              <div className="processing-current">
                <div className="processing-current-icon">
                  {(() => {
                    const Icon =
                      processingStages[
                        processingStage
                      ].icon;

                    return <Icon size={19} />;
                  })()}
                </div>

                <div>
                  <strong>
                    {
                      processingStages[
                        processingStage
                      ].title
                    }
                  </strong>

                  <span>
                    {
                      processingStages[
                        processingStage
                      ].description
                    }
                  </span>
                </div>

                <LoaderCircle
                  size={17}
                  className="stage-spinner"
                />
              </div>

              <div className="processing-stages">
                {processingStages.map(
                  (stage, index) => {
                    const StageIcon =
                      stage.icon;

                    const completed =
                      index <
                      processingStage;

                    const active =
                      index ===
                      processingStage;

                    return (
                      <div
                        className={`processing-stage ${
                          completed
                            ? "completed"
                            : ""
                        } ${
                          active
                            ? "active"
                            : ""
                        }`}
                        key={stage.title}
                      >
                        <div className="stage-icon">
                          {completed ? (
                            <Check size={13} />
                          ) : (
                            <StageIcon
                              size={13}
                            />
                          )}
                        </div>

                        <span>
                          {stage.title}
                        </span>

                        {index !==
                          processingStages.length -
                            1 && (
                          <div className="stage-line" />
                        )}
                      </div>
                    );
                  },
                )}
              </div>

              <div className="processing-footer">
                <span>
                  <ShieldCheck size={13} />
                  Processing locally on your
                  computer
                </span>

                <span>{videoName}</span>
              </div>
            </div>
          </div>
        )}

        {processingComplete && (
          <div className="processing-overlay complete-overlay">
            <div className="complete-panel">
              <div className="complete-icon">
                <Check size={30} />
              </div>

              <span className="complete-eyebrow">
                ALL DONE
              </span>

              <h2>
                Your clips are ready.
              </h2>

              <p>
                Snip AI generated{" "}
                <strong>
                  {outputPaths.length}
                </strong>{" "}
                real clip
                {outputPaths.length === 1
                  ? ""
                  : "s"} in{" "}
                <strong>{format}</strong>{" "}
                format.
              </p>

              <div className="complete-stats">
                <div>
                  <strong>
                    {outputPaths.length}
                  </strong>
                  <span>
                    clips generated
                  </span>
                </div>

                <div>
                  <strong>{format}</strong>
                  <span>video format</span>
                </div>

                <div>
                  <strong>
                    {selectedTemplate.name}
                  </strong>
                  <span>caption style</span>
                </div>
              </div>

              <div className="output-path-box">
                <span>Saved locally</span>

                <strong>
                  Your generated clips are ready
                  to preview.
                </strong>
              </div>

              <div className="complete-actions">
                <button
                  className="secondary-complete-button"
                  onClick={createAnother}
                >
                  <RotateCcw size={16} />
                  Create another
                </button>

                <button
                  className="primary-complete-button"
                  onClick={openGallery}
                  disabled={
                    outputPaths.length === 0
                  }
                >
                  <Play size={16} />
                  Preview clips
                </button>
              </div>
            </div>
          </div>
        )}

        {showWelcome && (
          <div className="welcome-overlay" role="dialog" aria-modal="true" aria-label="Welcome to Snip AI">
            <div className="welcome-backdrop" />
            <div className="welcome-glow welcome-glow-one" />
            <div className="welcome-glow welcome-glow-two" />
            <div className="welcome-modal">
              <div className="welcome-modal-icon"><Sparkles size={22} /></div>
              <span className="welcome-modal-eyebrow">SNIP AI</span>
              <h2>{welcomeTitle || "Welcome master"}</h2>
              <p>{welcomeSubtitle || "Aaj ka kya plan hai?"}</p>
              <button type="button" className="welcome-continue-button" onClick={() => setShowWelcome(false)}>
                Let's create <span>→</span>
              </button>
            </div>
          </div>
        )}
      </main>
      </div>
    </>
  );
}

export default App;
