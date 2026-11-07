use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;
use tauri::Emitter;
use tokio::io::AsyncWriteExt;

pub const GITHUB_REPO: &str = "kingbest1195/ai-antiban";
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct GitHubReleaseResponse {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
    published_at: Option<String>,
    draft: Option<bool>,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_name: String,
    pub release_notes: String,
    pub release_url: String,
    pub published_at: Option<String>,
    pub download_url: Option<String>,
    pub asset_name: Option<String>,
    pub asset_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProgressPayload {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub percent: u8,
    pub phase: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallUpdateResult {
    pub success: bool,
    pub message: String,
    pub will_restart: bool,
}

/// Parses a semantic version string (e.g. `"v1.0.4"` -> `(1, 0, 4)`).
pub fn parse_semver(ver: &str) -> Option<(u32, u32, u32)> {
    let clean = ver.trim().trim_start_matches(['v', 'V']);
    let core = clean.split('-').next().unwrap_or(clean);
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u32>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u32>().ok()?;
    Some((major, minor, patch))
}

/// Returns `true` if `latest` is strictly newer than `current`.
pub fn is_newer_version(current: &str, latest: &str) -> bool {
    match (parse_semver(current), parse_semver(latest)) {
        (Some(cur), Some(lat)) => lat > cur,
        _ => false,
    }
}

/// Strictly validates that the download URL belongs to our official GitHub repository releases.
pub fn validate_download_url(url: &str) -> Result<(), String> {
    let u = url.trim();
    let allowed_prefix_1 = format!("https://github.com/{GITHUB_REPO}/releases/download/");
    let allowed_prefix_2 = "https://objects.githubusercontent.com/";

    if u.starts_with(&allowed_prefix_1) || u.starts_with(allowed_prefix_2) {
        Ok(())
    } else {
        Err("Запрещенный URL загрузки: разрешены только официальные релизы GitHub.".to_string())
    }
}

/// Sanitizes an asset filename to prevent path traversal (`../`).
pub fn sanitize_asset_filename(name: &str) -> Result<String, String> {
    let file_name = Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Некорректное имя файла обновления.".to_string())?;

    if file_name.is_empty()
        || file_name.contains("..")
        || file_name.contains('/')
        || file_name.contains('\\')
    {
        return Err("Небезопасное имя файла обновления.".to_string());
    }

    Ok(file_name.to_string())
}

/// Selects the best matching asset for the current OS platform.
pub fn select_platform_asset(assets: &[GitHubAsset]) -> Option<&GitHubAsset> {
    #[cfg(target_os = "macos")]
    {
        // Prefer .app.tar.gz for in-place app bundle replacement, fallback to .dmg
        if let Some(tar) = assets
            .iter()
            .find(|a| a.name.ends_with(".app.tar.gz") && !a.name.ends_with(".sig"))
        {
            return Some(tar);
        }
        if let Some(dmg) = assets.iter().find(|a| a.name.ends_with(".dmg")) {
            return Some(dmg);
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(exe) = assets
            .iter()
            .find(|a| a.name.ends_with("-setup.exe") || a.name.ends_with(".exe"))
        {
            return Some(exe);
        }
        if let Some(msi) = assets.iter().find(|a| a.name.ends_with(".msi")) {
            return Some(msi);
        }
    }

    assets.first()
}

/// Queries GitHub Releases API for the latest published release.
pub async fn check_github_updates() -> Result<UpdateCheckResult, String> {
    let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent(format!("Zastava/{CURRENT_VERSION}"))
        .build()
        .map_err(|e| format!("Ошибка инициализации HTTP-клиента: {e}"))?;

    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Не удалось связаться с GitHub Releases: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "GitHub API вернул статус {}",
            resp.status().as_u16()
        ));
    }

    let release: GitHubReleaseResponse = resp
        .json()
        .await
        .map_err(|e| format!("Ошибка разбора ответа GitHub Releases: {e}"))?;

    if release.draft.unwrap_or(false) {
        return Err("Последний релиз находится в черновиках.".to_string());
    }

    let latest_clean = release
        .tag_name
        .trim()
        .trim_start_matches(['v', 'V'])
        .to_string();
    let update_available = is_newer_version(CURRENT_VERSION, &latest_clean);
    let selected_asset = select_platform_asset(&release.assets);

    Ok(UpdateCheckResult {
        current_version: CURRENT_VERSION.to_string(),
        latest_version: latest_clean.clone(),
        update_available,
        release_name: release
            .name
            .unwrap_or_else(|| format!("Zastava v{latest_clean}")),
        release_notes: release
            .body
            .unwrap_or_else(|| "Официальная сборка GitHub Actions CI/CD.".to_string()),
        release_url: release.html_url,
        published_at: release.published_at,
        download_url: selected_asset.map(|a| a.browser_download_url.clone()),
        asset_name: selected_asset.map(|a| a.name.clone()),
        asset_size: selected_asset.map(|a| a.size),
    })
}

