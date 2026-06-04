mod store;
mod icon;
mod process;
mod network;
mod winget;
mod scoop;
mod choco;
mod setup;
mod job;
mod db;
mod autostart;
mod uninstaller;
mod everything;
mod keybinds;
mod guardian;
mod diskmap;
mod updater;

use store::{App, Group, Store, CustomTheme};
use db::{DailyActivity, AppStat, TodaySummary};
use tauri::{Manager, Emitter};
use window_vibrancy::{apply_mica, apply_acrylic};
use serde::{Serialize, Deserialize};
use network::ConnectionInfo;
use std::thread;
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use std::time::Duration;

#[derive(Serialize)]
struct AppMetrics {
    running: bool,
    pid: Option<u32>,
    cpu: f32,
    mem_mb: f64,
    connections: u32,
    recv_kb: f64,
    sent_kb: f64,
    connections_detail: Vec<ConnectionInfo>,
    is_autostart: bool,
}

// ── Everything ──────────────────────────────────────────────────────────────

#[tauri::command]
async fn everything_search(query: String, limit: usize, ext_filter: Option<String>) -> Result<Vec<everything::EverythingResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        everything::search(&query, limit, ext_filter.as_deref())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn everything_search_apps(query: String, limit: usize) -> Result<Vec<everything::EverythingResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        everything::search_apps(&query, limit)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn is_indexer_ready() -> bool {
    tauri::async_runtime::spawn_blocking(|| {
        everything::is_indexer_ready()
    }).await.unwrap_or(false)
}

// ── Apps ────────────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_store(app: tauri::AppHandle) -> Store {
    tauri::async_runtime::spawn_blocking(move || {
        store::load(&app)
    }).await.unwrap_or_else(|_| store::Store {
        apps: vec![], groups: vec![], scanned_apps: vec![],
        theme: store::ThemeConfig::default(),
        guardian_enabled: true,
        update_check_enabled: true,
    })
}

#[tauri::command]
async fn add_app(app: tauri::AppHandle, path: String, name: Option<String>, group_id: Option<String>) -> Result<App, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exe_name = std::path::Path::new(&path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Unknown".into());

        let entry = App {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.unwrap_or(exe_name),
            icon: icon::extract_icon(&path),
            path,
            group_id,
            hotkey: None,
        };

        let mut s = store::load(&app);
        s.apps.push(entry.clone());
        store::save(&app, &s);
        Ok(entry)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn remove_app(app: tauri::AppHandle, id: String) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let mut s = store::load(&app);
        s.apps.retain(|a| a.id != id);
        store::save(&app, &s);
    }).await;
}

// ── Theme commands ───────────────────────────────────────────────────────────

#[tauri::command]
async fn set_active_theme(app: tauri::AppHandle, theme_id: String) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let mut s = store::load(&app);
        s.theme.active = theme_id;
        store::save(&app, &s);
    }).await;
}

#[tauri::command]
async fn save_custom_theme(app: tauri::AppHandle, theme: CustomTheme) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let mut s = store::load(&app);
        if let Some(idx) = s.theme.custom_themes.iter().position(|t| t.id == theme.id) {
            s.theme.custom_themes[idx] = theme;
        } else {
            s.theme.custom_themes.push(theme);
        }
        store::save(&app, &s);
    }).await;
}

#[tauri::command]
async fn delete_custom_theme(app: tauri::AppHandle, theme_id: String) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let mut s = store::load(&app);
        s.theme.custom_themes.retain(|t| t.id != theme_id);
        if s.theme.active == theme_id {
            s.theme.active = "dark".to_string();
        }
        store::save(&app, &s);
    }).await;
}

// ── Analytics commands ─────────────────────────────────────────────────────────

