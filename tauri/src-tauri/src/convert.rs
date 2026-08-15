use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use regex::Regex;

use crate::{
    api::AppError,
    logs,
    models::Job,
    naming, settings::ConversionProfile,
};

#[derive(Clone, Debug)]
pub struct ConvertProgress {
    pub percent: Option<u32>,
    pub chunk: Option<String>,
    pub is_error: bool,
}

#[derive(Debug)]
pub struct ConvertOutcome {
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub path: String,
    pub renamed: Option<String>,
    pub log_path: Option<String>,
}

pub fn build_calibre_args(format: &str, profile: &ConversionProfile) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    match profile {
        ConversionProfile::Recommended => {
            args.extend(
                [
                    "--no-process",
                    "--dont-grayscale",
                    "--dont-normalize",
                    "--dont-sharpen",
                    "--landscape",
                ]
                .map(String::from),
            );
            match format {
                "pdf" => args.extend(
                    [
                        "--paper-size=a4",
                        "--pdf-page-margin-top=0",
                        "--pdf-page-margin-bottom=0",
                        "--pdf-page-margin-left=0",
                        "--pdf-page-margin-right=0",
                    ]
                    .map(String::from),
                ),
                "epub" => args.extend(
                    [
                        "--no-chapters-in-toc",
                        "--prefer-metadata-cover",
                        "--preserve-cover-aspect-ratio",
                        "--no-default-epub-cover",
                    ]
                    .map(String::from),
                ),
                "mobi" => args.extend(
                    [
                        "--no-chapters-in-toc",
                        "--prefer-metadata-cover",
                        "--mobi-keep-original-images",
                        "--mobi-file-type=new",
                    ]
                    .map(String::from),
                ),
                "azw3" => args.extend(
                    ["--no-chapters-in-toc", "--prefer-metadata-cover"].map(String::from),
                ),
                _ => {}
            }
        }
        ConversionProfile::Compatible => match format {
            "epub" => args.push("--no-default-epub-cover".into()),
            "mobi" => args.push("--mobi-keep-original-images".into()),
            _ => {}
        },
    }
    args
}

pub fn convert(
    job: &Job,
    format: &str,
    calibre_path: &str,
    source: &str,
    log_path: Option<&Path>,
    on_progress: &mut dyn FnMut(ConvertProgress),
    cancelled: &AtomicBool,
) -> Result<ConvertOutcome, AppError> {
    let safe_name = naming::sanitize_filename(&job.comic_name);
    let base = format!("{safe_name}.{format}");
    let (resolved, renamed) = naming::resolve_output_path(
        Path::new(&job.output_dir),
        &base,
        &job.overwrite_policy,
    )?;
    let dst_path: PathBuf = Path::new(&job.output_dir).join(&resolved);
    let profile = if job.profile == "compatible" {
        ConversionProfile::Compatible
    } else {
        ConversionProfile::Recommended
    };
    let params = build_calibre_args(format, &profile);

    if let Some(log) = log_path {
        logs::append_log(
            log,
            &format!(
                "# Command: {} {} {}\n",
                calibre_path,
                source,
                params.join(" ")
            ),
        );
    }

    let mut cmd = std::process::Command::new(calibre_path);
    cmd.arg(source)
        .arg(&dst_path)
        .args(&params)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| {
        AppError::custom(
            "E_CALIBRE_SPAWN",
            format!("无法启动 ebook-convert（{calibre_path}）: {e}"),
        )
    })?;

    let stdout = child.stdout.take().expect("stdout should be piped");
    let stderr = child.stderr.take().expect("stderr should be piped");
    let (tx, rx) = mpsc::channel::<(String, bool)>();

    let tx_out = tx.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if let Ok(line) = line {
                let _ = tx_out.send((line, false));
            }
        }
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            if let Ok(line) = line {
                let _ = tx.send((line, true));
            }
        }
    });

    let progress_re = Regex::new(r"(\d+)%").unwrap();
    let started = Instant::now();
    let timeout = Duration::from_secs(job.timeout_secs.max(60));
    let exit_code;

    loop {
        while let Ok((line, is_error)) = rx.try_recv() {
            handle_line(
                &line,
                is_error,
                log_path,
                &progress_re,
                on_progress,
            );
        }
        if cancelled.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::custom("E_CANCELLED", "转换已取消"));
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::custom(
                "E_TIMEOUT",
                format!("转换超时（{} 分钟）", job.timeout_secs / 60),
            ));
        }
        if let Some(status) = child.try_wait()? {
            exit_code = status.code();
            break;
        }
        thread::sleep(Duration::from_millis(50));
    }

    while let Ok((line, is_error)) = rx.recv() {
        handle_line(
            &line,
            is_error,
            log_path,
            &progress_re,
            on_progress,
        );
    }

    if let Some(log) = log_path {
        logs::append_log(
            log,
            &format!("\n# ExitCode: {}\n", exit_code.unwrap_or(-1)),
        );
    }

    Ok(ConvertOutcome {
        ok: exit_code == Some(0),
        exit_code,
        path: dst_path.to_string_lossy().into_owned(),
        renamed: renamed.or(Some(resolved)),
        log_path: log_path.map(|p| p.to_string_lossy().into_owned()),
    })
}

