pub mod auditor;
pub mod bin_checker;
pub mod proxy;
pub mod state;
pub mod sysproxy;

use std::time::Duration;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

pub const MAIN_TRAY_ID: &str = "main-tray";

const TRAY_ICON_GREEN: &[u8] = include_bytes!("../icons/tray-green.png");
const TRAY_ICON_YELLOW: &[u8] = include_bytes!("../icons/tray-yellow.png");
const TRAY_ICON_RED: &[u8] = include_bytes!("../icons/tray-red.png");

/// Updates the system tray icon, menu bar title (macOS), and tooltip based on current audit report.
pub fn update_tray_from_report(
    app: &tauri::AppHandle,
    report: &auditor::RiskReport,
    is_pinned: bool,
    has_blocked: bool,
) {
    if let Some(tray) = app.tray_by_id(MAIN_TRAY_ID) {
        let country = &report.telemetry.country_code;
        let score = report.trust_score;

        let (icon_bytes, status_label, dot) = if has_blocked {
            (TRAY_ICON_RED, format!(" {country} · ПАУЗА"), "🔴")
        } else {
            match report.overall_status {
                auditor::OverallStatus::Green => {
                    let pin_mark = if is_pinned { " 📌" } else { "" };
                    (TRAY_ICON_GREEN, format!(" {country} · {score}%{pin_mark}"), "🟢")
                }
                auditor::OverallStatus::Yellow => {
                    (TRAY_ICON_YELLOW, format!(" {country} · РИСК"), "🟡")
                }
                auditor::OverallStatus::Red => {
                    (TRAY_ICON_RED, format!(" {country} · БЛОК"), "🔴")
                }
            }
        };

        let _ = tray.set_title(Some(&status_label));

        let tooltip = format!(
            "AI-AntiBan {dot} IP: {} ({}) · Траст: {}% · DNSBL: {}",
            report.telemetry.ip, country, score, report.dnsbl_clean_count
        );
        let _ = tray.set_tooltip(Some(&tooltip));

        if let Ok(img) = Image::from_bytes(icon_bytes) {
            let _ = tray.set_icon(Some(img));
        }
    }
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Привет, {}! AI-AntiBan активен.", name)
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
    guard: tauri::State<'_, std::sync::Arc<proxy::NetworkGuard>>,
    app: tauri::AppHandle,
    force_refresh: Option<bool>,
) -> Result<auditor::RiskReport, String> {
    let provider_id = auditor::ProviderId::from_id(&provider)
        .ok_or_else(|| format!("Неизвестный провайдер: {provider}"))?;
    let report = auditor
        .evaluate_all(provider_id, &state, force_refresh.unwrap_or(false))
        .await?;

    // Sync system tray status whenever Anthropic or primary audit runs
    if provider_id == auditor::ProviderId::Anthropic || force_refresh.unwrap_or(false) {
        let st = state.get_data().await;
        let is_pinned = st
            .pinned_ip
            .as_ref()
            .map(|p| p.trim() == report.telemetry.ip.trim())
            .unwrap_or(false);
        let has_blocked =
            !st.blocked_providers.is_empty() || guard.gate() != proxy::Gate::Open;
        update_tray_from_report(&app, &report, is_pinned, has_blocked);
    }

    Ok(report)
}