#[tauri::command]
async fn get_daily_activity(app: tauri::AppHandle, days: i64) -> Result<Vec<DailyActivity>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        db::get_daily_activity(&app, days).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_app_stats(app: tauri::AppHandle) -> Result<Vec<AppStat>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut stats = db::get_app_stats(&app).map_err(|e| e.to_string())?;
        let s = store::load(&app);
        for stat in &mut stats {
            stat.name = s.apps.iter()
                .find(|a| a.path == stat.path)
                .map(|a| a.name.clone())
                .unwrap_or_else(|| stat.path.rsplit('\\').next().unwrap_or(&stat.path).trim_end_matches(".exe").to_string());
        }
        Ok(stats)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_today_summary(app: tauri::AppHandle) -> Result<TodaySummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        db::get_today_summary(&app).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_app_daily_detail(app: tauri::AppHandle, app_path: String, days: i64) -> Result<Vec<db::AppDailyDetail>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        db::get_app_daily_detail(&app, &app_path, days).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_app_network_activity(app: tauri::AppHandle, app_path: String, limit: i64) -> Result<Vec<db::NetworkRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        db::get_app_network_activity(&app, &app_path, limit).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_app_hourly(app: tauri::AppHandle, app_path: String) -> Result<Vec<(String, f64)>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        db::get_app_hourly(&app, &app_path).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_app_hotkey(app: tauri::AppHandle, app_id: String, hotkey: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = store::load(&app);
        if let Some(entry) = s.apps.iter_mut().find(|a| a.id == app_id) {
            entry.hotkey = hotkey;
            store::save(&app, &s);
            keybinds::register_all(&app);
            Ok(())
        } else {
            Err(format!("App {} not found", app_id))
        }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_global_hotkey(app: tauri::AppHandle, _hotkey: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        keybinds::register_all(&app);
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn move_app_to_group(app: tauri::AppHandle, app_id: String, group_id: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = store::load(&app);
        if let Some(entry) = s.apps.iter_mut().find(|a| a.id == app_id) {
            entry.group_id = group_id;
            store::save(&app, &s);
            Ok(())
        } else {
            Err(format!("App {} not found", app_id))
        }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn launch_app(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        focus_or_launch(&path)
    }).await.map_err(|e| e.to_string())?
}

#[derive(serde::Deserialize)]
struct TrayApp {
    name: String,
    path: String,
}

#[tauri::command]
fn update_tray_menu(app_handle: tauri::AppHandle, active_apps: Vec<TrayApp>) -> Result<(), String> {
    let menu = Menu::new(&app_handle).map_err(|e| e.to_string())?;
    
    if active_apps.is_empty() {
        let empty = MenuItem::with_id(&app_handle, "empty", "No active apps", false, None::<&str>).unwrap();
        let _ = menu.append(&empty);
    } else {
        for app in active_apps {
            let item = MenuItem::with_id(&app_handle, app.path.clone(), &app.name, true, None::<&str>).unwrap();
            let _ = menu.append(&item);
        }
    }
    
    let sep = PredefinedMenuItem::separator(&app_handle).unwrap();
    let _ = menu.append(&sep);
    let quit_i = MenuItem::with_id(&app_handle, "quit", "Quit Hubify", true, None::<&str>).unwrap();
    let _ = menu.append(&quit_i);

    if let Some(tray) = app_handle.tray_by_id("main_tray") {
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
async fn get_process_info(path: String) -> Result<process::ProcessInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        process::get_process_info(&path)
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_processes_info(paths: Vec<String>) -> Result<std::collections::HashMap<String, process::ProcessInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        process::get_processes_info(&paths)
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn kill_app(path: String) -> bool {
    process::kill_process(&path)
}

/// Focus an existing window of a running app, or launch it if not running
fn focus_or_launch(path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let info = process::get_process_info(path);
        if info.running {
            if let Some(pid) = info.pid {
                unsafe {
                    use windows::Win32::UI::WindowsAndMessaging::*;
                    use windows::Win32::Foundation::*;
                    use std::sync::Mutex;

                    let result: Mutex<isize> = Mutex::new(0);
                    let result_ptr = LPARAM(&result as *const _ as isize);

                    extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
                        unsafe {
                            let result = &*(lparam.0 as *const Mutex<isize>);
                            let mut window_pid: u32 = 0;
                            let target_pid = *result.lock().unwrap() as u32;
                            let _ = GetWindowThreadProcessId(hwnd, Some(&mut window_pid));
                            if window_pid == target_pid {
                                *result.lock().unwrap() = hwnd.0 as isize;
                                return FALSE;
                            }
                        }
                        TRUE
                    }

                    *result.lock().unwrap() = pid as isize;
                    let _ = EnumWindows(Some(enum_proc), result_ptr);

                    let hwnd_val = *result.lock().unwrap();
                    if hwnd_val != pid as isize && hwnd_val != 0 {
                        let hwnd = HWND(hwnd_val as *mut _);
                        if IsIconic(hwnd).as_bool() {
                            let _ = ShowWindow(hwnd, SW_RESTORE);
                        }
                        let _ = SetForegroundWindow(hwnd);
                        return Ok(());
                    }
                }
            }
        }
    }

    // Try direct spawn first so the app becomes a child process of Hubify
    let path_lower = path.to_lowercase();
    if path_lower.ends_with(".exe") || path_lower.ends_with(".bat") || path_lower.ends_with(".cmd") {
        if let Ok(child) = std::process::Command::new(path).spawn() {
            job::assign(&child);
            return Ok(());
        }
    }

    // Fallback: use cmd start for protocol URLs or non-executables
    let child = std::process::Command::new("cmd")
        .args(["/C", "start", "", path])
        .spawn()
        .map_err(|e| e.to_string())?;
    job::assign(&child);
    Ok(())
}

#[tauri::command]
async fn focus_or_launch_app(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        focus_or_launch(&path)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_app_metrics(path: String, name: String) -> Result<AppMetrics, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let info = process::get_process_info(&path);
        let net = if info.running {
            network::get_net_stats(info.pid.unwrap_or(0))
        } else {
            network::NetStats { connections: 0, recv_kb: 0.0, sent_kb: 0.0, connections_detail: vec![] }
        };
        
        let is_autostart = autostart::is_autostart_enabled(&name);

        AppMetrics {
            running: info.running,
            pid: info.pid,
            cpu: info.cpu,
            mem_mb: info.mem_mb,
            connections: net.connections,
            recv_kb: net.recv_kb,
            sent_kb: net.sent_kb,
            connections_detail: net.connections_detail,
            is_autostart,
        }
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn toggle_autostart(name: String, path: String, enable: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        autostart::set_hub_autostart(&name, &path, enable)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_startup_items() -> Vec<autostart::StartupItem> {
    tauri::async_runtime::spawn_blocking(|| {
        autostart::get_startup_items()
    }).await.unwrap_or_default()
}

// ── Uninstaller ─────────────────────────────────────────────────────────────

#[tauri::command]
async fn list_uninstallable_apps(hints: Option<Vec<String>>) -> Result<Vec<uninstaller::UninstallableApp>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        uninstaller::list_apps_fast(hints.unwrap_or_default())
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn run_uninstall_string(command: String) -> Result<(), String> {
    let parts: Vec<String> = shell_words::split(&command).map_err(|e| e.to_string())?;
    if parts.is_empty() { return Err("Empty command".into()); }

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&parts[0]);
        if parts.len() > 1 {
            cmd.args(&parts[1..]);
        }
        let status = cmd.status().map_err(|e| e.to_string())?;
        if status.success() { Ok(()) } else { Err("Uninstaller exited with error".into()) }
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn find_leftovers(name: String, publisher: Option<String>) -> Vec<uninstaller::Leftover> {
    tauri::async_runtime::spawn_blocking(move || {
        uninstaller::find_leftovers(&name, publisher.as_deref())
    }).await.unwrap_or_default()
}

#[tauri::command]
async fn delete_leftover(leftover: uninstaller::Leftover) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        uninstaller::delete_leftover(&leftover)
    }).await.map_err(|e| e.to_string())?
}

// ── Groups ───────────────────────────────────────────────────────────────────

#[tauri::command]
async fn add_group(app: tauri::AppHandle, name: String, color: Option<String>) -> Group {
    tauri::async_runtime::spawn_blocking(move || {
        let group = Group {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            color,
        };
        let mut s = store::load(&app);
        s.groups.push(group.clone());
        store::save(&app, &s);
        group
    }).await.unwrap_or_else(|_| Group {
        id: String::new(), name: String::new(), color: None,
    })
}

