pub mod auditor;
pub mod bin_checker;
pub mod proxy;
pub mod state;
pub mod sysproxy;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn get_state(state: tauri::State<'_, state::AppState>) -> Result<state::AppStateData, String> {
    Ok(state.get_data().await)
}

#[tauri::command]
async fn audit_connection(
    provider: String,
    state: tauri::State<'_, state::AppState>,
    auditor: tauri::State<'_, auditor::Auditor>,
    force_refresh: Option<bool>,
) -> Result<auditor::RiskReport, String> {
    let provider_id = auditor::ProviderId::from_id(&provider)
        .ok_or_else(|| format!("Unknown provider: {provider}"))?;
    auditor
        .evaluate_all(provider_id, &state, force_refresh.unwrap_or(false))
        .await
}

#[tauri::command]
async fn clean_app_cache(
    provider: String,
) -> Result<auditor::cache_cleaner::CleanResult, String> {
    let provider_id = auditor::ProviderId::from_id(&provider)
        .ok_or_else(|| format!("Unknown provider: {provider}"))?;
    Ok(auditor::clean_ai_app_cache(provider_id))
}

#[tauri::command]
async fn pin_current_ip(
    ip: String,
    state: tauri::State<'_, state::AppState>,
) -> Result<(), String> {
    state
        .set_pinned_ip(Some(ip))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn unpin_ip(state: tauri::State<'_, state::AppState>) -> Result<(), String> {
    state.set_pinned_ip(None).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn toggle_strict_pinning(
    enabled: bool,
    state: tauri::State<'_, state::AppState>,
) -> Result<(), String> {
    state
        .set_strict_pinning_enabled(enabled)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn resolve_interception(
    id: String,
    action: proxy::InterceptionAction,
    provider: String,
    proxy_manager: tauri::State<'_, proxy::ProxyManager>,
    state: tauri::State<'_, state::AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    match action {
        proxy::InterceptionAction::AllowSession => {
            state
                .allow_provider_for_session(&provider)
                .await
                .map_err(|e| e.to_string())?;
            proxy_manager
                .hold_queue
                .resolve(&id, proxy::HoldResolution::Allow)
                .await;
            proxy_manager
                .hold_queue
                .resolve_all_for_provider(&provider, proxy::HoldResolution::Allow)
                .await;
        }
        proxy::InterceptionAction::BlockUntilNetworkChange => {
            state
                .block_provider(&provider)
                .await
                .map_err(|e| e.to_string())?;
            proxy_manager
                .hold_queue
                .resolve(&id, proxy::HoldResolution::Block)
                .await;
            proxy_manager
                .hold_queue
                .resolve_all_for_provider(&provider, proxy::HoldResolution::Block)
                .await;
        }
        proxy::InterceptionAction::OpenGuideAndBlock => {
            proxy_manager
                .hold_queue
                .resolve(&id, proxy::HoldResolution::Block)
                .await;
            proxy_manager
                .hold_queue
                .resolve_all_for_provider(&provider, proxy::HoldResolution::Block)
                .await;
            if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.show();
                let _ = main_win.set_focus();
                let _ = app.emit("interceptor://open-guide", "01-personal-vpn-15min");
            }
        }
    }

    if let Some(popup) = app.get_webview_window("alert-popup") {
        let _ = popup.hide();
    }

    Ok(())
}

#[tauri::command]
async fn simulate_interception(
    provider: Option<String>,
    app: tauri::AppHandle,
    auditor: tauri::State<'_, auditor::Auditor>,
    proxy_manager: tauri::State<'_, proxy::ProxyManager>,
) -> Result<(), String> {
    let prov = provider.unwrap_or_else(|| "anthropic".to_string());
    let provider_id = auditor::ProviderId::from_id(&prov).unwrap_or(auditor::ProviderId::Anthropic);

    let matrix = auditor.rules.provider_matrix.read().await;
    let dangerous_asns = auditor.rules.dangerous_asns.read().await;

    let telemetry = auditor::NetworkTelemetry {
        ip: "185.220.101.5".to_string(),
        country_code: "TR".to_string(),
        asn: Some(9009),
        org: Some("M247 Europe SRL".to_string()),
        isp: Some("M247 Europe SRL".to_string()),
        timezone: Some("Europe/Istanbul".to_string()),
        resolved_at: auditor::network::current_timestamp(),
    };

    let geo_result = auditor::evaluate_provider_geo(&matrix, provider_id, &telemetry.country_code);
    let pinning_result = auditor::CheckResult::warning(
        "PINNED_IP_NOT_CONFIGURED",
        "Strict Pinning is disabled. Traffic routing via unpinned commercial IP.",
        Some(auditor::geo_matrix::GUIDE_PERSONAL_VPN.to_string()),
    );
    let travel_result = auditor::CheckResult::ok("TRAVEL_NORMAL", "No previous travel conflict.");
    let dnsbl_report = auditor::check_all_dnsbl(&telemetry.ip, &dangerous_asns).await;
    let dnsbl_result = auditor::evaluate_dnsbl_report(&dnsbl_report);
    let asn_result = auditor::evaluate_asn_reputation(
        telemetry.asn,
        telemetry.isp.as_deref(),
        telemetry.org.as_deref(),
        &dangerous_asns,
        false,
    );
    let ipv6_result = auditor::CheckResult::ok("IPV6_SAFE", "No IPv6 dual-stack leak.");
    let timezone_result = auditor::evaluate_system_timezone(telemetry.timezone.as_deref());

    let checks = vec![
        geo_result.clone(),
        pinning_result.clone(),
        travel_result.clone(),
        dnsbl_result.clone(),
        asn_result.clone(),
        ipv6_result.clone(),
        timezone_result.clone(),
    ];

    let report = auditor::RiskReport {
        provider: provider_id,
        overall_status: auditor::OverallStatus::Red,
        trust_score: 28,
        telemetry,
        geo_result,
        pinning_result,
        travel_result,
        dnsbl_result,
        dnsbl_clean_count: dnsbl_report.summary_label,
        asn_result,
        ipv6_result,
        timezone_result,
        checks,
    };

    let hold_id = uuid::Uuid::new_v4().to_string();
    let _rx = proxy_manager
        .hold_queue
        .register(hold_id.clone(), provider_id.as_str())
        .await;

    let payload = proxy::RiskInterceptPayload {
        id: hold_id,
        provider: provider_id,
        host: "claude.ai".to_string(),
        report,
        ttl_seconds: proxy::hold_queue::DEFAULT_HOLD_TTL_SECS,
    };

    if let Some(popup) = app.get_webview_window("alert-popup") {
        let _ = popup.show();
        let _ = popup.set_focus();
    }
    let _ = app.emit("interceptor://risk-detected", &payload);

    Ok(())
}

#[tauri::command]
async fn toggle_sysproxy(
    enable: bool,
    proxy_manager: tauri::State<'_, proxy::ProxyManager>,
) -> Result<bool, String> {
    if enable {
        let pac_url = format!("http://{}/proxy.pac", proxy_manager.server.bound_addr);
        sysproxy::enable_sysproxy(&pac_url)?;
        Ok(true)
    } else {
        sysproxy::disable_all_sysproxy();
        Ok(false)
    }
}

#[tauri::command]
fn get_sysproxy_status() -> Result<bool, String> {
    Ok(sysproxy::is_sysproxy_active())
}

#[tauri::command]
async fn check_payment_bin(
    bin: String,
    vpn_country: Option<String>,
    checker: tauri::State<'_, bin_checker::BinChecker>,
) -> Result<bin_checker::BinAuditResult, String> {
    checker.check_bin(&bin, vpn_country.as_deref()).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Register panic guard for systemic proxy clean-up
            sysproxy::register_clean_exit_guard();

            // Initialize persistent AppState
            let app_state = state::init_app_state(app.handle())
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            app.manage(app_state.clone());

            // Initialize Risk Auditor Engine
            let risk_auditor = auditor::Auditor::new()
                .map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)) as Box<dyn std::error::Error>)?;
            app.manage(risk_auditor.clone());

            // Initialize BIN Checker
            let bin_checker = bin_checker::BinChecker::new();
            app.manage(bin_checker);

            // Initialize and start local selective PAC + Hold Proxy
            let handle_clone = app.handle().clone();
            tauri::async_runtime::block_on(async {
                let proxy_mgr = proxy::ProxyManager::start(
                    risk_auditor,
                    app_state,
                    Some(handle_clone),
                ).await.expect("Failed to start proxy server");
                app.manage(proxy_mgr);
            });

            // Native tray menu
            let quit_i = MenuItem::with_id(app, "quit", "Quit AI-AntiBan", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Open Dashboard", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "quit" => {
                            sysproxy::disable_all_sysproxy();
                            app.exit(0);
                        }
                        "show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_state,
            audit_connection,
            clean_app_cache,
            pin_current_ip,
            unpin_ip,
            toggle_strict_pinning,
            resolve_interception,
            simulate_interception,
            toggle_sysproxy,
            get_sysproxy_status,
            check_payment_bin
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
                sysproxy::disable_all_sysproxy();
            }
        });
}
