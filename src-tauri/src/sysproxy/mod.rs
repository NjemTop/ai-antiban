use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, Once};

static SYS_PROXY_ACTIVE: AtomicBool = AtomicBool::new(false);
static CLI_PROTECTION_ACTIVE: AtomicBool = AtomicBool::new(false);
static CLEAN_HOOK_INIT: Once = Once::new();
static LAST_PAC_URL: Mutex<Option<String>> = Mutex::new(None);
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
static KNOWN_SERVICES: Mutex<Vec<String>> = Mutex::new(Vec::new());

const ZASTAVA_RC_START: &str = "# >>> Zastava AI CLI & IDE Guard >>>";
const ZASTAVA_RC_END: &str = "# <<< Zastava AI CLI & IDE Guard <<<";
const NO_PROXY_VALUE: &str = "localhost,127.0.0.1,::1,.local";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SysproxyStatus {
    pub enabled: bool,
    pub pac_url: Option<String>,
    pub services_configured: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CliProtectionReport {
    pub enabled: bool,
    pub proxy_url: String,
    pub configured_targets: Vec<String>,
    pub shell_command: String,
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

    if CLI_PROTECTION_ACTIVE.swap(false, Ordering::SeqCst) {
        disable_cli_and_ide_runtime_settings();
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

fn normalize_proxy_url_and_port(proxy_addr_or_url: &str) -> (String, u16) {
    let trimmed = proxy_addr_or_url
        .trim()
        .trim_end_matches("/proxy.pac")
        .trim_end_matches('/');
    let url = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{trimmed}")
    };
    let port = trimmed
        .rsplit_once(':')
        .and_then(|(_, p)| p.parse::<u16>().ok())
        .unwrap_or(8899);
    (url, port)
}

fn is_zastava_local_proxy_val(val: &str) -> bool {
    let v = val.trim().to_ascii_lowercase();
    v.contains("127.0.0.1:8899")
        || v.contains("127.0.0.1:8900")
        || v.contains("localhost:8899")
        || v.contains("localhost:8900")
}

/// Builds the shell RC block that enables proxy variables in new terminals ONLY when
/// Zastava is actively listening on `127.0.0.1:<port>`. If Zastava is closed, `nc -z`
/// exits immediately and the terminal works directly without proxy errors.
pub fn build_shell_rc_guard_block(proxy_url: &str, port: u16) -> String {
    format!(
        "{start}\nif command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 {port} >/dev/null 2>&1; then\n  export HTTP_PROXY=\"{url}\"\n  export HTTPS_PROXY=\"{url}\"\n  export ALL_PROXY=\"{url}\"\n  export http_proxy=\"{url}\"\n  export https_proxy=\"{url}\"\n  export all_proxy=\"{url}\"\n  export NO_PROXY=\"{no_proxy}\"\n  export no_proxy=\"{no_proxy}\"\nfi\n{end}",
        start = ZASTAVA_RC_START,
        port = port,
        url = proxy_url,
        no_proxy = NO_PROXY_VALUE,
        end = ZASTAVA_RC_END
    )
}

/// Idempotently inserts or updates the Zastava CLI guard block inside a shell RC file content.
pub fn upsert_shell_rc_content(existing: &str, proxy_url: &str, port: u16) -> String {
    let block = build_shell_rc_guard_block(proxy_url, port);
    if let (Some(start_idx), Some(end_idx)) = (
        existing.find(ZASTAVA_RC_START),
        existing.find(ZASTAVA_RC_END),
    ) {
        if start_idx <= end_idx {
            let after_end = end_idx + ZASTAVA_RC_END.len();
            let mut result = String::with_capacity(existing.len() + block.len());
            result.push_str(&existing[..start_idx]);
            result.push_str(&block);
            result.push_str(&existing[after_end..]);
            return result;
        }
    }

    let mut result = existing.to_string();
    if !result.is_empty() && !result.ends_with('\n') {
        result.push('\n');
    }
    if !result.is_empty() {
        result.push('\n');
    }
    result.push_str(&block);
    result.push('\n');
    result
}

/// Strips `//` and `/* */` comments outside JSON string literals and removes trailing commas
/// so VS Code `settings.json` (JSONC) can be safely parsed by `serde_json`.
pub fn sanitize_jsonc(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0;
    let mut in_string = false;

    while i < chars.len() {
        let c = chars[i];
        if in_string {
            out.push(c);
            if c == '\\' && i + 1 < chars.len() {
                i += 1;
                out.push(chars[i]);
            } else if c == '"' {
                in_string = false;
            }
            i += 1;
            continue;
        }

        if c == '"' {
            in_string = true;
            out.push(c);
            i += 1;
            continue;
        }

        // Line comment //
        if c == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
            i += 2;
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }

        // Block comment /* ... */
        if c == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            i = (i + 2).min(chars.len());
            continue;
        }

        out.push(c);
        i += 1;
    }

    // Remove trailing commas before `}` or `]` outside strings
    let chars2: Vec<char> = out.chars().collect();
    let mut final_out = String::with_capacity(out.len());
    let mut j = 0;
    let mut in_str = false;
    while j < chars2.len() {
        let c = chars2[j];
        if in_str {
            final_out.push(c);
            if c == '\\' && j + 1 < chars2.len() {
                j += 1;
                final_out.push(chars2[j]);
            } else if c == '"' {
                in_str = false;
            }
            j += 1;
            continue;
        }
        if c == '"' {
            in_str = true;
            final_out.push(c);
            j += 1;
            continue;
        }
        if c == ',' {
            let mut k = j + 1;
            while k < chars2.len() && chars2[k].is_whitespace() {
                k += 1;
            }
            if k < chars2.len() && (chars2[k] == '}' || chars2[k] == ']') {
                j += 1;
                continue;
            }
        }
        final_out.push(c);
        j += 1;
    }

    final_out
}

