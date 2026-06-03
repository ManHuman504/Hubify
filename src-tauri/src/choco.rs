use std::process::Command;
use crate::winget::{WingetPackage, WingetPackageDetail};

pub fn is_available() -> bool {
    Command::new("choco")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn search(query: &str) -> Vec<WingetPackage> {
    if !is_available() {
        return vec![];
    }

    let output = Command::new("choco")
        .args(["search", query, "--limit", "15"])
        .output();

    let output = match output {
        Ok(o) => o,
        Err(_) => return vec![],
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    
    let mut results = Vec::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.contains("Chocolatey v") || trimmed.starts_with("---") { continue; }

        let parts: Vec<&str> = trimmed.split(' ').collect();
        if parts.len() >= 2 {
            let name = parts[0].to_string();
            let version = parts[1].to_string();
            
            if name.chars().all(char::is_numeric) { continue; }

            results.push(WingetPackage {
                id: name.clone(),
                name,
                version,
                source: "choco".to_string(),
            });
        }
    }

    results
}

pub fn show(id: &str) -> Option<WingetPackageDetail> {
    if !is_available() { return None; }
    
    let output = Command::new("choco")
        .args(["info", id])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    
    let mut version = String::new();
    let mut description = String::new();
    let mut homepage = None;
    let mut publisher = None;
    let mut tags = Vec::new();
    let mut in_desc = false;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if line.starts_with("Version:") { version = line.split(':').nth(1).unwrap_or("").trim().to_string(); }
        else if line.starts_with("Software Site:") { homepage = Some(line.splitn(2, ':').nth(1).unwrap_or("").trim().to_string()); }
        else if line.starts_with("Software Author(s):") { publisher = Some(line.splitn(2, ':').nth(1).unwrap_or("").trim().to_string()); }
        else if line.starts_with("Tags:") { 
            let t = line.split(':').nth(1).unwrap_or("").trim();
            tags = t.split(' ').map(|s| s.to_string()).collect();
        }
        else if line.starts_with("Description:") { in_desc = true; }
        else if line.starts_with("Release Notes:") { in_desc = false; }
        else if in_desc {
            if !trimmed.is_empty() {
                description.push_str(trimmed);
                description.push('\n');
            }
        }
    }

    Some(WingetPackageDetail {
        id: id.to_string(),
        name: id.to_string(),
        version,
        source: "choco".to_string(),
        description: if description.is_empty() { None } else { Some(description.trim().to_string()) },
        homepage,
        publisher,
        tags,
    })
}