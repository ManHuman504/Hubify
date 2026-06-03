use serde::{Serialize, Deserialize};
use std::sync::{Arc, Mutex};
use std::thread;
use lazy_static::lazy_static;
use jwalk::{WalkDir, Parallelism};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EverythingResult {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

struct Index {
    files: Vec<EverythingResult>,
    ready: bool,
}

lazy_static! {
    static ref INDEX: Arc<Mutex<Index>> = Arc::new(Mutex::new(Index { files: Vec::new(), ready: false }));
}

pub fn init_indexer() {
    thread::spawn(|| {
        println!("reEverything: Starting indexer...");
        let mut local_index = Vec::new();
        
        let paths_to_index = vec![
            std::env::var("ProgramFiles").unwrap_or_else(|_| "C:\\Program Files".into()),
            std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".into()),
            format!("{}\\AppData\\Local\\Microsoft\\Windows\\Start Menu\\Programs", std::env::var("USERPROFILE").unwrap_or_default()),
            "C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs".to_string(),
        ];

        for path in paths_to_index {
            if !std::path::Path::new(&path).exists() { 
                println!("reEverything: Path does not exist: {}", path);
                continue; 
            }
            
            println!("reEverything: Indexing {}", path);
            for entry in WalkDir::new(path)
                .parallelism(Parallelism::Serial)
                .skip_hidden(true)
                .process_read_dir(|_, _, _, dir_entry_results| {
                    dir_entry_results.retain(|result| result.is_ok());
                }) 
            {
                if let Ok(entry) = entry {
                    let path_buf = entry.path();
                    let path_str = path_buf.to_string_lossy().to_string();
                    
                    let name = entry.file_name().to_string_lossy().to_string();
                    let is_dir = entry.file_type().is_dir();
                    
                    local_index.push(EverythingResult {
                        name,
                        path: path_str,
                        is_dir,
                    });
                }
            }
        }
        
        let count = local_index.len();
        let mut idx = INDEX.lock().unwrap();
        idx.files = local_index;
        idx.ready = true;
        println!("reEverything: Indexer finished. Indexed {} items.", count);
    });
}

pub fn search(query: &str, limit: usize, ext_filter: Option<&str>) -> Result<Vec<EverythingResult>, String> {
    let idx = INDEX.lock().unwrap();
    
    let q = query.to_lowercase();
    let exts: Vec<String> = ext_filter
        .map(|e| e.split(',').map(|s| s.trim().to_lowercase()).collect())
        .unwrap_or_default();

    println!("reEverything: Searching for '{}' (limit: {}, ext: {:?})", q, limit, exts);

    let mut results = Vec::new();
    
    for file in &idx.files {
        if results.len() >= limit {
            break;
        }

        if !exts.is_empty() {
            let lower_name = file.name.to_lowercase();
            let matches_ext = exts.iter().any(|ext| lower_name.ends_with(ext));
            if !matches_ext {
                continue;
            }
        }

        if file.name.to_lowercase().contains(&q) {
            results.push(file.clone());
        }
    }

    println!("reEverything: Found {} results", results.len());
    Ok(results)
}

pub fn is_indexer_ready() -> bool {
    let idx = INDEX.lock().unwrap();
    idx.ready
}

pub fn search_apps(query: &str, limit: usize) -> Result<Vec<EverythingResult>, String> {
    let idx = INDEX.lock().unwrap();
    
    let q = query.to_lowercase();

    let mut results = Vec::new();
    
    for file in &idx.files {
        if results.len() >= limit {
            break;
        }

        let lower_name = file.name.to_lowercase();
        // Apps are usually .exe or .lnk
        if !lower_name.ends_with(".exe") && !lower_name.ends_with(".lnk") {
            continue;
        }

        if lower_name.contains(&q) {
            results.push(file.clone());
        }
    }

    Ok(results)
}
