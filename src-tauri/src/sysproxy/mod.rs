use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, Once};

static SYS_PROXY_ACTIVE: AtomicBool = AtomicBool::new(false);
static CLEAN_HOOK_INIT: Once = Once::new();
static LAST_PAC_URL: Mutex<Option<String>> = Mutex::new(None);
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
static KNOWN_SERVICES: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SysproxyStatus {
    pub enabled: bool,
    pub pac_url: Option<String>,
    pub services_configured: Vec<String>,
}

/// Registers panic hook and cleanup guard once per process.
pub fn register_clean_exit_guard() {
    CLEAN_HOOK_INIT.call_once(|| {
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |panic_info| {
            eprintln!("Panic detected! Executing emergency system PAC proxy cleanup...");
            disable_all_sysproxy();
            default_hook(panic_info);
        }));
    });
}

/// Spawns an asynchronous OS signal watcher (`SIGINT` / `SIGTERM` / `SIGHUP`) that guarantees
/// systemic PAC proxy settings are disabled before the process terminates.
pub fn spawn_signal_cleanup_watcher() {
    tauri::async_runtime::spawn(async {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{signal, SignalKind};
            let mut sigterm = signal(SignalKind::terminate()).ok();
            let mut sighup = signal(SignalKind::hangup()).ok();

            tokio::select! {
                _ = tokio::signal::ctrl_c() => {},
                _ = async {
                    match &mut sigterm {
                        Some(s) => { let _ = s.recv().await; }
                        None => std::future::pending::<()>().await,
                    }
                } => {},
                _ = async {
                    match &mut sighup {
                        Some(s) => { let _ = s.recv().await; }
                        None => std::future::pending::<()>().await,
                    }
                } => {},
            }
        }

        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
        }

        eprintln!("Termination signal received! Cleaning up system PAC proxy...");
        disable_all_sysproxy();
        std::process::exit(0);
    });
}