#[tauri::command]
async fn clean_app_cache(
    provider: String,
) -> Result<auditor::cache_cleaner::CleanResult, String> {
    let provider_id = auditor::ProviderId::from_id(&provider)
        .ok_or_else(|| format!("Неизвестный провайдер: {provider}"))?;
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
async fn allow_provider_session(
    provider: String,
    state: tauri::State<'_, state::AppState>,
    auditor: tauri::State<'_, auditor::Auditor>,
    proxy_manager: tauri::State<'_, proxy::ProxyManager>,
) -> Result<(), String> {
    state
        .allow_provider_for_session(&provider)
        .await
        .map_err(|e| e.to_string())?;

    // Record current IP in history so Impossible Travel is acknowledged and cleared
    if let Some(provider_id) = auditor::ProviderId::from_id(&provider) {
        if let Ok(tel) = auditor.resolver.resolve(false).await {
            let entry = state::IpHistoryEntry::new(
                tel.ip,
                tel.country_code,
                tel.asn,
                tel.resolved_at,
            );
            let _ = state.record_ip_history(provider_id.as_str(), entry).await;
        }
    }

    proxy_manager
        .hold_queue
        .resolve_all_for_provider(&provider, proxy::HoldResolution::Allow)
        .await;

    // If traffic was frozen after a network change, the user's manual confirmation resumes it
    proxy_manager.guard.accept_current().await;

    Ok(())
}

#[tauri::command]
async fn unblock_provider_cmd(
    provider: String,
    state: tauri::State<'_, state::AppState>,
    auditor: tauri::State<'_, auditor::Auditor>,
) -> Result<(), String> {
    state
        .unblock_provider(&provider)
        .await
        .map_err(|e| e.to_string())?;

    // Also update IP history to current IP so a stale Impossible Travel doesn't immediately re-flag
    if let Some(provider_id) = auditor::ProviderId::from_id(&provider) {
        if let Ok(tel) = auditor.resolver.resolve(false).await {
            let entry = state::IpHistoryEntry::new(
                tel.ip,
                tel.country_code,
                tel.asn,
                tel.resolved_at,
            );
            let _ = state.record_ip_history(provider_id.as_str(), entry).await;
        }
    }

    Ok(())
}

#[tauri::command]
async fn resolve_interception(
    id: String,
    action: proxy::InterceptionAction,
    provider: String,
    scope: Option<String>,
    proxy_manager: tauri::State<'_, proxy::ProxyManager>,
    state: tauri::State<'_, state::AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // `all` or scope "network" = network-wide hold created by the network guard after a sudden IP change
    let is_network_scope = scope.as_deref() == Some("network") || provider == proxy::ALL_PROVIDERS;
    let targets: Vec<String> = if is_network_scope {
        state::KNOWN_PROVIDERS.iter().map(|p| p.to_string()).collect()
    } else {
        vec![provider.clone()]
    };

    match action {
        proxy::InterceptionAction::AllowSession => {
            for p in &targets {
                state
                    .allow_provider_for_session(p)
                    .await
                    .map_err(|e| e.to_string())?;
            }
            proxy_manager
                .hold_queue
                .resolve(&id, proxy::HoldResolution::Allow)
                .await;
            for p in targets.iter().map(String::as_str).chain([proxy::ALL_PROVIDERS]) {
                proxy_manager
                    .hold_queue
                    .resolve_all_for_provider(p, proxy::HoldResolution::Allow)
                    .await;
            }
            if is_network_scope {
                proxy_manager.guard.accept_current().await;
            }
        }
        proxy::InterceptionAction::BlockUntilNetworkChange => {
            for p in &targets {
                state.block_provider(p).await.map_err(|e| e.to_string())?;
            }
            proxy_manager
                .hold_queue
                .resolve(&id, proxy::HoldResolution::Block)
                .await;
            for p in targets.iter().map(String::as_str).chain([proxy::ALL_PROVIDERS]) {
                proxy_manager
                    .hold_queue
                    .resolve_all_for_provider(p, proxy::HoldResolution::Block)
                    .await;
            }
        }
        proxy::InterceptionAction::OpenGuideAndBlock => {
            for p in &targets {
                state.block_provider(p).await.map_err(|e| e.to_string())?;
            }
            proxy_manager
                .hold_queue
                .resolve(&id, proxy::HoldResolution::Block)
                .await;
            for p in targets.iter().map(String::as_str).chain([proxy::ALL_PROVIDERS]) {
                proxy_manager
                    .hold_queue
                    .resolve_all_for_provider(p, proxy::HoldResolution::Block)
                    .await;
            }
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
    let _ = app.emit("interceptor://resolved", "");

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
        "Строгая привязка IP отключена. Трафик идет через публичный коммерческий VPN-пул.",
        Some(auditor::geo_matrix::GUIDE_PERSONAL_VPN.to_string()),
    );
    let travel_result = auditor::CheckResult::ok("TRAVEL_NORMAL", "Конфликтов перемещения за 12ч нет.");
    let dnsbl_report = auditor::check_all_dnsbl(&telemetry.ip, &dangerous_asns).await;
    let dnsbl_result = auditor::evaluate_dnsbl_report(&dnsbl_report);
    let asn_result = auditor::evaluate_asn_reputation(
        telemetry.asn,
        telemetry.isp.as_deref(),
        telemetry.org.as_deref(),
        &dangerous_asns,
        false,
    );
    let ipv6_result = auditor::CheckResult::ok("IPV6_SAFE", "Утечек по протоколу IPv6 не обнаружено.");
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
        host: "api.anthropic.com:443".to_string(),
        report,
        ttl_seconds: proxy::hold_queue::DEFAULT_HOLD_TTL_SECS,
        scope: "provider".to_string(),
        network_change: None,
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
            let auditor_for_proxy = risk_auditor.clone();
            let state_for_proxy = app_state.clone();
            let (guard_for_watcher, pac_url) = tauri::async_runtime::block_on(async {
                let proxy_mgr = proxy::ProxyManager::start(
                    auditor_for_proxy,
                    state_for_proxy,
                    Some(handle_clone),
                )
                .await
                .expect("Failed to start proxy server");
                let guard = proxy_mgr.guard.clone();
                let pac_url = format!("http://{}/proxy.pac", proxy_mgr.server.bound_addr);
                app.manage(proxy_mgr);
                (guard, pac_url)
            });
            app.manage(guard_for_watcher.clone());

            // Protection is ON by default: route AI domains through the local interceptor
            match sysproxy::enable_sysproxy(&pac_url) {
                Ok(status) => println!(
                    "AI-AntiBan: защита включена ({} сетевых служб)",
                    status.services_configured.len()
                ),
                Err(e) => eprintln!("AI-AntiBan: не удалось включить защиту при старте: {e}"),
            }

            // Network guard: detects sudden IP changes and freezes AI traffic until confirmed
            guard_for_watcher.start(proxy::GuardCtx {
                auditor: risk_auditor.clone(),
                state: app_state.clone(),
                hold_queue: app.state::<proxy::ProxyManager>().hold_queue.clone(),
                app: app.handle().clone(),
            });

            // Native Russian tray menu with live actions
            let status_i = MenuItem::with_id(
                app,
                "status_header",
                "🛡️ AI-AntiBan: Защитный шлюз активен",
                false,
                None::<&str>,
            )?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let show_i = MenuItem::with_id(
                app,
                "show",
                "Открыть панель мониторинга (Пульс)",
                true,
                None::<&str>,
            )?;
            let rescan_i = MenuItem::with_id(
                app,
                "rescan",
                "↻ Перепроверить соединение (2ip / DNSBL)",
                true,
                None::<&str>,
            )?;
            let pin_i = MenuItem::with_id(
                app,
                "pin_ip",
                "📌 Закрепить текущий IP как личный VPS",
                true,
                None::<&str>,
            )?;
            let guide_i = MenuItem::with_id(
                app,
                "open_guide",
                "⚡ Гайд: Свой чистый VPN за 15 минут",
                true,
                None::<&str>,
            )?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(
                app,
                "quit",
                "Выйти и отключить PAC-перехват",
                true,
                None::<&str>,
            )?;

            let menu = Menu::with_items(
                app,
                &[
                    &status_i,
                    &sep1,
                    &show_i,
                    &rescan_i,
                    &pin_i,
                    &guide_i,
                    &sep2,
                    &quit_i,
                ],
            )?;

            let mut tray_builder = TrayIconBuilder::with_id(MAIN_TRAY_ID)
                .menu(&menu)
                .title(" ···")
                .tooltip("AI-AntiBan — Аудитор рисков для Claude, ChatGPT и Gemini")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
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
                    "rescan" => {
                        let _ = app.emit("tray://rescan", ());
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "pin_ip" => {
                        let _ = app.emit("tray://pin-current-ip", ());
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "open_guide" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                            let _ = app.emit("interceptor://open-guide", "01-personal-vpn-15min");
                        }
                    }
                    _ => {}
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
                });

            if let Ok(initial_icon) = Image::from_bytes(TRAY_ICON_GREEN) {
                tray_builder = tray_builder.icon(initial_icon);
            }

            let _tray = tray_builder.build(app)?;

            // Background tray status updater (network changes are handled by the NetworkGuard)
            let watcher_handle = app.handle().clone();
            let watcher_auditor = risk_auditor.clone();
            let watcher_state = app_state.clone();
            let watcher_guard = guard_for_watcher;
            tauri::async_runtime::spawn(async move {
                loop {
                    if let Ok(report) = watcher_auditor
                        .evaluate_all(auditor::ProviderId::Anthropic, &watcher_state, false)
                        .await
                    {
                        let st = watcher_state.get_data().await;
                        let is_pinned = st
                            .pinned_ip
                            .as_ref()
                            .map(|p| p.trim() == report.telemetry.ip.trim())
                            .unwrap_or(false);
                        let has_blocked = !st.blocked_providers.is_empty()
                            || watcher_guard.gate() != proxy::Gate::Open;

                        update_tray_from_report(&watcher_handle, &report, is_pinned, has_blocked);
                    }
                    tokio::time::sleep(Duration::from_secs(10)).await;
                }
            });

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
            allow_provider_session,
            unblock_provider_cmd,
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
