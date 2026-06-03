mod store;
mod icon;
mod process;
mod network;
mod winget;
mod setup;

use store::{App, Group, Store};
use tauri::{Manager, Emitter};
use window_vibrancy::{apply_mica, apply_acrylic};
use serde::Serialize;
use network::ConnectionInfo;

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
    std::process::Command::new(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_process_info(path: String) -> process::ProcessInfo {
    process::get_process_info(&path)
}

#[tauri::command]
fn kill_app(path: String) -> bool {
    process::kill_process(&path)
}

#[tauri::command]
fn get_app_metrics(path: String) -> AppMetrics {
    let info = process::get_process_info(&path);
    let net = if info.running {
        network::get_net_stats(info.pid.unwrap_or(0))
    } else {
        network::NetStats { connections: 0, recv_kb: 0.0, sent_kb: 0.0, connections_detail: vec![] }
    };
    AppMetrics {
        running: info.running,
        pid: info.pid,
        cpu: info.cpu,
        mem_mb: info.mem_mb,
        connections: net.connections,
        recv_kb: net.recv_kb,
        sent_kb: net.sent_kb,
        connections_detail: net.connections_detail,
    }
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

#[derive(Serialize, Clone)]
pub struct DetectedApp {
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
}

#[tauri::command]
fn scan_installed_apps() -> Vec<DetectedApp> {
    #[cfg(target_os = "windows")]
    {
        scan_registry()
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![]
    }
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

            // Skip entries with no display name
            let Ok(display_name) = subkey.get_value::<String, _>("DisplayName") else { continue };
            if display_name.trim().is_empty() { continue }

            // Skip system updates, KB patches
            if display_name.starts_with("KB") || display_name.contains("Update for") ||
               display_name.contains("Security Update") || display_name.contains("Hotfix") {
                continue;
            }

            // Try to get a launch path
            let Some(exe_path) = find_exe_path(&subkey) else { continue };
            if exe_path.is_empty() { continue }

            // Deduplicate by path
            let lower = exe_path.to_lowercase();
            if seen_paths.contains(&lower) { continue }
            seen_paths.insert(lower);

            let icon = icon::extract_icon(&exe_path);

            results.push(DetectedApp {
                name: display_name,
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
    // 1. DisplayIcon — often "C:\path\app.exe,0"
    if let Ok(icon_str) = subkey.get_value::<String, _>("DisplayIcon") {
        let cleaned = icon_str.split(',').next().unwrap_or("").trim().trim_matches('"');
        if cleaned.ends_with(".exe") && std::path::Path::new(cleaned).exists() {
            return Some(cleaned.to_string());
        }
    }

    // 2. InstallLocation — directory, look for a likely .exe
    if let Ok(install_dir) = subkey.get_value::<String, _>("InstallLocation") {
        let dir = install_dir.trim().trim_matches('"');
        if !dir.is_empty() {
            if let Ok(display_name) = subkey.get_value::<String, _>("DisplayName") {
                // Try displayname.exe in install dir
                let candidate = std::path::Path::new(dir)
                    .join(format!("{}.exe", display_name));
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
            // Try first .exe in root of install dir
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.filter_map(|e| e.ok()) {
                    let p = entry.path();
                    if p.extension().and_then(|e| e.to_str()) == Some("exe") {
                        return Some(p.to_string_lossy().to_string());
                    }
                }
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

/// Run the full first-run setup sequence.
/// Emits progress events: "setup_progress" with SetupProgressEvent payload.
#[derive(Clone, Serialize)]
struct SetupProgressEvent {
    step: String,
    status: String,  // "running" | "ok" | "error" | "skip"
    message: String,
    percent: u8,
}

#[tauri::command]
async fn run_first_setup(app: tauri::AppHandle) -> Result<(), String> {
    let emit = |step: &str, status: &str, message: &str, percent: u8| {
        let _ = app.emit("setup_progress", SetupProgressEvent {
            step: step.to_string(),
            status: status.to_string(),
            message: message.to_string(),
            percent,
        });
    };

    // ── Step 1: Check winget ─────────────────────────────────────────────────
    emit("winget", "running", "Checking winget…", 5);

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

    // ── Step 2: Update winget sources ────────────────────────────────────────
    if winget_ok {
        emit("sources", "running", "Updating package sources…", 22);
        // Run in background thread so we don't block too long
        let _ = std::thread::spawn(|| setup::update_winget_sources());
        emit("sources", "ok", "Sources updated", 35);
    } else {
        emit("sources", "skip", "Skipped (winget not available)", 35);
    }

    // ── Step 3: Scan registry ────────────────────────────────────────────────
    emit("scan", "running", "Scanning installed programs…", 38);

    #[cfg(target_os = "windows")]
    let scan_result = {
        let results = scan_registry();
        let count = results.len();
        (count, results)
    };
    #[cfg(not(target_os = "windows"))]
    let scan_result = (0usize, vec![]);

    let (count, _) = scan_result;
    emit("scan", "ok", &format!("Found {} installed programs", count), 90);

    // ── Step 4: Save state ───────────────────────────────────────────────────
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

// ── Store (winget) ───────────────────────────────────────────────────────────

#[derive(Serialize)]
struct WingetAvailable {
    available: bool,
}

#[tauri::command]
fn winget_check() -> WingetAvailable {
    WingetAvailable { available: winget::is_available() }
}

#[tauri::command]
fn winget_search(query: String) -> Vec<winget::WingetPackage> {
    winget::search(&query)
}

#[derive(Serialize)]
struct InstallResult {
    success: bool,
    log: String,
    exe_path: Option<String>,
    icon: Option<String>,
}

#[tauri::command]
fn winget_install(
    app_handle: tauri::AppHandle,
    id: String,
    name: String,
    group_id: Option<String>,
) -> InstallResult {
    let (success, log) = winget::install(&id);

    if !success {
        return InstallResult { success: false, log, exe_path: None, icon: None };
    }

    // After install, try to find the installed exe
    let exe_path = find_installed_exe(&name);
    let icon = exe_path.as_deref().and_then(|p| icon::extract_icon(p));

    // Auto-add to hub if we found the exe
    if let Some(ref path) = exe_path {
        let entry = App {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.clone(),
            path: path.clone(),
            icon: icon.clone(),
            group_id,
        };
        let mut s = store::load(&app_handle);
        // Don't duplicate
        if !s.apps.iter().any(|a| a.path.to_lowercase() == path.to_lowercase()) {
            s.apps.push(entry);
            store::save(&app_handle, &s);
        }
    }

    InstallResult { success: true, log, exe_path, icon }
}

#[tauri::command]
fn winget_uninstall(id: String) -> InstallResult {
    let (success, log) = winget::uninstall(&id);
    InstallResult { success, log, exe_path: None, icon: None }
}

#[tauri::command]
fn winget_list_installed() -> Vec<winget::WingetPackage> {
    winget::list_installed()
}

/// Try to find the exe for a freshly installed app via registry
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            if apply_mica(&window, Some(true)).is_err() {
                let _ = apply_acrylic(&window, Some((18, 18, 20, 180)));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_store,
            add_app,
            remove_app,
            move_app_to_group,
            launch_app,
            get_process_info,
            kill_app,
            get_app_metrics,
            add_group,
            remove_group,
            rename_group,
            scan_installed_apps,
            winget_check,
            winget_search,
            winget_install,
            winget_uninstall,
            winget_list_installed,
            get_setup_status,
            run_first_setup,
            mark_setup_complete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