/// Disables systemic PAC proxy on all network services across macOS and Windows.
pub fn disable_all_sysproxy() {
    #[cfg(target_os = "macos")]
    {
        if let Ok(services) = get_macos_network_services() {
            for service in services {
                let _ = std::process::Command::new("networksetup")
                    .args(["-setautoproxystate", &service, "off"])
                    .output();
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // On Windows remove HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings\AutoConfigURL
        let _ = std::process::Command::new("reg")
            .args([
                "delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                "/v",
                "AutoConfigURL",
                "/f",
            ])
            .output();
        notify_windows_inet_refresh();
    }

    SYS_PROXY_ACTIVE.store(false, Ordering::SeqCst);
    if let Ok(mut g) = LAST_PAC_URL.lock() {
        *g = None;
    }
}

/// Enables systemic PAC proxy with the given PAC URL (e.g. "http://127.0.0.1:8899/proxy.pac").
pub fn enable_sysproxy(pac_url: &str) -> Result<SysproxyStatus, String> {
    register_clean_exit_guard();
    let mut configured = Vec::new();

    #[cfg(target_os = "macos")]
    {
        let services = get_macos_network_services().map_err(|e| e.to_string())?;
        if let Ok(mut known) = KNOWN_SERVICES.lock() {
            *known = services.clone();
        }
        for service in services {
            // Set autoproxy URL
            let output_url = std::process::Command::new("networksetup")
                .args(["-setautoproxyurl", &service, pac_url])
                .output();

            // Enable autoproxy state
            let output_state = std::process::Command::new("networksetup")
                .args(["-setautoproxystate", &service, "on"])
                .output();

            if output_url.is_ok() && output_state.is_ok() {
                configured.push(service);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let output = std::process::Command::new("reg")
            .args([
                "add",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                "/v",
                "AutoConfigURL",
                "/t",
                "REG_SZ",
                "/d",
                pac_url,
                "/f",
            ])
            .output();

        if output.is_ok() {
            configured.push("Windows Internet Settings (WinINet)".to_string());
        }
        notify_windows_inet_refresh();
    }

    SYS_PROXY_ACTIVE.store(true, Ordering::SeqCst);
    if let Ok(mut g) = LAST_PAC_URL.lock() {
        *g = Some(pac_url.to_string());
    }

    Ok(SysproxyStatus {
        enabled: true,
        pac_url: Some(pac_url.to_string()),
        services_configured: configured,
    })
}

#[cfg(target_os = "windows")]
fn notify_windows_inet_refresh() {
    #[link(name = "wininet")]
    unsafe extern "system" {
        fn InternetSetOptionW(
            hInternet: *mut core::ffi::c_void,
            dwOption: u32,
            lpBuffer: *mut core::ffi::c_void,
            dwBufferLength: u32,
        ) -> i32;
    }
    const INTERNET_OPTION_SETTINGS_CHANGED: u32 = 39;
    const INTERNET_OPTION_REFRESH: u32 = 37;
    unsafe {
        let _ = InternetSetOptionW(
            core::ptr::null_mut(),
            INTERNET_OPTION_SETTINGS_CHANGED,
            core::ptr::null_mut(),
            0,
        );
        let _ = InternetSetOptionW(
            core::ptr::null_mut(),
            INTERNET_OPTION_REFRESH,
            core::ptr::null_mut(),
            0,
        );
    }
}

/// Returns whether systemic PAC proxy is currently active.
pub fn is_sysproxy_active() -> bool {
    SYS_PROXY_ACTIVE.load(Ordering::SeqCst)
}

/// Re-applies the PAC configuration when a new network service appeared (e.g. a VPN client
/// added its own service) or when an external network tool / OS sleep-wake cycle disabled
/// or overwrote the PAC URL on the primary interface (Self-Healing).
/// Returns `true` when the configuration was re-applied.
pub fn refresh_if_services_changed() -> bool {
    if !is_sysproxy_active() {
        return false;
    }

    #[cfg(target_os = "macos")]
    {
        let pac = LAST_PAC_URL.lock().ok().and_then(|g| g.clone());
        if let (Some(pac), Ok(mut services)) = (pac, get_macos_network_services()) {
            let mut known = KNOWN_SERVICES.lock().map(|g| g.clone()).unwrap_or_default();
            services.sort();
            known.sort();
            if services != known {
                return enable_sysproxy(&pac).is_ok();
            }

            // Also verify that the primary service (e.g. "Wi-Fi" or first active service)
            // still has Auto Proxy enabled and pointing to our PAC URL.
            let check_target = services
                .iter()
                .find(|s| s.eq_ignore_ascii_case("Wi-Fi") || s.contains("Ethernet"))
                .or_else(|| services.first());
            if let Some(service) = check_target {
                if let Ok(output) = std::process::Command::new("networksetup")
                    .args(["-getautoproxyurl", service])
                    .output()
                {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let url_matches = stdout.contains(&pac);
                    let enabled_yes = stdout.lines().any(|l| {
                        let t = l.trim().to_ascii_lowercase();
                        t.starts_with("enabled:") && t.contains("yes")
                    });
                    if !url_matches || !enabled_yes {
                        return enable_sysproxy(&pac).is_ok();
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        let pac = LAST_PAC_URL.lock().ok().and_then(|g| g.clone());
        if let Some(pac) = pac {
            if let Ok(output) = std::process::Command::new("reg")
                .args([
                    "query",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                    "/v",
                    "AutoConfigURL",
                ])
                .output()
            {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if !output.status.success() || !stdout.contains(&pac) {
                    return enable_sysproxy(&pac).is_ok();
                }
            }
        }
    }

    false
}

#[cfg(target_os = "macos")]
fn get_macos_network_services() -> Result<Vec<String>, std::io::Error> {
    let output = std::process::Command::new("networksetup")
        .arg("-listallnetworkservices")
        .output()?;

    let text = String::from_utf8_lossy(&output.stdout);
    let mut services = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('*')
            || trimmed.contains("denotes that a network service is disabled")
        {
            continue;
        }
        services.push(trimmed.to_string());
    }

    Ok(services)
}

pub struct SysProxy;

impl SysProxy {
    pub fn enable(pac_url: &str) -> Result<SysproxyStatus, String> {
        enable_sysproxy(pac_url)
    }

    pub fn disable() {
        disable_all_sysproxy();
    }

    pub fn is_active() -> bool {
        is_sysproxy_active()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_graceful_proxy_cleanup() {
        register_clean_exit_guard();
        SysProxy::disable();
        assert!(!SysProxy::is_active());
    }

    #[test]
    fn test_graceful_proxy_cleanup_hook() {
        register_clean_exit_guard();
        // Disabling proxy should execute safely without crashing
        disable_all_sysproxy();
        assert!(!is_sysproxy_active());
    }
}
