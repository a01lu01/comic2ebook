use std::fs::{self, File};
use std::io::{self, BufReader, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::{
    api::AppError,
    models::{Job, JobResult},
    naming, scan,
};

pub fn pack_cbz(
    job: &Job,
    on_progress: &mut dyn FnMut(u32),
    cancelled: &AtomicBool,
) -> Result<JobResult, AppError> {
    let images = scan::list_images(Path::new(&job.folder_path))?;
    if images.is_empty() {
        return Err(AppError::custom(
            "E_NO_IMAGES",
            format!("文件夹中没有找到图片文件: {}", job.folder_path),
        ));
    }

    let base = format!("{}.cbz", naming::sanitize_filename(&job.comic_name));
    let (resolved, renamed) = naming::resolve_output_path(
        Path::new(&job.output_dir),
        &base,
        &job.overwrite_policy,
    )?;
    let output_path = Path::new(&job.output_dir).join(&resolved);

    let file = File::create(&output_path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let pad_len = images.len().to_string().len();
    let total = images.len() as u32;

    for (idx, img_name) in images.iter().enumerate() {
        if cancelled.load(Ordering::Relaxed) {
            drop(zip);
            let _ = fs::remove_file(&output_path);
            return Err(AppError::custom("E_CANCELLED", "打包已取消"));
        }

        let ext = Path::new(img_name)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e.to_lowercase()))
            .unwrap_or_default();
        let entry_name = format!("{:0width$}{}", idx + 1, ext, width = pad_len);
        let src_path = Path::new(&job.folder_path).join(img_name);

        zip.start_file(&entry_name, options)?;
        if ext == "png" {
            if let Some(normalized) = normalize_png(&src_path)? {
                zip.write_all(&normalized)?;
            } else {
                let mut reader = BufReader::new(File::open(&src_path)?);
                io::copy(&mut reader, &mut zip)?;
            }
        } else {
            let mut reader = BufReader::new(File::open(&src_path)?);
            io::copy(&mut reader, &mut zip)?;
        }

        let done = (idx + 1) as u32;
        if done % 10 == 0 || done == total {
            on_progress((done * 100 / total).min(100));
        }
    }

    zip.finish()?;
    Ok(JobResult {
        format: "cbz".into(),
        path: output_path.to_string_lossy().into_owned(),
        renamed: renamed.or(Some(resolved)),
        log_path: None,
    })
}

fn normalize_png(src: &Path) -> Result<Option<Vec<u8>>, AppError> {
    let raw = fs::read(src)?;
    if raw.len() < 26 || raw[0] != 0x89 || raw[1] != 0x50 {
        return Ok(None);
    }
    let color_type = raw[25];
    if color_type != 4 && color_type != 6 {
        return Ok(None);
    }

    let img = image::load_from_memory(&raw)?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let mut rgb = image::RgbImage::new(width, height);
    for (x, y, px) in rgba.enumerate_pixels() {
        let a = px[3] as f32 / 255.0;
        let blend = |c: u8| ((c as f32) * a + 255.0 * (1.0 - a)).round().clamp(0.0, 255.0) as u8;
        rgb.put_pixel(x, y, image::Rgb([blend(px[0]), blend(px[1]), blend(px[2])]));
    }

    let mut out = Vec::new();
    image::DynamicImage::ImageRgb8(rgb).write_to(
        &mut io::Cursor::new(&mut out),
        image::ImageFormat::Png,
    )?;
    Ok(Some(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        models::{Job, JobInput},
        settings::OverwritePolicy,
    };

    #[test]
    fn pack_small_cbz() {
        let dir = std::env::temp_dir().join("comic2ebook-pack-test");
        let out = dir.join("out");
        std::fs::create_dir_all(&out).unwrap();
        for name in ["1.jpg", "2.jpg", "3.jpg"] {
            std::fs::write(dir.join(name), format!("fake-image-{name}")).unwrap();
        }
        let job = Job::new(
            JobInput {
                comic_id: "c1".into(),
                comic_name: "测试漫画".into(),
                folder_path: dir.to_string_lossy().into_owned(),
                output_dir: out.to_string_lossy().into_owned(),
                formats: vec!["cbz".into()],
            },
            "recommended".into(),
            None,
            OverwritePolicy::Rename,
            600,
            true,
        );
        let cancel = AtomicBool::new(false);
        let mut progress = 0u32;
        let result = pack_cbz(&job, &mut |p| progress = p, &cancel).unwrap();
        assert_eq!(result.format, "cbz");
        assert!(std::path::Path::new(&result.path).exists());
        assert!(progress >= 100);
        let archive = zip::ZipArchive::new(File::open(&result.path).unwrap()).unwrap();
        let names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
        assert_eq!(names, vec!["1.jpg", "2.jpg", "3.jpg"]);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
