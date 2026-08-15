use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::{api::AppError, appdata};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum OutputMode {
    SameAsSource,
    FixedDir,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum OverwritePolicy {
    Rename,
    Overwrite,
    Fail,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConversionProfile {
    Recommended,
    Compatible,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode {
    System,
    Light,
    Dark,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub schema_version: u32,
    pub calibre_path: String,
    pub output_mode: OutputMode,
    #[serde(alias = "outputDir")]
    pub fixed_output_dir: String,
    pub overwrite_policy: OverwritePolicy,
    pub profile: ConversionProfile,
    pub packing_concurrency: u32,
    pub convert_concurrency: u32,
    pub theme_mode: ThemeMode,
    pub keep_logs: bool,
    pub selected_formats: Vec<String>,
    pub last_comic_dir: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            calibre_path: String::new(),
            output_mode: OutputMode::SameAsSource,
            fixed_output_dir: String::new(),
            overwrite_policy: OverwritePolicy::Rename,
            profile: ConversionProfile::Recommended,
            packing_concurrency: 2,
            convert_concurrency: 1,
            theme_mode: ThemeMode::System,
            keep_logs: true,
            selected_formats: vec!["cbz".to_string(), "pdf".to_string()],
            last_comic_dir: String::new(),
        }
    }
}

pub fn settings_path() -> PathBuf {
    appdata::resolve().join("settings.json")
}

pub fn load_settings() -> Settings {
    let path = settings_path();
    if !path.exists() {
        let settings = Settings::default();
        let _ = save_settings(&settings);
        return settings;
    }
    match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<Settings>(&raw) {
            Ok(settings) => settings,
            Err(_) => {
                backup_corrupt(&path);
                let settings = Settings::default();
                let _ = save_settings(&settings);
                settings
            }
        },
        Err(_) => {
            backup_corrupt(&path);
            let settings = Settings::default();
            let _ = save_settings(&settings);
            settings
        }
    }
}

pub fn save_settings(settings: &Settings) -> Result<(), AppError> {
    let path = settings_path();
    let dir = path.parent().ok_or_else(|| {
        AppError::custom("E_SETTINGS_PATH", "无法定位设置目录")
    })?;
    fs::create_dir_all(dir)?;
    let json = serde_json::to_string_pretty(settings)?;
    let tmp = path.with_extension("json.tmp");
    let mut file = fs::File::create(&tmp)?;
    file.write_all(json.as_bytes())?;
    file.sync_all()?;
    drop(file);
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(&tmp, &path)?;
    Ok(())
}

fn backup_corrupt(path: &Path) {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let backup = path.with_file_name(format!("settings.json.corrupt-{stamp}"));
    let _ = fs::rename(path, backup);
}
