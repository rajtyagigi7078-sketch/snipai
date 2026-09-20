use tauri::{Emitter, Manager};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

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

    let clipper_dir = manifest_dir
        .parent()
        .ok_or_else(|| {
            "Could not resolve clipper directory.".to_string()
        })?;

    let project_root = clipper_dir
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
    if let Ok(runtime_root) = resolve_runtime_root(app) {
        let python_dir = runtime_root.join("python");

        let candidates = if cfg!(target_os = "windows") {
            vec![
                python_dir.join("Scripts").join("python.exe"),
                python_dir.join("Scripts").join("python"),
            ]
        } else {
            vec![
                python_dir.join("bin").join("python"),
                python_dir.join("bin").join("python3"),
            ]
        };

        for candidate in candidates {
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    let project_root = resolve_project_root()?;

    let venv = project_root
        .join("clipper")
        .join(".whisper-venv");

    let candidates = if cfg!(target_os = "windows") {
        vec![
            venv.join("Scripts").join("python.exe"),
            venv.join("Scripts").join("python"),
        ]
    } else {
        vec![
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
        "Snip AI Python environment was not found.\n\
Expected bundled runtime or development environment."
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

    let runner = project_root.join("pipeline_runner.py");

    if !runner.is_file() {
        return Err(format!(
            "Pipeline runner not found:\n{}",
            runner.display()
        ));
    }

    Ok(runner)
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
fn download_youtube(
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
        return Err(
            "YouTube URL cannot be empty.".to_string()
        );
    }

    if !(url.starts_with("https://www.youtube.com/")
        || url.starts_with("https://youtube.com/")
        || url.starts_with("https://m.youtube.com/")
        || url.starts_with("https://youtu.be/"))
    {
        return Err(
            "Please enter a valid YouTube URL.".to_string()
        );
    }

    let python = resolve_python(&app)?;

    let download_dir = dirs::download_dir()
        .ok_or_else(|| {
            "Could not find your Downloads folder."
                .to_string()
        })?
        .join("Snip AI Downloads");

    fs::create_dir_all(&download_dir)
        .map_err(|error| {
            format!(
                "Could not create Snip AI Downloads folder:\n{}",
                error
            )
        })?;

    println!(
        "Download folder: {}",
        download_dir.display()
    );

    let output_template =
        download_dir.join("%(title).120s.%(ext)s");

    let output = Command::new(&python)
        .args([
            "-m",
            "yt_dlp",
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
        .map_err(|error| {
            format!(
                "Failed to start YouTube downloader:\n{}",
                error
            )
        })?;

    if !output.status.success() {
        let stderr =
            String::from_utf8_lossy(&output.stderr);

        let stdout =
            String::from_utf8_lossy(&output.stdout);

        return Err(format!(
            "YouTube download failed.\n\n{}\n{}",
            stderr.trim(),
            stdout.trim()
        ));
    }

    let stdout =
        String::from_utf8_lossy(&output.stdout);

    let mut downloaded_path: Option<PathBuf> = None;

    for line in stdout.lines().rev() {
        let candidate = PathBuf::from(line.trim());

        if candidate.is_file() {
            downloaded_path = Some(candidate);
            break;
        }
    }

    let downloaded_path = downloaded_path
        .ok_or_else(|| {
            format!(
                "Download completed but Snip AI could not find the downloaded video.\n\n{}",
                stdout.trim()
            )
        })?;

    println!(
        "Downloaded: {}",
        downloaded_path.display()
    );

    println!("==============================================");

    Ok(downloaded_path.to_string_lossy().to_string())
}

// ------------------------------------------------------------
// REAL SNIP AI PIPELINE
// ------------------------------------------------------------

#[tauri::command]
fn create_clips(
    app: tauri::AppHandle,
    input_path: String,
    format: String,
    requested_clips: u32,
    caption_template: String,
    different_captions: bool,
) -> Result<Vec<String>, String> {
    println!();
    println!("==============================================");
    println!("SNIP AI — CREATE CLIPS");
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
        "Reveal",
        "Reveal Cyan",
        "Reveal Pink",
        "Reveal Lime",
        "Snap",
        "Snap Gold",
        "Snap Cyan",
        "Snap Lime",
        "Headline",
        "Headline Bottom",
        "Headline Yellow",
        "Headline Red",
        "Hype",
        "Hype Blue",
        "Hype Green",
        "Hype Purple",
        "MrBeast",
        "Minimal",
        "Podcast",
        "Highlight",
        "Clean",
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

    let output_dir =
        resolve_output_dir()?;

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

    remove_old_generated_clips(&output_dir)?;

    println!();
    println!("Starting Snip AI pipeline...");

    let mut child = Command::new(&python)
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
        .env(
            "SNIP_AI_RUNTIME_ROOT",
            &runtime_root,
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
        .current_dir(
            runtime_root.join("pipeline"),
        )
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| {
            format!(
                "Failed to start Snip AI pipeline:\n{}",
                error
            )
        })?;

    let status = child
        .wait()
        .map_err(|error| {
            format!(
                "Failed while waiting for Snip AI pipeline:\n{}",
                error
            )
        })?;

    if !status.success() {
        return Err(format!(
            "Snip AI pipeline failed.\nExit status: {}",
            status
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
    println!("SNIP AI — GENERATED CLIPS");
    println!("==============================================");
    println!("Count: {}", output_paths.len());

    for path in &output_paths {
        println!("{}", path);
    }

    println!("==============================================");
    println!();

    Ok(output_paths)
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
        "SNIP AI — EXPORTED {} CLIPS",
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
                export_clips
            ],
        )
        .run(tauri::generate_context!())
        .expect(
            "error while running Tauri application"
        );
}
