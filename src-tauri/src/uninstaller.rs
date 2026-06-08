use serde::{Deserialize, Serialize};
use std::path::Path;
use winreg::enums::{HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER, KEY_READ, KEY_ALL_ACCESS};
use winreg::RegKey;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UninstallableApp {
    pub name: String,
    pub id: String, // registry key name
    pub uninstall_string: String,
    pub install_location: Option<String>,
    pub publisher: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Leftover {
    pub path: String,
    pub kind: String, // "folder" or "registry"
}

pub fn list_apps_fast(hints: Vec<String>) -> Vec<UninstallableApp> {
    let mut apps = Vec::new();
    let lower_hints: Vec<String> = hints.into_iter().map(|h| h.to_lowercase()).collect();

    let keys = [
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_CURRENT_USER,  r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];

    for (hive, path) in &keys {
        let root = RegKey::predef(*hive);
        let Ok(uninstall_key) = root.open_subkey_with_flags(path, KEY_READ) else { continue };

        for subkey_name in uninstall_key.enum_keys().filter_map(|k| k.ok()) {
            let Ok(subkey) = uninstall_key.open_subkey_with_flags(&subkey_name, KEY_READ) else { continue };

            let name = subkey.get_value::<String, _>("DisplayName").unwrap_or_default();
            if name.is_empty() { continue; }

            // If we have hints, only include apps that match the hints (fast path for Hubify managed apps)
            // If hints is empty, we do a full scan (but safely)
            if !lower_hints.is_empty() {
                let lower_name = name.to_lowercase();
                if !lower_hints.iter().any(|h| lower_name.contains(h)) {
                    continue;
                }
            }

            let uninstall_string = subkey.get_value::<String, _>("UninstallString").unwrap_or_default();
            if uninstall_string.is_empty() { continue; }

            apps.push(UninstallableApp {
                name,
                id: subkey_name,
                uninstall_string,
                install_location: subkey.get_value::<String, _>("InstallLocation").ok(),
                publisher: subkey.get_value::<String, _>("Publisher").ok(),
            });
        }
    }

    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

#[allow(dead_code)]
pub fn list_apps() -> Vec<UninstallableApp> {
    list_apps_fast(vec![])
}

pub fn find_leftovers(app_name: &str, publisher: Option<&str>) -> Vec<Leftover> {
    let mut leftovers = Vec::new();
    let lower_name = app_name.to_lowercase();
    let lower_publisher = publisher.map(|p| p.to_lowercase());

    // 1. Folders
    let common_dirs = [
        r"C:\Program Files",
        r"C:\Program Files (x86)",
        r"C:\ProgramData",
    ];

    // AppData dirs
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        scan_dir_for_leftovers(&local_app_data, &lower_name, lower_publisher.as_deref(), &mut leftovers);
    }
    if let Ok(roaming_app_data) = std::env::var("APPDATA") {
        scan_dir_for_leftovers(&roaming_app_data, &lower_name, lower_publisher.as_deref(), &mut leftovers);
    }
    // Check User Profile root too (some apps like .vscode, .docker etc)
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        scan_dir_for_leftovers(&user_profile, &lower_name, lower_publisher.as_deref(), &mut leftovers);
    }

    for dir in common_dirs {
        scan_dir_for_leftovers(dir, &lower_name, lower_publisher.as_deref(), &mut leftovers);
    }

    // 2. Registry
    let reg_roots = [
        (HKEY_LOCAL_MACHINE, "Software"),
        (HKEY_LOCAL_MACHINE, "Software\\WOW6432Node"),
        (HKEY_CURRENT_USER, "Software"),
    ];

    for (hive, path) in &reg_roots {
        let root = RegKey::predef(*hive);
        if let Ok(key) = root.open_subkey_with_flags(path, KEY_READ) {
            for subkey_name in key.enum_keys().filter_map(|k| k.ok()) {
                let lower_subkey = subkey_name.to_lowercase();
                
                // CRITICAL: Strict exclusion for system keys
                if is_system_key(&lower_subkey) {
                    continue;
                }

                if lower_subkey.contains(&lower_name) {
                    leftovers.push(Leftover {
                        path: format!("{}\\{}\\{}", if *hive == HKEY_LOCAL_MACHINE { "HKLM" } else { "HKCU" }, path, subkey_name),
                        kind: "registry".to_string(),
                    });
                } else if let Some(ref pub_name) = lower_publisher {
                    if lower_subkey.contains(pub_name) {
                        // Check if this publisher key has a subkey matching the app
                        if let Ok(pub_key) = key.open_subkey_with_flags(&subkey_name, KEY_READ) {
                            for app_subkey in pub_key.enum_keys().filter_map(|k| k.ok()) {
                                if app_subkey.to_lowercase().contains(&lower_name) {
                                    leftovers.push(Leftover {
                                        path: format!("{}\\{}\\{}\\{}", if *hive == HKEY_LOCAL_MACHINE { "HKLM" } else { "HKCU" }, path, subkey_name, app_subkey),
                                        kind: "registry".to_string(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    leftovers
}

fn is_system_key(name: &str) -> bool {
    matches!(name, "microsoft" | "windows" | "classes" | "clients" | "registeredapplications" | "policies" | "wow6432node")
}

fn scan_dir_for_leftovers(root: &str, app_name: &str, publisher: Option<&str>, results: &mut Vec<Leftover>) {
    let root_path = Path::new(root);
    if !root_path.exists() { return; }

    if let Ok(entries) = std::fs::read_dir(root_path) {
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_dir() { continue; }
            
            let name = path.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
            
            // CRITICAL: Never suggest deleting these
            if is_system_dir(&name) {
                continue;
            }

            // Direct match or contains
            if name.contains(app_name) {
                results.push(Leftover {
                    path: path.to_string_lossy().to_string(),
                    kind: "folder".to_string(),
                });
            } else if let Some(pub_name) = publisher {
                // If the folder is a publisher folder (e.g. Adobe, Google), scan inside it
                if name.contains(pub_name) {
                    if let Ok(sub_entries) = std::fs::read_dir(&path) {
                        for sub_entry in sub_entries.filter_map(|e| e.ok()) {
                            let sub_p = sub_entry.path();
                            if !sub_p.is_dir() { continue; }
                            let sub_n = sub_p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                            if sub_n.contains(app_name) {
                                results.push(Leftover {
                                    path: sub_p.to_string_lossy().to_string(),
                                    kind: "folder".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
}

fn is_system_dir(name: &str) -> bool {
    matches!(name, 
        "microsoft" | "windows" | "common files" | "desktop" | "temp" | "windowsnt" | "system32" |
        "documents" | "downloads" | "music" | "pictures" | "videos" | "favorites" | 
        "contacts" | "links" | "searches" | "saved games" | "onedrive" | "tracing"
    )
}


pub fn delete_leftover(leftover: &Leftover) -> Result<(), String> {
    if leftover.kind == "folder" {
        std::fs::remove_dir_all(&leftover.path).map_err(|e| e.to_string())
    } else {
        // Registry removal
        let (root_str, rest) = leftover.path.split_once('\\').ok_or("Invalid reg path")?;
        let hive = if root_str == "HKLM" { HKEY_LOCAL_MACHINE } else { HKEY_CURRENT_USER };
        let (parent_path, key_name) = rest.rsplit_once('\\').ok_or("Invalid reg path rest")?;
        
        let root = RegKey::predef(hive);
        let parent = root.open_subkey_with_flags(parent_path, KEY_ALL_ACCESS).map_err(|e| e.to_string())?;
        parent.delete_subkey_all(key_name).map_err(|e| e.to_string())
    }
}
