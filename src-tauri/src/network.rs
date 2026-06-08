use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct NetStats {
    pub connections: u32,
    pub recv_kb: f64,
    pub sent_kb: f64,
    pub connections_detail: Vec<ConnectionInfo>,
}

#[derive(Serialize, Clone)]
pub struct ConnectionInfo {
    pub local_port: u16,
    pub remote_ip: String,
    pub remote_port: u16,
    pub state: String,
}

#[cfg(target_os = "windows")]
pub fn get_net_stats(pid: u32) -> NetStats {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_ALL,
    };
    use windows::Win32::Networking::WinSock::AF_INET;

    let mut connections_detail: Vec<ConnectionInfo> = Vec::new();
    let connections;

    unsafe {
        let mut size: u32 = 0;
        let _ = GetExtendedTcpTable(
            None, &mut size, false, AF_INET.0 as u32,
            TCP_TABLE_OWNER_PID_ALL, 0,
        );
        let mut buf = vec![0u8; size as usize];
        let ret = GetExtendedTcpTable(
            Some(buf.as_mut_ptr() as *mut _),
            &mut size, false, AF_INET.0 as u32,
            TCP_TABLE_OWNER_PID_ALL, 0,
        );
        if ret == 0 {
            let table = buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID;
            let count = (*table).dwNumEntries as usize;
            let rows_ptr = (*table).table.as_ptr();
            let rows = std::slice::from_raw_parts(rows_ptr, count);

            let proc_rows: Vec<&MIB_TCPROW_OWNER_PID> =
                rows.iter().filter(|r| r.dwOwningPid == pid).collect();

            connections = proc_rows.len() as u32;

            for row in proc_rows {
                let ra = row.dwRemoteAddr.to_be();
                let remote_ip = format!(
                    "{}.{}.{}.{}",
                    (ra >> 24) & 0xFF,
                    (ra >> 16) & 0xFF,
                    (ra >> 8) & 0xFF,
                    ra & 0xFF
                );
                let la = row.dwLocalAddr.to_be();
                let local_port = ((row.dwLocalPort.to_be()) >> 16) as u16;
                let remote_port = ((row.dwRemotePort.to_be()) >> 16) as u16;

                let state = match row.dwState {
                    1  => "CLOSED",
                    2  => "LISTEN",
                    3  => "SYN_SENT",
                    4  => "SYN_RCVD",
                    5  => "ESTABLISHED",
                    6  => "FIN_WAIT1",
                    7  => "FIN_WAIT2",
                    8  => "CLOSE_WAIT",
                    9  => "CLOSING",
                    10 => "LAST_ACK",
                    11 => "TIME_WAIT",
                    12 => "DELETE_TCB",
                    _  => "UNKNOWN",
                };

                let _ = la;
                if remote_ip == "0.0.0.0" { continue; }

                connections_detail.push(ConnectionInfo {
                    local_port,
                    remote_ip,
                    remote_port,
                    state: state.to_string(),
                });
            }
        } else {
            connections = 0;
        }
    }

    let (recv_kb, sent_kb) = get_net_bytes();
    NetStats { connections, recv_kb, sent_kb, connections_detail }
}

/// Count connections for a PID without allocating detail structs (faster)
#[cfg(target_os = "windows")]
#[allow(dead_code)]
pub fn count_connections(pid: u32) -> u32 {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_ALL,
    };
    use windows::Win32::Networking::WinSock::AF_INET;

    unsafe {
        let mut size: u32 = 0;
        let _ = GetExtendedTcpTable(None, &mut size, false, AF_INET.0 as u32, TCP_TABLE_OWNER_PID_ALL, 0);
        let mut buf = vec![0u8; size as usize];
        let ret = GetExtendedTcpTable(
            Some(buf.as_mut_ptr() as *mut _), &mut size, false,
            AF_INET.0 as u32, TCP_TABLE_OWNER_PID_ALL, 0,
        );
        if ret == 0 {
            let table = buf.as_ptr() as *const MIB_TCPTABLE_OWNER_PID;
            let count = (*table).dwNumEntries as usize;
            let rows_ptr = (*table).table.as_ptr();
            let rows = std::slice::from_raw_parts(rows_ptr, count);
            rows.iter().filter(|r| r.dwOwningPid == pid).count() as u32
        } else {
            0
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn count_connections(_pid: u32) -> u32 { 0 }

#[cfg(target_os = "windows")]
fn get_net_bytes() -> (f64, f64) {
    use sysinfo::Networks;
    let networks = Networks::new_with_refreshed_list();
    let mut rx = 0u64;
    let mut tx = 0u64;
    for (_, data) in &networks {
        rx += data.received();
        tx += data.transmitted();
    }
    (rx as f64 / 1024.0, tx as f64 / 1024.0)
}

#[cfg(not(target_os = "windows"))]
pub fn get_net_stats(_pid: u32) -> NetStats {
    NetStats {
        connections: 0,
        recv_kb: 0.0,
        sent_kb: 0.0,
        connections_detail: vec![],
    }
}