#[tauri::command]
async fn remove_group(app: tauri::AppHandle, id: String) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let mut s = store::load(&app);
        s.groups.retain(|g| g.id != id);
        for a in s.apps.iter_mut() {
            if a.group_id.as_deref() == Some(&id) {
                a.group_id = None;
            }
        }
        store::save(&app, &s);
    }).await;
}

#[tauri::command]
async fn rename_group(app: tauri::AppHandle, id: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = store::load(&app);
        if let Some(g) = s.groups.iter_mut().find(|g| g.id == id) {
            g.name = name;
            store::save(&app, &s);
            Ok(())
        } else {
            Err(format!("Group {} not found", id))
        }
    }).await.map_err(|e| e.to_string())?
}

// ── Auto-detect ──────────────────────────────────────────────────────────────

// DetectedApp is now imported from store
pub use store::DetectedApp;

#[tauri::command]
async fn scan_installed_apps(app: tauri::AppHandle) -> Result<Vec<DetectedApp>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            use winreg::enums::{HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER, KEY_READ};
            use winreg::RegKey;

            let keys: [(winreg::HKEY, &str); 3] = [
                (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
                (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
                (HKEY_CURRENT_USER,  r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            ];

            let mut results: Vec<DetectedApp> = Vec::new();
            let mut seen_paths = std::collections::HashSet::new();

            for (hive, path) in &keys {
                let root = RegKey::predef(*hive);
                let Ok(uninstall_key) = root.open_subkey_with_flags(path, KEY_READ) else { continue };

                for subkey_name in uninstall_key.enum_keys().filter_map(|k| k.ok()) {
                    let Ok(subkey) = uninstall_key.open_subkey_with_flags(&subkey_name, KEY_READ) else { continue };

                    let is_system = subkey.get_value::<u32, _>("SystemComponent").unwrap_or(0);
                    if is_system == 1 { continue; }

                    if subkey.get_value::<String, _>("ParentKeyName").is_ok() { continue; }

                    let Ok(display_name) = subkey.get_value::<String, _>("DisplayName") else { continue };
                    let trimmed_name = display_name.trim();
                    if trimmed_name.is_empty() { continue }

                    let lower_name = trimmed_name.to_lowercase();

                    if lower_name.starts_with("kb") || 
                       lower_name.contains("update for") ||
                       lower_name.contains("security update") || 
                       lower_name.contains("hotfix") ||
                       lower_name.contains("redistributable") ||
                       lower_name.contains("c++") ||
                       lower_name.contains(".net") ||
                       lower_name.contains("sdk") ||
                       lower_name.contains("runtime") ||
                       lower_name.contains("language pack") ||
                       lower_name.contains("prerequisite") {
                        continue;
                    }

                    let Some(exe_path) = find_exe_path(&subkey) else { continue };
                    if exe_path.is_empty() { continue }

                    let lower_path = exe_path.to_lowercase();
                    if seen_paths.contains(&lower_path) { continue }
                    seen_paths.insert(lower_path);

                    let icon = icon::extract_icon(&exe_path);

                    let app_entry = DetectedApp {
                        name: trimmed_name.to_string(),
                        path: exe_path,
                        icon,
                    };
                    results.push(app_entry.clone());
                    let _ = app.emit("scan_app_found", &app_entry);
                }
            }

            results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            let mut s = store::load(&app);
            s.scanned_apps = results.clone();
            store::save(&app, &s);
            let _ = app.emit("scan_complete", &results.len());
            results
        }
        #[cfg(not(target_os = "windows"))]
        {
            vec![]
        }
    }).await.map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn scan_registry() -> Vec<DetectedApp> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER, KEY_READ};
    use winreg::RegKey;

    let keys: [(winreg::HKEY, &str); 3] = [
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
        (HKEY_CURRENT_USER,  r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
    ];

    let mut results: Vec<DetectedApp> = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();

    for (hive, path) in &keys {
        let root = RegKey::predef(*hive);
        let Ok(uninstall_key) = root.open_subkey_with_flags(path, KEY_READ) else { continue };

        for subkey_name in uninstall_key.enum_keys().filter_map(|k| k.ok()) {
            let Ok(subkey) = uninstall_key.open_subkey_with_flags(&subkey_name, KEY_READ) else { continue };

            let is_system = subkey.get_value::<u32, _>("SystemComponent").unwrap_or(0);
            if is_system == 1 { continue; }

            if subkey.get_value::<String, _>("ParentKeyName").is_ok() { continue; }

            let Ok(display_name) = subkey.get_value::<String, _>("DisplayName") else { continue };
            let trimmed_name = display_name.trim();
            if trimmed_name.is_empty() { continue }

            let lower_name = trimmed_name.to_lowercase();

            if lower_name.starts_with("kb") || 
               lower_name.contains("update for") ||
               lower_name.contains("security update") || 
               lower_name.contains("hotfix") ||
               lower_name.contains("redistributable") ||
               lower_name.contains("c++") ||
               lower_name.contains(".net") ||
               lower_name.contains("sdk") ||
               lower_name.contains("runtime") ||
               lower_name.contains("language pack") ||
               lower_name.contains("prerequisite") {
                continue;
            }

            let Some(exe_path) = find_exe_path(&subkey) else { continue };
            if exe_path.is_empty() { continue }

            let lower_path = exe_path.to_lowercase();
            if seen_paths.contains(&lower_path) { continue }
            seen_paths.insert(lower_path);

            let icon = icon::extract_icon(&exe_path);

            results.push(DetectedApp {
                name: trimmed_name.to_string(),
                path: exe_path,
                icon,
            });
        }
    }

    results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    results
}

