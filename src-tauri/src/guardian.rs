use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager, WebviewWindowBuilder};

lazy_static::lazy_static! {
    static ref STARTUP_SNAPSHOT: Mutex<HashMap<String, String>> = Mutex::new(HashMap::new());
}

fn get_current_startup_map() -> HashMap<String, String> {
    let mut map: HashMap<String, String> = HashMap::new();

    for item in crate::autostart::get_startup_items() {
        map.insert(item.name, item.cmd);
    }

    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
        use winreg::RegKey;
        if let Ok(hklm_run) = RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Run", KEY_READ)
        {
            for res in hklm_run.enum_values().filter_map(|r| r.ok()) {
                map.entry(res.0).or_insert_with(|| res.1.to_string());
            }
        }
    }

    map
}

pub fn start(app_handle: tauri::AppHandle) {
    // Initial snapshot
    {
        let mut snap = STARTUP_SNAPSHOT.lock().unwrap();
        *snap = get_current_startup_map();
    }

    // Auto-start Hubify with Windows for guardian coverage
    // (silent — only set if not already present)
    if let Ok(current_exe) = std::env::current_exe() {
        let path = current_exe.to_string_lossy().to_string();
        if !crate::autostart::is_autostart_enabled("Hubify") {
            let _ = crate::autostart::set_autostart("Hubify", &path, true);
        }
    }

    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(2));

            // Skip if guardian is disabled
            if !crate::store::load(&app_handle).guardian_enabled {
                continue;
            }

            let current = get_current_startup_map();
            let mut snap = STARTUP_SNAPSHOT.lock().unwrap();

            let mut changes: Vec<(String, String)> = Vec::new();
            for (name, cmd) in &current {
                match snap.get(name) {
                    None => changes.push((name.clone(), cmd.clone())),
                    Some(old) if old != cmd => changes.push((name.clone(), cmd.clone())),
                    _ => {}
                }
            }
            *snap = current;
            drop(snap);

            for (name, cmd) in changes {
                show_popup(&app_handle, &name, &cmd);
            }
        }
    });
}

fn show_popup(app_handle: &tauri::AppHandle, name: &str, cmd: &str) {
    let payload = serde_json::json!({ "name": name, "cmd": cmd, "kind": "added" });

    // If popup already open, just update it
    if let Some(window) = app_handle.get_webview_window("guardian-popup") {
        let _ = window.set_focus();
        let _ = window.emit("guardian:startup-change", payload.clone());
        return;
    }

    // Create a new popup window — embed data before page loads via initialization script
    let js = format!(
        "window.__guardianData = {}",
        serde_json::to_string(&payload).unwrap()
    );
    if let Ok(popup) = WebviewWindowBuilder::new(
        app_handle,
        "guardian-popup",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Hubify Guardian")
    .inner_size(480.0, 360.0)
    .always_on_top(true)
    .decorations(false)
    .center()
    .initialization_script(&js)
    .build()
    {
        let _ = popup.emit("guardian:startup-change", payload);
    }
}
