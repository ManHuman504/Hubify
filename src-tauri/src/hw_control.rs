use serde::Serialize;
use std::ffi::c_void;

// ── Manual COM FFI for Windows Core Audio API ──────────────────────────────

type HRESULT = i32;
const CLSCTX_ALL: u32 = 23;
const COINIT_APARTMENTTHREADED: u32 = 2;

#[repr(C)]
struct GUID {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

const CLSID_MMDEVICE_ENUMERATOR: GUID = GUID {
    data1: 0xBCDE0395,
    data2: 0xE52F,
    data3: 0x467C,
    data4: [0x8E, 0x3D, 0xC4, 0x57, 0x92, 0x91, 0x69, 0x2E],
};
const IID_IMMDEVICE_ENUMERATOR: GUID = GUID {
    data1: 0xA95664D2,
    data2: 0x9614,
    data3: 0x4F35,
    data4: [0xA7, 0x46, 0xDE, 0x8D, 0xB6, 0x36, 0x17, 0xE6],
};
const IID_IAUDIO_ENDPOINT_VOLUME: GUID = GUID {
    data1: 0x5CDF2C82,
    data2: 0x841E,
    data3: 0x4546,
    data4: [0x97, 0x22, 0x0C, 0xF7, 0x40, 0x78, 0x22, 0x9A],
};

#[link(name = "ole32")]
extern "system" {
    fn CoInitializeEx(pvReserved: *mut c_void, dwCoInit: u32) -> HRESULT;
    fn CoCreateInstance(
        rclsid: *const GUID,
        pUnkOuter: *mut c_void,
        dwClsContext: u32,
        riid: *const GUID,
        ppv: *mut *mut c_void,
    ) -> HRESULT;
}

// Raw vtable slot read
unsafe fn vtable_slot<T>(obj: *mut c_void, idx: usize) -> T {
    let vtbl: *mut *mut c_void = *(obj as *mut *mut *mut c_void);
    let slot = vtbl.add(idx);
    let func_ptr: *mut c_void = *slot;
    std::mem::transmute_copy::<*mut c_void, T>(&func_ptr)
}

type ReleaseFn = unsafe extern "system" fn(*mut c_void) -> u32;

unsafe fn release(obj: *mut c_void) {
    let f: ReleaseFn = vtable_slot(obj, 2);
    f(obj);
}

fn with_endpoint_volume<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(*mut c_void) -> Result<R, String>,
{
    unsafe {
        let hr = CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED);
        if hr < 0 && hr as u32 != 0x80010106 /* RPC_E_CHANGED_MODE */ {
            // Non-fatal: COM might already be initialised on this thread
            eprintln!("CoInitializeEx returned 0x{:08X} (continuing anyway)", hr as u32);
        }

        let mut enumerator: *mut c_void = std::ptr::null_mut();
        let hr = CoCreateInstance(
            &CLSID_MMDEVICE_ENUMERATOR as *const GUID,
            std::ptr::null_mut(),
            CLSCTX_ALL,
            &IID_IMMDEVICE_ENUMERATOR as *const GUID,
            &mut enumerator,
        );
        if hr < 0 || enumerator.is_null() {
            return Err(format!("CoCreate IMMDeviceEnumerator: 0x{:08X}", hr as u32));
        }

        let get_default: unsafe extern "system" fn(*mut c_void, u32, u32, *mut *mut c_void) -> HRESULT =
            vtable_slot(enumerator, 4);
        let mut device: *mut c_void = std::ptr::null_mut();
        let hr = get_default(enumerator, 0, 1, &mut device);
        if hr < 0 || device.is_null() {
            release(enumerator);
            return Err(format!("GetDefaultAudioEndpoint: 0x{:08X}", hr as u32));
        }

        let activate: unsafe extern "system" fn(*mut c_void, *const GUID, u32, *mut c_void, *mut *mut c_void) -> HRESULT =
            vtable_slot(device, 3);
        let mut epv: *mut c_void = std::ptr::null_mut();
        let hr = activate(
            device,
            &IID_IAUDIO_ENDPOINT_VOLUME as *const GUID,
            CLSCTX_ALL,
            std::ptr::null_mut(),
            &mut epv,
        );
        if hr < 0 || epv.is_null() {
            release(device);
            release(enumerator);
            return Err(format!("Activate IAudioEndpointVolume: 0x{:08X}", hr as u32));
        }

        let result = f(epv);
        release(epv);
        release(device);
        release(enumerator);
        result
    }
}