#[cfg(target_os = "windows")]
fn find_exe_path(subkey: &winreg::RegKey) -> Option<String> {
    let display_name = subkey.get_value::<String, _>("DisplayName").unwrap_or_default();
    let mut candidate_dirs = vec![];

    if let Ok(install_dir) = subkey.get_value::<String, _>("InstallLocation") {
        let dir = install_dir.trim().trim_matches('"');
        if !dir.is_empty() {
            candidate_dirs.push(std::path::PathBuf::from(dir));
        }
    }

    if let Ok(icon_str) = subkey.get_value::<String, _>("DisplayIcon") {
        let cleaned = icon_str.split(',').next().unwrap_or("").trim().trim_matches('"');
        let p = std::path::Path::new(cleaned);
        
        if cleaned.to_lowercase().ends_with(".exe") && p.exists() {
            if cleaned.to_lowercase().ends_with("update.exe") {
                if let Some(parent) = p.parent() {
                    candidate_dirs.push(parent.to_path_buf());
                }
            } else {
                return Some(cleaned.to_string());
            }
        } else {
            if let Some(parent) = p.parent() {
                if parent.exists() {
                    candidate_dirs.push(parent.to_path_buf());
                }
            }
        }
    }

    for dir in candidate_dirs {
        if !dir.exists() { continue; }
        
        let exact = dir.join(format!("{}.exe", display_name));
        if exact.exists() { return Some(exact.to_string_lossy().to_string()); }
        
        let nospace = dir.join(format!("{}.exe", display_name.replace(" ", "")));
        if nospace.exists() { return Some(nospace.to_string_lossy().to_string()); }
        
        if let Ok(entries) = std::fs::read_dir(&dir) {
            let mut squirrel_exes = vec![];
            for entry in entries.filter_map(|e| e.ok()) {
                let p = entry.path();
                if p.is_dir() && p.file_name().unwrap_or_default().to_string_lossy().starts_with("app-") {
                    if let Ok(sub_entries) = std::fs::read_dir(&p) {
                        for sub_entry in sub_entries.filter_map(|e| e.ok()) {
                            let sub_p = sub_entry.path();
                            if sub_p.extension().and_then(|e| e.to_str()).map(|s| s.to_lowercase()) == Some("exe".to_string()) {
                                let fname = sub_p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                                if !fname.contains("unins") && !fname.contains("setup") && !fname.contains("update") && !fname.contains("crash") {
                                    squirrel_exes.push(sub_p);
                                }
                            }
                        }
                    }
                }
            }
            if !squirrel_exes.is_empty() {
                squirrel_exes.sort_by_key(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0));
                return Some(squirrel_exes.last().unwrap().to_string_lossy().to_string());
            }
        }

        if let Ok(entries) = std::fs::read_dir(&dir) {
            let mut best_exes = vec![];
            for entry in entries.filter_map(|e| e.ok()) {
                let p = entry.path();
                if p.extension().and_then(|e| e.to_str()).map(|s| s.to_lowercase()) == Some("exe".to_string()) {
                    let fname = p.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                    if !fname.contains("unins") && !fname.contains("setup") && !fname.contains("update") && !fname.contains("crash") && !fname.contains("helper") {
                        best_exes.push(p);
                    }
                }
            }
            if !best_exes.is_empty() {
                best_exes.sort_by_key(|p| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0));
                return Some(best_exes.last().unwrap().to_string_lossy().to_string());
            }
        }
    }

    None
}

// ── First-run setup ──────────────────────────────────────────────────────────

#[derive(Serialize)]
struct SetupStatus {
    completed: bool,
    winget_ok: bool,
    initial_scan_done: bool,
}

#[tauri::command]
async fn get_setup_status(app: tauri::AppHandle) -> SetupStatus {
    tauri::async_runtime::spawn_blocking(move || {
        let s = setup::load_state(&app);
        SetupStatus {
            completed: s.completed,
            winget_ok: s.winget_ok,
            initial_scan_done: s.initial_scan_done,
        }
    }).await.unwrap_or_else(|_| SetupStatus {
        completed: false, winget_ok: false, initial_scan_done: false,
    })
}

#[derive(Clone, Serialize)]
struct SetupProgressEvent {
    step: String,
    status: String,
    message: String,
    percent: u8,
}

#[tauri::command]
async fn run_first_setup(app: tauri::AppHandle) -> Result<(), String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let emit = |step: &str, status: &str, message: &str, percent: u8| {
            let _ = app_handle.emit("setup_progress", SetupProgressEvent {
                step: step.to_string(),
                status: status.to_string(),
                message: message.to_string(),
                percent,
            });
        };

        emit("winget", "running", "Checking package managers…", 5);

        let winget_ok = if setup::check_winget() {
            emit("winget", "ok", "winget is available", 20);
            true
        } else {
            emit("winget", "running", "winget not found — downloading App Installer…", 8);
            let (ok, log) = setup::install_winget();
            if ok {
                emit("winget", "ok", "winget installed successfully", 20);
                true
            } else {
                let short = log.lines().last().unwrap_or("Install failed").to_string();
                emit("winget", "error", &format!("winget install failed: {}", short), 20);
                false
            }
        };

        if winget_ok {
            emit("sources", "running", "Updating package sources…", 22);
            let _ = std::thread::spawn(|| setup::update_winget_sources());
            emit("sources", "ok", "Sources updated", 35);
        } else {
            emit("sources", "skip", "Skipped (winget not available)", 35);
        }

        emit("scan", "running", "Scanning installed programs…", 38);

        #[cfg(target_os = "windows")]
        let scan_result = {
            let results = scan_registry();
            let mut s = store::load(&app);
            s.scanned_apps = results.clone();
            store::save(&app, &s);
            let count = results.len();
            (count, results)
        };
        #[cfg(not(target_os = "windows"))]
        let scan_result = (0usize, vec![]);

        let (count, _) = scan_result;
        emit("scan", "ok", &format!("Found {} installed programs", count), 90);

        let mut state = setup::load_state(&app);
        state.completed = true;
        state.winget_ok = winget_ok;
        state.initial_scan_done = true;
        setup::save_state(&app, &state);

        emit("done", "ok", "Setup complete", 100);

        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn mark_setup_complete(app: tauri::AppHandle) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let mut state = setup::load_state(&app);
        state.completed = true;
        setup::save_state(&app, &state);
    }).await;
}

#[tauri::command]
async fn reset_setup_status(app: tauri::AppHandle) {
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let mut state = setup::load_state(&app);
        state.completed = false;
        setup::save_state(&app, &state);
    }).await;
}

// ── Store (Universal) ────────────────────────────────────────────────────────

