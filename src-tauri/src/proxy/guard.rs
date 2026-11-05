//! Network guard: detects sudden egress-IP changes (VPN switch, reconnect, roaming),
//! freezes ALL AI traffic (new and already established tunnels) and asks the user
//! to confirm the new network before anything is forwarded again.

use std::net::IpAddr;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};
use tokio::sync::{watch, Mutex};
use uuid::Uuid;

use crate::auditor::geo_matrix::ProviderId;
use crate::auditor::{Auditor, NetworkTelemetry, OverallStatus, RiskReport};
use crate::proxy::hold_queue::{
    HoldQueue, HoldResolution, NetworkChange, RiskInterceptPayload, DEFAULT_HOLD_TTL_SECS,
};
use crate::state::{AppState, IpHistoryEntry, KNOWN_PROVIDERS};

/// How often the egress IP is probed.
pub const PROBE_INTERVAL_MS: u64 = 3000;
/// Minimum gap between two probes (protects against a probe per CONNECT).
pub const PROBE_MIN_GAP_MS: u64 = 1000;
/// How long an established tunnel may stall before it is dropped (looks like a dead network).
pub const MAX_STALL_SECS: u64 = 90;
/// Pseudo provider id used for network-wide holds.
pub const ALL_PROVIDERS: &str = "all";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gate {
    /// Traffic flows normally.
    Open,
    /// Network changed, waiting for the user's decision.
    Pending,
    /// User refused the new network: traffic stays frozen until the IP is restored or confirmed.
    Blocked,
}

#[derive(Clone)]
pub struct GuardCtx {
    pub auditor: Auditor,
    pub state: AppState,
    pub hold_queue: Arc<HoldQueue>,
    pub app: tauri::AppHandle,
}

#[derive(Clone)]
struct Baseline {
    ip: String,
    country: Option<String>,
}

struct Pending {
    id: String,
}

#[derive(Default)]
struct Inner {
    baseline: Option<Baseline>,
    observed_ip: Option<String>,
    /// IP of the network the user has already been asked about (avoids popup loops).
    handled_ip: Option<String>,
    pending: Option<Pending>,
    last_probe: Option<Instant>,
}

pub struct NetworkGuard {
    gate_tx: watch::Sender<Gate>,
    inner: Mutex<Inner>,
    ctx: OnceLock<GuardCtx>,
    client: reqwest::Client,
}

impl Default for NetworkGuard {
    fn default() -> Self {
        Self::new()
    }
}

fn severity(report: &RiskReport) -> u8 {
    match report.overall_status {
        OverallStatus::Red => 2,
        OverallStatus::Yellow => 1,
        OverallStatus::Green => 0,
    }
}

async fn audit_all(ctx: &GuardCtx) -> Result<Vec<RiskReport>, String> {
    // First call forces a fresh geo lookup, the others reuse the freshly filled cache.
    let anthropic = ctx
        .auditor
        .evaluate_all(ProviderId::Anthropic, &ctx.state, true)
        .await?;
    let (openai, gemini) = tokio::join!(
        ctx.auditor
            .evaluate_all(ProviderId::Openai, &ctx.state, false),
        ctx.auditor
            .evaluate_all(ProviderId::Gemini, &ctx.state, false)
    );
    Ok(vec![anthropic, openai?, gemini?])
}

