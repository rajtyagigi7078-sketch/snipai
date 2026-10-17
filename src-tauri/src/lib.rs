use tauri::{Emitter, Manager};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::io::{BufRead, BufReader};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::hash::{Hash, Hasher};
use std::collections::hash_map::DefaultHasher;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Default)]
struct PipelineControl {
    active: bool,
    pid: Option<u32>,
    cancel_requested: bool,
}

static PIPELINE_CONTROL: Mutex<PipelineControl> = Mutex::new(PipelineControl {
    active: false,
    pid: None,
    cancel_requested: false,
});

struct PipelineRequestGuard;

#[derive(serde::Serialize)]
struct GeneratedClipsResult {
    paths: Vec<String>,
    social_captions: Vec<String>,
}

impl Drop for PipelineRequestGuard {
    fn drop(&mut self) {
        if let Ok(mut control) = PIPELINE_CONTROL.lock() {
            control.active = false;
            control.pid = None;
            control.cancel_requested = false;
        }
    }
}

fn persist_process_output(
    output_dir: &Path,
    log_name: &str,
    stdout: &[u8],
    stderr: &[u8],
) -> (PathBuf, String) {
    let stdout = String::from_utf8_lossy(stdout);
    let stderr = String::from_utf8_lossy(stderr);
    let log = format!("=== stdout ===\n{}\n=== stderr ===\n{}", stdout, stderr);
    let log_path = output_dir.join(log_name);
    let save_note = match fs::write(&log_path, log.as_bytes()) {
        Ok(()) => String::new(),
        Err(error) => format!("\nCould not save full log: {}", error),
    };
    let tail = log
        .chars()
        .rev()
        .take(12_000)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    (log_path, format!("{}{}", tail, save_note))
}

fn stream_child_output(
    app: &tauri::AppHandle,
    mut child: Child,
    output_dir: &Path,
    log_name: &str,
) -> Result<(ExitStatus, PathBuf, String), String> {
    let pid = child.id();
    let cancel_on_start = {
        let mut control = PIPELINE_CONTROL
            .lock()
            .map_err(|_| "Pipeline control state is unavailable.".to_string())?;
        control.pid = Some(pid);
        let cancel = control.cancel_requested;
        control.cancel_requested = false;
        cancel
    };
    if cancel_on_start {
        let _ = terminate_process_tree(pid);
    }
    let (line_tx, line_rx) = mpsc::channel::<(bool, String)>();

    if let Some(stdout) = child.stdout.take() {
        let tx = line_tx.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().flatten() {
                let _ = tx.send((true, line));
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let tx = line_tx.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().flatten() {
                let _ = tx.send((false, line));
            }
        });
    }
    drop(line_tx);

    let mut stdout_log = String::new();
    let mut stderr_log = String::new();
    for (is_stdout, line) in line_rx {
        let log = if is_stdout { &mut stdout_log } else { &mut stderr_log };
        log.push_str(&line);
        log.push('\n');
        let _ = app.emit("pipeline-progress", line);
    }

    let status = child.wait().map_err(|error| {
        if let Ok(mut control) = PIPELINE_CONTROL.lock() {
            if control.pid == Some(pid) {
                control.pid = None;
            }
        }
        format!("Could not wait for pipeline process: {}", error)
    })?;
    if let Ok(mut control) = PIPELINE_CONTROL.lock() {
        if control.pid == Some(pid) {
            control.pid = None;
        }
        control.cancel_requested = false;
    }

    let (log_path, log_tail) = persist_process_output(
        output_dir,
        log_name,
        stdout_log.as_bytes(),
        stderr_log.as_bytes(),
    );
    Ok((status, log_path, log_tail))
}

fn terminate_process_tree(pid: u32) -> Result<(), String> {
    let pid_text = pid.to_string();
    #[cfg(target_os = "windows")]
    let result = {
        let mut command = Command::new("taskkill");
        command.creation_flags(0x08000000);
        command.args(["/PID", &pid_text, "/T", "/F"]).output()
    };
    #[cfg(not(target_os = "windows"))]
    let result = Command::new("kill")
        .args(["-TERM", &pid_text])
        .output();
    let result = result.map_err(|error| {
        format!("Could not stop the active render process: {}", error)
    })?;
    if !result.status.success() {
        return Err(format!(
            "Could not stop render process {}. {}",
            pid,
            String::from_utf8_lossy(&result.stderr).trim()
        ));
    }
    Ok(())
}

fn begin_pipeline_request() -> Result<PipelineRequestGuard, String> {
    let mut control = PIPELINE_CONTROL
        .lock()
        .map_err(|_| "Pipeline control state is unavailable.".to_string())?;
    if control.active {
        return Err("Another video job is already running.".to_string());
    }
    control.active = true;
    control.cancel_requested = false;
    Ok(PipelineRequestGuard)
}

