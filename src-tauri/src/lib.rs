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

use store::{App, Group, Store};
use tauri::{Manager, Emitter};
use window_vibrancy::{apply_mica, apply_acrylic};
use serde::Serialize;
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

// ── Apps ────────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_store(app: tauri::AppHandle) -> Store {
    store::load(&app)
}

#[tauri::command]
fn add_app(app: tauri::AppHandle, path: String, name: Option<String>, group_id: Option<String>) -> Result<App, String> {
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
    };

    let mut s = store::load(&app);
    s.apps.push(entry.clone());
    store::save(&app, &s);
    Ok(entry)
}

#[tauri::command]
fn remove_app(app: tauri::AppHandle, id: String) {
    let mut s = store::load(&app);
    s.apps.retain(|a| a.id != id);
    store::save(&app, &s);
}

#[tauri::command]
fn move_app_to_group(app: tauri::AppHandle, app_id: String, group_id: Option<String>) -> Result<(), String> {
    let mut s = store::load(&app);
    if let Some(entry) = s.apps.iter_mut().find(|a| a.id == app_id) {
        entry.group_id = group_id;
        store::save(&app, &s);
        Ok(())
    } else {
        Err(format!("App {} not found", app_id))
    }
}

#[tauri::command]
fn launch_app(path: String) -> Result<(), String> {
    let child = std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    
    job::assign(&child);
    Ok(())
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
fn toggle_autostart(name: String, path: String, enable: bool) -> Result<(), String> {
    autostart::set_hub_autostart(&name, &path, enable)
}

#[tauri::command]
fn get_startup_items() -> Vec<autostart::StartupItem> {
    autostart::get_startup_items()
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
    
    let mut cmd = std::process::Command::new(&parts[0]);
    if parts.len() > 1 {
        cmd.args(&parts[1..]);
    }

    let status = cmd.status().map_err(|e| e.to_string())?;
    if status.success() { Ok(()) } else { Err("Uninstaller exited with error".into()) }
}

#[tauri::command]
fn find_leftovers(name: String, publisher: Option<String>) -> Vec<uninstaller::Leftover> {
    uninstaller::find_leftovers(&name, publisher.as_deref())
}

#[tauri::command]
fn delete_leftover(leftover: uninstaller::Leftover) -> Result<(), String> {
    uninstaller::delete_leftover(&leftover)
}

// ── Groups ───────────────────────────────────────────────────────────────────

#[tauri::command]
fn add_group(app: tauri::AppHandle, name: String, color: Option<String>) -> Group {
    let group = Group {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        color,
    };
    let mut s = store::load(&app);
    s.groups.push(group.clone());
    store::save(&app, &s);
    group
}

#[tauri::command]
fn remove_group(app: tauri::AppHandle, id: String) {
    let mut s = store::load(&app);
    s.groups.retain(|g| g.id != id);
    // Unassign apps that belonged to this group
    for a in s.apps.iter_mut() {
        if a.group_id.as_deref() == Some(&id) {
            a.group_id = None;
        }
    }
    store::save(&app, &s);
}

#[tauri::command]
fn rename_group(app: tauri::AppHandle, id: String, name: String) -> Result<(), String> {
    let mut s = store::load(&app);
    if let Some(g) = s.groups.iter_mut().find(|g| g.id == id) {
        g.name = name;
        store::save(&app, &s);
        Ok(())
    } else {
        Err(format!("Group {} not found", id))
    }
}

// ── Auto-detect ──────────────────────────────────────────────────────────────

// DetectedApp is now imported from store
pub use store::DetectedApp;

#[tauri::command]
async fn scan_installed_apps(app: tauri::AppHandle) -> Result<Vec<DetectedApp>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            let results = scan_registry();
            let mut s = store::load(&app);
            s.scanned_apps = results.clone();
            store::save(&app, &s);
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
fn get_setup_status(app: tauri::AppHandle) -> SetupStatus {
    let s = setup::load_state(&app);
    SetupStatus {
        completed: s.completed,
        winget_ok: s.winget_ok,
        initial_scan_done: s.initial_scan_done,
    }
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
    let emit = move |step: &str, status: &str, message: &str, percent: u8| {
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
}

#[tauri::command]
fn mark_setup_complete(app: tauri::AppHandle) {
    let mut state = setup::load_state(&app);
    state.completed = true;
    setup::save_state(&app, &state);
}

// ── Store (Universal) ────────────────────────────────────────────────────────

#[derive(Serialize)]
struct ManagersAvailable {
    winget: bool,
    scoop: bool,
    choco: bool,
}

#[tauri::command]
fn winget_check() -> ManagersAvailable {
    ManagersAvailable {
        winget: winget::is_available(),
        scoop: scoop::is_available(),
        choco: choco::is_available(),
    }
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

        if !success {
            return InstallResult { success: false, log, exe_path: None, icon: None };
        }

        // Wait a bit for the installation to finish and registry to update
        std::thread::sleep(std::time::Duration::from_secs(3));

        let exe_path = find_installed_exe(&name);
        let mut icon = exe_path.as_deref().and_then(|p| icon::extract_icon(p));
        if icon.is_none() {
            icon = fallback_icon;
        }

        if let Some(ref path) = exe_path {
            let entry = App {
                id: uuid::Uuid::new_v4().to_string(),
                name: name.clone(),
                path: path.clone(),
                icon: icon.clone(),
                group_id,
            };
            let mut s = store::load(&app_handle_clone);
            // Case-insensitive path check
            if !s.apps.iter().any(|a| a.path.to_lowercase() == path.to_lowercase()) {
                s.apps.push(entry);
                store::save(&app_handle_clone, &s);
            }
        }

        InstallResult { success: true, log, exe_path, icon }
    }).await.map_err(|e| e.to_string())?;

    // Refresh the frontend
    let _ = app_handle.emit("store_updated", ());

    Ok(res)
}