#[derive(Serialize)]
struct ManagersAvailable {
    winget: bool,
    scoop: bool,
    choco: bool,
}

#[tauri::command]
async fn winget_check() -> ManagersAvailable {
    tauri::async_runtime::spawn_blocking(|| {
        ManagersAvailable {
            winget: winget::is_available(),
            scoop: scoop::is_available(),
            choco: choco::is_available(),
        }
    }).await.unwrap_or(ManagersAvailable { winget: false, scoop: false, choco: false })
}

#[tauri::command]
async fn search_other_managers(query: String) -> Result<Vec<winget::WingetPackage>, String> {
    let q2 = query.clone();
    let q3 = query.clone();

    let res = tauri::async_runtime::spawn_blocking(move || {
        let t2 = thread::spawn(move || scoop::search(&q2));
        let t3 = thread::spawn(move || choco::search(&q3));

        let mut results = Vec::new();
        if let Ok(mut s) = t2.join() { results.append(&mut s); }
        if let Ok(mut c) = t3.join() { results.append(&mut c); }
        
        results
    }).await.map_err(|e| e.to_string())?;

    Ok(res)
}

#[tauri::command]
async fn winget_show(id: String) -> Result<Option<winget::WingetPackageDetail>, String> {
    let res = tauri::async_runtime::spawn_blocking(move || {
        if id.contains('/') {
            if let Some(s) = scoop::show(&id) { return Some(s); }
        }
        
        if let Some(w) = winget::show(&id) { return Some(w); }
        if let Some(s) = scoop::show(&id) { return Some(s); }
        if let Some(c) = choco::show(&id) { return Some(c); }
        None
    }).await.map_err(|e| e.to_string())?;

    Ok(res)
}

#[derive(Serialize)]
struct InstallResult {
    success: bool,
    log: String,
    exe_path: Option<String>,
    icon: Option<String>,
}

#[tauri::command]
async fn winget_install(
    app_handle: tauri::AppHandle,
    id: String,
    name: String,
    group_id: Option<String>,
    fallback_icon: Option<String>,
) -> Result<InstallResult, String> {
    let app_handle_clone = app_handle.clone();
    let res = tauri::async_runtime::spawn_blocking(move || {
        let (success, log) = if id.contains('/') {
            scoop::install(&id)
        } else {
            winget::install(&id)
        };

        // Attempt to register the app in the store (find exe, extract icon)
        let try_register = |name: &str, app_handle: &tauri::AppHandle| -> (Option<String>, Option<String>) {
            let exe = find_installed_exe(name);
            let mut ico = exe.as_deref().and_then(|p| icon::extract_icon(p));
            if ico.is_none() {
                ico = fallback_icon.clone();
            }
            if let Some(ref path) = exe {
                let entry = App {
                    id: uuid::Uuid::new_v4().to_string(),
                    name: name.to_string(),
                    path: path.clone(),
                    icon: ico.clone(),
                    group_id: group_id.clone(),
                    hotkey: None,
                };
                let mut s = store::load(app_handle);
                if !s.apps.iter().any(|a| a.path.to_lowercase() == path.to_lowercase()) {
                    s.apps.push(entry);
                    store::save(app_handle, &s);
                }
            }
            (exe, ico)
        };

        if !success {
            let log_lower = log.to_lowercase();
            if log_lower.contains("already installed") || log_lower.contains("another installation") {
                // Registry already has the entry — try to register immediately
                let (exe_path, icon) = try_register(&name, &app_handle_clone);
                if exe_path.is_some() {
                    return InstallResult { success: true, log, exe_path, icon };
                }
            }
            return InstallResult { success: false, log, exe_path: None, icon: None };
        }

        // Wait a bit for the installation to settle and registry to update
        std::thread::sleep(std::time::Duration::from_secs(3));

        let (exe_path, icon) = try_register(&name, &app_handle_clone);

        // If we still couldn't find the exe, report failure so the frontend
        // doesn't show "Installed" for an app that wasn't actually saved.
        if exe_path.is_none() {
            return InstallResult {
                success: false,
                log: format!("{}\n⚠ Winget reported success but the app was not found in the system registry.", log),
                exe_path: None,
                icon: None,
            };
        }

        InstallResult { success: true, log, exe_path, icon }
    }).await.map_err(|e| e.to_string())?;

    // Refresh the frontend
    let _ = app_handle.emit("store_updated", ());

    Ok(res)
}

#[tauri::command]
async fn winget_uninstall(app_handle: tauri::AppHandle, id: String) -> InstallResult {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let (success, log) = winget::uninstall(&id);
        if success {
            let _ = app_handle.emit("store_updated", ());
        }
        InstallResult { success, log, exe_path: None, icon: None }
    }).await.unwrap_or_else(|_| InstallResult {
        success: false, log: "Thread pool shut down".into(), exe_path: None, icon: None,
    });
    result
}

#[tauri::command]
async fn winget_list_installed() -> Vec<winget::WingetPackage> {
    tauri::async_runtime::spawn_blocking(|| {
        winget::list_installed()
    }).await.unwrap_or_default()
}

