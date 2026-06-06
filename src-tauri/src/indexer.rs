use rusqlite::{Connection, params};
use serde::{Serialize, Deserialize};
use std::sync::Mutex;
use std::path::Path;
use jwalk::{WalkDir, Parallelism};
use std::thread;

lazy_static::lazy_static! {
    static ref INDEX_DB: Mutex<Option<Connection>> = Mutex::new(None);
    static ref INDEXING: Mutex<bool> = Mutex::new(false);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

fn get_all_drives() -> Vec<String> {
    let mut drives = Vec::new();
    for letter in 'C'..='Z' {
        if Path::new(&format!("{}:", letter)).exists() {
            drives.push(format!("{}:", letter));
        }
    }
    drives
}

fn find_steam_libraries() -> Vec<String> {
    let mut libs = Vec::new();
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
            let main = format!("{}\\steamapps\\common", sp);
            if Path::new(&main).exists() { libs.push(main); }

            let vdf = format!("{}\\steamapps\\libraryfolders.vdf", sp);
            if let Ok(content) = std::fs::read_to_string(&vdf) {
                for line in content.lines() {
                    let t = line.trim();
                    if t.starts_with("\"path\"") {
                        // Extract the path from: "path" "X:\folder"
                        if let Some(last_quote) = t.rfind('"') {
                            if last_quote > 0 {
                                if let Some(prev_quote) = t[..last_quote].rfind('"') {
                                    let extracted = &t[prev_quote+1..last_quote];
                                    if extracted.contains(':') {
                                        let p = format!("{}\\steamapps\\common", extracted);
                                        if Path::new(&p).exists() {
                                            libs.push(p);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    libs
}

fn build_paths_list() -> Vec<String> {
    let mut paths = Vec::new();

    let drives = get_all_drives();

    for drive in &drives {
        paths.push(format!("{}\\Program Files", drive));
        paths.push(format!("{}\\Program Files (x86)", drive));
        paths.push(format!("{}\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs", drive));
    }

    if let Ok(up) = std::env::var("USERPROFILE") {
        paths.push(format!("{}\\AppData\\Local\\Microsoft\\Windows\\Start Menu\\Programs", up));
        paths.push(format!("{}\\AppData\\Local\\Programs", up));
        paths.push(format!("{}\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs", up));
        paths.push(format!("{}\\Desktop", up));
        paths.push(format!("{}\\AppData\\Local\\Microsoft\\WindowsApps", up));
        let scoops = format!("{}\\scoop\\apps", up);
        if Path::new(&scoops).exists() { paths.push(scoops); }
    }

    if let Ok(ap) = std::env::var("ALLUSERSPROFILE") {
        paths.push(format!("{}\\Microsoft\\Windows\\Start Menu\\Programs", ap));
    }

    let choco = "C:\\ProgramData\\chocolatey\\lib".to_string();
    if Path::new(&choco).exists() { paths.push(choco); }

    paths.extend(find_steam_libraries());

    paths.retain(|p| Path::new(p).exists());
    paths
}

fn init_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS index_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            is_dir INTEGER NOT NULL DEFAULT 0,
            size INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_files_name ON files(name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
    ")
}

fn build_index(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM files", []).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM index_meta", []).map_err(|e| e.to_string())?;

    let paths = build_paths_list();
    let total_paths = paths.len();
    println!("Indexer: Scanning {} directories...", total_paths);

    conn.execute("BEGIN TRANSACTION", []).map_err(|e| e.to_string())?;
    let mut count = 0usize;
    let mut batch = Vec::new();

    for (idx, path) in paths.iter().enumerate() {
        println!("Indexer: [{}/{}] {}", idx + 1, total_paths, path);

        for entry in WalkDir::new(path)
            .parallelism(Parallelism::Serial)
            .skip_hidden(true)
            .process_read_dir(|_, _, _, dir_entry_results| {
                dir_entry_results.retain(|r| {
                    if let Ok(ref e) = r {
                        if e.file_type().is_dir() {
                            let n = e.file_name().to_string_lossy().to_lowercase();
                            if n == "node_modules" || n == ".git" || n == ".svn" || n == "__pycache__" {
                                return false;
                            }
                        }
                    }
                    r.is_ok()
                });
            })
        {
            if let Ok(entry) = entry {
                let path_str = entry.path().to_string_lossy().to_string();
                let name = entry.file_name().to_string_lossy().to_string();
                let is_dir = entry.file_type().is_dir();
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);

                batch.push((path_str, name, is_dir, size));
                count += 1;

                if batch.len() >= 10000 {
                    flush_batch(conn, &batch)?;
                    batch.clear();
                }
            }
        }
    }

    if !batch.is_empty() {
        flush_batch(conn, &batch)?;
    }

    conn.execute("COMMIT", []).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO index_meta (key, value) VALUES ('total', ?1)",
        params![count.to_string()],
    ).map_err(|e| e.to_string())?;

    println!("Indexer: Index built: {} files", count);
    Ok(())
}

fn flush_batch(conn: &Connection, batch: &[(String, String, bool, u64)]) -> Result<(), String> {
    for (path, name, is_dir, size) in batch {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO files (path, name, is_dir, size) VALUES (?1, ?2, ?3, ?4)",
            params![path, name, *is_dir as i32, *size as i64],
        );
    }
    Ok(())
}

pub fn init(db_path: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(db_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;

    let count: i64 = conn.query_row(
        "SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM index_meta WHERE key = 'total'), 0)",
        [],
        |r| r.get(0),
    ).unwrap_or(0);

    if count > 0 {
        println!("Indexer: Loaded existing index ({} entries)", count);
        *INDEX_DB.lock().unwrap() = Some(conn);
        return Ok(());
    }

    // Build index in background
    *INDEXING.lock().unwrap() = true;
    *INDEX_DB.lock().unwrap() = Some(conn);
    let db_path_owned = db_path.to_string();

    thread::spawn(move || {
        let t0 = std::time::Instant::now();

        // Re-open connection for the background thread
        match Connection::open(&db_path_owned) {
            Ok(bg_conn) => {
                if let Err(e) = init_schema(&bg_conn) {
                    println!("Indexer: Schema error: {}", e);
                    *INDEXING.lock().unwrap() = false;
                    return;
                }
                match build_index(&bg_conn) {
                    Ok(()) => {
                        let elapsed = t0.elapsed();
                        println!("Indexer: Complete in {:.1}s", elapsed.as_secs_f64());
                    }
                    Err(e) => println!("Indexer: Build error: {}", e),
                }
            }
            Err(e) => println!("Indexer: DB error: {}", e),
        }
        *INDEXING.lock().unwrap() = false;
    });

    Ok(())
}

pub fn search(query: &str, limit: usize, ext_filter: Option<&str>) -> Result<Vec<IndexEntry>, String> {
    let guard = INDEX_DB.lock().unwrap();
    let conn = guard.as_ref().ok_or("Index not initialized")?;

    let q = format!("%{}%", query.replace('%', "%%"));

    let (where_ext, ext_params): (String, Vec<String>) = if let Some(exts) = ext_filter {
        let parts: Vec<String> = exts.split(',').map(|s| s.trim().to_lowercase()).collect();
        (format!("AND ({} )", parts.iter().enumerate().map(|(i, _)| format!("LOWER(name) LIKE ?{}", i + 3)).collect::<Vec<_>>().join(" OR ")), parts)
    } else {
        (String::new(), vec![])
    };

    let sql = format!(
        "SELECT name, path, is_dir, size FROM files WHERE name LIKE ?1 {} ORDER BY is_dir ASC, size DESC LIMIT ?2",
        where_ext
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![
        Box::new(q),
        Box::new(limit as i64),
    ];

    for ext in &ext_params {
        param_values.push(Box::new(format!("%{}", ext)));
    }

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(IndexEntry {
            name: row.get(0)?,
            path: row.get(1)?,
            is_dir: row.get::<_, i32>(2)? != 0,
            size: row.get::<_, i64>(3)? as u64,
        })
    }).map_err(|e| e.to_string())?;

    let results: Vec<IndexEntry> = rows.filter_map(|r| r.ok()).collect();
    Ok(results)
}

pub fn search_by_path(path_filter: &str, limit: usize, ext_filter: Option<&str>) -> Result<Vec<IndexEntry>, String> {
    let guard = INDEX_DB.lock().unwrap();
    let conn = guard.as_ref().ok_or("Index not initialized")?;

    let pf = format!("%{}%", path_filter.replace('%', "%%"));

    let (where_ext, ext_params): (String, Vec<String>) = if let Some(exts) = ext_filter {
        let parts: Vec<String> = exts.split(',').map(|s| s.trim().to_lowercase()).collect();
        let conditions: Vec<String> = parts.iter().enumerate()
            .map(|(i, _)| format!("LOWER(name) LIKE ?{}", i + 3))
            .collect();
        (format!("AND ({}) ", conditions.join(" OR ")), parts)
    } else {
        (String::new(), vec![])
    };

    let sql = format!(
        "SELECT name, path, is_dir, size FROM files WHERE path LIKE ?1 {}ORDER BY is_dir ASC, size DESC LIMIT ?2",
        where_ext
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![
        Box::new(pf),
        Box::new(limit as i64),
    ];

    for ext in &ext_params {
        param_values.push(Box::new(format!("%{}", ext)));
    }

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(IndexEntry {
            name: row.get(0)?,
            path: row.get(1)?,
            is_dir: row.get::<_, i32>(2)? != 0,
            size: row.get::<_, i64>(3)? as u64,
        })
    }).map_err(|e| e.to_string())?;

    let results: Vec<IndexEntry> = rows.filter_map(|r| r.ok()).collect();
    Ok(results)
}

pub fn search_apps(query: &str, limit: usize) -> Result<Vec<IndexEntry>, String> {
    let guard = INDEX_DB.lock().unwrap();
    let conn = guard.as_ref().ok_or("Index not initialized")?;

    let q = format!("%{}%", query.replace('%', "%%"));

    let mut stmt = conn.prepare(
        "SELECT name, path, is_dir, size FROM files \
         WHERE name LIKE ?1 AND (LOWER(name) LIKE '%.exe' OR LOWER(name) LIKE '%.lnk' \
         OR LOWER(name) LIKE '%.bat' OR LOWER(name) LIKE '%.cmd' OR LOWER(name) LIKE '%.msi') \
         ORDER BY is_dir ASC, size DESC LIMIT ?2"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![q, limit as i64], |row| {
        Ok(IndexEntry {
            name: row.get(0)?,
            path: row.get(1)?,
            is_dir: row.get::<_, i32>(2)? != 0,
            size: row.get::<_, i64>(3)? as u64,
        })
    }).map_err(|e| e.to_string())?;

    let results: Vec<IndexEntry> = rows.filter_map(|r| r.ok()).collect();
    Ok(results)
}

pub fn is_ready() -> bool {
    INDEX_DB.lock().unwrap().is_some()
}

pub fn is_indexing() -> bool {
    *INDEXING.lock().unwrap()
}

pub fn total_entries() -> i64 {
    let guard = INDEX_DB.lock().unwrap();
    if let Some(ref conn) = *guard {
        conn.query_row(
            "SELECT COALESCE((SELECT CAST(value AS INTEGER) FROM index_meta WHERE key = 'total'), 0)",
            [],
            |r| r.get(0),
        ).unwrap_or(0)
    } else {
        0
    }
}
