import { useEffect, useRef, useState } from "react";
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
  X,
} from "lucide-react";

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { supabase } from "./lib/supabase";

import LicenseActivation from "./LicenseActivation";

type Format = "1:1" | "16:9";

const CAPTION_STYLES = [
  { name: "pop", label: "Pop", description: "Word-by-word pop with a quick scale-up." },
  { name: "bold-center", label: "Bold Center", description: "One bold word at a time, centered and static." },
  { name: "bounce", label: "Steady Highlight", description: "Pink active-word highlight with a soft fade; captions stay anchored." },
  { name: "highlight-box", label: "Teal Highlight Box", description: "White active word on a deep teal highlight." },
  { name: "karaoke", label: "Karaoke", description: "League Spartan; each spoken word instantly fills with electric cyan." },
  { name: "minimal", label: "Minimal Fade", description: "One clean word at a time with a gentle fade and no position changes." },
  { name: "podcast", label: "Podcast", description: "A fixed dark word panel; yellow color follows the spoken word without movement." },
  { name: "typewriter", label: "Typewriter", description: "Retro condensed Teko lettering revealed character by character." },
  { name: "kinetic", label: "Kinetic", description: "Oswald two-line groups with steady cyan word highlighting and no vertical movement." },
  { name: "punch", label: "Punch", description: "Comic-book stamp motion, directional slide, and alternating neon red/yellow words." },
  { name: "yellow-stack", label: "Sunny Stack", description: "Bold yellow two-line captions, like your first reference." },
  { name: "violet-pill", label: "Violet Pill", description: "White words with a violet active-word pill." },
  { name: "dual-line", label: "Dual-Line Lyric", description: "A bold gold line followed by the next line in a softer contrasting style." },
  { name: "bold-karaoke", label: "Reel Karaoke", description: "Compact uppercase captions; the yellow active word fades in without popping." },
  { name: "soft-lyric", label: "Soft Lyric", description: "Smaller centered lyrics with a gentle fade and no bouncing." },
] as const;

type CaptionThemeName =
  (typeof CAPTION_STYLES)[number]["name"];

function isCaptionThemeName(value: string): value is CaptionThemeName {
  return CAPTION_STYLES.some((item) => item.name === value);
}

const captionProcessingStages = [
  { title: "Transcribing audio", description: "Creating word timings locally with Whisper", icon: Captions },
  { title: "Rendering captions", description: "Applying the selected FFmpeg caption style", icon: WandSparkles },
  { title: "Validating full video", description: "Checking the completed captioned file", icon: Check },
];

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
        <span>Loading previewâ€¦</span>
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