fn find_installed_exe(name: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER, KEY_READ};
        use winreg::RegKey;

        let keys: [(winreg::HKEY, &str); 3] = [
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (HKEY_CURRENT_USER,  r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
        ];

        for (hive, path) in &keys {
            let root = RegKey::predef(*hive);
            let Ok(uk) = root.open_subkey_with_flags(path, KEY_READ) else { continue };
            for subkey_name in uk.enum_keys().filter_map(|k| k.ok()) {
                let Ok(sk) = uk.open_subkey_with_flags(&subkey_name, KEY_READ) else { continue };
                let Ok(dn) = sk.get_value::<String, _>("DisplayName") else { continue };
                if dn.to_lowercase().contains(&name.to_lowercase()) {
                    if let Some(p) = find_exe_path(&sk) {
                        return Some(p);
                    }
                }
            }
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    { let _ = name; None }
}

// ── Guardian: startup monitoring responses ───────────────────────────────────
#[tauri::command]
async fn guardian_allow_startup(name: String, _cmd: String) -> Result<(), String> {
    println!("Guardian: allowed startup entry '{}'", name);
    Ok(())
}
#[tauri::command]
async fn guardian_deny_startup(name: String, cmd: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        println!("Guardian: denied startup entry '{}'", name);
        crate::autostart::set_autostart(&name, &cmd, false)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn guardian_open_folder(cmd: String) -> Result<(), String> {
        tauri::async_runtime::spawn_blocking(move || {
            let path = std::path::Path::new(&cmd);
            let parent = path.parent().unwrap_or(path);
            std::process::Command::new("explorer")
                .arg(parent.as_os_str())
                .spawn()
                .map_err(|e| format!("Failed to open folder: {}", e))?;
            Ok(())
        }).await.map_err(|e| e.to_string())?
}

// ── Disk Map ──────────────────────────────────────────────────────────────────

#[tauri::command]
async fn scan_disk(drive: char) -> Result<diskmap::DirScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        diskmap::scan_drive_mft(drive, &|_| {})
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_disk_entry(path: String, is_dir: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if is_dir {
            std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
        } else {
            std::fs::remove_file(&path).map_err(|e| e.to_string())
        }
    }).await.map_err(|e| e.to_string())?
}

// ── Updater ───────────────────────────────────────────────────

#[tauri::command]
async fn check_for_update() -> updater::UpdateInfo {
    updater::check_for_update().await
}

#[tauri::command]
async fn download_update(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dest_dir = app_data.join("updates");
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let path = updater::download_update(&url, &dest_dir, |_, _| {}).await?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
async fn install_update(path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    updater::install_update(&p)
}

#[tauri::command]
async fn get_update_check_enabled(app: tauri::AppHandle) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        store::load(&app).update_check_enabled
    }).await.unwrap_or(true)
}

#[tauri::command]
async fn set_update_check_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = store::load(&app);
        s.update_check_enabled = enabled;
        store::save(&app, &s);
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

// ── Guardian settings ────────────────────────────────────────────────────────
#[tauri::command]
async fn get_guardian_enabled(app: tauri::AppHandle) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        crate::store::load(&app).guardian_enabled
    }).await.unwrap_or(false)
}
#[tauri::command]
async fn set_guardian_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = crate::store::load(&app);
        store.guardian_enabled = enabled;
        crate::store::save(&app, &store);
        Ok(())
    }).await.map_err(|e| e.to_string())?
}

// ── Sync ──────────────────────────────────────────────────────────────────────
use std::sync::Mutex;

lazy_static::lazy_static! {
    static ref HTTP_CLIENT: Mutex<Option<reqwest::Client>> = Mutex::new(None);
}

fn get_http_client() -> reqwest::Client {
    HTTP_CLIENT.lock().unwrap().clone().unwrap_or_else(|| {
        let c = reqwest::Client::builder().user_agent("Hubify/0.1").build().unwrap_or_default();
        HTTP_CLIENT.lock().unwrap().replace(c.clone());
        c
    })
}

fn sync_token_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path().app_data_dir().unwrap().join("sync_token.json")
}
fn sync_ignored_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    app.path().app_data_dir().unwrap().join("sync_ignored.json")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SyncToken { pub email: String, pub token: String }

