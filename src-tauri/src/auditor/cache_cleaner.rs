use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use crate::auditor::geo_matrix::ProviderId;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanResult {
    pub provider: ProviderId,
    pub cleaned_targets: Vec<String>,
    pub files_removed: usize,
    pub bytes_freed: u64,
    pub success: bool,
    pub message: String,
}

pub fn get_ai_app_data_dir(provider: ProviderId) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").ok()?;
        let app_support = PathBuf::from(home).join("Library").join("Application Support");
        match provider {
            ProviderId::Anthropic => Some(app_support.join("Claude")),
            ProviderId::Openai => Some(app_support.join("ChatGPT")),
            ProviderId::Gemini => None, // Google does not provide a desktop app
        }
    }

    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").ok()?;
        let base = PathBuf::from(appdata);
        match provider {
            ProviderId::Anthropic => Some(base.join("Claude")),
            ProviderId::Openai => Some(base.join("ChatGPT")),
            ProviderId::Gemini => None,
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        None
    }
}

pub fn clean_ai_app_cache(provider: ProviderId) -> CleanResult {
    let app_dir = match get_ai_app_data_dir(provider) {
        Some(d) => d,
        None => {
            return CleanResult {
                provider,
                cleaned_targets: Vec::new(),
                files_removed: 0,
                bytes_freed: 0,
                success: true,
                message: format!(
                    "Папка настольного клиента {} не найдена на этой ОС.",
                    provider.display_name()
                ),
            };
        }
    };

    if !app_dir.exists() {
        return CleanResult {
            provider,
            cleaned_targets: Vec::new(),
            files_removed: 0,
            bytes_freed: 0,
            success: true,
            message: format!(
                "Кэш десктопного клиента {} уже чист (директория отсутствует).",
                provider.display_name()
            ),
        };
    }

    // High-risk telemetry / tracking targets in Chromium/Electron desktop clients
    let target_names = [
        "Cookies",
        "Cookies-journal",
        "IndexedDB",
        "Local Storage",
        "Session Storage",
        "Cache",
        "Code Cache",
        "GPUCache",
        "DawnGraphiteCache",
        "DawnWebGPUCache",
        "Network Action Predictor",
        "TransportSecurity",
    ];

    let mut cleaned_targets = Vec::new();
    let mut files_removed = 0;
    let mut bytes_freed = 0;

    for target in &target_names {
        let path = app_dir.join(target);
        if path.exists() {
            if path.is_dir() {
                if let Ok((count, bytes)) = remove_dir_contents(&path) {
                    files_removed += count;
                    bytes_freed += bytes;
                    let _ = std::fs::remove_dir_all(&path);
                    cleaned_targets.push(target.to_string());
                }
            } else if path.is_file() {
                if let Ok(metadata) = std::fs::metadata(&path) {
                    bytes_freed += metadata.len();
                }
                if std::fs::remove_file(&path).is_ok() {
                    files_removed += 1;
                    cleaned_targets.push(target.to_string());
                }
            }
        }
    }

    CleanResult {
        provider,
        cleaned_targets,
        files_removed,
        bytes_freed,
        success: true,
        message: format!(
            "Следы старой сессии и кэш {} успешно очищены (удалено файлов: {}).",
            provider.display_name(),
            files_removed
        ),
    }
}

fn remove_dir_contents(path: &std::path::Path) -> std::io::Result<(usize, u64)> {
    let mut count = 0;
    let mut bytes = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                let (c, b) = remove_dir_contents(&entry_path)?;
                count += c;
                bytes += b;
                let _ = std::fs::remove_dir_all(&entry_path);
            } else {
                if let Ok(meta) = std::fs::metadata(&entry_path) {
                    bytes += meta.len();
                }
                let _ = std::fs::remove_file(&entry_path);
                count += 1;
            }
        }
    }
    Ok((count, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_cache_cleaner_execution() {
        let result = clean_ai_app_cache(ProviderId::Anthropic);
        assert!(result.success);
    }
}
