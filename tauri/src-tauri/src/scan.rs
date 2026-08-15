use std::cmp::Ordering;
use std::fs;
use std::path::Path;

use crate::{api::AppError, models::ComicPreview};

pub const IMAGE_EXTS: [&str; 6] = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"];

fn split_parts(s: &str) -> Vec<(bool, String)> {
    let mut parts: Vec<(bool, String)> = Vec::new();
    let mut current = String::new();
    let mut is_num = false;
    for ch in s.chars() {
        let digit = ch.is_ascii_digit();
        if current.is_empty() {
            is_num = digit;
            current.push(ch);
        } else if digit == is_num {
            current.push(ch);
        } else {
            parts.push((is_num, std::mem::take(&mut current)));
            is_num = digit;
            current.push(ch);
        }
    }
    if !current.is_empty() {
        parts.push((is_num, current));
    }
    parts
}

pub fn natural_sort(a: &str, b: &str) -> Ordering {
    let ap = split_parts(a);
    let bp = split_parts(b);
    for (i, (an, at)) in ap.iter().enumerate() {
        let Some((bn, bt)) = bp.get(i) else {
            return Ordering::Greater;
        };
        if *an && *bn {
            let av = at.parse::<u64>().unwrap_or(0);
            let bv = bt.parse::<u64>().unwrap_or(0);
            let ord = av.cmp(&bv);
            if ord != Ordering::Equal {
                return ord;
            }
            let tie = at.len().cmp(&bt.len());
            if tie != Ordering::Equal {
                return tie;
            }
        } else if *an != *bn {
            return if *an { Ordering::Greater } else { Ordering::Less };
        } else {
            let ord = at.cmp(bt);
            if ord != Ordering::Equal {
                return ord;
            }
        }
    }
    ap.len().cmp(&bp.len())
}

pub fn is_image(name: &str) -> bool {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_lowercase()))
        .unwrap_or_default();
    IMAGE_EXTS.contains(&ext.as_str())
}

pub fn list_images(dir: &Path) -> Result<Vec<String>, AppError> {
    let mut names: Vec<String> = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_image(&name) {
                names.push(name);
            }
        }
    }
    names.sort_by(|a, b| natural_sort(a, b));
    Ok(names)
}

pub fn comic_preview(dir: &Path) -> Result<ComicPreview, AppError> {
    let images = list_images(dir)?;
    if images.is_empty() {
        return Err(AppError::custom(
            "E_NO_IMAGES",
            format!("文件夹中没有找到图片文件: {}", dir.display()),
        ));
    }
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for name in &images {
        let ext = Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_uppercase();
        *counts.entry(ext).or_insert(0) += 1;
    }
    let main_ext = counts
        .into_iter()
        .max_by_key(|(_, n)| *n)
        .map(|(e, _)| e)
        .unwrap_or_default();
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(ComicPreview {
        path: dir.to_string_lossy().into_owned(),
        name,
        image_count: images.len(),
        main_ext,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_order_without_padding() {
        let mut v = vec!["10.jpg", "2.jpg", "1.jpg", "9.jpg"];
        v.sort_by(|a, b| natural_sort(a, b));
        assert_eq!(v, vec!["1.jpg", "2.jpg", "9.jpg", "10.jpg"]);
    }

    #[test]
    fn natural_order_with_padding() {
        let mut v = vec!["010.jpg", "001.jpg", "002.jpg"];
        v.sort_by(|a, b| natural_sort(a, b));
        assert_eq!(v, vec!["001.jpg", "002.jpg", "010.jpg"]);
    }

    #[test]
    fn natural_order_chinese() {
        let mut v = vec!["第10页.jpg", "第2页.jpg", "第1页.jpg"];
        v.sort_by(|a, b| natural_sort(a, b));
        assert_eq!(v, vec!["第1页.jpg", "第2页.jpg", "第10页.jpg"]);
    }
}