/// Waits until the gate is open. Returns `false` when the stall limit is exceeded.
pub async fn wait_open(rx: &mut watch::Receiver<Gate>) -> bool {
    let fut = async {
        loop {
            if *rx.borrow_and_update() == Gate::Open {
                return true;
            }
            if rx.changed().await.is_err() {
                return false;
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(MAX_STALL_SECS), fut)
        .await
        .unwrap_or(false)
}

/// Completes as soon as the gate leaves the `Open` state.
pub async fn gate_closed(rx: &mut watch::Receiver<Gate>) {
    loop {
        if *rx.borrow_and_update() != Gate::Open {
            return;
        }
        if rx.changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }
}

impl NetworkGuard {
    pub fn new() -> Self {
        let (gate_tx, _rx) = watch::channel(Gate::Open);
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(2000))
            // Never reuse keep-alive sockets: they may still point to the previous route.
            .pool_max_idle_per_host(0)
            .user_agent("Zastava/1.0")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            gate_tx,
            inner: Mutex::new(Inner::default()),
            ctx: OnceLock::new(),
            client,
        }
    }

    pub fn gate(&self) -> Gate {
        *self.gate_tx.borrow()
    }

    pub fn subscribe(&self) -> watch::Receiver<Gate> {
        self.gate_tx.subscribe()
    }

    fn set_gate(&self, gate: Gate) {
        self.gate_tx.send_replace(gate);
    }

    /// Used by new CONNECT requests: waits for the user's decision while the gate is pending.
    pub async fn await_decision(&self) -> Gate {
        let mut rx = self.gate_tx.subscribe();
        let fut = async {
            loop {
                let g = *rx.borrow_and_update();
                if g != Gate::Pending {
                    return g;
                }
                if rx.changed().await.is_err() {
                    return Gate::Blocked;
                }
            }
        };
        tokio::time::timeout(Duration::from_secs(DEFAULT_HOLD_TTL_SECS + 15), fut)
            .await
            .unwrap_or(Gate::Blocked)
    }

    /// Starts the background monitor (call once from the Tauri setup hook).
    pub fn start(self: &Arc<Self>, ctx: GuardCtx) {
        if self.ctx.set(ctx).is_err() {
            return;
        }
        let guard = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let mut n: u64 = 0;
            loop {
                if let Some(ctx) = guard.ctx.get() {
                    guard.tick(ctx).await;
                    if n % 5 == 0 {
                        let _ = tokio::task::spawn_blocking(
                            crate::sysproxy::refresh_if_services_changed,
                        )
                        .await;
                    }
                }
                n += 1;
                tokio::time::sleep(Duration::from_millis(PROBE_INTERVAL_MS)).await;
            }
        });
    }

    /// Cheap pre-flight check used by every new CONNECT (no-op when the monitor is not running).
    pub async fn ensure_fresh(self: &Arc<Self>) {
        if let Some(ctx) = self.ctx.get() {
            self.tick(ctx).await;
        }
    }

    /// Fetches the current egress IP (Cloudflare trace, falls back to ipify).
    async fn probe_ip(&self) -> Option<String> {
        if let Ok(resp) = self.client.get("https://1.1.1.1/cdn-cgi/trace").send().await {
            if let Ok(text) = resp.text().await {
                for line in text.lines() {
                    if let Some(val) = line.strip_prefix("ip=") {
                        let val = val.trim();
                        if val.parse::<IpAddr>().is_ok() {
                            return Some(val.to_string());
                        }
                    }
                }
            }
        }
        if let Ok(resp) = self.client.get("https://api.ipify.org").send().await {
            if let Ok(text) = resp.text().await {
                let val = text.trim();
                if val.parse::<IpAddr>().is_ok() {
                    return Some(val.to_string());
                }
            }
        }
        None
    }

    pub async fn tick(self: &Arc<Self>, ctx: &GuardCtx) {
        let mut inner = self.inner.lock().await;

        if let Some(t) = inner.last_probe {
            if t.elapsed() < Duration::from_millis(PROBE_MIN_GAP_MS) {
                return;
            }
        }
        let probed = self.probe_ip().await;
        inner.last_probe = Some(Instant::now());
        let Some(ip) = probed else {
            return; // offline: nothing to compare
        };
        inner.observed_ip = Some(ip.clone());

        let Some(baseline_ip) = inner.baseline.as_ref().map(|b| b.ip.clone()) else {
            let country = ctx
                .auditor
                .resolver
                .resolve(true)
                .await
                .ok()
                .map(|t| t.country_code);
            inner.baseline = Some(Baseline { ip, country });
            return;
        };

        if ip == baseline_ip {
            if self.gate() != Gate::Open {
                self.restore_locked(ctx, &mut inner).await;
            } else {
                inner.handled_ip = None;
            }
            return;
        }

        if inner.handled_ip.as_deref() == Some(ip.as_str()) {
            return; // user already decided about this network
        }

        self.handle_change_locked(ctx, &mut inner, ip).await;
    }

    async fn handle_change_locked(
        self: &Arc<Self>,
        ctx: &GuardCtx,
        inner: &mut Inner,
        new_ip: String,
    ) {
        // 1. Freeze everything immediately.
        self.set_gate(Gate::Pending);
        if let Some(p) = inner.pending.take() {
            ctx.hold_queue.remove(&p.id).await;
        }

        // 2. Previous allowances / blocks belonged to the old network.
        let _ = ctx.state.clear_session_allowed_providers().await;
        let _ = ctx.state.clear_blocked_providers().await;
        ctx.auditor.resolver.invalidate_cache().await;

        // 3. Full re-audit of the new network.
        let reports = match audit_all(ctx).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("Network guard: audit of the new network failed: {e}");
                return; // gate stays closed, next tick retries
            }
        };
        inner.handled_ip = Some(new_ip.clone());

        let mut worst = &reports[0];
        for r in &reports[1..] {
            if severity(r) > severity(worst) {
                worst = r;
            }
        }
        let worst = worst.clone();
        let tel = worst.telemetry.clone();

        let st = ctx.state.get_data().await;
        let is_pinned = st
            .pinned_ip
            .as_deref()
            .map(|p| p.trim() == new_ip.trim() || p.trim() == tel.ip.trim())
            .unwrap_or(false);
        let all_green = reports
            .iter()
            .all(|r| r.overall_status == OverallStatus::Green);

        self.update_tray(ctx, &reports[0]).await;

        // Returning to the trusted pinned VPS with a clean audit needs no confirmation.
        if is_pinned && all_green {
            self.accept_locked(ctx, inner, &new_ip, &tel).await;
            return;
        }

        // 4. Ask the user (popup), traffic stays frozen.
        let id = Uuid::new_v4().to_string();
        let rx = ctx
            .hold_queue
            .register(id.clone(), ALL_PROVIDERS)
            .await;
        inner.pending = Some(Pending { id: id.clone() });

        let old = inner.baseline.clone();
        let payload = RiskInterceptPayload {
            id: id.clone(),
            provider: worst.provider,
            host: "Смена сети · все ИИ-сервисы".to_string(),
            report: worst.clone(),
            ttl_seconds: DEFAULT_HOLD_TTL_SECS,
            scope: "network".to_string(),
            network_change: Some(NetworkChange {
                old_ip: old.as_ref().map(|b| b.ip.clone()),
                old_country: old.as_ref().and_then(|b| b.country.clone()),
                new_ip: tel.ip.clone(),
                new_country: tel.country_code.clone(),
            }),
        };

        let _ = ctx.app.emit("interceptor://risk-detected", &payload);
        if let Some(popup) = ctx.app.get_webview_window("alert-popup") {
            let _ = popup.show();
            let _ = popup.unminimize();
            let _ = popup.set_always_on_top(true);
            let _ = popup.center();
            let _ = popup.set_focus();
        } else if let Some(main_win) = ctx.app.get_webview_window("main") {
            let _ = main_win.show();
            let _ = main_win.set_focus();
        }
        let _ = ctx.app.emit("network://changed", &worst);

        // 5. Wait for the decision in the background.
        let guard = Arc::clone(self);
        let ctx2 = ctx.clone();
        tauri::async_runtime::spawn(async move {
            let res = tokio::time::timeout(Duration::from_secs(DEFAULT_HOLD_TTL_SECS), rx).await;
            let allow = matches!(res, Ok(Ok(HoldResolution::Allow)));

            let mut inner = guard.inner.lock().await;
            let still_current = inner
                .pending
                .as_ref()
                .map(|p| p.id == id)
                .unwrap_or(false);
            if !still_current {
                return; // superseded by a newer change or already accepted/restored
            }
            inner.pending = None;
            ctx2.hold_queue.remove(&id).await;

            if allow {
                let ip = inner.observed_ip.clone().unwrap_or_else(|| tel.ip.clone());
                guard.accept_locked(&ctx2, &mut inner, &ip, &tel).await;
            } else {
                for p in KNOWN_PROVIDERS {
                    let _ = ctx2.state.block_provider(p).await;
                }
                guard.set_gate(Gate::Blocked);
                guard.hide_popup(&ctx2);
                guard.refresh_tray(&ctx2).await;
            }
        });
    }

    /// Confirms the current network as the new trusted baseline and resumes traffic.
    async fn accept_locked(
        &self,
        ctx: &GuardCtx,
        inner: &mut Inner,
        ip: &str,
        tel: &NetworkTelemetry,
    ) {
        inner.baseline = Some(Baseline {
            ip: ip.to_string(),
            country: Some(tel.country_code.clone()),
        });
        inner.handled_ip = None;
        if let Some(p) = inner.pending.take() {
            ctx.hold_queue.remove(&p.id).await;
        }

        let now = crate::auditor::network::current_timestamp();
        for p in KNOWN_PROVIDERS {
            let entry = IpHistoryEntry::new(tel.ip.clone(), tel.country_code.clone(), tel.asn, now);
            let _ = ctx.state.record_ip_history(p, entry).await;
        }

        self.set_gate(Gate::Open);
        self.hide_popup(ctx);
        let _ = ctx.app.emit("network://changed", ());
        self.refresh_tray(ctx).await;
    }

    /// The previous (trusted) IP is back: resume traffic.
    async fn restore_locked(&self, ctx: &GuardCtx, inner: &mut Inner) {
        if let Some(p) = inner.pending.take() {
            ctx.hold_queue.remove(&p.id).await;
        }
        inner.handled_ip = None;
        let _ = ctx.state.clear_blocked_providers().await;
        self.set_gate(Gate::Open);
        self.hide_popup(ctx);
        let _ = ctx.app.emit("network://changed", ());
        self.refresh_tray(ctx).await;
    }

    /// Manual override from the main window ("Разблокировать и разрешить доступ").
    pub async fn accept_current(self: &Arc<Self>) {
        let Some(ctx) = self.ctx.get() else {
            return;
        };
        let mut inner = self.inner.lock().await;
        if self.gate() == Gate::Open {
            return;
        }
        let Some(ip) = inner.observed_ip.clone() else {
            return;
        };
        if let Ok(tel) = ctx.auditor.resolver.resolve(false).await {
            self.accept_locked(ctx, &mut inner, &ip, &tel).await;
        }
    }

    fn hide_popup(&self, ctx: &GuardCtx) {
        if let Some(popup) = ctx.app.get_webview_window("alert-popup") {
            let _ = popup.hide();
        }
        let _ = ctx.app.emit("interceptor://resolved", "");
    }

    async fn update_tray(&self, ctx: &GuardCtx, report: &RiskReport) {
        let st = ctx.state.get_data().await;
        let is_pinned = st
            .pinned_ip
            .as_deref()
            .map(|p| p.trim() == report.telemetry.ip.trim())
            .unwrap_or(false);
        let held = self.gate() != Gate::Open || !st.blocked_providers.is_empty();
        crate::update_tray_from_report(&ctx.app, report, is_pinned, held);
    }

    async fn refresh_tray(&self, ctx: &GuardCtx) {
        if let Ok(report) = ctx
            .auditor
            .evaluate_all(ProviderId::Anthropic, &ctx.state, false)
            .await
        {
            self.update_tray(ctx, &report).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_gate_default_open_and_wait() {
        let guard = NetworkGuard::new();
        assert_eq!(guard.gate(), Gate::Open);

        let mut rx = guard.subscribe();
        assert!(wait_open(&mut rx).await);
    }

    #[tokio::test]
    async fn test_gate_pending_blocks_until_open() {
        let guard = Arc::new(NetworkGuard::new());
        guard.set_gate(Gate::Pending);

        let g2 = Arc::clone(&guard);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            g2.set_gate(Gate::Open);
        });

        let decision = guard.await_decision().await;
        assert_eq!(decision, Gate::Open);
    }

    #[tokio::test]
    async fn test_await_decision_returns_blocked() {
        let guard = Arc::new(NetworkGuard::new());
        guard.set_gate(Gate::Pending);

        let g2 = Arc::clone(&guard);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            g2.set_gate(Gate::Blocked);
        });

        assert_eq!(guard.await_decision().await, Gate::Blocked);
    }
}
