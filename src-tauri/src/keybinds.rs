use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState};

lazy_static::lazy_static! {
    /// Map of registered shortcuts → app path for per-app hotkeys
    static ref APP_HOTKEYS: Mutex<Vec<(Shortcut, String)>> = Mutex::new(Vec::new());
    /// Global toggle shortcut
    static ref GLOBAL_HOTKEY: Mutex<Option<Shortcut>> = Mutex::new(None);
}

/// Parse a shortcut string like "Ctrl+Shift+A" into (Modifiers, Code)
pub fn parse_shortcut(s: &str) -> Option<Shortcut> {
    let parts: Vec<&str> = s.split('+').map(|p| p.trim()).collect();
    let mut modifiers = Modifiers::empty();
    let mut key_code = None;

    for part in parts {
        let upper = part.to_uppercase();
        match upper.as_str() {
            "CTRL" | "CONTROL" => modifiers |= Modifiers::CONTROL,
            "ALT" => modifiers |= Modifiers::ALT,
            "SHIFT" => modifiers |= Modifiers::SHIFT,
            "SUPER" | "WIN" | "CMD" => modifiers |= Modifiers::SUPER,
            other => {
                if other.len() == 1 {
                    let c = other.chars().next().unwrap();
                    key_code = code_from_char(c);
                } else {
                    key_code = match other {
                        "F1" => Some(Code::F1),
                        "F2" => Some(Code::F2),
                        "F3" => Some(Code::F3),
                        "F4" => Some(Code::F4),
                        "F5" => Some(Code::F5),
                        "F6" => Some(Code::F6),
                        "F7" => Some(Code::F7),
                        "F8" => Some(Code::F8),
                        "F9" => Some(Code::F9),
                        "F10" => Some(Code::F10),
                        "F11" => Some(Code::F11),
                        "F12" => Some(Code::F12),
                        "SPACE" => Some(Code::Space),
                        "ENTER" => Some(Code::Enter),
                        "ESCAPE" | "ESC" => Some(Code::Escape),
                        "TAB" => Some(Code::Tab),
                        "BACKSPACE" => Some(Code::Backspace),
                        "DELETE" => Some(Code::Delete),
                        "HOME" => Some(Code::Home),
                        "END" => Some(Code::End),
                        "PAGEUP" => Some(Code::PageUp),
                        "PAGEDOWN" => Some(Code::PageDown),
                        "UP" => Some(Code::ArrowUp),
                        "DOWN" => Some(Code::ArrowDown),
                        "LEFT" => Some(Code::ArrowLeft),
                        "RIGHT" => Some(Code::ArrowRight),
                        _ => None,
                    };
                }
            }
        }
    }

    key_code.map(|code| Shortcut::new(Some(modifiers), code))
}

fn code_from_char(c: char) -> Option<Code> {
    match c {
        'A'..='Z' => {
            let idx = (c as u8 - b'A') as usize;
            Some([
                Code::KeyA, Code::KeyB, Code::KeyC, Code::KeyD, Code::KeyE,
                Code::KeyF, Code::KeyG, Code::KeyH, Code::KeyI, Code::KeyJ,
                Code::KeyK, Code::KeyL, Code::KeyM, Code::KeyN, Code::KeyO,
                Code::KeyP, Code::KeyQ, Code::KeyR, Code::KeyS, Code::KeyT,
                Code::KeyU, Code::KeyV, Code::KeyW, Code::KeyX, Code::KeyY, Code::KeyZ,
            ][idx])
        }
        '0'..='9' => {
            let idx = (c as u8 - b'0') as usize;
            Some([
                Code::Digit0, Code::Digit1, Code::Digit2, Code::Digit3, Code::Digit4,
                Code::Digit5, Code::Digit6, Code::Digit7, Code::Digit8, Code::Digit9,
            ][idx])
        }
        _ => None,
    }
}

/// Handle a shortcut event
fn handle_shortcut(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    // Only act on Pressed, ignore Released
    if !matches!(event.state, ShortcutState::Pressed) {
        return;
    }

    // Check per-app hotkeys — match against the Shortcut objects (no string parsing)
    {
        let hotkeys = APP_HOTKEYS.lock().unwrap();
        for (registered, path) in hotkeys.iter() {
            if registered == shortcut {
                let _ = crate::focus_or_launch_app(path.clone());
                return;
            }
        }
    }

    // Check global toggle
    {
        let toggle = GLOBAL_HOTKEY.lock().unwrap();
        if toggle.as_ref() == Some(shortcut) {
            if let Some(window) = app.get_webview_window("main") {
                if window.is_visible().unwrap_or(false) {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
    }
}

/// Build the shortcut plugin with handler
pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(handle_shortcut)
        .build()
}

/// Register all app hotkeys from the store
pub fn register_all(app: &AppHandle) {
    let guard = app.global_shortcut();
    let _ = guard.unregister_all();

    let mut app_hotkeys = APP_HOTKEYS.lock().unwrap();
    app_hotkeys.clear();

    let s = crate::store::load(app);
    for a in &s.apps {
        if let Some(ref hotkey_str) = a.hotkey {
            if let Some(shortcut) = parse_shortcut(hotkey_str) {
                let _ = guard.register(shortcut.clone());
                app_hotkeys.push((shortcut, a.path.clone()));
            }
        }
    }

    // Global toggle: Ctrl+Shift+H
    if let Some(shortcut) = parse_shortcut("Ctrl+Shift+H") {
        let _ = guard.register(shortcut.clone());
        let mut toggle = GLOBAL_HOTKEY.lock().unwrap();
        *toggle = Some(shortcut);
    }
}
