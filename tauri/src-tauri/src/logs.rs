use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::{api::AppError, appdata, naming::sanitize_filename};

const MAX_LOG_FILES: usize = 100;

pub fn logs_dir() -> PathBuf {
    appdata::logs_dir()
}

pub fn create_log(comic_name: &str, format: &str) -> Result<PathBuf, AppError> {
    prune_logs();
    let dir = logs_dir();
    fs::create_dir_all(&dir)?;
    let safe = sanitize_filename(comic_name);
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let path = dir.join(format!("{safe}_{format}_{ts}.log"));
    let header = format!(
        "# Comic2Ebook Calibre Log\n# Time: {}\n# Format: {format}\n\n",
        chrono::Local::now().to_rfc3339()
    );
    fs::write(&path, header)?;
    Ok(path)
}

pub fn append_log(path: &Path, text: &str) {
    if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = f.write_all(text.as_bytes());
    }
}

pub fn read_log(path: &Path) -> Result<String, AppError> {
    Ok(fs::read_to_string(path)?)
}

pub fn prune_logs() {
    let dir = logs_dir();
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    let mut files: Vec<(PathBuf, std::time::SystemTime)> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .ends_with(".log")
        })
        .filter_map(|e| {
            let path = e.path();
            let modified = e.metadata().ok().and_then(|m| m.modified().ok());
            modified.map(|t| (path, t))
        })
        .collect();
    files.sort_by_key(|(_, t)| *t);
    while files.len() > MAX_LOG_FILES {
        if let Some((path, _)) = files.first() {
            let _ = fs::remove_file(path);
        }
        files.remove(0);
    }
}
