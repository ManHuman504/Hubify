#[cfg(target_os = "windows")]
use winreg::enums::{HKEY_CURRENT_USER, KEY_ALL_ACCESS};
#[cfg(target_os = "windows")]
use winreg::RegKey;

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

pub fn is_autostart_enabled(app_name: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(run) = hkcu.open_subkey(RUN_KEY) {
            // 1. Exact match
            if run.get_value::<String, _>(app_name).is_ok() { return true; }
            
            // 2. Fuzzy match (check all values)
            let lower_name = app_name.to_lowercase();
            for res in run.enum_values().filter_map(|r| r.ok()) {
                if res.0.to_lowercase().contains(&lower_name) {
                    return true;
                }
            }
        }
    }
    false
}

pub fn set_autostart(app_name: &str, exe_path: &str, enable: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run = hkcu.open_subkey_with_flags(RUN_KEY, KEY_ALL_ACCESS).map_err(|e| e.to_string())?;

        if enable {
            // We store the path to the exe. 
            // Note: If we want to launch via Hubify tree, we could store hubify.exe --launch ...
            run.set_value(app_name, &exe_path).map_err(|e| e.to_string())?;
        } else {
            let _ = run.delete_value(app_name);
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app_name, exe_path, enable);
        Ok(())
    }
}

#[derive(serde::Serialize)]
pub struct StartupItem {
    pub name: String,
    pub cmd: String,
}

pub fn get_startup_items() -> Vec<StartupItem> {
    #[cfg(target_os = "windows")]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(run) = hkcu.open_subkey(RUN_KEY) {
            return run.enum_values()
                .filter_map(|res| res.ok())
                .map(|(name, val)| StartupItem {
                    name,
                    cmd: val.to_string(),
                })
                .collect();
        }
    }
    vec![]
}

/// Specialized version for Hubify-managed shortcuts
pub fn set_hub_autostart(app_name: &str, target_exe: &str, enable: bool) -> Result<(), String> {
    let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let launch_cmd = format!("\"{}\" --launch \"{}\"", current_exe.to_string_lossy(), target_exe);
    set_autostart(app_name, &launch_cmd, enable)
}
