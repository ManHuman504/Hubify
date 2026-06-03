#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;
#[cfg(target_os = "windows")]
use windows::Win32::System::JobObjects::{CreateJobObjectW, AssignProcessToJobObject};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HANDLE;

#[cfg(target_os = "windows")]
static mut GLOBAL_JOB: Option<HANDLE> = None;

pub fn init() {
    #[cfg(target_os = "windows")]
    unsafe {
        if let Ok(handle) = CreateJobObjectW(None, None) {
            // Default behavior: apps stay alive when Hubify closes.
            GLOBAL_JOB = Some(handle);
        }
    }
}

pub fn assign(child: &std::process::Child) {
    #[cfg(target_os = "windows")]
    unsafe {
        if let Some(job) = GLOBAL_JOB {
            let process_handle = HANDLE(child.as_raw_handle() as *mut _);
            let _ = AssignProcessToJobObject(job, process_handle);
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = child;
    }
}