#[tauri::command]
fn cancel_processing(app: tauri::AppHandle) -> Result<(), String> {
    let pid = {
        let mut control = PIPELINE_CONTROL
            .lock()
            .map_err(|_| "Pipeline control state is unavailable.".to_string())?;
        if !control.active {
            return Err("There is no active video job to stop.".to_string());
        }
        control.cancel_requested = true;
        let pid = control.pid;
        if pid.is_some() {
            control.cancel_requested = false;
        }
        pid
    };
    if let Some(pid) = pid {
        terminate_process_tree(pid)?;
    }
    let _ = app.emit("pipeline-progress", "Stopping the current job…");
    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

// ------------------------------------------------------------
// Resolve Snip AI runtime root
//
// Production:
//   Tauri bundled resource directory/windows-runtime
//
// Development fallback:
//   clipper/windows-runtime
//
// ------------------------------------------------------------

fn resolve_runtime_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| {
            format!(
                "Could not resolve Tauri resource directory:\n{}",
                error
            )
        })?;

    let bundled_runtime = resource_dir.join("windows-runtime");

    if bundled_runtime.is_dir() {
        return Ok(bundled_runtime);
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    let clipper_dir = manifest_dir
        .parent()
        .ok_or_else(|| {
            "Could not resolve clipper directory.".to_string()
        })?;

    let development_runtime =
        clipper_dir.join("windows-runtime");

    if development_runtime.is_dir() {
        return Ok(development_runtime);
    }

    Err(format!(
        "Snip AI runtime was not found.\n\nChecked:\n{}\n{}",
        bundled_runtime.display(),
        development_runtime.display()
    ))
}

// ------------------------------------------------------------
// Resolve legacy project root for development fallback
// ------------------------------------------------------------

fn resolve_project_root() -> Result<PathBuf, String> {
    if let Ok(value) = env::var("SNIP_AI_PROJECT_ROOT") {
        if !value.trim().is_empty() {
            let path = PathBuf::from(value);

            if path.exists() {
                return Ok(path);
            }

            return Err(format!(
                "SNIP_AI_PROJECT_ROOT does not exist:\n{}",
                path.display()
            ));
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    let project_root = manifest_dir
        .parent()
        .ok_or_else(|| {
            "Could not resolve Snip AI project root.".to_string()
        })?;

    Ok(project_root.to_path_buf())
}

// ------------------------------------------------------------
// Resolve Python executable
//
// Bundled runtime:
//   Windows: windows-runtime/python/Scripts/python.exe
//   Linux:   windows-runtime/python/bin/python
//
// Development fallback:
//   clipper/.whisper-venv
// ------------------------------------------------------------

fn resolve_python(
    app: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    let project_root = resolve_project_root()?;

    // --------------------------------------------------------
    // WINDOWS
    // --------------------------------------------------------
    //
    // Windows uses the bundled portable Python runtime.
    //
    if cfg!(target_os = "windows") {
        if let Ok(runtime_root) = resolve_runtime_root(app) {
            let python_dir = runtime_root.join("python");

            let candidates = [
                python_dir.join("python.exe"),
                python_dir.join("Scripts").join("python.exe"),
                python_dir.join("Scripts").join("python"),
            ];

            for candidate in candidates {
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }

    // --------------------------------------------------------
    // DEVELOPMENT / LINUX / MACOS
    // --------------------------------------------------------
    //
    // Linux development uses the project's Whisper virtual
    // environment instead of the Windows runtime directory.
    //
    let venv = project_root
        .join("clipper")
        .join(".whisper-venv");

    let development_venv = project_root
        .join(".venv-whisper");

    let candidates = if cfg!(target_os = "windows") {
        vec![
            development_venv.join("Scripts").join("python.exe"),
            development_venv.join("Scripts").join("python"),
            venv.join("Scripts").join("python.exe"),
            venv.join("Scripts").join("python"),
        ]
    } else {
        vec![
            development_venv.join("bin").join("python"),
            development_venv.join("bin").join("python3"),
            venv.join("bin").join("python"),
            venv.join("bin").join("python3"),
        ]
    };

    for candidate in candidates {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "Whisper Python environment not found.
\
Expected development environment:
{}",
        venv.display()
    ))
}

// ------------------------------------------------------------
// Resolve pipeline runner
//
// Bundled:
//   windows-runtime/pipeline/pipeline_runner.py
//
// Development fallback:
//   project root/pipeline_runner.py
// ------------------------------------------------------------

fn resolve_runner(
    app: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    if let Ok(runtime_root) = resolve_runtime_root(app) {
        let runner = runtime_root
            .join("pipeline")
            .join("pipeline_runner.py");

        if runner.is_file() {
            return Ok(runner);
        }
    }

    let project_root = resolve_project_root()?;

    let candidates = [
        project_root.join("windows-runtime").join("pipeline").join("pipeline_runner.py"),
        project_root.join("pipeline_runner.py"),
    ];

    if let Some(runner) = candidates.iter().find(|path| path.is_file()) {
        return Ok(runner.to_path_buf());
    }

    Err(format!(
        "Pipeline runner not found. Checked:\n{}",
        candidates.iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join("\n")
    ))
}

// ------------------------------------------------------------
// Resolve output directory
// ------------------------------------------------------------

fn resolve_output_dir() -> Result<PathBuf, String> {
    if let Ok(value) = env::var("SNIP_AI_OUTPUT_DIR") {
        if !value.trim().is_empty() {
            return Ok(PathBuf::from(value));
        }
    }

    let home = env::var("HOME")
        .or_else(|_| env::var("USERPROFILE"))
        .map_err(|_| {
            "Could not determine the user's home directory."
                .to_string()
        })?;

    Ok(PathBuf::from(home)
        .join("Downloads")
        .join("Snip AI Clips"))
}

// ------------------------------------------------------------
// Remove previous generated clips
// ------------------------------------------------------------

fn remove_old_generated_clips(
    output_dir: &Path,
) -> Result<(), String> {
    if !output_dir.exists() {
        return Ok(());
    }

    let entries = fs::read_dir(output_dir)
        .map_err(|error| {
            format!(
                "Could not read output folder:\n{}\n{}",
                output_dir.display(),
                error
            )
        })?;

    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Could not read output entry:\n{}",
                error
            )
        })?;

        let path = entry.path();

        let is_generated_clip = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| {
                name.starts_with("snip_ai_simple_clip_")
                    && name.ends_with(".mp4")
            })
            .unwrap_or(false);

        if is_generated_clip && path.is_file() {
            fs::remove_file(&path).map_err(|error| {
                format!(
                    "Could not remove old generated clip:\n{}\n{}",
                    path.display(),
                    error
                )
            })?;
        }
    }

    Ok(())
}

