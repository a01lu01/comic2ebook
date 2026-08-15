mod appdata;
mod api;
mod calibre;
mod convert;
mod logs;
mod models;
mod naming;
mod orchestrator;
mod pack;
mod scan;
mod settings;
mod ui_state;

use std::path::Path;

use tauri::{Manager, State};

use api::ApiError;
use models::{CalibreStatus, ComicPreview, JobInput, LogContent};
use orchestrator::JobManager;

#[tauri::command]
fn scan_folder(folder: String) -> Result<ComicPreview, ApiError> {
    scan::comic_preview(Path::new(&folder)).map_err(Into::into)
}

#[tauri::command]
async fn check_calibre(settings_path: Option<String>) -> CalibreStatus {
    let path = settings_path.unwrap_or_default();
    match calibre::detect_calibre(&path).await {
        Some(path) => CalibreStatus {
            found: true,
            path: Some(path),
        },
        None => CalibreStatus {
            found: false,
            path: None,
        },
    }
}

#[tauri::command]
fn get_settings() -> settings::Settings {
    settings::load_settings()
}

#[tauri::command]
fn save_settings(
    settings: settings::Settings,
    manager: State<'_, JobManager>,
) -> Result<settings::Settings, ApiError> {
    settings::save_settings(&settings)?;
    manager.update_settings(&settings);
    Ok(settings)
}

#[tauri::command]
async fn enqueue_jobs(
    jobs: Vec<JobInput>,
    manager: State<'_, JobManager>,
) -> Result<Vec<String>, ApiError> {
    let cfg = settings::load_settings();
    let calibre = if cfg.calibre_path.trim().is_empty() {
        calibre::detect_calibre("").await
    } else {
        Some(cfg.calibre_path.clone())
    };
    manager.enqueue(jobs, &cfg, calibre).map_err(Into::into)
}

#[tauri::command]
fn cancel_job(job_id: String, manager: State<'_, JobManager>) -> Result<(), ApiError> {
    manager.cancel(&job_id)
}

#[tauri::command]
fn clear_jobs(manager: State<'_, JobManager>) -> usize {
    manager.clear_all()
}

#[tauri::command]
fn retry_job(job_id: String, manager: State<'_, JobManager>) -> Result<String, ApiError> {
    manager.retry(&job_id)
}

#[tauri::command]
fn export_log(log_path: String) -> Result<LogContent, ApiError> {
    let content = logs::read_log(Path::new(&log_path))?;
    Ok(LogContent { path: log_path, content })
}

#[tauri::command]
fn get_ui_state() -> ui_state::UiState {
    ui_state::load()
}

#[tauri::command]
fn save_ui_state(
    order: Vec<String>,
    widths: std::collections::HashMap<String, i64>,
) -> Result<ui_state::UiState, ApiError> {
    ui_state::save(order, widths).map_err(Into::into)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: String,
    version: String,
    runtime: String,
}

#[tauri::command]
fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Comic2Ebook".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        runtime: format!("Tauri {} / Rust", tauri::VERSION),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let settings = settings::load_settings();
            let manager = JobManager::new(app.handle().clone(), &settings);
            app.manage(manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_folder,
            check_calibre,
            get_settings,
            save_settings,
            enqueue_jobs,
            cancel_job,
            clear_jobs,
            retry_job,
            export_log,
            get_ui_state,
            save_ui_state,
            get_app_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