fn load_sync_token(app: &tauri::AppHandle) -> Option<SyncToken> {
    let p = sync_token_path(app);
    if !p.exists() { return None; }
    let data = std::fs::read_to_string(p).ok()?;
    serde_json::from_str(&data).ok()
}
fn save_sync_token(app: &tauri::AppHandle, t: &SyncToken) {
    let p = sync_token_path(app);
    let _ = std::fs::create_dir_all(p.parent().unwrap());
    let _ = std::fs::write(p, serde_json::to_string_pretty(t).unwrap());
}
fn clear_sync_token(app: &tauri::AppHandle) {
    let _ = std::fs::remove_file(sync_token_path(app));
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IgnoredList { pub ignored: Vec<String> }
fn load_ignored_list(app: &tauri::AppHandle) -> IgnoredList {
    let p = sync_ignored_path(app);
    if !p.exists() { return IgnoredList { ignored: vec![] }; }
    let data = std::fs::read_to_string(p).ok().unwrap_or_default();
    serde_json::from_str(&data).unwrap_or(IgnoredList { ignored: vec![] })
}
fn save_ignored_list(app: &tauri::AppHandle, list: &IgnoredList) {
    let p = sync_ignored_path(app);
    let _ = std::fs::create_dir_all(p.parent().unwrap());
    let _ = std::fs::write(p, serde_json::to_string_pretty(list).unwrap());
}

#[derive(Serialize)] struct RegisterRequest { pub email: String, pub password: String }
#[derive(Serialize)] struct LoginRequest { pub email: String, pub password: String }
#[derive(Serialize, Deserialize)] struct AuthResponse { pub token: String, pub ok: bool }

#[derive(Serialize, Deserialize)]
struct SyncAppEntry { pub name: String, pub path: String, pub group: Option<String>, pub hotkey: Option<String> }
#[derive(Serialize, Deserialize)]
struct SyncGroupEntry { pub id: String, pub name: String, pub color: Option<String> }
#[derive(Serialize, Deserialize)]
struct SyncThemeEntry { pub active: String, pub custom_themes: Vec<crate::store::CustomTheme> }
#[derive(Serialize, Deserialize)]
struct SyncStatEntry { pub path: String, pub total_minutes: f64 }

#[derive(Serialize)]
struct SyncPayload {
    pub apps: Vec<SyncAppEntry>,
    pub groups: Vec<SyncGroupEntry>,
    pub ignored: Vec<String>,
    pub theme: SyncThemeEntry,
    pub stats: Vec<SyncStatEntry>,
}
#[derive(Serialize, Deserialize)]
struct SyncRemote {
    pub apps: Vec<SyncAppEntry>,
    pub groups: Vec<SyncGroupEntry>,
    pub theme: SyncThemeEntry,
    pub stats: Vec<SyncStatEntry>,
}

fn sync_api_url() -> String {
    std::env::var("HUBIFY_SYNC_URL").unwrap_or_else(|_| "https://sync.hubify.app/api".to_string())
}

async fn sync_api_req<T: Serialize, R: for<'de> serde::Deserialize<'de>>(
    path: &str, token: Option<&str>, body: &T,
) -> Result<R, String> {
    let url = format!("{}{}", sync_api_url(), path);
    let mut req = get_http_client().post(&url).json(body);
    if let Some(t) = token { req = req.header("Authorization", format!("Bearer {}", t)); }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let st = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {}", st, txt));
    }
    resp.json::<R>().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn sync_register(app: tauri::AppHandle, email: String, password: String) -> Result<AuthResponse, String> {
    let req = RegisterRequest { email, password };
    let resp: AuthResponse = sync_api_req("/register", None, &req).await?;
    let token = resp.token.clone();
    if resp.ok {
        let app2 = app.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            save_sync_token(&app2, &SyncToken { email: req.email, token });
        }).await;
    }
    Ok(resp)
}
#[tauri::command]
async fn sync_login(app: tauri::AppHandle, email: String, password: String) -> Result<AuthResponse, String> {
    let req = LoginRequest { email, password };
    let resp: AuthResponse = sync_api_req("/login", None, &req).await?;
    let token = resp.token.clone();
    if resp.ok {
        let app2 = app.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            save_sync_token(&app2, &SyncToken { email: req.email, token });
        }).await;
    }
    Ok(resp)
}
#[tauri::command]
async fn sync_logout(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        clear_sync_token(&app);
        Ok(())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn sync_get_token(app: tauri::AppHandle) -> Result<Option<SyncToken>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(load_sync_token(&app))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn sync_push(app: tauri::AppHandle) -> Result<(), String> {
    let (token, payload) = tauri::async_runtime::spawn_blocking(move || {
        let token = load_sync_token(&app).ok_or("Not logged in")?;
        let s = crate::store::load(&app);
        let ign = load_ignored_list(&app);
        let payload = SyncPayload {
            apps: s.apps.into_iter().map(|a| SyncAppEntry {
                name: a.name, path: a.path, group: a.group_id, hotkey: a.hotkey
            }).collect(),
            groups: s.groups.into_iter().map(|g| SyncGroupEntry { id: g.id, name: g.name, color: g.color }).collect(),
            ignored: ign.ignored,
            theme: SyncThemeEntry { active: s.theme.active, custom_themes: s.theme.custom_themes },
            stats: vec![],
        };
        Ok::<(SyncToken, SyncPayload), String>((token, payload))
    }).await.map_err(|e| e.to_string())??;
    sync_api_req::<SyncPayload, ()>("/sync/push", Some(&token.token), &payload).await?;
    Ok(())
}
#[tauri::command]
async fn sync_pull(app: tauri::AppHandle) -> Result<SyncRemote, String> {
    let token = tauri::async_runtime::spawn_blocking(move || {
        load_sync_token(&app).ok_or("Not logged in".to_string())
    }).await.map_err(|e| e.to_string())??;
    let remote: SyncRemote = sync_api_req("/sync/pull", Some(&token.token), &()).await?;
    Ok(remote)
}
#[tauri::command]
async fn sync_import(app: tauri::AppHandle, remote: SyncRemote) -> Result<(), String> {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut store = crate::store::load(&app2);
        store.apps = remote.apps.into_iter().map(|a| crate::store::App {
            id: uuid::Uuid::new_v4().to_string(),
            name: a.name,
            path: a.path,
            icon: None,
            group_id: a.group,
            hotkey: a.hotkey,
        }).collect();
        store.groups = remote.groups.into_iter().map(|g| crate::store::Group {
            id: g.id,
            name: g.name,
            color: g.color,
        }).collect();
        store.theme = crate::store::ThemeConfig {
            active: remote.theme.active,
            custom_themes: remote.theme.custom_themes,
        };
        crate::store::save(&app2, &store);
        let _ = app2.emit("store_updated", ());
        Ok(())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn sync_set_ignored(app: tauri::AppHandle, ignored: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_ignored_list(&app, &IgnoredList { ignored });
        Ok(())
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn sync_get_ignored(app: tauri::AppHandle) -> Result<IgnoredList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(load_ignored_list(&app))
    }).await.map_err(|e| e.to_string())?
}

// ── App entry point ──────────────────────────────────────────────────────────