// ------------------------------------------------------------
// Validate MP4 using bundled/system ffprobe
// ------------------------------------------------------------

fn validate_mp4(
    app: &tauri::AppHandle,
    path: &Path,
) -> bool {
    if !path.is_file() {
        return false;
    }

    let metadata = match fs::metadata(path) {
        Ok(value) => value,
        Err(_) => return false,
    };

    if metadata.len() == 0 {
        return false;
    }

    let ffprobe = resolve_ffprobe(app);

    let ffprobe_result = Command::new(ffprobe)
        .arg("-v")
        .arg("error")
        .arg("-select_streams")
        .arg("v:0")
        .arg("-show_entries")
        .arg("stream=codec_name,width,height,duration")
        .arg("-of")
        .arg("default=noprint_wrappers=1:nokey=0")
        .arg(path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    match ffprobe_result {
        Ok(status) => status.success(),
        Err(_) => false,
    }
}

// ------------------------------------------------------------
// Resolve bundled FFmpeg
// ------------------------------------------------------------

fn resolve_ffmpeg(
    app: &tauri::AppHandle,
) -> PathBuf {
    if let Ok(runtime_root) = resolve_runtime_root(app) {
        let bundled = runtime_root
            .join("ffmpeg")
            .join(if cfg!(target_os = "windows") {
                "ffmpeg.exe"
            } else {
                "ffmpeg"
            });

        if bundled.is_file() {
            return bundled;
        }
    }

    PathBuf::from(if cfg!(target_os = "windows") {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    })
}

// ------------------------------------------------------------
// Resolve bundled FFprobe
// ------------------------------------------------------------

fn resolve_ffprobe(
    app: &tauri::AppHandle,
) -> PathBuf {
    if let Ok(runtime_root) = resolve_runtime_root(app) {
        let bundled = runtime_root
            .join("ffmpeg")
            .join(if cfg!(target_os = "windows") {
                "ffprobe.exe"
            } else {
                "ffprobe"
            });

        if bundled.is_file() {
            return bundled;
        }
    }

    PathBuf::from(if cfg!(target_os = "windows") {
        "ffprobe.exe"
    } else {
        "ffprobe"
    })
}

// ------------------------------------------------------------
// Collect and validate generated clips
// ------------------------------------------------------------

fn collect_generated_clips(
    app: &tauri::AppHandle,
    output_dir: &Path,
) -> Result<Vec<String>, String> {
    if !output_dir.exists() {
        return Err(format!(
            "Output folder was not created:\n{}",
            output_dir.display()
        ));
    }

    let entries = fs::read_dir(output_dir)
        .map_err(|error| {
            format!(
                "Could not read output folder:\n{}\n{}",
                output_dir.display(),
                error
            )
        })?;

    let mut output_paths = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Could not read output entry:\n{}",
                error
            )
        })?;

        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let is_mp4 = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("mp4"))
            .unwrap_or(false);

        let is_snip_clip = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| {
                name.starts_with("snip_ai_simple_clip_")
            })
            .unwrap_or(false);

        if !is_mp4 || !is_snip_clip {
            continue;
        }

        if validate_mp4(app, &path) {
            output_paths.push(
                path.to_string_lossy().to_string()
            );
        } else {
            println!(
                "Ignoring invalid generated MP4: {}",
                path.display()
            );
        }
    }

    output_paths.sort();

    Ok(output_paths)
}

