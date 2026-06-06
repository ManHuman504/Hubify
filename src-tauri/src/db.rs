use rusqlite::{Connection, Result, params};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

lazy_static::lazy_static! {
    static ref DB_CONN: Mutex<Option<Connection>> = Mutex::new(None);
}

fn get_or_init_conn(app_handle: &tauri::AppHandle) -> Result<std::sync::MutexGuard<'static, Option<Connection>>> {
    let mut guard = DB_CONN.lock().unwrap();
    if guard.is_none() {
        let db_path = get_db_path(app_handle);
        let conn = Connection::open(db_path)?;
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS usage_stats (
                id INTEGER PRIMARY KEY,
                app_path TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                cpu_usage REAL,
                memory_mb REAL,
                is_active INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_usage_app_path ON usage_stats (app_path);
            CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_stats (timestamp);

            CREATE TABLE IF NOT EXISTS network_log (
                id INTEGER PRIMARY KEY,
                app_path TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                remote_ip TEXT NOT NULL,
                remote_port INTEGER NOT NULL,
                local_port INTEGER NOT NULL,
                state TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_net_app_path ON network_log (app_path);
            CREATE INDEX IF NOT EXISTS idx_net_ts ON network_log (timestamp);
        ")?;
        *guard = Some(conn);
    }
    Ok(guard)
}

#[derive(Debug, Clone, Serialize)]
pub struct DailyActivity {
    pub date: String,
    pub total_minutes: f64,
    pub total_sessions: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppStat {
    pub name: String,
    pub path: String,
    pub total_minutes: f64,
    pub avg_cpu: f64,
    pub avg_mem_mb: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TodaySummary {
    pub total_minutes: f64,
    pub active_apps: i64,
    pub top_app: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppDailyDetail {
    pub date: String,
    pub total_minutes: f64,
    pub avg_cpu: f64,
    pub avg_mem_mb: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct NetworkRecord {
    pub timestamp: String,
    pub remote_ip: String,
    pub remote_port: u16,
    pub local_port: u16,
    pub state: String,
}

pub fn init(app_handle: &tauri::AppHandle) -> Result<()> {
    let _guard = get_or_init_conn(app_handle)?;
    let _ = app_handle;
    Ok(())
}

pub fn log_usage(app_handle: &tauri::AppHandle, app_path: &str, cpu: f32, mem: f64, active: bool) -> Result<()> {
    let mut guard = get_or_init_conn(app_handle)?;
    let conn = guard.as_mut().unwrap();
    conn.execute(
        "INSERT INTO usage_stats (app_path, cpu_usage, memory_mb, is_active) VALUES (?1, ?2, ?3, ?4)",
        params![app_path, cpu as f64, mem, if active { 1 } else { 0 }],
    )?;
    Ok(())
}

pub fn log_network(app_handle: &tauri::AppHandle, app_path: &str, connections: &[super::network::ConnectionInfo]) -> Result<()> {
    let mut guard = get_or_init_conn(app_handle)?;
    let conn = guard.as_mut().unwrap();
    for c in connections {
        conn.execute(
            "INSERT INTO network_log (app_path, remote_ip, remote_port, local_port, state) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![app_path, c.remote_ip, c.remote_port, c.local_port, c.state],
        )?;
    }
    Ok(())
}

pub fn get_daily_activity(app_handle: &tauri::AppHandle, days: i64) -> Result<Vec<DailyActivity>> {
    let guard = get_or_init_conn(app_handle)?;
    let conn = guard.as_ref().unwrap();
    let mut stmt = conn.prepare(
        "SELECT DATE(timestamp) as day,
                CAST(COUNT(DISTINCT strftime('%Y-%m-%d %H:%M', timestamp)) AS REAL) as total_minutes,
                COUNT(DISTINCT strftime('%H', timestamp) || '-' || app_path) as sessions
         FROM usage_stats
         WHERE timestamp >= DATE('now', ?1)
         GROUP BY day
         ORDER BY day"
    )?;
    let rows = stmt.query_map(params![format!("-{} days", days)], |row| {
        Ok(DailyActivity {
            date: row.get(0)?,
            total_minutes: row.get(1)?,
            total_sessions: row.get(2)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows { result.push(row?); }
    Ok(result)
}

pub fn get_app_stats(app_handle: &tauri::AppHandle) -> Result<Vec<AppStat>> {
    let guard = get_or_init_conn(app_handle)?;
    let conn = guard.as_ref().unwrap();
    let mut stmt = conn.prepare(
        "SELECT app_path,
                ROUND(SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) * 15.0 / 60, 1) as total_minutes,
                ROUND(AVG(cpu_usage), 1) as avg_cpu,
                ROUND(AVG(memory_mb), 1) as avg_mem
         FROM usage_stats
         GROUP BY app_path
         ORDER BY total_minutes DESC
         LIMIT 30"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(AppStat {
            name: String::new(),
            path: row.get(0)?,
            total_minutes: row.get(1)?,
            avg_cpu: row.get(2)?,
            avg_mem_mb: row.get(3)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows { result.push(row?); }
    Ok(result)
}

pub fn get_today_summary(app_handle: &tauri::AppHandle) -> Result<TodaySummary> {
    let guard = get_or_init_conn(app_handle)?;
    let conn = guard.as_ref().unwrap();
    let total: f64 = conn.query_row(
        "SELECT CAST(COUNT(DISTINCT strftime('%Y-%m-%d %H:%M', timestamp)) AS REAL)
         FROM usage_stats WHERE DATE(timestamp) = DATE('now')",
        [], |row| row.get(0),
    ).unwrap_or(0.0);
    let active: i64 = conn.query_row(
        "SELECT COUNT(DISTINCT app_path) FROM usage_stats
         WHERE DATE(timestamp) = DATE('now') AND is_active=1",
        [], |row| row.get(0),
    ).unwrap_or(0);
    let top: String = conn.query_row(
        "SELECT app_path FROM usage_stats
         WHERE DATE(timestamp) = DATE('now') AND is_active=1
         GROUP BY app_path ORDER BY COUNT(*) DESC LIMIT 1",
        [], |row| row.get(0),
    ).unwrap_or_default();
    Ok(TodaySummary { total_minutes: total, active_apps: active, top_app: top })
}

pub fn get_app_daily_detail(app_handle: &tauri::AppHandle, app_path: &str, days: i64) -> Result<Vec<AppDailyDetail>> {
    let guard = get_or_init_conn(app_handle)?;
    let conn = guard.as_ref().unwrap();
    let mut stmt = conn.prepare(
        "SELECT DATE(timestamp) as day,
                ROUND(SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) * 15.0 / 60, 1) as total_minutes,
                ROUND(AVG(cpu_usage), 1) as avg_cpu,
                ROUND(AVG(memory_mb), 1) as avg_mem
         FROM usage_stats
         WHERE app_path = ?1 AND timestamp >= DATE('now', ?2)
         GROUP BY day
         ORDER BY day"
    )?;
    let rows = stmt.query_map(params![app_path, format!("-{} days", days)], |row| {
        Ok(AppDailyDetail {
            date: row.get(0)?,
            total_minutes: row.get(1)?,
            avg_cpu: row.get(2)?,
            avg_mem_mb: row.get(3)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows { result.push(row?); }
    Ok(result)
}

pub fn get_app_network_activity(app_handle: &tauri::AppHandle, app_path: &str, limit: i64) -> Result<Vec<NetworkRecord>> {
    let guard = get_or_init_conn(app_handle)?;
    let conn = guard.as_ref().unwrap();
    let mut stmt = conn.prepare(
        "SELECT timestamp, remote_ip, remote_port, local_port, state
         FROM network_log
         WHERE app_path = ?1
         ORDER BY timestamp DESC
         LIMIT ?2"
    )?;
    let rows = stmt.query_map(params![app_path, limit], |row| {
        Ok(NetworkRecord {
            timestamp: row.get(0)?,
            remote_ip: row.get(1)?,
            remote_port: row.get(2)?,
            local_port: row.get(3)?,
            state: row.get(4)?,
        })
    })?;
    let mut result = Vec::new();
    for row in rows { result.push(row?); }
    Ok(result)
}

pub fn get_app_hourly(app_handle: &tauri::AppHandle, app_path: &str) -> Result<Vec<(String, f64)>> {
    let guard = get_or_init_conn(app_handle)?;
    let conn = guard.as_ref().unwrap();
    let mut stmt = conn.prepare(
        "SELECT strftime('%H:00', timestamp) as hour,
                ROUND(SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) * 15.0 / 60, 2) as mins
         FROM usage_stats
         WHERE app_path = ?1 AND DATE(timestamp) = DATE('now')
         GROUP BY hour
         ORDER BY hour"
    )?;
    let rows = stmt.query_map(params![app_path], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
    })?;
    let mut result = Vec::new();
    for row in rows { result.push(row?); }
    Ok(result)
}

fn get_db_path(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .unwrap()
        .join("hubify.db")
}