pub fn get_volume() -> Result<u32, String> {
    println!("hw_control::get_volume() called");
    with_endpoint_volume(|epv| unsafe {
        let get_scalar: unsafe extern "system" fn(*mut c_void, *mut f32) -> HRESULT = vtable_slot(epv, 9);
        let mut scalar: f32 = 0.0;
        let hr = get_scalar(epv, &mut scalar);
        if hr < 0 {
            return Err(format!("GetMasterVolumeLevelScalar: 0x{:08X}", hr as u32));
        }
        let pct = (scalar * 100.0).round() as u32;
        println!("hw_control::get_volume() = {} (scalar {})", pct, scalar);
        Ok(pct)
    })
}

pub fn set_volume(level: u32) -> Result<(), String> {
    println!("hw_control::set_volume({}) called", level);
    with_endpoint_volume(|epv| unsafe {
        let set_scalar: unsafe extern "system" fn(*mut c_void, f32, *mut c_void) -> HRESULT = vtable_slot(epv, 7);
        let scalar = (level.min(100) as f32) / 100.0;
        let hr = set_scalar(epv, scalar, std::ptr::null_mut());
        if hr < 0 {
            return Err(format!("SetMasterVolumeLevelScalar: 0x{:08X}", hr as u32));
        }
        println!("hw_control::set_volume({}) OK", level);
        Ok(())
    })
}

// ── Audio devices (simple stub) ────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

pub fn get_audio_devices() -> Result<Vec<AudioDevice>, String> {
    Ok(vec![AudioDevice {
        id: "default".into(),
        name: "System Default".into(),
        is_default: true,
    }])
}

pub fn set_default_audio_device(_device_id: &str) -> Result<(), String> {
    Ok(())
}

// ── Brightness ──────────────────────────────────────────────────────────────