// ------------------------------------------------------------
// YOUTUBE DOWNLOAD
// ------------------------------------------------------------

#[tauri::command]
async fn download_youtube(
    app: tauri::AppHandle,
    url: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || download_youtube_inner(app, url))
        .await
        .map_err(|error| format!("Background YouTube download task failed: {}", error))?
}

fn download_youtube_inner(
    app: tauri::AppHandle,
    url: String,
) -> Result<String, String> {
    println!();
    println!("==============================================");
    println!("SNIP AI — YOUTUBE DOWNLOAD");
    println!("==============================================");
    println!("URL: {}", url);

    let url = url.trim();

    if url.is_empty() {
        return Err("YouTube URL cannot be empty.".to_string());
    }

    if !(url.starts_with("https://www.youtube.com/")
        || url.starts_with("https://youtube.com/")
        || url.starts_with("https://m.youtube.com/")
        || url.starts_with("https://youtu.be/"))
    {
        return Err("Please enter a valid YouTube URL.".to_string());
    }

    let python = resolve_python(&app)?;
    let downloads_root = dirs::download_dir()
        .ok_or_else(|| "Could not find your Downloads folder.".to_string())?
        .join("Snip AI Downloads");
    let download_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Could not create download ID: {}", error))?
        .as_millis();
    let download_dir = downloads_root.join(format!("download-{}", download_id));
    fs::create_dir_all(&download_dir).map_err(|error| {
        format!(
            "Could not create Snip AI Downloads folder:\n{}",
            error
        )
    })?;

    println!("Download folder: {}", download_dir.display());
    let output_template = download_dir.join("%(title).100s-%(id)s.%(ext)s");
    let mut command = Command::new(&python);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    let output = command
        .args([
            "-m",
            "yt_dlp",
            "--js-runtimes",
            "node",
            "--no-playlist",
            "--newline",
            "--format",
            "bv*+ba/b",
            "--merge-output-format",
            "mp4",
            "--restrict-filenames",
            "--print",
            "after_move:filepath",
            "--output",
        ])
        .arg(&output_template)
        .arg(url)
        .output()
        .map_err(|error| format!("Failed to start YouTube downloader:\n{}", error))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut downloaded_path = None;

    // yt-dlp can report a late HTTP/post-processing error after it has already
    // moved the completed media into place. Trust a file only if FFprobe can
    // read its video stream; the process exit code alone is not sufficient.
    for line in stdout.lines().rev() {
        let candidate = PathBuf::from(line.trim().trim_matches('"'));
        if candidate.is_file() && validate_mp4(&app, &candidate) {
            downloaded_path = Some(candidate);
            break;
        }
    }

    let log_path = download_dir.join(format!(
        "download-{}.log",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default()
    ));
    let full_log = format!("=== stdout ===\n{}\n=== stderr ===\n{}", stdout, stderr);
    let log_save_note = fs::write(&log_path, full_log.as_bytes())
        .err()
        .map(|error| format!("\nCould not save download log: {}", error))
        .unwrap_or_default();

    let Some(downloaded_path) = downloaded_path else {
        let tail = full_log
            .chars()
            .rev()
            .take(8_000)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<String>();
        return Err(format!(
            "YouTube download did not produce a valid video ({}). Full log: {}{}\n\nLast downloader output:\n{}",
            output.status,
            log_path.display(),
            log_save_note,
            tail
        ));
    };

    if !output.status.success() {
        eprintln!(
            "yt-dlp exited with {} after producing a valid MP4; using the validated file. Full log: {}",
            output.status,
            log_path.display()
        );
    }

    println!("Downloaded and validated: {}", downloaded_path.display());
    println!("==============================================");
    Ok(downloaded_path.to_string_lossy().to_string())
}

fn resolve_caption_renderer(
    app: &tauri::AppHandle,
) -> Result<PathBuf, String> {
    if let Ok(runtime_root) = resolve_runtime_root(app) {
        let bundled = runtime_root.join("caption-renderer");

        if bundled.join("src").join("render.ts").is_file() {
            return Ok(bundled);
        }
    }

    let project_root = resolve_project_root()?;
    let development = project_root.join("snip-caption-renderer");

    if development.join("src").join("render.ts").is_file() {
        return Ok(development);
    }

    Err(format!(
        "Remotion caption renderer was not found.\\n\\nExpected development path:\\n{}",
        development.display()
    ))
}

// ------------------------------------------------------------
// REAL SNIP AI PIPELINE
// ------------------------------------------------------------

