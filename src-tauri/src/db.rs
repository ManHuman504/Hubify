use rusqlite::{Connection, Result};
use std::path::PathBuf;
use tauri::Manager;

pub fn init(app_handle: &tauri::AppHandle) -> Result<()> {
    let db_path = get_db_path(app_handle);
    let conn = Connection::open(db_path)?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS usage_stats (
            id INTEGER PRIMARY KEY,
            app_path TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            cpu_usage REAL,
            memory_mb REAL,
            is_active INTEGER
        )",
        (),
    )?;

    // Index for faster queries later
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_usage_app_path ON usage_stats (app_path)",
        (),
    )?;

    Ok(())
}

pub fn log_usage(app_handle: &tauri::AppHandle, app_path: &str, cpu: f32, mem: f64, active: bool) -> Result<()> {
    let db_path = get_db_path(app_handle);
    let conn = Connection::open(db_path)?;

    conn.execute(
        "INSERT INTO usage_stats (app_path, cpu_usage, memory_mb, is_active) VALUES (?1, ?2, ?3, ?4)",
        (app_path, cpu as f64, mem, if active { 1 } else { 0 }),
    )?;

    Ok(())
}

fn get_db_path(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .unwrap()
        .join("hubify.db")
}