/// Downloads the release artifact from GitHub and executes automatic installation.
pub async fn download_and_install_update(
    app: &tauri::AppHandle,
    download_url: &str,
    asset_name: &str,
) -> Result<InstallUpdateResult, String> {
    validate_download_url(download_url)?;
    let safe_name = sanitize_asset_filename(asset_name)?;

    let update_dir = std::env::temp_dir().join(format!("zastava-update-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&update_dir)
        .await
        .map_err(|e| format!("Не удалось создать временную папку обновления: {e}"))?;

    let target_file = update_dir.join(&safe_name);

    let _ = app.emit(
        "updater://progress",
        UpdateProgressPayload {
            downloaded_bytes: 0,
            total_bytes: 0,
            percent: 5,
            phase: "Подключение к GitHub Releases...".to_string(),
        },
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .user_agent(format!("Zastava/{CURRENT_VERSION}"))
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| format!("Ошибка скачивания обновления: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Ошибка загрузки файла обновления (HTTP {})",
            resp.status().as_u16()
        ));
    }

    let total_bytes = resp.content_length().unwrap_or(0);
    let mut downloaded_bytes: u64 = 0;
    let mut file = tokio::fs::File::create(&target_file)
        .await
        .map_err(|e| format!("Не удалось создать файл обновления: {e}"))?;

    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Обрыв загрузки обновления: {e}"))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Ошибка записи обновления на диск: {e}"))?;
        downloaded_bytes += chunk.len() as u64;

        let percent = if total_bytes > 0 {
            ((downloaded_bytes as f64 / total_bytes as f64) * 85.0).clamp(5.0, 90.0) as u8
        } else {
            50
        };

        let _ = app.emit(
            "updater://progress",
            UpdateProgressPayload {
                downloaded_bytes,
                total_bytes,
                percent,
                phase: "Скачивание пакета обновления...".to_string(),
            },
        );
    }

    file.flush()
        .await
        .map_err(|e| format!("Ошибка сохранения файла: {e}"))?;
    drop(file);

    let _ = app.emit(
        "updater://progress",
        UpdateProgressPayload {
            downloaded_bytes,
            total_bytes,
            percent: 95,
            phase: "Установка и подготовка к перезапуску...".to_string(),
        },
    );

    apply_platform_update(app, &update_dir, &target_file, &safe_name)
}