#[tauri::command]
async fn create_clips(
    app: tauri::AppHandle,
    input_path: String,
    format: String,
    requested_clips: u32,
    caption_template: String,
    different_captions: bool,
    audio_language: String,
) -> Result<GeneratedClipsResult, String> {
    let _request_guard = begin_pipeline_request()?;
    tauri::async_runtime::spawn_blocking(move || {
        create_clips_inner(
            app,
            input_path,
            format,
            requested_clips,
            caption_template,
            different_captions,
            audio_language,
        )
    })
    .await
    .map_err(|error| format!("Background pipeline task failed: {}", error))?
}

fn create_clips_inner(
    app: tauri::AppHandle,
    input_path: String,
    format: String,
    requested_clips: u32,
    caption_template: String,
    different_captions: bool,
    audio_language: String,
) -> Result<GeneratedClipsResult, String> {
    println!();
    println!("==============================================");
    println!("SNIP AI ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â CREATE CLIPS");
    println!("==============================================");
    println!("Input : {}", input_path);
    println!("Format: {}", format);
    println!(
        "Requested clips: {}",
        requested_clips
    );
    println!(
        "Caption template: {}",
        caption_template
    );
    println!(
        "Different captions: {}",
        different_captions
    );

    if audio_language != "english" && audio_language != "hinglish" {
        return Err("Invalid audio language. Choose English or Hinglish.".to_string());
    }
    println!("English transcription model: base");

    if format != "1:1" && format != "16:9" {
        return Err(
            "Invalid framing format. Use 1:1 or 16:9."
                .to_string()
        );
    }

    if requested_clips < 1 || requested_clips > 10 {
        return Err(
            "Clip count must be between 1 and 10."
                .to_string()
        );
    }

    let allowed_caption_templates = [
        "pop",
        "karaoke",
        "bold-center",
        "punch",
        "minimal",
        "highlight-box",
        "typewriter",
        "bounce",
        "kinetic",
        "podcast",
        "yellow-stack",
        "violet-pill",
        "dual-line",
        "bold-karaoke",
        "soft-lyric",
    ];

    if !allowed_caption_templates
        .contains(&caption_template.as_str())
    {
        return Err(format!(
            "Invalid caption template: {}",
            caption_template
        ));
    }

    let input = PathBuf::from(&input_path);

    if !input.exists() {
        return Err(format!(
            "Video file not found:\n{}",
            input.display()
        ));
    }

    if !input.is_file() {
        return Err(format!(
            "Input path is not a file:\n{}",
            input.display()
        ));
    }

    let runtime_root =
        resolve_runtime_root(&app)?;

    let python =
        resolve_python(&app)?;

    let runner =
        resolve_runner(&app)?;

    let output_root = resolve_output_dir()?;
    let run_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Could not create render run ID: {}", error))?
        .as_millis();
    let output_dir = output_root.join(format!("run-{}", run_id));



    println!(
        "Runtime root: {}",
        runtime_root.display()
    );

    println!(
        "Python: {}",
        python.display()
    );

    println!(
        "Runner: {}",
        runner.display()
    );

    println!(
        "FFmpeg: {}",
        resolve_ffmpeg(&app).display()
    );

    println!(
        "FFprobe: {}",
        resolve_ffprobe(&app).display()
    );

    println!(
        "Output: {}",
        output_dir.display()
    );

    fs::create_dir_all(&output_dir)
        .map_err(|error| {
            format!(
                "Could not create output directory:\n{}\n{}",
                output_dir.display(),
                error
            )
        })?;

    // Preserve previous runs. Each run uses its own output directory.

    println!();
    println!("Starting Snip AI pipeline...");

    let mut command = Command::new(&python);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    let child = command
        .arg(&runner)
        .arg(&input)
        .arg(&format)
        .arg(requested_clips.to_string())
        .arg(&caption_template)
        .arg(if different_captions {
            "true"
        } else {
            "false"
        })
        .arg(&audio_language)
        .env(
            "SNIP_AI_OUTPUT_DIR",
            &output_dir,
        )
        .env(
            "SNIP_AI_WORK_DIR",
            output_dir.join(".snip-ai-work"),
        )
        .env("PYTHONUNBUFFERED", "1")
        .env(
            "SNIP_AI_RUNTIME_ROOT",
            &runtime_root,
        )
        .env(
            "SNIP_AI_PYTHON",
            &python,
        )
        .env(
            "SNIP_AI_FFMPEG",
            resolve_ffmpeg(&app),
        )
        .env(
            "SNIP_AI_FFPROBE",
            resolve_ffprobe(&app),
        )
        .env(
            "SNIP_AI_WHISPER_MODEL_DIR",
            runtime_root.join("whisper-model"),
        )
        .env("SNIP_AI_WHISPER_MODEL", "base")
        .env("SNIP_AI_HINGLISH_ENGINE", "swift")

        .env(
            "SNIP_AI_NODE",
            if cfg!(target_os = "windows") {
                runtime_root
                    .join("node")
                    .join("node.exe")
            } else {
                PathBuf::from("node")
            },
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(
            runner.parent().ok_or_else(|| {
                "Could not resolve pipeline runner directory.".to_string()
            })?,
        )
        .spawn()
        .map_err(|error| {
            format!(
                "Failed to start Snip AI pipeline:\n{}",
                error
            )
        })?;

    let (status, log_path, log_tail) = stream_child_output(
        &app,
        child,
        &output_dir,
        "pipeline.log",
    )?;
    if !status.success() {
        return Err(format!(
            "Snip AI pipeline failed.\nExit status: {}\nFull log: {}\n\nLast process output:\n{}",
            status,
            log_path.display(),
            log_tail
        ));
    }

    let output_paths =
        collect_generated_clips(
            &app,
            &output_dir,
        )?;

    if output_paths.is_empty() {
        return Err(
            "Pipeline completed, but no valid generated clips were found."
                .to_string()
        );
    }

    println!();
    println!("==============================================");
    println!("SNIP AI ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â GENERATED CLIPS");
    println!("==============================================");
    println!("Count: {}", output_paths.len());

    for path in &output_paths {
        println!("{}", path);
    }

    println!("==============================================");
    println!();

    let social_captions = load_social_captions(&output_dir, output_paths.len());
    Ok(GeneratedClipsResult {
        paths: output_paths,
        social_captions,
    })
}

fn load_social_captions(output_dir: &Path, clip_count: usize) -> Vec<String> {
    const FALLBACK: &str = "A standout moment worth sharing.";
    let selected_generation = output_dir
        .join(".snip-ai-work")
        .join("selected-generation.json");
    let clips = fs::read_to_string(selected_generation)
        .ok()
        .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .and_then(|data| data.get("clips").and_then(serde_json::Value::as_array).cloned())
        .unwrap_or_default();

    let mut ranked_clips = clips;
    ranked_clips.sort_by_key(|clip| {
        clip.get("generation_rank")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(u64::MAX)
    });

    (0..clip_count)
        .map(|index| {
            let text = ranked_clips
                .get(index)
                .and_then(|clip| clip.get("text"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            let cleaned = text.split_whitespace().collect::<Vec<_>>().join(" ");
            let cleaned = cleaned.trim_matches(|character: char| {
                character.is_whitespace() || ",.;:!?-–—\"'“”‘’".contains(character)
            });
            if cleaned.is_empty() {
                return FALLBACK.to_string();
            }
            if cleaned.chars().count() <= 140 {
                return cleaned.to_string();
            }

            let mut shortened = String::new();
            for word in cleaned.split_whitespace() {
                let candidate_length = shortened.chars().count()
                    + usize::from(!shortened.is_empty())
                    + word.chars().count();
                if candidate_length > 137 {
                    break;
                }
                if !shortened.is_empty() {
                    shortened.push(' ');
                }
                shortened.push_str(word);
            }
            if shortened.is_empty() {
                cleaned.chars().take(137).collect::<String>()
            } else {
                format!("{}…", shortened.trim_end_matches(|character: char| ",.;:!?-–—".contains(character)))
            }
        })
        .collect()
}

#[tauri::command]
async fn create_auto_caption(app: tauri::AppHandle, input_path: String, caption_template: String, audio_language: String) -> Result<Vec<String>, String> {
    let _request_guard = begin_pipeline_request()?;
    tauri::async_runtime::spawn_blocking(move || create_auto_caption_inner(app, input_path, caption_template, audio_language))
        .await.map_err(|error| format!("Background caption task failed: {}", error))?
}

fn create_auto_caption_inner(app: tauri::AppHandle, input_path: String, caption_template: String, audio_language: String) -> Result<Vec<String>, String> {
    let input = PathBuf::from(&input_path);
    if !input.is_file() { return Err(format!("Video file not found: {}", input.display())); }
    if audio_language != "english" && audio_language != "hinglish" { return Err("Invalid audio language. Choose English or Hinglish.".into()); }
    let allowed = ["pop", "karaoke", "bold-center", "punch", "minimal", "highlight-box", "typewriter", "bounce", "kinetic", "podcast", "yellow-stack", "violet-pill", "dual-line", "bold-karaoke", "soft-lyric"];
    if !allowed.contains(&caption_template.as_str()) { return Err(format!("Invalid caption template: {}", caption_template)); }
    let runtime = resolve_runtime_root(&app)?;
    let python = resolve_python(&app)?;
    let script = runtime.join("pipeline").join("auto_caption.py");
    if !script.is_file() { return Err(format!("Auto Caption script not found: {}", script.display())); }
    let root = resolve_output_dir()?;
    let id = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis();
    let output_dir = root.join(format!("caption-run-{}", id));
    fs::create_dir_all(&output_dir).map_err(|e| format!("Could not create output directory: {}", e))?;
    let ffmpeg = resolve_ffmpeg(&app);
    let ffprobe = resolve_ffprobe(&app);
    let mut command = Command::new(&python);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let child = command.arg(&script).arg(&input).arg(&audio_language).arg(&caption_template).arg(&output_dir)
        .env("SNIP_AI_OUTPUT_DIR", &output_dir).env("SNIP_AI_RUNTIME_ROOT", &runtime)
        .env("SNIP_AI_PYTHON", &python).env("SNIP_AI_FFMPEG", &ffmpeg).env("SNIP_AI_FFPROBE", &ffprobe)
        .env("PYTHONUNBUFFERED", "1")
        .env("SNIP_AI_WHISPER_MODEL_DIR", runtime.join("whisper-model"))
        .env("SNIP_AI_WHISPER_MODEL", "base")
        .env("SNIP_AI_HINGLISH_ENGINE", "swift")
        .env("SNIP_AI_NODE", if cfg!(target_os = "windows") { runtime.join("node").join("node.exe") } else { PathBuf::from("node") })
        .current_dir(script.parent().ok_or_else(|| "Could not resolve caption script directory.".to_string())?)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start Auto Caption: {}", e))?;
    let (status, log_path, log_tail) = stream_child_output(
        &app,
        child,
        &output_dir,
        "auto-caption.log",
    )?;
    if !status.success() {
        return Err(format!(
            "Auto Caption failed with status {}.\nFull log: {}\n\nLast process output:\n{}",
            status,
            log_path.display(),
            log_tail
        ));
    }
    let stem = input.file_stem().and_then(|x| x.to_str()).unwrap_or("video");
    let output = output_dir.join(format!("{}.captioned.mp4", stem));
    if !validate_mp4(&app, &output) { return Err(format!("Captioned video failed validation: {}", output.display())); }
    Ok(vec![output.to_string_lossy().to_string()])
}

// ------------------------------------------------------------
// EXPORT CLIPS
// ------------------------------------------------------------

#[tauri::command]
fn export_clips(
    input_paths: Vec<String>,
    destination_dir: String,
) -> Result<Vec<String>, String> {
    if input_paths.is_empty() {
        return Err(
            "No clips were selected for export.".to_string()
        );
    }

    let destination =
        PathBuf::from(&destination_dir);

    if !destination.exists() {
        fs::create_dir_all(&destination)
            .map_err(|error| {
                format!(
                    "Could not create export folder:\n{}",
                    error
                )
            })?;
    }

    if !destination.is_dir() {
        return Err(
            "Selected export location is not a folder."
                .to_string()
        );
    }

    let mut exported_paths: Vec<String> =
        Vec::new();

    for input_path in input_paths {
        let source =
            PathBuf::from(&input_path);

        if !source.exists() || !source.is_file() {
            return Err(format!(
                "Clip file not found:\n{}",
                source.display()
            ));
        }

        let file_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                format!(
                    "Could not read clip filename:\n{}",
                    source.display()
                )
            })?;

        let target =
            destination.join(file_name);

        fs::copy(&source, &target)
            .map_err(|error| {
                format!(
                    "Could not export clip:\n{}\n{}",
                    source.display(),
                    error
                )
            })?;

        exported_paths.push(
            target.to_string_lossy().to_string()
        );
    }

    println!(
        "SNIP AI ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â EXPORTED {} CLIPS",
        exported_paths.len()
    );

    for path in &exported_paths {
        println!("{}", path);
    }

    Ok(exported_paths)
}

// ------------------------------------------------------------
// TAURI APPLICATION
// ------------------------------------------------------------

// Render an animated caption-only preview using the same FFmpeg caption
// engine as production. Results are cached per template in the app cache.
#[tauri::command]
fn render_caption_preview(
    app: tauri::AppHandle,
    theme: String,
) -> Result<String, String> {
    let allowed = [
        "pop", "karaoke", "bold-center", "punch", "minimal",
        "highlight-box", "typewriter", "bounce", "kinetic", "podcast",
        "yellow-stack", "violet-pill", "dual-line", "bold-karaoke", "soft-lyric",
    ];
    if !allowed.contains(&theme.as_str()) {
        return Err(format!("Invalid caption preview theme: {}", theme));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = manifest_dir.parent()
        .ok_or_else(|| "Could not resolve project directory.".to_string())?;
    let runtime_root = resolve_runtime_root(&app)?;
    let resource_dir = app.path().resource_dir()
        .map_err(|e| format!("Could not resolve resource directory: {}", e))?;
    let bundled_engine = resource_dir.join("caption-renderer").join("engine.cjs");
    let development_engine = project_root.join("snip-caption-renderer")
        .join("src").join("ffmpeg-captions").join("engine.cjs");
    let engine = if bundled_engine.is_file() {
        bundled_engine
    } else {
        development_engine
    };
    if !engine.is_file() {
        return Err(format!("FFmpeg caption engine not found: {}", engine.display()));
    }

    let bundled_script = runtime_root.join("pipeline").join("render_caption_preview.py");
    let dev_script = project_root.join("windows-runtime").join("pipeline").join("render_caption_preview.py");
    let script = if bundled_script.is_file() { bundled_script } else { dev_script };
    if !script.is_file() {
        return Err(format!("Caption preview script not found: {}", script.display()));
    }

    let cache_dir = app.path().app_cache_dir()
        .map_err(|e| format!("Could not resolve app cache directory: {}", e))?
        .join("caption-previews");
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Could not create caption preview cache: {}", e))?;

    let mut hasher = DefaultHasher::new();
    theme.hash(&mut hasher);
    "snip-caption-preview-landscape-v2".hash(&mut hasher);
    engine.to_string_lossy().hash(&mut hasher);
    if let Ok(meta) = fs::metadata(&engine) {
        meta.len().hash(&mut hasher);
        if let Ok(modified) = meta.modified() {
            if let Ok(age) = modified.duration_since(std::time::UNIX_EPOCH) {
                age.as_secs().hash(&mut hasher);
            }
        }
    }
    let output = cache_dir.join(format!("{:016x}-{}.mp4", hasher.finish(), theme));
    if output.is_file() && fs::metadata(&output).map(|m| m.len() > 1024).unwrap_or(false) {
        return Ok(output.to_string_lossy().to_string());
    }

    let python = resolve_python(&app).or_else(|_| {
        let system_python = PathBuf::from(r"C:\Python314\python.exe");
        if system_python.is_file() {
            Ok(system_python)
        } else {
            Err("No usable Python interpreter found for caption preview.".to_string())
        }
    })?;
    let result = Command::new(&python)
        .arg(&script)
        .arg(&theme)
        .arg(&output)
        .env("SNIP_AI_CAPTION_ENGINE", &engine)
        .env("SNIP_AI_FFMPEG", {
            let bundled = resolve_ffmpeg(&app);
            if bundled.is_file() { bundled } else {
                std::env::var_os("PATH")
                    .map(|p| {
                        let exe = if cfg!(target_os = "windows") { "ffmpeg.exe" } else { "ffmpeg" };
                        std::env::split_paths(&p)
                            .map(|dir| dir.join(exe))
                            .find(|candidate| candidate.is_file())
                            .unwrap_or(bundled.clone())
                    })
                    .unwrap_or(bundled.clone())
            }
        })
        .env("SNIP_AI_NODE", {
            let bundled = runtime_root.join("node").join(if cfg!(target_os = "windows") { "node.exe" } else { "node" });
            if bundled.is_file() { bundled } else {
                std::env::var_os("PATH")
                    .map(|p| {
                        let exe = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
                        std::env::split_paths(&p)
                            .map(|dir| dir.join(exe))
                            .find(|candidate| candidate.is_file())
                            .unwrap_or(bundled.clone())
                    })
                    .unwrap_or(bundled.clone())
            }
        })
        .current_dir(std::env::temp_dir())
        .output()
        .map_err(|e| format!("Could not start caption preview renderer ({}): {}", python.display(), e))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let stdout = String::from_utf8_lossy(&result.stdout);
        return Err(format!(
            "Caption preview render failed for '{}'.\n{}\n{}",
            theme, stderr.trim(), stdout.trim()
        ));
    }
    if !output.is_file() || fs::metadata(&output).map(|m| m.len() < 1024).unwrap_or(true) {
        return Err("Caption preview renderer finished without a valid MP4.".to_string());
    }
    Ok(output.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_single_instance::init(
                |app, args, _cwd| {
                    println!(
                        "Snip AI received second-instance arguments: {:?}",
                        args
                    );

                    if let Some(url) = args
                        .iter()
                        .find(|arg| {
                            arg.starts_with("snipai://")
                        })
                    {
                        println!(
                            "Snip AI deep-link received: {}",
                            url
                        );

                        if let Some(window) =
                            app.get_webview_window("main")
                        {
                            let _ = window.set_focus();
                        }

                        if url.starts_with(
                            "snipai://payment/",
                        ) {
                            println!(
                                "Snip AI payment deep-link received: {}",
                                url
                            );

                            let _ = app.emit(
                                "snipai://payment/callback",
                                url.clone(),
                            );
                        } else if url.starts_with(
                            "snipai://auth/",
                        ) {
                            let _ = app.emit(
                                "snipai://auth/callback",
                                url.clone(),
                            );
                        }
                    }
                },
            ),
        )
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(
            tauri::generate_handler![
                greet,
                download_youtube,
                create_clips,
                create_auto_caption,
                cancel_processing,
                export_clips,
                render_caption_preview
            ],
        )
        .run(tauri::generate_context!())
        .expect(
            "error while running Tauri application"
        );
}
