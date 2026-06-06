use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WingetPackage {
    pub id: String,
    pub name: String,
    pub version: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WingetPackageDetail {
    pub id: String,
    pub name: String,
    pub version: String,
    pub source: String,
    pub description: Option<String>,
    pub homepage: Option<String>,
    pub publisher: Option<String>,
    pub tags: Vec<String>,
}

/// Check if winget is available on this system
pub fn is_available() -> bool {
    crate::hidden_cmd("winget")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Get info about a specific package by id
#[allow(dead_code)]
pub fn show(id: &str) -> Option<WingetPackageDetail> {
    let output = crate::hidden_cmd("winget")
        .args(["show", "--id", id, "--exact", "--accept-source-agreements", "--disable-interactivity"])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    
    let mut name = id.to_string();
    let mut version = String::new();
    let mut description = String::new();
    let mut homepage = None;
    let mut publisher = None;
    let mut tags = Vec::new();
    
    let mut in_desc = false;
    let mut in_tags = false;

    for line in stdout.lines() {
        if let Some(v) = line.strip_prefix("Found ") {
            if let Some(bracket) = v.find('[') {
                name = v[..bracket].trim().to_string();
            }
        }
        
        let trimmed = line.trim();
        
        if line.starts_with("Version:") { version = line.split(':').nth(1).unwrap_or("").trim().to_string(); }
        else if line.starts_with("Homepage:") { homepage = Some(line.splitn(2, ':').nth(1).unwrap_or("").trim().to_string()); }
        else if line.starts_with("Publisher:") { publisher = Some(line.splitn(2, ':').nth(1).unwrap_or("").trim().to_string()); }
        else if line.starts_with("Description:") {
            in_desc = true;
            in_tags = false;
        } else if line.starts_with("Tags:") {
            in_tags = true;
            in_desc = false;
        } else if !line.starts_with(' ') && !line.is_empty() && line.contains(':') {
            in_desc = false;
            in_tags = false;
        } else if in_desc && line.starts_with("  ") {
            description.push_str(trimmed);
            description.push(' ');
        } else if in_tags && line.starts_with("  ") && !trimmed.is_empty() {
            tags.push(trimmed.to_string());
        }
    }

    Some(WingetPackageDetail {
        id: id.to_string(),
        name,
        version,
        source: "winget".to_string(),
        description: if description.is_empty() { None } else { Some(description.trim().to_string()) },
        homepage,
        publisher,
        tags,
    })
}

/// Install a package, returns (success, log)
pub fn install(id: &str) -> (bool, String) {
    let output = crate::hidden_cmd("winget")
        .args([
            "install",
            "--id", id,
            "--exact",
            "--accept-package-agreements",
            "--accept-source-agreements",
            "--disable-interactivity",
            "--silent",
        ])
        .output();

    match output {
        Ok(o) => {
            let log = format!(
                "{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            );
            (o.status.success(), log)
        }
        Err(e) => (false, e.to_string()),
    }
}

/// Uninstall a package
pub fn uninstall(id: &str) -> (bool, String) {
    let output = crate::hidden_cmd("winget")
        .args([
            "uninstall",
            "--id", id,
            "--exact",
            "--accept-source-agreements",
            "--disable-interactivity",
            "--silent",
        ])
        .output();

    match output {
        Ok(o) => {
            let log = format!(
                "{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            );
            (o.status.success(), log)
        }
        Err(e) => (false, e.to_string()),
    }
}

/// List installed packages via winget
pub fn list_installed() -> Vec<WingetPackage> {
    let output = crate::hidden_cmd("winget")
        .args(["list", "--accept-source-agreements", "--disable-interactivity"])
        .output();

    let output = match output {
        Ok(o) => o,
        Err(_) => return vec![],
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_winget_table(&stdout)
}

// ── Parser ───────────────────────────────────────────────────────────────────

/// Parse winget tabular output (Name / Id / Version / Source columns)
fn parse_winget_table(text: &str) -> Vec<WingetPackage> {
    let mut results = Vec::new();
    let lines: Vec<&str> = text.lines().collect();

    // Find the header line — contains "Name" and "Id"
    let header_idx = lines.iter().position(|l| {
        let u = l.to_uppercase();
        u.contains("NAME") && u.contains("ID")
    });

    let header_idx = match header_idx {
        Some(i) => i,
        None => return results,
    };

    // Find column offsets from the separator line (dashes)
    let separator_idx = header_idx + 1;
    if separator_idx >= lines.len() {
        return results;
    }

    let sep = lines[separator_idx];
    // Split by 2+ spaces to find column widths from separator
    let col_positions = find_column_positions(lines[header_idx]);

    for line in &lines[separator_idx + 1..] {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('-') {
            continue;
        }
        // Skip lines with non-ASCII chars (e.g. █▒ progress bars from winget)
        if !trimmed.is_ascii() {
            continue;
        }

        let cols = extract_columns(line, &col_positions);
        if cols.len() < 2 {
            continue;
        }

        let name = cols[0].trim().to_string();
        let id = cols[1].trim().to_string();
        let version = cols.get(2).map(|s| s.trim().to_string()).unwrap_or_default();
        let source = cols.get(3).map(|s| s.trim().to_string()).unwrap_or_else(|| "winget".to_string());

        if name.is_empty() || id.is_empty() {
            continue;
        }
        // Skip lines that look like progress/status output
        if name.starts_with('[') || id.contains("…") {
            continue;
        }

        results.push(WingetPackage { id, name, version, source });
    }

    let _ = sep; // suppress unused warning
    results
}

fn find_column_positions(header: &str) -> Vec<usize> {
    let chars: Vec<char> = header.chars().collect();
    let mut starts = vec![0usize];
    let n = chars.len();
    let mut i = 0;

    while i < n {
        if i + 1 < n && chars[i] == ' ' && chars[i + 1] == ' ' {
            // Two+ consecutive spaces — skip all spaces
            let mut end = i;
            while end < n && chars[end] == ' ' {
                end += 1;
            }
            if end < n {
                starts.push(end);
            }
            i = end;
        } else {
            i += 1;
        }
    }
    starts.dedup();
    starts
}

fn extract_columns(line: &str, positions: &[usize]) -> Vec<String> {
    let mut cols = Vec::new();
    let chars: Vec<char> = line.chars().collect();
    let total = chars.len();

    for (idx, &start) in positions.iter().enumerate() {
        let end = if idx + 1 < positions.len() {
            positions[idx + 1].min(total)
        } else {
            total
        };
        if start <= total {
            let col: String = chars[start.min(total)..end].iter().collect();
            cols.push(col);
        } else {
            cols.push(String::new());
        }
    }
    cols
}