fn ide_env_key() -> &'static str {
    if cfg!(target_os = "macos") {
        "terminal.integrated.env.osx"
    } else if cfg!(target_os = "windows") {
        "terminal.integrated.env.windows"
    } else {
        "terminal.integrated.env.linux"
    }
}

/// Applies Zastava proxy configuration to a VS Code / Cursor / Windsurf `settings.json` file.
pub fn apply_ide_settings_file(settings_path: &Path, proxy_url: &str) -> Result<bool, String> {
    let raw = if settings_path.exists() {
        fs::read_to_string(settings_path).map_err(|e| e.to_string())?
    } else {
        "{}".to_string()
    };

    let clean = if raw.trim().is_empty() {
        "{}".to_string()
    } else {
        sanitize_jsonc(&raw)
    };

    let mut root: Value = serde_json::from_str(&clean).map_err(|e| e.to_string())?;
    let Some(obj) = root.as_object_mut() else {
        return Ok(false);
    };

    obj.insert("http.proxy".to_string(), Value::String(proxy_url.to_string()));
    obj.insert(
        "http.proxySupport".to_string(),
        Value::String("override".to_string()),
    );

    let env_key = ide_env_key();
    let env_entry = obj
        .entry(env_key.to_string())
        .or_insert_with(|| json!({}));
    if !env_entry.is_object() {
        *env_entry = json!({});
    }
    if let Some(env_map) = env_entry.as_object_mut() {
        env_map.insert("HTTP_PROXY".to_string(), Value::String(proxy_url.to_string()));
        env_map.insert("HTTPS_PROXY".to_string(), Value::String(proxy_url.to_string()));
        env_map.insert("ALL_PROXY".to_string(), Value::String(proxy_url.to_string()));
        env_map.insert(
            "NO_PROXY".to_string(),
            Value::String(NO_PROXY_VALUE.to_string()),
        );
    }

    let formatted = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(settings_path, format!("{formatted}\n")).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Removes Zastava local proxy keys from a VS Code / Cursor / Windsurf `settings.json` file
/// when Zastava exits or when protection is turned off, preserving all other user settings.
pub fn cleanup_ide_settings_file(settings_path: &Path) -> Result<bool, String> {
    if !settings_path.exists() {
        return Ok(false);
    }
    let raw = fs::read_to_string(settings_path).map_err(|e| e.to_string())?;
    let clean = sanitize_jsonc(&raw);
    let mut root: Value = serde_json::from_str(&clean).map_err(|e| e.to_string())?;
    let Some(obj) = root.as_object_mut() else {
        return Ok(false);
    };

    let mut changed = false;
    if let Some(val) = obj.get("http.proxy").and_then(|v| v.as_str()) {
        if is_zastava_local_proxy_val(val) {
            obj.remove("http.proxy");
            obj.remove("http.proxySupport");
            changed = true;
        }
    }

    for env_key in [
        "terminal.integrated.env.osx",
        "terminal.integrated.env.windows",
        "terminal.integrated.env.linux",
    ] {
        let mut remove_entire_env_obj = false;
        if let Some(env_map) = obj.get_mut(env_key).and_then(|v| v.as_object_mut()) {
            let matches_zastava = env_map
                .get("HTTPS_PROXY")
                .or_else(|| env_map.get("HTTP_PROXY"))
                .and_then(|v| v.as_str())
                .map(is_zastava_local_proxy_val)
                .unwrap_or(false);

            if matches_zastava {
                env_map.remove("HTTP_PROXY");
                env_map.remove("HTTPS_PROXY");
                env_map.remove("ALL_PROXY");
                env_map.remove("NO_PROXY");
                changed = true;
            }
            if env_map.is_empty() {
                remove_entire_env_obj = true;
            }
        }
        if remove_entire_env_obj {
            obj.remove(env_key);
        }
    }

    if changed {
        let formatted = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
        fs::write(settings_path, format!("{formatted}\n")).map_err(|e| e.to_string())?;
    }
    Ok(changed)
}

/// Applies Zastava proxy environment variables to `~/.claude/settings.json` (`env` block)
/// so both the Claude Code VS Code extension and `claude` CLI route through Zastava immediately.
pub fn apply_claude_code_settings_file(settings_path: &Path, proxy_url: &str) -> Result<bool, String> {
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = if settings_path.exists() {
        fs::read_to_string(settings_path).map_err(|e| e.to_string())?
    } else {
        "{}".to_string()
    };
    let clean = if raw.trim().is_empty() {
        "{}".to_string()
    } else {
        sanitize_jsonc(&raw)
    };
    let mut root: Value = serde_json::from_str(&clean).unwrap_or_else(|_| json!({}));
    if !root.is_object() {
        root = json!({});
    }
    let obj = root.as_object_mut().unwrap();
    let env_entry = obj.entry("env".to_string()).or_insert_with(|| json!({}));
    if !env_entry.is_object() {
        *env_entry = json!({});
    }
    if let Some(env_map) = env_entry.as_object_mut() {
        env_map.insert("HTTP_PROXY".to_string(), Value::String(proxy_url.to_string()));
        env_map.insert("HTTPS_PROXY".to_string(), Value::String(proxy_url.to_string()));
        env_map.insert("ALL_PROXY".to_string(), Value::String(proxy_url.to_string()));
        env_map.insert(
            "NO_PROXY".to_string(),
            Value::String(NO_PROXY_VALUE.to_string()),
        );
    }

    let formatted = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(settings_path, format!("{formatted}\n")).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Removes Zastava local proxy variables from `~/.claude/settings.json` when Zastava exits.
pub fn cleanup_claude_code_settings_file(settings_path: &Path) -> Result<bool, String> {
    if !settings_path.exists() {
        return Ok(false);
    }
    let raw = fs::read_to_string(settings_path).map_err(|e| e.to_string())?;
    let clean = sanitize_jsonc(&raw);
    let mut root: Value = serde_json::from_str(&clean).map_err(|e| e.to_string())?;
    let Some(obj) = root.as_object_mut() else {
        return Ok(false);
    };

    let mut changed = false;
    let mut remove_env_obj = false;
    if let Some(env_map) = obj.get_mut("env").and_then(|v| v.as_object_mut()) {
        let matches_zastava = env_map
            .get("HTTPS_PROXY")
            .or_else(|| env_map.get("HTTP_PROXY"))
            .and_then(|v| v.as_str())
            .map(is_zastava_local_proxy_val)
            .unwrap_or(false);
        if matches_zastava {
            env_map.remove("HTTP_PROXY");
            env_map.remove("HTTPS_PROXY");
            env_map.remove("ALL_PROXY");
            env_map.remove("NO_PROXY");
            changed = true;
        }
        if env_map.is_empty() {
            remove_env_obj = true;
        }
    }
    if remove_env_obj {
        obj.remove("env");
    }

    if changed {
        let formatted = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
        fs::write(settings_path, format!("{formatted}\n")).map_err(|e| e.to_string())?;
    }
    Ok(changed)
}

fn user_home_dir() -> Option<PathBuf> {
    #[cfg(unix)]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
}

fn candidate_ide_settings_paths() -> Vec<(&'static str, PathBuf)> {
    let mut result = Vec::new();
    let ides = [
        ("VS Code", "Code"),
        ("Cursor", "Cursor"),
        ("Windsurf", "Windsurf"),
        ("VSCodium", "VSCodium"),
        ("Antigravity", "Antigravity"),
    ];

    #[cfg(target_os = "macos")]
    if let Some(home) = user_home_dir() {
        let base = home.join("Library").join("Application Support");
        for (label, folder) in ides {
            let user_dir = base.join(folder).join("User");
            if user_dir.is_dir() {
                result.push((label, user_dir.join("settings.json")));
            }
        }
    }

    #[cfg(target_os = "windows")]
    if let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) {
        for (label, folder) in ides {
            let user_dir = appdata.join(folder).join("User");
            if user_dir.is_dir() {
                result.push((label, user_dir.join("settings.json")));
            }
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    if let Some(home) = user_home_dir() {
        let base = home.join(".config");
        for (label, folder) in ides {
            let user_dir = base.join(folder).join("User");
            if user_dir.is_dir() {
                result.push((label, user_dir.join("settings.json")));
            }
        }
    }

    result
}

/// Automatically configures CLI & IDE protection across:
/// 1. `~/.claude/settings.json` (`env.HTTPS_PROXY`, `env.HTTP_PROXY`) for Claude Code CLI & VS Code extension
/// 2. VS Code / Cursor / Windsurf `settings.json` (`http.proxy` + `terminal.integrated.env.*`)
/// 3. Shell profiles (`~/.zshrc`, `~/.bash_profile`) with an automatic `nc -z` liveness check
/// 4. macOS `launchctl setenv` for GUI apps launched from Dock
pub fn enable_cli_and_ide_protection(proxy_addr_or_url: &str) -> CliProtectionReport {
    let (proxy_url, port) = normalize_proxy_url_and_port(proxy_addr_or_url);
    let mut configured_targets = Vec::new();

    #[cfg(target_os = "macos")]
    {
        let vars = [
            ("HTTP_PROXY", proxy_url.as_str()),
            ("HTTPS_PROXY", proxy_url.as_str()),
            ("ALL_PROXY", proxy_url.as_str()),
            ("NO_PROXY", NO_PROXY_VALUE),
        ];
        let mut launchd_ok = false;
        for (k, v) in vars {
            if std::process::Command::new("launchctl")
                .args(["setenv", k, v])
                .output()
                .is_ok()
            {
                launchd_ok = true;
            }
        }
        if launchd_ok {
            configured_targets.push("macOS Launchd (GUI)".to_string());
        }
    }

    if let Some(home) = user_home_dir() {
        // 1. Claude Code settings (~/.claude/settings.json)
        let claude_settings = home.join(".claude").join("settings.json");
        if apply_claude_code_settings_file(&claude_settings, &proxy_url).is_ok() {
            configured_targets.push("Claude Code".to_string());
        }

        // 2. Shell RC files on Unix (~/.zshrc, ~/.bash_profile)
        #[cfg(unix)]
        {
            for rc_name in [".zshrc", ".bash_profile"] {
                let rc_path = home.join(rc_name);
                if rc_name == ".zshrc" || rc_path.exists() {
                    let existing = fs::read_to_string(&rc_path).unwrap_or_default();
                    let updated = upsert_shell_rc_content(&existing, &proxy_url, port);
                    if fs::write(&rc_path, updated).is_ok() && rc_name == ".zshrc" {
                        configured_targets.push("Терминал (~/.zshrc)".to_string());
                    }
                }
            }
        }
    }

    // 3. Installed IDEs (VS Code, Cursor, Windsurf, VSCodium, Antigravity)
    for (label, settings_path) in candidate_ide_settings_paths() {
        if apply_ide_settings_file(&settings_path, &proxy_url).unwrap_or(false) {
            configured_targets.push(label.to_string());
        }
    }

    CLI_PROTECTION_ACTIVE.store(true, Ordering::SeqCst);

    let shell_command = format!(
        "export HTTP_PROXY=\"{proxy_url}\" HTTPS_PROXY=\"{proxy_url}\" ALL_PROXY=\"{proxy_url}\" NO_PROXY=\"{NO_PROXY_VALUE}\""
    );

    CliProtectionReport {
        enabled: true,
        proxy_url,
        configured_targets,
        shell_command,
    }
}

/// Cleans up runtime proxy settings in IDE `settings.json`, `~/.claude/settings.json`, and
/// macOS `launchctl` environment so apps work directly when Zastava is closed or disabled.
pub fn disable_cli_and_ide_runtime_settings() {
    #[cfg(target_os = "macos")]
    {
        for k in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "NO_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
            "no_proxy",
        ] {
            let _ = std::process::Command::new("launchctl")
                .args(["unsetenv", k])
                .output();
        }
    }

    if let Some(home) = user_home_dir() {
        let claude_settings = home.join(".claude").join("settings.json");
        let _ = cleanup_claude_code_settings_file(&claude_settings);
    }

    for (_label, settings_path) in candidate_ide_settings_paths() {
        let _ = cleanup_ide_settings_file(&settings_path);
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

    #[test]
    fn test_upsert_shell_rc_idempotent() {
        let initial = "export PATH=\"$HOME/.local/bin:$PATH\"\n";
        let updated1 = upsert_shell_rc_content(initial, "http://127.0.0.1:8899", 8899);
        assert!(updated1.contains("nc -z 127.0.0.1 8899"));
        assert!(updated1.contains("export HTTPS_PROXY=\"http://127.0.0.1:8899\""));

        // Second upsert with fallback port 8900 replaces the block without duplicating it
        let updated2 = upsert_shell_rc_content(&updated1, "http://127.0.0.1:8900", 8900);
        assert_eq!(updated2.matches(ZASTAVA_RC_START).count(), 1);
        assert!(updated2.contains("nc -z 127.0.0.1 8900"));
        assert!(!updated2.contains("127.0.0.1:8899"));
    }

    #[test]
    fn test_ide_and_claude_settings_apply_and_cleanup() {
        let tmp_dir = std::env::temp_dir().join(format!("zastava_ide_test_{}", std::process::id()));
        let _ = fs::create_dir_all(&tmp_dir);
        let vscode_settings = tmp_dir.join("settings.json");

        // Write JSONC with comments and trailing comma
        let initial_jsonc = r#"{
            // User custom theme
            "workbench.colorTheme": "Default Dark+",
            "editor.fontSize": 14,
        }"#;
        fs::write(&vscode_settings, initial_jsonc).unwrap();

        assert!(apply_ide_settings_file(&vscode_settings, "http://127.0.0.1:8899").unwrap());
        let content = fs::read_to_string(&vscode_settings).unwrap();
        assert!(content.contains("\"http.proxy\": \"http://127.0.0.1:8899\""));
        assert!(content.contains("\"HTTPS_PROXY\": \"http://127.0.0.1:8899\""));
        assert!(content.contains("\"workbench.colorTheme\": \"Default Dark+\""));

        // Cleanup removes Zastava proxy keys while preserving user settings
        assert!(cleanup_ide_settings_file(&vscode_settings).unwrap());
        let cleaned = fs::read_to_string(&vscode_settings).unwrap();
        assert!(!cleaned.contains("127.0.0.1:8899"));
        assert!(cleaned.contains("\"workbench.colorTheme\": \"Default Dark+\""));

        // Test Claude Code ~/.claude/settings.json apply and cleanup
        let claude_settings = tmp_dir.join(".claude").join("settings.json");
        assert!(apply_claude_code_settings_file(&claude_settings, "http://127.0.0.1:8899").unwrap());
        let claude_content = fs::read_to_string(&claude_settings).unwrap();
        assert!(claude_content.contains("\"HTTPS_PROXY\": \"http://127.0.0.1:8899\""));

        assert!(cleanup_claude_code_settings_file(&claude_settings).unwrap());
        let claude_cleaned = fs::read_to_string(&claude_settings).unwrap();
        assert!(!claude_cleaned.contains("127.0.0.1:8899"));

        let _ = fs::remove_dir_all(&tmp_dir);
    }
}
