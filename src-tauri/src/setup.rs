use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use tauri::Manager;

// ── State file ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SetupState {
    /// True once first-run setup has been completed
    pub completed: bool,
    /// Winget was available or successfully installed
    pub winget_ok: bool,
    /// Registry scan was completed on first run
    pub initial_scan_done: bool,
}

fn state_path(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .unwrap()
        .join("setup.json")
}

pub fn load_state(app_handle: &tauri::AppHandle) -> SetupState {
    let path = state_path(app_handle);
    if !path.exists() {
        return SetupState::default();
    }
    let data = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&data).unwrap_or_default()
}

pub fn save_state(app_handle: &tauri::AppHandle, state: &SetupState) {
    let path = state_path(app_handle);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&path, serde_json::to_string_pretty(state).unwrap());
}

// ── Tool checks ──────────────────────────────────────────────────────────────

pub fn check_winget() -> bool {
    crate::hidden_cmd("winget")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Attempt to install winget via PowerShell using the official MSIX bundle.
/// This downloads the App Installer from Microsoft's CDN via winget-cli GitHub.
/// Returns (success, log_message)
pub fn install_winget() -> (bool, String) {
    // Strategy 1: try via Add-AppxPackage with the official MSIX bundle URL
    // Microsoft releases winget (App Installer) as a .msixbundle
    let ps_script = r#"
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
try {
    $releases_url = 'https://api.github.com/repos/microsoft/winget-cli/releases/latest'
    $headers = @{ 'User-Agent' = 'Hubify-Setup' }
    $release = Invoke-RestMethod -Uri $releases_url -Headers $headers
    $asset = $release.assets | Where-Object { $_.name -like '*.msixbundle' } | Select-Object -First 1
    if (-not $asset) { throw 'No msixbundle asset found' }
    $tmp = Join-Path $env:TEMP 'winget_installer.msixbundle'
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmp -Headers $headers
    Add-AppxPackage -Path $tmp -ForceApplicationShutdown
    Remove-Item $tmp -ErrorAction SilentlyContinue
    Write-Output 'SUCCESS'
} catch {
    Write-Output "FAILED: $_"
}
"#;

    let output = crate::hidden_cmd("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", ps_script])
        .output();

    match output {
        Ok(o) => {
            let log = String::from_utf8_lossy(&o.stdout).to_string()
                + &String::from_utf8_lossy(&o.stderr);
            let success = log.contains("SUCCESS") || check_winget();
            (success, log.trim().to_string())
        }
        Err(e) => (false, format!("PowerShell error: {}", e)),
    }
}

/// Check if Windows Package Manager source is up to date.
/// Run winget source update silently in background.
pub fn update_winget_sources() {
    let _ = crate::hidden_cmd("winget")
        .args(["source", "update", "--disable-interactivity"])
        .output();
}

// ── Step result ───────────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
pub struct StepResult {
    pub step: String,
    pub ok: bool,
    pub message: String,
}
