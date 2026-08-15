use std::path::PathBuf;

pub fn resolve() -> PathBuf {
    std::env::var("APPDATA")
        .map(|p| PathBuf::from(p).join("comic2ebook"))
        .unwrap_or_else(|_| std::env::temp_dir().join("comic2ebook"))
}

pub fn logs_dir() -> PathBuf {
    resolve().join("logs")
}
