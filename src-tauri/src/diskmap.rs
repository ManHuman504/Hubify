use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom};
use std::os::windows::fs::OpenOptionsExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirScanResult {
    pub path: String,
    pub entries: Vec<DiskEntry>,
    pub total_size: u64,
}

const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x02000000u32;

// ── Helpers ────────────────────────────────────────────────────────────

fn le16(b: &[u8], off: usize) -> u16 {
    u16::from_le_bytes([b[off], b[off + 1]])
}
fn le32(b: &[u8], off: usize) -> u32 {
    u32::from_le_bytes([b[off], b[off + 1], b[off + 2], b[off + 3]])
}
fn le64(b: &[u8], off: usize) -> u64 {
    u64::from_le_bytes([
        b[off], b[off + 1], b[off + 2], b[off + 3],
        b[off + 4], b[off + 5], b[off + 6], b[off + 7],
    ])
}
fn le48(b: &[u8], off: usize) -> u64 {
    let mut a = [0u8; 8];
    a[..6].copy_from_slice(&b[off..off + 6]);
    u64::from_le_bytes(a)
}

// ── Fixup ──────────────────────────────────────────────────────────────

fn fixup(buf: &mut [u8], sector_size: usize) {
    let count = le16(buf, 6) as usize;
    if count < 1 { return; }
    let fu_off = le16(buf, 4) as usize;
    // fixup values start after the 2-byte "Update Sequence Number"
    let vals = fu_off + 2;
    for i in 0..count {
        let pos = (i + 1) * sector_size - 2;
        if pos + 2 <= buf.len() && vals + i * 2 + 2 <= buf.len() {
            buf[pos]     = buf[vals + i * 2];
            buf[pos + 1] = buf[vals + i * 2 + 1];
        }
    }
}

// ── Read MFT records from \\.\C:\$MFT ─────────────────────────────────

fn read_all_records(drive: char) -> Result<Vec<Vec<u8>>, String> {
    let path = format!(r"\\.\{}:\$MFT", drive);
    let mut f = OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(&path)
        .map_err(|e| format!(
            "Cannot open $MFT. Try running as Administrator.\n{}\nPath: {}",
            e, path
        ))?;

    let meta = f.metadata().map_err(|e| e.to_string())?;
    let file_size = meta.len();
    let record_size = 1024u64; // standard
    let total = file_size / record_size;

    let mut records = Vec::with_capacity(total as usize);

    for i in 0..total {
        let mut buf = vec![0u8; record_size as usize];
        f.seek(SeekFrom::Start(i * record_size)).map_err(|e| format!("seek rec {}: {}", i, e))?;
        f.read_exact(&mut buf).map_err(|e| format!("read rec {}: {}", i, e))?;
        if &buf[0..4] != b"FILE" {
            records.push(buf); // push anyway for record number alignment
            continue;
        }
        fixup(&mut buf, 512);
        records.push(buf);
    }

    Ok(records)
}

// ── Parse $FILE_NAME from a record ────────────────────────────────────

struct FnInfo {
    parent: u64,
    name: String,
    size: u64,
    is_dir: bool,
}

fn parse_fn(buf: &[u8]) -> Option<FnInfo> {
    if &buf[0..4] != b"FILE" { return None; }
    let flags = le16(buf, 0x16);
    if flags & 1 == 0 { return None; } // not in use

    let is_dir = (flags & 2) != 0;
    let mut off = le16(buf, 0x14) as usize;

    loop {
        if off + 4 > buf.len() { break; }
        let at = le32(buf, off);
        if at == 0xFFFFFFFF { break; }
        let alen = le32(buf, off + 4) as usize;
        if alen < 8 || off + alen > buf.len() { break; }

        let nonres = buf[off + 8];
        if at == 0x30 && nonres == 0 {
            // resident $FILE_NAME
            let co = le16(buf, off + 0x14) as usize;
            let p = off + co;
            if p + 0x42 + 2 > buf.len() { break; }

            let parent = le48(buf, p);
            let size   = le64(buf, p + 0x28).max(le64(buf, p + 0x30));
            let nlen   = buf[p + 0x40] as usize;
            let ntype  = buf[p + 0x41];
            if nlen == 0 { break; }

            let start = p + 0x42;
            let end = start + nlen * 2;
            if end > buf.len() { break; }

            let u16s: Vec<u16> = buf[start..end]
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            let name = String::from_utf16(&u16s).unwrap_or_default();
            if name.is_empty() || name == "." || name == ".." { break; }
            // prefer long name (0x01 or 0x03) over short (0x02)
            if ntype == 0x02 && size == 0 { break; }

            return Some(FnInfo { parent, name, size, is_dir });
        }
        off += alen;
    }
    None
}

// ── Public API ────────────────────────────────────────────────────────

pub fn scan_drive_mft<F>(drive: char, emit: &F) -> Result<DirScanResult, String>
where F: Fn(&DiskEntry),
{
    let records = read_all_records(drive)?;

    // phase 1: extract (rec_num -> (parent, name))
    let mut map: HashMap<u64, (u64, String)> = HashMap::new();
    // phase 1b: store size + is_dir keyed by absolute parent path for aggregation
    let mut sizes: Vec<(u64, u64, bool)> = Vec::new(); // (rec_num, size, is_dir)

    for (i, rec) in records.iter().enumerate() {
        if let Some(fi) = parse_fn(rec) {
            let rn = i as u64;
            let e = map.entry(rn).or_insert((0, String::new()));
            if e.1.is_empty() || fi.name.len() > e.1.len() {
                e.0 = fi.parent;
                e.1 = fi.name.clone();
            }
            sizes.push((rn, fi.size, fi.is_dir));
        }
    }

    // phase 2: resolve paths
    let mut path_cache: HashMap<u64, String> = HashMap::new();

    fn resolve(rn: u64, map: &HashMap<u64, (u64, String)>, cache: &mut HashMap<u64, String>) -> String {
        if rn == 5 { return String::new(); }
        if let Some(p) = cache.get(&rn) { return p.clone(); }
        if let Some((parent, name)) = map.get(&(rn & 0xFFFFFFFFFFFF)) {
            let pp = resolve(*parent, map, cache);
            let full = if pp.is_empty() { name.clone() } else { format!("{}\\{}", pp, name) };
            cache.insert(rn, full.clone());
            full
        } else { String::new() }
    }

    // Aggregate by top-level directory at the entry level
    let mut entries = Vec::with_capacity(sizes.len().min(200_000));

    for (rn, size, is_dir) in &sizes {
        let full_path = resolve(*rn, &map, &mut path_cache);
        if full_path.is_empty() { continue; }

        let entry = DiskEntry {
            path: format!("{}:\\{}", drive, full_path),
            name: map.get(&(rn & 0xFFFFFFFFFFFF)).map(|(_, n)| n.clone()).unwrap_or_default(),
            size: *size,
            is_dir: *is_dir,
        };
        emit(&entry);
        if entries.len() < 200_000 {
            entries.push(entry);
        }
    }

    entries.sort_by(|a, b| b.size.cmp(&a.size));
    let total_size: u64 = entries.iter().map(|e| e.size).sum();

    Ok(DirScanResult {
        path: format!("{}:\\", drive),
        entries,
        total_size,
    })
}
