use std::mem;
use std::ptr;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
    JOBOBJECT_BASIC_LIMIT_INFORMATION, JobObjectBasicLimitInformation,
};
use windows::Win32::System::Threading::{
    CreateProcessW, ResumeThread, PROCESS_INFORMATION, STARTUPINFOW,
    PROCESS_CREATION_FLAGS, CREATE_SUSPENDED,
};

static mut GLOBAL_JOB: Option<HANDLE> = None;

pub fn init() {
    unsafe {
        if let Ok(handle) = CreateJobObjectW(None, None) {
            let limits = JOBOBJECT_BASIC_LIMIT_INFORMATION {
                LimitFlags: windows::Win32::System::JobObjects::JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK,
                ..Default::default()
            };

            let _ = SetInformationJobObject(
                handle,
                JobObjectBasicLimitInformation,
                &limits as *const _ as *const _,
                mem::size_of::<JOBOBJECT_BASIC_LIMIT_INFORMATION>() as u32,
            );

            GLOBAL_JOB = Some(handle);
        }
    }
}

pub fn launch_process(exe_path: &str) -> Result<(), String> {
    unsafe {
        let Some(job) = GLOBAL_JOB else {
            return Err("Job object not initialized".to_string());
        };

        let wide: Vec<u16> = OsStr::new(exe_path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut si = STARTUPINFOW::default();
        si.cb = mem::size_of::<STARTUPINFOW>() as u32;
        let mut pi = PROCESS_INFORMATION::default();

        let result = CreateProcessW(
            PCWSTR::from_raw(wide.as_ptr()),
            PWSTR(ptr::null_mut()),
            None,
            None,
            false,
            CREATE_SUSPENDED | PROCESS_CREATION_FLAGS(0x08000000),
            None,
            None,
            &si,
            &mut pi,
        );

        if result.is_err() {
            return launch_with_cmd(exe_path);
        }

        let process_handle = pi.hProcess;
        if let Err(e) = AssignProcessToJobObject(job, process_handle) {
            let _ = CloseHandle(process_handle);
            let _ = CloseHandle(pi.hThread);
            return Err(format!("AssignProcessToJobObject: {:?}", e));
        }

        let _ = ResumeThread(pi.hThread);
        let _ = CloseHandle(pi.hThread);
        let _ = CloseHandle(process_handle);

        Ok(())
    }
}

unsafe fn launch_with_cmd(path: &str) -> Result<(), String> {
    let cmd_line = format!("/c start \"\" \"{}\"", path.replace('"', "\\\""));
    let mut cmd_line_wide: Vec<u16> = OsStr::new(&cmd_line)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut si = STARTUPINFOW::default();
    si.cb = mem::size_of::<STARTUPINFOW>() as u32;
    let mut pi = PROCESS_INFORMATION::default();

    let result = CreateProcessW(
        PCWSTR::from_raw(ptr::null()),
        PWSTR(cmd_line_wide.as_mut_ptr() as *mut _),
        None,
        None,
        false,
        CREATE_SUSPENDED | PROCESS_CREATION_FLAGS(0x08000000),
        None,
        None,
        &si,
        &mut pi,
    );

    if result.is_err() {
        return Err("Failed to launch process".to_string());
    }

    if let Some(job) = GLOBAL_JOB {
        let _ = AssignProcessToJobObject(job, pi.hProcess);
    }

    let _ = ResumeThread(pi.hThread);
    let _ = CloseHandle(pi.hThread);
    let _ = CloseHandle(pi.hProcess);
    Ok(())
}