type WorkspacePage = "auto-clipping" | "auto-caption" | "projects" | "templates" | "history" | "settings";
type GenerationRecord = {
  id: string;
  createdAt: string;
  videoName: string;
  format: Format;
  template: string;
  clipCount: number;
  paths: string[];
  kind?: "clips" | "caption";
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
                <span>{record.clipCount} clips Â· {record.format} Â· {record.template}</span>
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
            Browse all FFmpeg caption styles and choose the active design for your next generation.
          </p>
        </div>
        <div className="page-header-badge">
          <LayoutTemplate size={15} /> {CAPTION_STYLES.length} styles
        </div>
      </div>

      <div className="remotion-template-library-grid">
        {CAPTION_STYLES.map((item) => (
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
            {CAPTION_STYLES.find((item) => item.name === template)?.label ?? template}
          </strong>
          <span>This caption style will be used when you generate clips. The preview is illustrative; final video timing and effects are rendered by FFmpeg.</span>
        </div>

        <button type="button" className="generate-button" onClick={onUse}>
          <Sparkles size={17} /> Use in Create
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
                 <span>{formatHistoryDate(record.createdAt)} Â· {record.clipCount} clips Â· {record.format} Â· {record.template}</span>
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
                <strong>FFmpeg caption styles</strong>
                <span>The selected caption theme is used consistently for generated clips.</span>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-card welcome-settings-card">
          <div className="settings-card-title"><div className="settings-card-icon"><Sparkles size={17} /></div><div><strong>Welcome message</strong><span>Customize the message shown when Snip AI opens.</span></div></div>

          <label className="settings-label">Main message</label>
          <input className="welcome-settings-input" value={welcomeTitle} maxLength={42} onChange={(event) => setWelcomeTitle(event.target.value)} placeholder="Welcome to Snip AI" />

          <label className="settings-label">Today's plan line</label>
          <input className="welcome-settings-input" value={welcomeSubtitle} maxLength={70} onChange={(event) => setWelcomeSubtitle(event.target.value)} placeholder="Ready to create your next clips?" />

          <div className="welcome-settings-preview">
            <span>PREVIEW</span>
            <strong>{welcomeTitle || "Welcome to Snip AI"}</strong>
            <p>{welcomeSubtitle || "Ready to create your next clips?"}</p>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-title"><div className="settings-card-icon"><FolderOpen size={17} /></div><div><strong>Storage</strong><span>Where Snip AI keeps generated files.</span></div></div>
          <div className="storage-path-box"><span>Generated clips</span><strong>~/Downloads/Snip AI Clips</strong><small>Output location is managed by the local Tauri backend.</small></div>
          <div className="storage-path-box"><span>Downloaded YouTube videos</span><strong>~/Downloads/Snip AI Downloads</strong><small>Downloaded source videos stay on this computer.</small></div>
        </div>
      </div>

      <LicenseActivation />

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
  const [audioLanguage, setAudioLanguage] = useState<"english" | "hinglish">("hinglish");
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
  const downloadInFlightRef = useRef(false);
  const [videoName, setVideoName] = useState("");
  const [videoPath, setVideoPath] = useState("");
  const videoPathRef = useRef("");

  const [isProcessing, setIsProcessing] = useState(false);
  const [isCanceling, setIsCanceling] = useState(false);
  const cancelRequestedRef = useRef(false);
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
  const [processingDetail, setProcessingDetail] = useState("");

  const [processingComplete, setProcessingComplete] =
    useState(false);

  const [outputPaths, setOutputPaths] = useState<string[]>(
    [],
  );

  const [errorMessage, setErrorMessage] = useState("");
  const [showGallery, setShowGallery] = useState(false);
  const [outputKind, setOutputKind] = useState<"clips" | "caption">("clips");
  const activeProcessingStages = outputKind === "caption" ? captionProcessingStages : processingStages;
  const [playingClip, setPlayingClip] = useState<number | null>(
    null,
  );

  const [selectedClips, setSelectedClips] = useState<Set<number>>(
    new Set(),
  );

  const [isExporting, setIsExporting] = useState(false);

  // ----------------------------------------------------------
  const [workspacePage, setWorkspacePage] = useState<WorkspacePage>("auto-clipping");
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
      return typeof value === "string" && value.trim() ? value : "Welcome to Snip AI";
    } catch {
      return "Welcome to Snip AI";
    }
  });

  const [welcomeSubtitle, setWelcomeSubtitle] = useState(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      const value = raw ? JSON.parse(raw).welcomeSubtitle : "";
      return typeof value === "string" && value.trim() ? value : "Ready to create your next clips?";
    } catch {
      return "Ready to create your next clips?";
    }
  });

  const [showWelcome, setShowWelcome] = useState(true);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("pipeline-progress", (event) => {
      const message = event.payload.trim();
      if (!message) return;
      setProcessingDetail(message);
      const normalized = message.toLowerCase();
      if (normalized.includes("whisper") || normalized.includes("transcrib") || normalized.includes("swift")) {
        setProcessingStage(1);
      } else if (normalized.includes("moment") || normalized.includes("analyz")) {
        setProcessingStage(2);
      } else if (normalized.includes("render") || normalized.includes("clip")) {
        setProcessingStage(3);
      } else if (normalized.includes("caption")) {
        setProcessingStage(4);
      }
    }).then((stop) => { unlisten = stop; });
    return () => unlisten?.();
  }, []);

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
    CAPTION_STYLES.find(
      (item) => item.name === template,
    ) ?? CAPTION_STYLES[0];

  // ----------------------------------------------------------
  const navigateTo = (page: WorkspacePage) => {
    if (isProcessing) return;
    setShowGallery(false);
    setProcessingComplete(false);
    if (page === "auto-caption") setOutputKind("caption");
    if (page === "auto-clipping") setOutputKind("clips");
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
    setOutputKind(record.kind === "caption" ? "caption" : "clips");
    setWorkspacePage(record.kind === "caption" ? "auto-caption" : "auto-clipping");
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
    videoPathRef.current = path;
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

    if (!link || isDownloading || downloadInFlightRef.current) {
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
    downloadInFlightRef.current = true;
    setIsDownloading(true);
     setVideoName("Downloading YouTube videoâ€¦");
    videoPathRef.current = "";
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
      videoPathRef.current = "";
      setVideoPath("");
      setErrorMessage(message);
    } finally {
      downloadInFlightRef.current = false;
      setIsDownloading(false);
    }
  };

  const resetVideo = () => {
    setIsDownloading(false);
    setFormat(defaultFormat);
    setRequestedClips(defaultClipCount);
    setWorkspacePage(workspacePage === "auto-caption" ? "auto-caption" : "auto-clipping");
    setVideoName("");
    videoPathRef.current = "";
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
  setOutputKind("clips");
  if (isDownloading || downloadInFlightRef.current) {
    return;
  }

  const selectedInputPath = videoPathRef.current;
  if (!selectedInputPath) {
    window.alert(
      "Please select a local video file or paste a YouTube link first.",
    );
    return;
  }

  setErrorMessage("");
  cancelRequestedRef.current = false;
  setIsCanceling(false);
  setProcessingDetail("");
  setProcessingComplete(false);
  setOutputPaths([]);
  setShowGallery(false);
  setPlayingClip(null);
  setIsProcessing(true);

  try {
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
        inputPath: selectedInputPath,
        format,
        requestedClips,
        captionTemplate: template,
        differentCaptions,
        audioLanguage,
      },
    );

    if (!result || result.length === 0) {
      throw new Error(
        "The pipeline finished without generating any valid clips.",
      );
    }

    setOutputKind("clips");
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
        kind: "clips" as const,
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
    if (cancelRequestedRef.current) {
      setIsProcessing(false);
      setIsCanceling(false);
      setProcessingProgress(0);
      setProcessingStage(0);
      setProcessingDetail("Processing canceled.");
      cancelRequestedRef.current = false;
      return;
    }
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

  const startAutoCaption = async () => {
    if (isDownloading || downloadInFlightRef.current) return;
    const selectedInputPath = videoPathRef.current;
    if (!selectedInputPath) { window.alert("Choose a video file first."); return; }
    cancelRequestedRef.current = false; setIsCanceling(false); setErrorMessage(""); setProcessingDetail(""); setProcessingComplete(false); setOutputPaths([]); setShowGallery(false);
    setOutputKind("caption"); setIsProcessing(true); setProcessingStage(0); setProcessingProgress(10);
    try {
      const result = await invoke<string[]>("create_auto_caption", { inputPath: selectedInputPath, captionTemplate: template, audioLanguage });
      if (!result?.length) throw new Error("Auto Caption finished without creating an output video.");
      setOutputPaths(result); setSelectedClips(new Set([0])); setProcessingProgress(100);
      setHistoryRecords((previous) => [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: new Date().toISOString(), videoName: videoName || "Untitled video", format, template, clipCount: 1, paths: result, kind: "caption" as const }, ...previous].slice(0, 30));
      setIsProcessing(false); setProcessingComplete(true);
    } catch (error) {
      if (cancelRequestedRef.current) {
        setIsProcessing(false); setIsCanceling(false); setProcessingProgress(0); setProcessingStage(0); setProcessingDetail("Processing canceled."); cancelRequestedRef.current = false;
        return;
      }
      const message = typeof error === "string" ? error : error instanceof Error ? error.message : "Could not caption the video.";
      setErrorMessage(message); setIsProcessing(false); setProcessingProgress(0);
    }
  };

  const cancelCurrentProcessing = async () => {
    if (isCanceling) return;
    cancelRequestedRef.current = true;
    setIsCanceling(true);
    setProcessingDetail("Stopping the current job…");
    try {
      await invoke("cancel_processing");
    } catch (error) {
      const message = typeof error === "string" ? error : error instanceof Error ? error.message : "Could not stop the current job.";
      setErrorMessage(message);
      cancelRequestedRef.current = false;
      setIsCanceling(false);
    }
  };

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

          <button type="button" className={`nav-item ${workspacePage === "auto-clipping" ? "active" : ""}`} onClick={() => navigateTo("auto-clipping")}>
            <Clapperboard size={18} /><span>Auto Clipping</span>
          </button>
          <button type="button" className={`nav-item ${workspacePage === "auto-caption" ? "active" : ""}`} onClick={() => navigateTo("auto-caption")}>
            <Captions size={18} /><span>Auto Caption</span>
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

                <h1>{outputKind === "caption" ? "Your captioned video is ready." : "Your clips are ready."}</h1>

                <p className="subtitle">
                  Preview your generated {outputKind === "caption" ? "video" : "clips"} directly inside Snip AI.
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
                  {outputKind === "caption" ? "1 captioned video" : `${outputPaths.length} clips`}
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
                             {format} Â·{" "}
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
        ) : (workspacePage === "auto-caption" ? (
          <section className="auto-caption-page">
            <header className="topbar"><div><p className="eyebrow">AUTO CAPTION</p><h1>Caption your full video.</h1><p className="subtitle">Transcribe locally, choose a style, and render the complete video without making clips. No GPT or internet connection is required.</p></div><div className="secure-badge"><ShieldCheck size={15} /> Local CPU / GPU</div></header>
            <section className="workspace">
              <div className={`drop-zone ${dragging ? "dragging" : ""} ${videoName ? "has-video" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop}>
                <div className="drop-icon">{videoName ? <Check size={23} /> : <Upload size={23} />}</div><h2>{videoName ? "Video ready" : "Choose a video to caption"}</h2><p>{videoName || "Drop a video here or browse your computer"}</p>
                {!videoName && <button className="primary-small" onClick={handleBrowse}><FolderOpen size={16} />Browse video</button>}
                {videoName && <button className="change-video-button" onClick={resetVideo}>Choose another video</button>}
                <div className="upload-note">Your full video stays local. CPU fallback works without a supported GPU.</div>
              </div>
              <div className="auto-caption-options">
                <div className="option-card"><div className="option-heading"><div><span className="option-title">Audio language</span><span className="option-description">Used for accurate offline transcription</span></div></div><select value={audioLanguage} onChange={(event) => setAudioLanguage(event.target.value as "english" | "hinglish")}><option value="hinglish">Hinglish (Hindi + English)</option><option value="english">English</option></select></div>
                <div className="option-card caption-card remotion-caption-card"><div className="option-heading"><div><span className="option-title">Caption style</span><span className="option-description">{selectedTemplate.description}</span></div><strong>{selectedTemplate.label}</strong></div><div className="remotion-create-template-carousel"><div className="remotion-create-template-track">{CAPTION_STYLES.map((item) => <button key={item.name} type="button" className={`remotion-create-template-card ${template === item.name ? "selected" : ""}`} onClick={() => setTemplate(item.name as CaptionThemeName)}><div className="remotion-create-template-preview"><CaptionThemePreview theme={item.name} /></div><div className="remotion-create-template-footer"><span>{item.label}</span>{template === item.name && <span className="template-check"><Check size={10} /></span>}</div></button>)}</div></div></div>
              </div>
              {errorMessage && <div className="processing-error"><strong>Captioning failed</strong><span>{errorMessage}</span></div>}
              <div className="generate-row"><div className="generation-info"><div className="mini-icon"><Captions size={15} /></div><div><strong>Full video output</strong><span>No clip selection or crop</span></div></div><button className="generate-button" onClick={startAutoCaption} disabled={isProcessing || !videoPath}><Captions size={18} />Add captions to full video</button></div>
            </section>
          </section>
        ) : (workspacePage === "auto-clipping" ? (
          <>
            <header className="topbar">
              <div>
                <p className="eyebrow">
                  AUTO CLIPPING
                </p>

                <h1>
                  Turn long videos into ready-to-post clips.
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
                     ? "Downloading YouTube videoâ€¦"
                    : videoName
                      ? "Video ready"
                      : "Drop your video here"}
                </h2>

                <p>
                  {isDownloading
                     ? "Fetching your video from YouTube. Please waitâ€¦"
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
                           ? "Downloading YouTube videoâ€¦"
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
                       <span>Downloading from YouTubeâ€¦</span>
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
                  <div className="language-detection-note">
                    <label htmlFor="audio-language-select">Audio language</label>
                    <select
                      id="audio-language-select"
                      value={audioLanguage}
                      onChange={(event) => setAudioLanguage(event.target.value as "english" | "hinglish")}
                      aria-label="Audio language"
                    >
                      <option value="hinglish">Hinglish (Hindi + English)</option>
                      <option value="english">English</option>
                    </select>
                  </div>
                </div>

                <div className="option-card caption-card remotion-caption-card">
                  <div className="option-heading">
                    <div>
                      <span className="option-title">Caption template</span>
                      <span className="option-description">
                        Choose one of the 15 FFmpeg caption styles
                      </span>
                    </div>

                    <div className="selected-template-name">
                      {selectedTemplate.label}
                    </div>
                  </div>

                  <div className="remotion-create-template-carousel">
                    <div className="remotion-create-template-track">
                      {CAPTION_STYLES.map((item) => (
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
                     â† Scroll to explore all 15 caption styles â†’
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
                      Generate clips
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
            onUse={() => navigateTo("auto-clipping")}
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
              setWelcomeTitle("Welcome to Snip AI");
              setWelcomeSubtitle("Ready to create your next clips?");
            }}
          />
        ) : null)))}

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
                    {outputKind === "caption" ? "Captioning your full video" : "Creating your clips"}
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

                <button
                  className="processing-cancel"
                  onClick={cancelCurrentProcessing}
                  disabled={isCanceling}
                  aria-label={isCanceling ? "Stopping processing" : outputKind === "caption" ? "Cancel captioning" : "Cancel generation"}
                >
                  <X size={15} /> {isCanceling ? "Stopping…" : outputKind === "caption" ? "Cancel captioning" : "Cancel generation"}
                </button>
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
                      activeProcessingStages[
                        Math.min(processingStage, activeProcessingStages.length - 1)
                      ].icon;

                    return <Icon size={19} />;
                  })()}
                </div>

                <div>
                  <strong>
                    {
                      activeProcessingStages[
                        Math.min(processingStage, activeProcessingStages.length - 1)
                      ].title
                    }
                  </strong>

                  <span>
                    {processingDetail ||
                      activeProcessingStages[
                        Math.min(processingStage, activeProcessingStages.length - 1)
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
                {activeProcessingStages.map(
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
                          activeProcessingStages.length -
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
                {outputKind === "caption" ? "Your captioned video is ready." : "Your clips are ready."}
              </h2>

              <p>
                {outputKind === "caption" ? "The complete video has been captioned." : <>Snip AI generated <strong>{outputPaths.length}</strong> real clip{outputPaths.length === 1 ? "" : "s"} in <strong>{format}</strong> format.</>}
              </p>

              <div className="complete-stats">
                <div>
                  <strong>
                    {outputPaths.length}
                  </strong>
                  <span>
                    {outputKind === "caption" ? "captioned video" : "clips generated"}
                  </span>
                </div>

                <div>
                  <strong>{outputKind === "caption" ? "Full video" : format}</strong>
                  <span>{outputKind === "caption" ? "original aspect preserved" : "video format"}</span>
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
                  {outputKind === "caption" ? "Your full-length captioned video is ready to preview." : "Your generated clips are ready to preview."}
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
                  {outputKind === "caption" ? "Preview video" : "Preview clips"}
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
              <h2>{welcomeTitle || "Welcome to Snip AI"}</h2>
              <p>{welcomeSubtitle || "Ready to create your next clips?"}</p>
              <button type="button" className="welcome-continue-button" onClick={() => setShowWelcome(false)}>
                Let's create
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