fn handle_line(
    line: &str,
    is_error: bool,
    log_path: Option<&Path>,
    progress_re: &Regex,
    on_progress: &mut dyn FnMut(ConvertProgress),
) {
    if let Some(log) = log_path {
        logs::append_log(log, &format!("{line}\n"));
    }
    on_progress(ConvertProgress {
        percent: None,
        chunk: Some(line.to_string()),
        is_error,
    });
    if let Some(caps) = progress_re.captures(line) {
        if let Some(m) = caps.get(1) {
            if let Ok(pct) = m.as_str().parse::<u32>() {
                on_progress(ConvertProgress {
                    percent: Some(pct.min(100)),
                    chunk: None,
                    is_error: false,
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        models::{Job, JobInput},
        pack,
        settings::OverwritePolicy,
    };
    use std::path::{Path, PathBuf};
    use std::sync::atomic::AtomicBool;

    #[test]
    fn recommended_args_are_stable() {
        let args = build_calibre_args("pdf", &ConversionProfile::Recommended);
        assert!(args.iter().any(|a| a == "--landscape"));
        assert!(args.iter().any(|a| a == "--paper-size=a4"));
        assert!(!args.iter().any(|a| a == "--pdf-default-font-size=0"));
    }

    #[test]
    fn compatible_args_are_minimal() {
        let args = build_calibre_args("mobi", &ConversionProfile::Compatible);
        assert_eq!(args, vec!["--mobi-keep-original-images"]);
    }

    fn find_calibre() -> Option<PathBuf> {
        let candidates = [
            std::env::var("LOCALAPPDATA")
                .ok()
                .map(|p| PathBuf::from(p).join("Programs/Calibre/ebook-convert.exe")),
            std::env::var("APPDATA")
                .ok()
                .map(|p| PathBuf::from(p).join("Calibre2/ebook-convert.exe")),
            Some(PathBuf::from("C:\\Program Files\\Calibre2\\ebook-convert.exe")),
        ];
        candidates.into_iter().flatten().find(|p| p.is_file())
    }

    #[test]
    fn calibre_converts_packed_cbz_when_available() {
        let Some(calibre) = find_calibre() else {
            eprintln!("Calibre not found, skipping integration test");
            return;
        };
        let dir = std::env::temp_dir().join("comic2ebook-calibre-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../samples/Comic-A-1-10");
        for (i, name) in ["1.jpg", "2.jpg"].iter().enumerate() {
            std::fs::copy(sample.join(name), dir.join(format!("{}.jpg", i + 1))).unwrap();
        }
        let out = dir.join("out");
        std::fs::create_dir_all(&out).unwrap();
        let mut job = Job::new(
            JobInput {
                comic_id: "c1".into(),
                comic_name: "测试漫画".into(),
                folder_path: dir.to_string_lossy().into_owned(),
                output_dir: out.to_string_lossy().into_owned(),
                formats: vec!["pdf".into()],
            },
            "recommended".into(),
            Some(calibre.to_string_lossy().into_owned()),
            OverwritePolicy::Rename,
            600,
            true,
        );
        job.rebuild_sub_tasks();
        let cancel = AtomicBool::new(false);
        let cbz = pack::pack_cbz(&job, &mut |_| {}, &cancel).unwrap();
        let log = dir.join("convert.log");
        let outcome = convert(
            &job,
            "pdf",
            &calibre.to_string_lossy(),
            &cbz.path,
            Some(&log),
            &mut |_| {},
            &cancel,
        )
        .unwrap();
        assert!(
            outcome.ok,
            "calibre failed: {}",
            std::fs::read_to_string(&log).unwrap_or_default()
        );
        assert!(Path::new(&outcome.path).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
