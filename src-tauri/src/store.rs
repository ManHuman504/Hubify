use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct App {
    pub id: String,
    pub name: String,
    pub path: String,
    pub icon: Option<String>, // base64 PNG
    #[serde(default)]
    pub group_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedApp {
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Store {
    pub apps: Vec<App>,
    pub groups: Vec<Group>,
    #[serde(default)]
    pub scanned_apps: Vec<DetectedApp>,
}

fn store_path(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .unwrap()
        .join("apps.json")
}

pub fn load(app_handle: &tauri::AppHandle) -> Store {
    let path = store_path(app_handle);
    if !path.exists() {
        return Store { apps: vec![], groups: vec![], scanned_apps: vec![] };
    }
    let data = fs::read_to_string(&path).unwrap_or_default();
    
    // Try current format
    if let Ok(store) = serde_json::from_str::<Store>(&data) {
        return store;
    }

    // Fallback for older formats
    #[derive(Deserialize)]
    struct LegacyStoreV1 { apps: Vec<App>, groups: Vec<Group> }
    if let Ok(legacy) = serde_json::from_str::<LegacyStoreV1>(&data) {
        return Store { apps: legacy.apps, groups: legacy.groups, scanned_apps: vec![] };
    }

    // Legacy: plain array of apps
    if let Ok(apps) = serde_json::from_str::<Vec<App>>(&data) {
        return Store { apps, groups: vec![], scanned_apps: vec![] };
    }

    Store { apps: vec![], groups: vec![], scanned_apps: vec![] }
}

pub fn save(app_handle: &tauri::AppHandle, store: &Store) {
    let path = store_path(app_handle);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, serde_json::to_string_pretty(store).unwrap());
}
