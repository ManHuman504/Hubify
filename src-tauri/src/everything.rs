use serde::{Serialize, Deserialize};
use crate::indexer;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EverythingResult {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

fn to_result(e: indexer::IndexEntry) -> EverythingResult {
    EverythingResult {
        name: e.name,
        path: e.path,
        is_dir: e.is_dir,
    }
}

pub fn init_indexer(db_path: &str) -> Result<(), String> {
    indexer::init(db_path)
}

pub fn search(query: &str, limit: usize, ext_filter: Option<&str>) -> Result<Vec<EverythingResult>, String> {
    let results = indexer::search(query, limit, ext_filter)?;
    Ok(results.into_iter().map(to_result).collect())
}

pub fn search_apps(query: &str, limit: usize) -> Result<Vec<EverythingResult>, String> {
    let results = indexer::search_apps(query, limit)?;
    Ok(results.into_iter().map(to_result).collect())
}

pub fn is_indexer_ready() -> bool {
    indexer::is_ready()
}

pub fn is_indexer_busy() -> bool {
    indexer::is_indexing()
}

pub fn total_indexed() -> i64 {
    indexer::total_entries()
}

pub fn find_steam_games() -> Vec<EverythingResult> {
    let mut games = Vec::new();
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let steam_path = {
            let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
            let path = r"SOFTWARE\WOW6432Node\Valve\Steam";
            if let Ok(key) = hklm.open_subkey_with_flags(path, KEY_READ) {
                key.get_value::<String, _>("InstallPath").ok()
            } else {
                let hkcu = RegKey::predef(HKEY_CURRENT_USER);
                let path = r"SOFTWARE\Valve\Steam";
                hkcu.open_subkey_with_flags(path, KEY_READ)
                    .and_then(|k| k.get_value::<String, _>("SteamPath"))
                    .ok()
            }
        };

        if let Some(sp) = steam_path {
            let mut libs = vec![sp.clone()];
            let vdf = format!("{}\\steamapps\\libraryfolders.vdf", sp);
            if let Ok(content) = std::fs::read_to_string(&vdf) {
                for line in content.lines() {
                    let t = line.trim();
                    if t.contains("\"") && t.contains(":") {
                        if let Some(s) = t.find('"') {
                            if let Some(e) = t.rfind('"') {
                                if s < e {
                                    let lp = &t[s+1..e];
                                    if lp.contains(':') { libs.push(lp.to_string()); }
                                }
                            }
                        }
                    }
                }
            }

            for lib in libs {
                let common = format!("{}\\steamapps\\common", lib);
                let dir = std::path::Path::new(&common);
                if !dir.exists() { continue; }
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.filter_map(|e| e.ok()) {
                        let gd = entry.path();
                        if !gd.is_dir() { continue; }
                        let dn = gd.file_name().unwrap_or_default().to_string_lossy().to_string();
                        if dn.starts_with('.') || dn == "_CommonRedist" { continue; }

                        let mut best = None;
                        if let Ok(files) = std::fs::read_dir(&gd) {
                            for f in files.filter_map(|f| f.ok()) {
                                let fp = f.path();
                                if fp.extension().and_then(|e| e.to_str()) == Some("exe") {
                                    let fn_lower = fp.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                                    if !fn_lower.contains("unins") && !fn_lower.contains("setup") && !fn_lower.contains("crash") && !fn_lower.contains("redist") {
                                        best = Some(fp);
                                    }
                                }
                            }
                        }
                        if let Some(exe) = best {
                            let gn = exe.file_stem().unwrap_or_default().to_string_lossy().to_string();
                            games.push(EverythingResult {
                                name: gn,
                                path: exe.to_string_lossy().to_string(),
                                is_dir: false,
                            });
                        }
                    }
                }
            }
        }
    }
    games
}
