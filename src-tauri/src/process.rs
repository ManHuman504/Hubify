use serde::Serialize;
use sysinfo::{ProcessesToUpdate, System};
use std::path::Path;
use std::collections::HashMap;

#[derive(Serialize, Clone)]
pub struct ProcessInfo {
    pub running: bool,
    pub pid: Option<u32>,
    pub cpu: f32,
    pub mem_mb: f64,
}

pub fn get_processes_info(exe_paths: &[String]) -> HashMap<String, ProcessInfo> {
    let mut sys = System::new();
    // First pass
    sys.refresh_processes(ProcessesToUpdate::All, true);
    // Short sleep so sysinfo can measure CPU delta
    std::thread::sleep(std::time::Duration::from_millis(200));
    // Second pass
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut target_names: HashMap<String, Vec<String>> = HashMap::new();
    for path in exe_paths {
        let name = Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        target_names.entry(name).or_default().push(path.clone());
    }

    let mut results = HashMap::new();

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
                if !results.contains_key(p) {
                    results.insert(p.clone(), info.clone());
                }
            }
        }
    }

    for path in exe_paths {
        if !results.contains_key(path) {
            results.insert(path.clone(), ProcessInfo { running: false, pid: None, cpu: 0.0, mem_mb: 0.0 });
        }
    }

    results
}

pub fn get_process_info(exe_path: &str) -> ProcessInfo {
    let res = get_processes_info(&[exe_path.to_string()]);
    res.get(exe_path).cloned().unwrap_or(ProcessInfo { running: false, pid: None, cpu: 0.0, mem_mb: 0.0 })
}

pub fn kill_process(exe_path: &str) -> bool {
    let exe_name = Path::new(exe_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mut sys = System::new();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let mut killed = false;
    for (_, proc) in sys.processes() {
        if proc.name().to_string_lossy().to_lowercase() == exe_name {
            proc.kill();
            killed = true;
        }
    }
    killed
}