#[tauri::command]
fn winget_uninstall(app_handle: tauri::AppHandle, id: String) -> InstallResult {
    let (success, log) = winget::uninstall(&id);
    if success {
        let _ = app_handle.emit("store_updated", ());
    }
    InstallResult { success, log, exe_path: None, icon: None }
}

#[tauri::command]
fn winget_list_installed() -> Vec<winget::WingetPackage> {
    winget::list_installed()
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

// ── App entry point ──────────────────────────────────────────────────────────

#[tauri::command]
fn create_shortcut(name: String, target_path: String) -> Result<(), String> {
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
        .setup(move |app| {
            job::init();
            let app_handle = app.handle().clone();
            
            // Initialize Database
            if let Err(e) = db::init(&app_handle) {
                println!("Failed to init DB: {}", e);
            }

            let window = app.get_webview_window("main").unwrap();
            
            if apply_mica(&window, Some(true)).is_err() {
                let _ = apply_acrylic(&window, Some((18, 18, 20, 180)));
            }

            if initial_launch_path.is_some() {
                let _ = window.hide();
            }

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
                                    let _ = std::process::Command::new("cmd").args(["/C", "start", "", &path]).spawn().map(|child| {
                                        job::assign(&child);
                                    });
                                }
                            }
                        }
                    }
                }
            });

            // ── Background Logging Thread ──
            let app_handle_for_logging = app_handle.clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_secs(60));
                    let s = store::load(&app_handle_for_logging);
                    for app in s.apps {
                        let info = process::get_process_info(&app.path);
                        if info.running {
                            let _ = db::log_usage(&app_handle_for_logging, &app.path, info.cpu, info.mem_mb, true);
                        }
                    }
                }
            });

            if let Some(path) = initial_launch_path {
                let path = path.trim_matches('"');
                let _ = std::process::Command::new("cmd").args(["/C", "start", "", path]).spawn().map(|child| {
                    job::assign(&child);
                });
            }

            let tray_menu = Menu::new(&app_handle)?;
            let empty = MenuItem::with_id(&app_handle, "empty", "No active apps", false, None::<&str>)?;
            let _ = tray_menu.append(&empty);
            let sep = PredefinedMenuItem::separator(&app_handle)?;
            let _ = tray_menu.append(&sep);
            let quit_i = MenuItem::with_id(&app_handle, "quit", "Quit Hubify", true, None::<&str>)?;
            let _ = tray_menu.append(&quit_i);

            let _tray = TrayIconBuilder::with_id("main_tray")
                .icon(app.default_window_icon().unwrap().clone())
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
                        let _ = std::process::Command::new("cmd").args(["/C", "start", "", &path]).spawn().map(|child| {
                            job::assign(&child);
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
            create_shortcut,
            toggle_autostart,
            get_startup_items,
            list_uninstallable_apps,
            run_uninstall_string,
            find_leftovers,
            delete_leftover,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
