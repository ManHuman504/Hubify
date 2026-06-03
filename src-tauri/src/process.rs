use serde::Serialize;
use sysinfo::{ProcessesToUpdate, System};
use std::path::Path;

#[derive(Serialize)]
pub struct ProcessInfo {
    pub running: bool,
    pub pid: Option<u32>,
    pub cpu: f32,
    pub mem_mb: f64,
}

pub fn get_process_info(exe_path: &str) -> ProcessInfo {
    let exe_name = Path::new(exe_path)
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mut sys = System::new();
    // First pass — register processes
    sys.refresh_processes(ProcessesToUpdate::All, true);
    // Short sleep so sysinfo can measure CPU delta
    std::thread::sleep(std::time::Duration::from_millis(200));
    // Second pass — get actual CPU usage
    sys.refresh_processes(ProcessesToUpdate::All, true);

    for (pid, proc) in sys.processes() {
        let name = proc.name().to_string_lossy().to_lowercase();
        if name == exe_name {
            return ProcessInfo {
                running: true,
                pid: Some(pid.as_u32()),
                cpu: proc.cpu_usage(),
                mem_mb: proc.memory() as f64 / 1024.0 / 1024.0,
            };
        }
    }

    ProcessInfo { running: false, pid: None, cpu: 0.0, mem_mb: 0.0 }
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
