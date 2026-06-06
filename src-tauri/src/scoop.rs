use crate::winget::{WingetPackage, WingetPackageDetail};

pub fn is_available() -> bool {
    crate::hidden_cmd("scoop")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn search(query: &str) -> Vec<WingetPackage> {
    if !is_available() {
        return vec![];
    }

    let output = crate::hidden_cmd("scoop")
        .args(["search", query])
        .output();

    let output = match output {
        Ok(o) => o,
        Err(_) => return vec![],
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    
    let mut results = Vec::new();
    let mut current_bucket = String::new();

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }

        if line.starts_with('\'') && line.contains("' bucket:") {
            if let Some(bucket) = line.split('\'').nth(1) {
                current_bucket = bucket.to_string();
            }
        } else if line.starts_with("    ") && !current_bucket.is_empty() {
            let parts: Vec<&str> = trimmed.split(' ').collect();
            if !parts.is_empty() {
                let name = parts[0].to_string();
                let mut version = String::new();
                if parts.len() > 1 && parts[1].starts_with('(') && parts[1].ends_with(')') {
                    version = parts[1].trim_matches(|c| c == '(' || c == ')').to_string();
                }

                results.push(WingetPackage {
                    id: format!("{}/{}", current_bucket, name),
                    name,
                    version,
                    source: "scoop".to_string(),
                });
            }
        }
    }

    results
}

pub fn show(id: &str) -> Option<WingetPackageDetail> {
    if !is_available() { return None; }
    
    let parts: Vec<&str> = id.split('/').collect();
    let name = if parts.len() == 2 { parts[1] } else { id };

    let output = crate::hidden_cmd("scoop")
        .args(["info", name])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    
    let mut version = String::new();
    let mut description = String::new();
    let mut homepage = None;

    for line in stdout.lines() {
        if line.starts_with("Version:") { version = line.split(':').nth(1).unwrap_or("").trim().to_string(); }
        else if line.starts_with("Description:") { description = line.split(':').nth(1).unwrap_or("").trim().to_string(); }
        else if line.starts_with("Homepage:") { homepage = Some(line.splitn(2, ':').nth(1).unwrap_or("").trim().to_string()); }
    }

    Some(WingetPackageDetail {
        id: id.to_string(),
        name: name.to_string(),
        version,
        source: "scoop".to_string(),
        description: if description.is_empty() { None } else { Some(description) },
        homepage,
        publisher: None,
        tags: vec![],
    })
}

pub fn install(id: &str) -> (bool, String) {
    let parts: Vec<&str> = id.split('/').collect();
    let name = if parts.len() == 2 { parts[1] } else { id };

    let output = crate::hidden_cmd("scoop")
        .args(["install", name])
        .output();

    match output {
        Ok(o) => {
            let log = format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
            (o.status.success(), log)
        }
        Err(e) => (false, e.to_string()),
    }
}