#[cfg(target_os = "macos")]
fn find_current_app_bundle() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    // Typical path: /Applications/Zastava.app/Contents/MacOS/zastava
    for ancestor in exe.ancestors() {
        if let Some(ext) = ancestor.extension() {
            if ext == "app" {
                return Some(ancestor.to_path_buf());
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn apply_platform_update(
    app: &tauri::AppHandle,
    update_dir: &Path,
    target_file: &Path,
    safe_name: &str,
) -> Result<InstallUpdateResult, String> {
    if safe_name.ends_with(".app.tar.gz") {
        let status = std::process::Command::new("tar")
            .args([
                "-xzf",
                &target_file.to_string_lossy(),
                "-C",
                &update_dir.to_string_lossy(),
            ])
            .status()
            .map_err(|e| format!("Не удалось распаковать архив обновления: {e}"))?;

        if !status.success() {
            return Err("Архив обновления поврежден (ошибка распаковки tar).".to_string());
        }

        let extracted_app = update_dir.join("Zastava.app");
        if !extracted_app.exists() {
            return Err("В архиве обновления не найден пакет Zastava.app.".to_string());
        }

        let _ = std::process::Command::new("xattr")
            .args(["-cr", &extracted_app.to_string_lossy()])
            .status();

        if let Some(current_app_bundle) = find_current_app_bundle() {
            let script_path = update_dir.join("install_update.sh");
            let script = format!(
                "#!/bin/sh\nsleep 1\nrm -rf \"{target}\"\nmv \"{src}\" \"{target}\"\nxattr -cr \"{target}\"\nopen \"{target}\"\n",
                src = extracted_app.display(),
                target = current_app_bundle.display()
            );
            std::fs::write(&script_path, script)
                .map_err(|e| format!("Не удалось подготовить скрипт обновления: {e}"))?;

            let _ = std::process::Command::new("chmod")
                .args(["+x", &script_path.to_string_lossy()])
                .status();

            let _ = std::process::Command::new("sh")
                .arg(&script_path)
                .spawn()
                .map_err(|e| format!("Не удалось запустить установщик обновления: {e}"))?;

            let _ = app.emit(
                "updater://progress",
                UpdateProgressPayload {
                    downloaded_bytes: 100,
                    total_bytes: 100,
                    percent: 100,
                    phase: "Перезапуск Заставы...".to_string(),
                },
            );

            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_millis(600)).await;
                crate::sysproxy::disable_all_sysproxy();
                app_clone.exit(0);
            });

            return Ok(InstallUpdateResult {
                success: true,
                message: "Обновление установлено! Приложение сейчас перезапустится.".to_string(),
                will_restart: true,
            });
        } else {
            // Running from cargo dev / non-bundle binary: open the extracted .app in Finder
            let _ = std::process::Command::new("open")
                .args(["-R", &extracted_app.to_string_lossy()])
                .spawn();

            return Ok(InstallUpdateResult {
                success: true,
                message: format!(
                    "Новая сборка Zastava.app распакована в {} и открыта в Finder.",
                    extracted_app.display()
                ),
                will_restart: false,
            });
        }
    }

    // Fallback for .dmg installer
    let _ = std::process::Command::new("xattr")
        .args(["-cr", &target_file.to_string_lossy()])
        .status();
    std::process::Command::new("open")
        .arg(target_file)
        .spawn()
        .map_err(|e| format!("Не удалось открыть образ DMG: {e}"))?;

    Ok(InstallUpdateResult {
        success: true,
        message: "Образ обновления DMG скачан и открыт. Перетащите Zastava в Программы.".to_string(),
        will_restart: false,
    })
}

#[cfg(target_os = "windows")]
fn apply_platform_update(
    app: &tauri::AppHandle,
    _update_dir: &Path,
    target_file: &Path,
    safe_name: &str,
) -> Result<InstallUpdateResult, String> {
    if safe_name.ends_with(".msi") {
        std::process::Command::new("msiexec")
            .args(["/i", &target_file.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Не удалось запустить MSI-установщик: {e}"))?;
    } else {
        std::process::Command::new(target_file)
            .spawn()
            .map_err(|e| format!("Не удалось запустить установщик обновления: {e}"))?;
    }

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(600)).await;
        crate::sysproxy::disable_all_sysproxy();
        app_clone.exit(0);
    });

    Ok(InstallUpdateResult {
        success: true,
        message: "Установщик обновления запущен! Приложение закроется для завершения обновления."
            .to_string(),
        will_restart: true,
    })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn apply_platform_update(
    _app: &tauri::AppHandle,
    _update_dir: &Path,
    target_file: &Path,
    _safe_name: &str,
) -> Result<InstallUpdateResult, String> {
    Ok(InstallUpdateResult {
        success: true,
        message: format!("Пакет обновления сохранен: {}", target_file.display()),
        will_restart: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_semver_comparison() {
        assert!(is_newer_version("1.0.3", "1.0.4"));
        assert!(is_newer_version("v1.0.3", "v1.0.4"));
        assert!(is_newer_version("1.0.3", "1.1.0"));
        assert!(is_newer_version("1.0.3", "2.0.0"));
        assert!(!is_newer_version("1.0.4", "1.0.4"));
        assert!(!is_newer_version("1.0.4", "1.0.3"));
        assert!(is_newer_version("1.0.3", "1.0.10"));
    }

    #[test]
    fn test_download_url_allowlist() {
        assert!(validate_download_url(
            "https://github.com/kingbest1195/ai-antiban/releases/download/v1.0.4/Zastava_universal.app.tar.gz"
        )
        .is_ok());
        assert!(validate_download_url(
            "https://objects.githubusercontent.com/github-production-release-asset-2e65be/12345"
        )
        .is_ok());

        // Reject untrusted domains or SSRF targets
        assert!(validate_download_url("https://evil.example.com/Zastava.dmg").is_err());
        assert!(validate_download_url("http://127.0.0.1:8899/proxy.pac").is_err());
    }

    #[test]
    fn test_sanitize_asset_filename() {
        assert_eq!(
            sanitize_asset_filename("Zastava_1.0.4_universal.dmg").unwrap(),
            "Zastava_1.0.4_universal.dmg"
        );
        assert!(sanitize_asset_filename("..").is_err());
        assert!(sanitize_asset_filename("").is_err());
    }
}