#[tauri::command]
async fn create_shortcut(name: String, target_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let current_exe_str = current_exe.to_string_lossy();
        
        let ps_script = format!(r#"
            $WshShell = New-Object -comObject WScript.Shell
            $DesktopPath = [Environment]::GetFolderPath("Desktop")
            $Shortcut = $WshShell.CreateShortcut("$DesktopPath\{}.lnk")
            $Shortcut.TargetPath = "{}"
            $Shortcut.Arguments = "--launch `"{}`""
            $Shortcut.IconLocation = "{},0"
            $Shortcut.Save()
        "#, name.replace("\"", ""), current_exe_str, target_path, target_path);

        std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps_script])
            .output()
            .map_err(|e| e.to_string())?;

        Ok(())
    }).await.map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use std::io::{Read, Write};

    let args: Vec<String> = std::env::args().collect();
    
    if let Ok(mut stream) = std::net::TcpStream::connect("127.0.0.1:43812") {
        if args.len() >= 3 && args[1] == "--launch" {
            let _ = stream.write_all(format!("LAUNCH:{}", args[2]).as_bytes());
        } else {
            let _ = stream.write_all(b"WAKEUP");
        }
        let _ = stream.shutdown(std::net::Shutdown::Write);
        std::thread::sleep(std::time::Duration::from_millis(50));
        std::process::exit(0);
    }

    let mut initial_launch_path = None;
    if args.len() >= 3 && args[1] == "--launch" {
        initial_launch_path = Some(args[2].clone());
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(keybinds::plugin())
        .setup(move |app| {
            job::init();
            let app_handle = app.handle().clone();
            
            // Initialize Database
            if let Err(e) = db::init(&app_handle) {
                println!("Failed to init DB: {}", e);
            }

            let window = app.get_webview_window("main").unwrap();

            // Set window and tray icon from embedded PNG
            let icon_bytes = include_bytes!("../icons/icon.png");
            let app_icon = ::image::load_from_memory(icon_bytes).ok()
                .map(|img| img.to_rgba8())
                .map(|rgba| {
                    let (w, h) = (rgba.width(), rgba.height());
                    let pixels = rgba.into_raw();
                    tauri::image::Image::new_owned(pixels, w, h)
                });
            
            if let Some(ref icon) = app_icon {
                let _ = window.set_icon(icon.clone());
            }
            
            if apply_mica(&window, Some(true)).is_err() {
                let _ = apply_acrylic(&window, Some((18, 18, 20, 180)));
            }

            if initial_launch_path.is_some() {
                let _ = window.hide();
            }
            
            // ── Initialize Native Indexer ──
            everything::init_indexer();

            // ── Guardian: monitor startup changes ──
            guardian::start(app_handle.clone());

            // ── Background IPC Listener ──
            let app_handle_for_ipc = app_handle.clone();
            std::thread::spawn(move || {
                if let Ok(listener) = std::net::TcpListener::bind("127.0.0.1:43812") {
                    for stream in listener.incoming() {
                        if let Ok(mut s) = stream {
                            let mut buf = String::new();
                            if s.read_to_string(&mut buf).is_ok() {
                                if buf == "WAKEUP" {
                                    let _ = app_handle_for_ipc.emit("show_window", ());
                                } else if buf.starts_with("LAUNCH:") {
                                    let path = buf.trim_start_matches("LAUNCH:").trim_matches('"').to_string();
                                    let path_lower = path.to_lowercase();
                                    if path_lower.ends_with(".exe") || path_lower.ends_with(".bat") || path_lower.ends_with(".cmd") {
                                        if let Ok(child) = std::process::Command::new(&path).spawn() {
                                            job::assign(&child);
                                        }
                                    } else {
                                        let _ = std::process::Command::new("cmd").args(["/C", "start", "", &path]).spawn().map(|child| {
                                            job::assign(&child);
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            });

            // ── Background Update Check ──
            let app_handle_for_update = app_handle.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(3));
                let s = store::load(&app_handle_for_update);
                if s.update_check_enabled {
                    let info = tauri::async_runtime::block_on(updater::check_for_update());
                    if info.available {
                        let _ = app_handle_for_update.emit("update_available", &info);
                    }
                }
            });

            // ── Background Logging Thread ──
            let app_handle_for_logging = app_handle.clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_secs(15));
                    let s = store::load(&app_handle_for_logging);
                    for app in s.apps {
                        let info = process::get_process_info(&app.path);
                        if info.running {
                            let _ = db::log_usage(&app_handle_for_logging, &app.path, info.cpu, info.mem_mb, true);
                            // Log network connections
                            if let Some(pid) = info.pid {
                                let net = network::get_net_stats(pid);
                                if !net.connections_detail.is_empty() {
                                    let _ = db::log_network(&app_handle_for_logging, &app.path, &net.connections_detail);
                                }
                            }
                        }
                    }
                }
            });

            // ── Register Global Hotkeys ──
            keybinds::register_all(&app_handle);

            if let Some(path) = initial_launch_path {
                let path = path.trim_matches('"');
                let path_lower = path.to_lowercase();
                if path_lower.ends_with(".exe") || path_lower.ends_with(".bat") || path_lower.ends_with(".cmd") {
                    if let Ok(child) = std::process::Command::new(path).spawn() {
                        job::assign(&child);
                    }
                } else {
                    let _ = std::process::Command::new("cmd").args(["/C", "start", "", path]).spawn().map(|child| {
                        job::assign(&child);
                    });
                }
            }

            let tray_menu = Menu::new(&app_handle)?;
            let empty = MenuItem::with_id(&app_handle, "empty", "No active apps", false, None::<&str>)?;
            let _ = tray_menu.append(&empty);
            let sep = PredefinedMenuItem::separator(&app_handle)?;
            let _ = tray_menu.append(&sep);
            let quit_i = MenuItem::with_id(&app_handle, "quit", "Quit Hubify", true, None::<&str>)?;
            let _ = tray_menu.append(&quit_i);

            let tray_icon = app_icon.clone().unwrap_or_else(|| app.default_window_icon().unwrap().clone());
            let _tray = TrayIconBuilder::with_id("main_tray")
                .icon(tray_icon)
                .menu(&tray_menu)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .on_menu_event(move |app_h, event| {
                    if event.id.as_ref() == "quit" {
                        app_h.exit(0);
                    } else if event.id.as_ref() != "empty" {
                        let path = event.id.as_ref().to_string();
                        tauri::async_runtime::spawn(async move {
                            let _ = focus_or_launch_app(path).await;
                        });
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_store,
            add_app,
            remove_app,
            move_app_to_group,
            launch_app,
            update_tray_menu,
            get_process_info,
            get_processes_info,
            kill_app,
            get_app_metrics,
            add_group,
            remove_group,
            rename_group,
            scan_installed_apps,
            winget_check,
            search_other_managers,
            winget_show,
            winget_install,
            winget_uninstall,
            winget_list_installed,
            get_setup_status,
            run_first_setup,
            mark_setup_complete,
            reset_setup_status,
            create_shortcut,
            toggle_autostart,
            get_startup_items,
            list_uninstallable_apps,
            run_uninstall_string,
            find_leftovers,
            delete_leftover,
            everything_search,
            everything_search_apps,
            is_indexer_ready,
            focus_or_launch_app,
            set_active_theme,
            save_custom_theme,
            delete_custom_theme,
            get_daily_activity,
            get_app_stats,
            get_today_summary,
            get_app_daily_detail,
            get_app_network_activity,
            get_app_hourly,
            set_app_hotkey,
            set_global_hotkey,
            guardian_allow_startup,
            guardian_deny_startup,
            guardian_open_folder,
            get_guardian_enabled,
            set_guardian_enabled,
            sync_register,
            sync_login,
            sync_logout,
            sync_get_token,
            sync_push,
            sync_pull,
            sync_import,
            sync_set_ignored,
            sync_get_ignored,
            scan_disk,
            delete_disk_entry,
            check_for_update,
            download_update,
            install_update,
            get_update_check_enabled,
            set_update_check_enabled,
            exit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
