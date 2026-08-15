use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::process::Command;

pub async fn detect_calibre(settings_path: &str) -> Option<String> {
    let configured = settings_path.trim().to_string();
    if !configured.is_empty() && looks_like_calibre(Path::new(&configured)).await {
        return Some(configured);
    }
    if let Some(found) = find_in_path().await {
        return Some(found);
    }
    for candidate in common_paths() {
        if looks_like_calibre(&candidate).await {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

async fn looks_like_calibre(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let mut cmd = Command::new(path);
    cmd.arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let result = tokio::time::timeout(Duration::from_secs(5), cmd.status()).await;
    matches!(result, Ok(Ok(status)) if status.success())
}

async fn find_in_path() -> Option<String> {
    let path_var = std::env::var("PATH").unwrap_or_default();
    for dir in std::env::split_paths(&path_var) {
        for name in ["ebook-convert.exe", "ebook-convert"] {
            let candidate = dir.join(name);
            if looks_like_calibre(&candidate).await {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}

fn common_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        out.push(PathBuf::from(appdata).join("Calibre2").join("ebook-convert.exe"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        out.push(
            PathBuf::from(local)
                .join("Programs")
                .join("Calibre")
                .join("ebook-convert.exe"),
        );
    }
    out.push(PathBuf::from("C:\\Program Files\\Calibre2\\ebook-convert.exe"));
    out.push(PathBuf::from(
        "C:\\Program Files (x86)\\Calibre2\\ebook-convert.exe",
    ));
    out
}
