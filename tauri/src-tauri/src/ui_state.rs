use std::collections::HashMap;
use std::fs;
use std::io::Write;

use serde::{Deserialize, Serialize};

use crate::{api::AppError, appdata};

pub const DEFAULT_ORDER: [&str; 5] = ["comic", "status", "progress", "formats", "actions"];
pub const DEFAULT_WIDTHS: [(&str, i64); 5] = [
    ("comic", 240),
    ("status", 110),
    ("progress", 160),
    ("formats", 300),
    ("actions", 180),
];
pub const MIN_WIDTHS: [(&str, i64); 5] = [
    ("comic", 120),
    ("status", 90),
    ("progress", 120),
    ("formats", 160),
    ("actions", 140),
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiState {
    pub order: Vec<String>,
    pub widths: HashMap<String, i64>,
}

impl Default for UiState {
    fn default() -> Self {
        Self {
            order: DEFAULT_ORDER.iter().map(|s| s.to_string()).collect(),
            widths: DEFAULT_WIDTHS
                .iter()
                .map(|(k, v)| (k.to_string(), *v))
                .collect(),
        }
    }
}

pub fn ui_state_path() -> std::path::PathBuf {
    appdata::resolve().join("ui_state.json")
}

pub fn load() -> UiState {
    let path = ui_state_path();
    if !path.exists() {
        return UiState::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save(order: Vec<String>, widths: HashMap<String, i64>) -> Result<UiState, AppError> {
    let mut state = UiState::default();
    if !order.is_empty() {
        state.order = order;
    }
    for (key, min) in MIN_WIDTHS {
        if let Some(v) = widths.get(key) {
            state.widths.insert(key.to_string(), (*v).max(min));
        }
    }
    let path = ui_state_path();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_string_pretty(&state)?;
    let tmp = path.with_extension("json.tmp");
    let mut f = fs::File::create(&tmp)?;
    f.write_all(json.as_bytes())?;
    f.sync_all()?;
    drop(f);
    if path.exists() {
        fs::remove_file(&path)?;
    }
    fs::rename(&tmp, &path)?;
    Ok(state)
}