fn run_powershell(script: &str) -> Result<String, String> {
    let output = crate::hidden_cmd("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|e| format!("PowerShell: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            return Ok(stdout);
        }
        return Err(format!("PS failed: {}", stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Try to get brightness via Win32 Dxva2 API (DDC/CI – external monitors)
#[cfg(target_os = "windows")]
fn get_brightness_win32() -> Result<u32, String> {
    use windows::Win32::Devices::Display::*;
    use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY};
    use windows::Win32::Foundation::POINT;

    unsafe {
        let pt = POINT { x: 0, y: 0 };
        let hmon = MonitorFromPoint(pt, MONITOR_DEFAULTTOPRIMARY);
        if hmon.is_invalid() {
            return Err("MonitorFromPoint failed".into());
        }

        let mut count: u32 = 0;
        if GetNumberOfPhysicalMonitorsFromHMONITOR(hmon, &mut count).is_err() || count == 0 {
            return Err("no physical monitors via Dxva2".into());
        }

        let total = count as usize;
        let mut monitors = vec![PHYSICAL_MONITOR::default(); total];
        if GetPhysicalMonitorsFromHMONITOR(hmon, &mut monitors).is_err() {
            return Err("GetPhysicalMonitorsFromHMONITOR failed".into());
        }

        let mut min: u32 = 0;
        let mut cur: u32 = 0;
        let mut max: u32 = 0;
        let ok = GetMonitorBrightness(monitors[0].hPhysicalMonitor, &mut min, &mut cur, &mut max);
        let _ = DestroyPhysicalMonitors(&monitors);

        if ok == 0 {
            return Err("GetMonitorBrightness failed".into());
        }

        let pct = if max > min {
            ((cur - min) * 100).min((max - min) * 100) / (max - min)
        } else {
            cur
        };
        Ok(pct.min(100))
    }
}

/// Try to get brightness via PowerShell WMI (laptop internal displays)
#[cfg(target_os = "windows")]
fn get_brightness_wmi() -> Result<u32, String> {
    let script = r#"
        $i = Get-CimInstance -Namespace "root/WMI" -ClassName "WmiMonitorBrightness" -ErrorAction Stop
        if ($i.Count -ge 1 -and $null -ne $i[0].CurrentBrightness) {
            [int]$i[0].CurrentBrightness
        } else {
            -1
        }
    "#;
    let out = run_powershell(script)?;
    let v: i32 = out.trim().parse().map_err(|e| format!("parse WMI brightness: {}", e))?;
    if v < 0 {
        // Fallback: Get-WmiObject (older PS)
        let script2 = r#"
            $i = Get-WmiObject -Namespace "root/WMI" -Class "WmiMonitorBrightness" -ErrorAction Stop
            if ($i.Count -ge 1 -and $null -ne $i[0].CurrentBrightness) {
                [int]$i[0].CurrentBrightness
            } else {
                -1
            }
        "#;
        let out2 = run_powershell(script2)?;
        let v2: i32 = out2.trim().parse().map_err(|e| format!("parse WMI2 brightness: {}", e))?;
        if v2 < 0 {
            return Err("WMI returned no brightness data".into());
        }
        Ok(v2 as u32)
    } else {
        Ok(v as u32)
    }
}

pub fn get_brightness() -> Result<u32, String> {
    // 1) Try Win32/Dxva2 (DDC/CI – external monitors)
    match get_brightness_win32() {
        Ok(v) => return Ok(v),
        Err(e) => println!("get_brightness: Dxva2 failed ({:?}), trying WMI…", e),
    }
    // 2) Try WMI/PowerShell (laptop displays)
    get_brightness_wmi()
}

/// Set brightness via Win32 Dxva2 + fallback to PowerShell WMI
#[cfg(target_os = "windows")]
fn set_brightness_win32(level: u32) -> Result<(), String> {
    use windows::Win32::Devices::Display::*;
    use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTOPRIMARY};
    use windows::Win32::Foundation::POINT;

    unsafe {
        let pt = POINT { x: 0, y: 0 };
        let hmon = MonitorFromPoint(pt, MONITOR_DEFAULTTOPRIMARY);
        if hmon.is_invalid() {
            return Err("MonitorFromPoint failed".into());
        }

        let mut count: u32 = 0;
        if GetNumberOfPhysicalMonitorsFromHMONITOR(hmon, &mut count).is_err() || count == 0 {
            return Err("no physical monitors via Dxva2".into());
        }

        let total = count as usize;
        let mut monitors = vec![PHYSICAL_MONITOR::default(); total];
        if GetPhysicalMonitorsFromHMONITOR(hmon, &mut monitors).is_err() {
            return Err("GetPhysicalMonitorsFromHMONITOR failed".into());
        }

        let mut min: u32 = 0;
        let mut cur: u32 = 0;
        let mut max: u32 = 0;
        let ok = GetMonitorBrightness(monitors[0].hPhysicalMonitor, &mut min, &mut cur, &mut max);
        if ok == 0 {
            let _ = DestroyPhysicalMonitors(&monitors);
            return Err("GetMonitorBrightness failed".into());
        }

        let target = min + ((max - min) as u64 * level.min(100) as u64 / 100) as u32;
        let ok2 = SetMonitorBrightness(monitors[0].hPhysicalMonitor, target);
        let _ = DestroyPhysicalMonitors(&monitors);

        if ok2 == 0 {
            return Err("SetMonitorBrightness failed".into());
        }
        Ok(())
    }
}

pub fn set_brightness(level: u32) -> Result<(), String> {
    let lvl = level.clamp(0, 100);

    // 1) Try Win32/Dxva2
    match set_brightness_win32(lvl) {
        Ok(()) => return Ok(()),
        Err(e) => println!("set_brightness: Dxva2 failed ({:?}), trying WMI…", e),
    }

    // 2) Fallback: PowerShell WMI
    run_powershell(&format!(
        "Invoke-CimMethod -Namespace \"root/WMI\" -ClassName WmiMonitorBrightnessMethods \
         -MethodName WmiSetBrightness -Arguments @{{Brightness={};Timeout=1}}",
        lvl
    ))?;
    Ok(())
}
