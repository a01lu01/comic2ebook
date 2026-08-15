use std::path::Path;

use crate::{
    api::AppError,
    settings::OverwritePolicy,
};

const FORBIDDEN: &str = "<>:\"/\\|?*";

pub fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if FORBIDDEN.contains(c) { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim_end_matches([' ', '.']).to_string();
    let stem = Path::new(&cleaned)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if reserved.contains(&stem.as_str()) {
        return format!("_{cleaned}");
    }
    cleaned
}

pub fn resolve_output_path(
    dir: &Path,
    base_name: &str,
    policy: &OverwritePolicy,
) -> Result<(String, Option<String>), AppError> {
    let ext = Path::new(base_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_string();
    let stem = Path::new(base_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(base_name)
        .to_string();

    match policy {
        OverwritePolicy::Overwrite => Ok((base_name.to_string(), None)),
        OverwritePolicy::Fail => {
            let full = dir.join(base_name);
            if full.exists() {
                Err(AppError::custom(
                    "E_OUTPUT_EXISTS",
                    format!("输出文件已存在: {}", full.display()),
                ))
            } else {
                Ok((base_name.to_string(), None))
            }
        }
        OverwritePolicy::Rename => {
            let mut counter = 0;
            loop {
                let candidate = if counter == 0 {
                    base_name.to_string()
                } else if ext.is_empty() {
                    format!("{stem} ({counter})")
                } else {
                    format!("{stem} ({counter}).{ext}")
                };
                if !dir.join(&candidate).exists() {
                    return Ok((candidate.clone(), (counter > 0).then_some(candidate.clone())));
                }
                counter += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::OverwritePolicy;

    #[test]
    fn sanitize_forbidden_chars() {
        assert_eq!(
            sanitize_filename("a:b*c?d"),
            "a_b_c_d"
        );
    }

    #[test]
    fn sanitize_reserved_name() {
        assert_eq!(sanitize_filename("CON.pdf"), "_CON.pdf");
    }

    #[test]
    fn rename_conflict_picks_next() {
        let dir = std::env::temp_dir().join("comic2ebook-naming-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("book.pdf"), b"x").unwrap();
        let (name, renamed) = resolve_output_path(&dir, "book.pdf", &OverwritePolicy::Rename).unwrap();
        assert_eq!(name, "book (1).pdf");
        assert!(renamed.is_some());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn overwrite_policy_returns_base() {
        let (name, renamed) = resolve_output_path(Path::new("."), "x.cbz", &OverwritePolicy::Overwrite).unwrap();
        assert_eq!(name, "x.cbz");
        assert!(renamed.is_none());
    }
}
