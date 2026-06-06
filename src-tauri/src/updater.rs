use serde::{Serialize, Deserialize};
use std::io::Write;
use std::path::PathBuf;

const GITHUB_OWNER: &str = "feeloowe";
const GITHUB_REPO: &str = "hubify";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub latest_version: String,
    pub current_version: String,
    pub release_notes: String,
    pub download_url: Option<String>,
    pub asset_name: Option<String>,
    pub error: Option<String>,
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    assets: Vec<GitHubAsset>,
}

#[derive(Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

pub fn get_current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub async fn check_for_update() -> UpdateInfo {
    let current = get_current_version();

    let url = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        GITHUB_OWNER, GITHUB_REPO
    );

    let client = reqwest::Client::builder()
        .user_agent("Hubify-Updater/1.0")
        .build();

    let client = match client {
        Ok(c) => c,
        Err(e) => {
            return UpdateInfo {
                available: false,
                latest_version: current.clone(),
                current_version: current,
                release_notes: String::new(),
                download_url: None,
                asset_name: None,
                error: Some(format!("Failed to create HTTP client: {}", e)),
            };
        }
    };

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => {
            return UpdateInfo {
                available: false,
                latest_version: current.clone(),
                current_version: current,
                release_notes: String::new(),
                download_url: None,
                asset_name: None,
                error: None,
            };
        }
    };

    if !resp.status().is_success() {
        return UpdateInfo {
            available: false,
            latest_version: current.clone(),
            current_version: current,
            release_notes: String::new(),
            download_url: None,
            asset_name: None,
            error: None,
        };
    }

    let release: GitHubRelease = match resp.json().await {
        Ok(r) => r,
        Err(_) => {
            return UpdateInfo {
                available: false,
                latest_version: current.clone(),
                current_version: current,
                release_notes: String::new(),
                download_url: None,
                asset_name: None,
                error: None,
            };
        }
    };

    let latest = release.tag_name.trim_start_matches('v').to_string();

    if !is_newer(&latest, &current) {
        return UpdateInfo {
            available: false,
            latest_version: latest,
            current_version: current,
            release_notes: release.body.unwrap_or_default(),
            download_url: None,
            asset_name: None,
            error: None,
        };
    }

    let asset = release.assets.iter().find(|a| {
        let lower = a.name.to_lowercase();
        lower.ends_with(".msi") || lower.ends_with(".exe") || lower.ends_with(".msix")
    });

    UpdateInfo {
        available: true,
        latest_version: latest,
        current_version: current,
        release_notes: release.body.unwrap_or_default(),
        download_url: asset.map(|a| a.browser_download_url.clone()),
        asset_name: asset.map(|a| a.name.clone()),
        error: None,
    }
}

pub async fn download_update(
    url: &str,
    dest_dir: &PathBuf,
    on_progress: impl Fn(u64, u64) + Send + 'static,
) -> Result<PathBuf, String> {
    let client = reqwest::Client::builder()
        .user_agent("Hubify-Updater/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client.get(url).send().await.map_err(|e| e.to_string())?;

    let total_size = resp.content_length().unwrap_or(0);

    let filename = url
        .split('/')
        .last()
        .unwrap_or("update.msi");

    let dest = dest_dir.join(filename);

    let mut file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;

    loop {
        let chunk = resp.chunk().await.map_err(|e| e.to_string())?;
        match chunk {
            Some(data) => {
                file.write_all(&data).map_err(|e| e.to_string())?;
                downloaded += data.len() as u64;
                on_progress(downloaded, total_size);
            }
            None => break,
        }
    }

    Ok(dest)
}

pub fn install_update(path: &PathBuf) -> Result<(), String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());

    let path_str = path.to_string_lossy();

    match ext.as_deref() {
        Some("msi") | Some("msix") => {
            crate::hidden_cmd("msiexec")
                .args(["/i", &*path_str, "/qb", "/norestart"])
                .spawn()
                .map_err(|e| format!("Failed to launch installer: {}", e))?;
        }
        Some("exe") => {
            std::process::Command::new(&*path_str)
                .arg("/S")
                .spawn()
                .or_else(|_| {
                    std::process::Command::new(&*path_str)
                        .spawn()
                        .map_err(|e| format!("Failed to launch installer: {}", e))
                })?;
        }
        _ => return Err("Unsupported installer format".to_string()),
    }

    std::thread::sleep(std::time::Duration::from_millis(500));
    Ok(())
}

fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.')
            .filter_map(|s| {
                let s = s.trim();
                if s.is_empty() { None } else { s.parse::<u32>().ok() }
            })
            .collect()
    };

    let latest_parts = parse(latest);
    let current_parts = parse(current);

    for (l, c) in latest_parts.iter().zip(current_parts.iter()) {
        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }

    latest_parts.len() > current_parts.len()
}
