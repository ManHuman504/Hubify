use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Serialize, Clone)]
pub struct ProcessInfo {
    pub running: bool,
    pub pid: Option<u32>,
    pub cpu: f32,
    pub mem_mb: f64,
}

struct SharedState {
    sys: sysinfo::System,
    last_refresh: std::time::Instant,
}

impl SharedState {
    fn new() -> Self {
        let mut sys = sysinfo::System::new();
        sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        Self {
            sys,
            last_refresh: std::time::Instant::now(),
        }
    }

    fn refresh_if_stale(&mut self) {
        if self.last_refresh.elapsed() >= std::time::Duration::from_millis(500) {
            self.sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
            self.last_refresh = std::time::Instant::now();
        }
    }
}

lazy_static::lazy_static! {
    static ref PROCESS_STATE: Arc<Mutex<SharedState>> = Arc::new(Mutex::new(SharedState::new()));
}



pub fn get_processes_info(exe_paths: &[String]) -> HashMap<String, ProcessInfo> {
    let mut state = PROCESS_STATE.lock().unwrap();
    state.refresh_if_stale();

    let sys = &state.sys;
    let mut target_names: HashMap<String, Vec<String>> = HashMap::new();
    for path in exe_paths {
        let name = Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        target_names.entry(name).or_default().push(path.clone());
    }

    let mut results: HashMap<String, ProcessInfo> = HashMap::new();
    for (_, proc) in sys.processes() {
        let name = proc.name().to_string_lossy().to_lowercase();
        if let Some(paths) = target_names.get(&name) {
            let info = ProcessInfo {
                running: true,
                pid: Some(proc.pid().as_u32()),
                cpu: proc.cpu_usage(),
                mem_mb: proc.memory() as f64 / 1024.0 / 1024.0,
            };
            for p in paths {
                results.entry(p.clone()).or_insert(info.clone());
            }
        }
    }

    for path in exe_paths {
        results
            .entry(path.clone())
            .or_insert(ProcessInfo {
                running: false,
                pid: None,
                cpu: 0.0,
                mem_mb: 0.0,
            });
    }

    results
}

pub fn get_process_info(exe_path: &str) -> ProcessInfo {
    let res = get_processes_info(&[exe_path.to_string()]);
    res.get(exe_path)
        .cloned()
        .unwrap_or(ProcessInfo {
            running: false,
            pid: None,
            cpu: 0.0,
            mem_mb: 0.0,
        })
}

pub fn kill_process(exe_path: &str) -> bool {
    let exe_name = Path::new(exe_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mut state = PROCESS_STATE.lock().unwrap();
    state.refresh_if_stale();

    let mut killed = false;
    for (_, proc) in state.sys.processes() {
        if proc.name().to_string_lossy().to_lowercase() == exe_name {
            proc.kill();
            killed = true;
        }
    }
    killed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_process_info_returns_bool_fast() {
        let info = get_process_info("nonexistent.exe");
        assert!(!info.running);
        assert!(info.pid.is_none());
    }
}
