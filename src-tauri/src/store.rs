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
pub struct Store {
    pub apps: Vec<App>,
    pub groups: Vec<Group>,
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
        return Store { apps: vec![], groups: vec![] };
    }
    let data = fs::read_to_string(&path).unwrap_or_default();
    // Try new format first, fall back to legacy array
    if let Ok(store) = serde_json::from_str::<Store>(&data) {
        return store;
    }
    // Legacy: plain array of apps
    let apps: Vec<App> = serde_json::from_str(&data).unwrap_or_default();
    Store { apps, groups: vec![] }
}

pub fn save(app_handle: &tauri::AppHandle, store: &Store) {
    let path = store_path(app_handle);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, serde_json::to_string_pretty(store).unwrap());
}
