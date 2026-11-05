use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use uuid::Uuid;

use crate::auditor::geo_matrix::ProviderId;
use crate::auditor::{Auditor, OverallStatus};
use crate::proxy::guard::{gate_closed, wait_open, Gate, NetworkGuard};
use crate::proxy::hold_queue::{
    HoldQueue, HoldResolution, RiskInterceptPayload, DEFAULT_HOLD_TTL_SECS,
};
use crate::proxy::pac::{generate_pac_script, get_all_ai_domains};
use crate::state::{AppState, IpHistoryEntry};

pub const DEFAULT_PROXY_PORT: u16 = 8899;
pub const FALLBACK_PROXY_PORT: u16 = 8900;
const FIRST_REQUEST_TIMEOUT_SECS: u64 = 10;
const UPSTREAM_CONNECT_TIMEOUT_SECS: u64 = 15;

pub struct ProxyServer {
    pub bound_addr: SocketAddr,
    listener: TcpListener,
    auditor: Auditor,
    state: AppState,
    pub hold_queue: Arc<HoldQueue>,
    pub guard: Arc<NetworkGuard>,
    app_handle: Option<tauri::AppHandle>,
    pub upstream_redirect: Option<SocketAddr>,
}

impl ProxyServer {
    /// Attempts to bind to 127.0.0.1:8899, with fallback to 8900 or ephemeral port.
    pub async fn bind(
        auditor: Auditor,
        state: AppState,
        hold_queue: Arc<HoldQueue>,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<Self, std::io::Error> {
        let listener = match TcpListener::bind(format!("127.0.0.1:{DEFAULT_PROXY_PORT}")).await {
            Ok(l) => l,
            Err(_) => match TcpListener::bind(format!("127.0.0.1:{FALLBACK_PROXY_PORT}")).await {
                Ok(l) => l,
                Err(_) => TcpListener::bind("127.0.0.1:0").await?,
            },
        };

        let bound_addr = listener.local_addr()?;

        Ok(Self {
            bound_addr,
            listener,
            auditor,
            state,
            hold_queue,
            guard: Arc::new(NetworkGuard::new()),
            app_handle,
            upstream_redirect: None,
        })
    }

    /// Binds to an ephemeral port (127.0.0.1:0) for isolated integration testing.
    pub async fn bind_ephemeral(
        auditor: Auditor,
        state: AppState,
        hold_queue: Arc<HoldQueue>,
        upstream_redirect: Option<SocketAddr>,
    ) -> Result<Self, std::io::Error> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let bound_addr = listener.local_addr()?;

        Ok(Self {
            bound_addr,
            listener,
            auditor,
            state,
            hold_queue,
            guard: Arc::new(NetworkGuard::new()),
            app_handle: None,
            upstream_redirect,
        })
    }

    /// Runs the proxy accept loop in the background.
    pub async fn run(self: Arc<Self>) {
        loop {
            match self.listener.accept().await {
                Ok((stream, client_addr)) => {
                    let server = Arc::clone(&self);
                    tokio::spawn(async move {
                        if let Err(err) = server.handle_connection(stream, client_addr).await {
                            eprintln!("Proxy connection error from {client_addr}: {err}");
                        }
                    });
                }
                Err(e) => {
                    eprintln!("Proxy accept error: {e}");
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        }
    }

    async fn handle_connection(
        &self,
        mut client: TcpStream,
        _client_addr: SocketAddr,
    ) -> Result<(), std::io::Error> {
        let mut buffer = [0u8; 4096];
        let bytes_read = match tokio::time::timeout(
            Duration::from_secs(FIRST_REQUEST_TIMEOUT_SECS),
            client.read(&mut buffer),
        )
        .await
        {
            Ok(res) => res?,
            Err(_) => return Ok(()), // idle / slow client: drop silently
        };
        if bytes_read == 0 {
            return Ok(());
        }

        let request_str = String::from_utf8_lossy(&buffer[..bytes_read]);
        let mut lines = request_str.lines();
        let request_line = match lines.next() {
            Some(l) => l,
            None => return Ok(()),
        };

        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or("");
        let target = parts.next().unwrap_or("");

        // 1. Route GET /proxy.pac (supports relative "/proxy.pac" or full "http://127.0.0.1:8899/proxy.pac")
        if method == "GET" && (target.starts_with("/proxy.pac") || target.contains("/proxy.pac")) {
            return self.handle_pac_request(&mut client).await;
        }

        // 2. Route CONNECT <host>:<port>
        if method == "CONNECT" {
            return self.handle_connect_request(&mut client, target).await;
        }

        // Generic HTTP health / info response
        let resp = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 23\r\nConnection: close\r\n\r\nZastava Gateway Active\n";
        client.write_all(resp.as_bytes()).await?;
        client.flush().await?;
        Ok(())
    }

    async fn handle_pac_request(&self, client: &mut TcpStream) -> Result<(), std::io::Error> {
        let matrix = self.auditor.rules.provider_matrix.read().await;
        let domains = get_all_ai_domains(&matrix);
        let pac_script = generate_pac_script(&domains, &self.bound_addr.to_string());

        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/x-ns-proxy-autoconfig\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            pac_script.len(),
            pac_script
        );

        client.write_all(response.as_bytes()).await?;
        client.flush().await?;
        Ok(())
    }

    async fn handle_connect_request(
        &self,
        client: &mut TcpStream,
        raw_target: &str,
    ) -> Result<(), std::io::Error> {
        let (host, port) = parse_host_port(raw_target);
        let provider_opt = ProviderId::from_host(&host);

        let provider = match provider_opt {
            Some(p) => p,
            None => {
                // Reject non-AI domains on local proxy to prevent open-proxy SSRF abuse
                return send_forbidden(
                    client,
                    "Zastava local gateway only routes authorized AI provider domains.",
                )
                .await;
            }
        };

        // Step 0: Network guard — a sudden IP change freezes every connection until the
        // user confirms the new network (or the old IP comes back).
        self.guard.ensure_fresh().await;
        match self.guard.gate() {
            Gate::Open => {}
            Gate::Pending => {
                if self.guard.await_decision().await != Gate::Open {
                    return send_forbidden(
                        client,
                        "Network change blocked by Zastava Risk Auditor: connection was not confirmed.",
                    )
                    .await;
                }
            }
            Gate::Blocked => {
                return send_forbidden(
                    client,
                    "Network change blocked by Zastava Risk Auditor: switch back to the trusted IP or confirm the new network.",
                )
                .await;
            }
        }

        // Step 1: Check if provider is blocked
        if self.state.is_provider_blocked(provider.as_str()).await {
            return send_forbidden(client, "Requests to this provider are blocked until network change.").await;
        }

        // Step 2: Check if provider has active session allowance
        if self.state.is_provider_session_allowed(provider.as_str()).await {
            return self.tunnel_to_target(client, &host, port).await;
        }

        // Step 3: Run comprehensive risk audit
        let report = match self.auditor.evaluate_all(provider, &self.state, false).await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("Auditor evaluation failed: {e}");
                // In case of auditor error, fall back to hold for safety
                return send_forbidden(client, &format!("Audit error: {e}")).await;
            }
        };

        // Step 4: If verdict is Green -> allow and record history
        if report.overall_status == OverallStatus::Green {
            let entry = IpHistoryEntry::new(
                report.telemetry.ip.clone(),
                report.telemetry.country_code.clone(),
                report.telemetry.asn,
                report.telemetry.resolved_at,
            );
            let _ = self.state.record_ip_history(provider.as_str(), entry).await;
            return self.tunnel_to_target(client, &host, port).await;
        }

        // Step 5: If verdict is Yellow or Red -> HOLD connection and alert UI
        let hold_id = Uuid::new_v4().to_string();
        let rx = self.hold_queue.register(hold_id.clone(), provider.as_str()).await;

        let payload = RiskInterceptPayload {
            id: hold_id.clone(),
            provider,
            host: host.clone(),
            report: report.clone(),
            ttl_seconds: DEFAULT_HOLD_TTL_SECS,
            scope: "provider".to_string(),
            network_change: None,
        };

        // Emit event to UI and bring emergency modal to front
        if let Some(app) = &self.app_handle {
            let _ = app.emit("interceptor://risk-detected", &payload);
            if let Some(popup) = app.get_webview_window("alert-popup") {
                let _ = popup.show();
                let _ = popup.unminimize();
                let _ = popup.set_always_on_top(true);
                let _ = popup.center();
                let _ = popup.set_focus();
            } else if let Some(main_win) = app.get_webview_window("main") {
                let _ = main_win.show();
                let _ = main_win.set_focus();
            }
        }

        // Wait up to 60 seconds for user action
        let resolution = tokio::time::timeout(
            Duration::from_secs(DEFAULT_HOLD_TTL_SECS),
            rx,
        ).await;

        match resolution {
            Ok(Ok(HoldResolution::Allow)) => {
                let entry = IpHistoryEntry::new(
                    report.telemetry.ip.clone(),
                    report.telemetry.country_code.clone(),
                    report.telemetry.asn,
                    report.telemetry.resolved_at,
                );
                let _ = self.state.record_ip_history(provider.as_str(), entry).await;
                self.tunnel_to_target(client, &host, port).await
            }
            _ => {
                self.hold_queue.remove(&hold_id).await;
                send_forbidden(
                    client,
                    "Connection held and blocked by Zastava Risk Auditor.",
                ).await
            }
        }
    }

    async fn tunnel_to_target(
        &self,
        client: &mut TcpStream,
        host: &str,
        port: u16,
    ) -> Result<(), std::io::Error> {
        let connect_res = match self.upstream_redirect {
            Some(redirect_addr) => tokio::time::timeout(
                Duration::from_secs(UPSTREAM_CONNECT_TIMEOUT_SECS),
                TcpStream::connect(redirect_addr),
            )
            .await,
            None => tokio::time::timeout(
                Duration::from_secs(UPSTREAM_CONNECT_TIMEOUT_SECS),
                TcpStream::connect((host, port)),
            )
            .await,
        };
        let connect_fut = match connect_res {
            Ok(res) => res,
            Err(_) => Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "upstream connect timeout",
            )),
        };

        let mut target_stream = match connect_fut {
            Ok(s) => s,
            Err(e) => {
                let err_msg = format!("Failed to connect to target {host}:{port}: {e}");
                let resp = format!(
                    "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    err_msg.len(),
                    err_msg
                );
                client.write_all(resp.as_bytes()).await?;
                client.flush().await?;
                return Err(e);
            }
        };

        client
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await?;
        client.flush().await?;

        pump(client, &mut target_stream, &self.guard).await
    }
}

/// Bidirectional relay that obeys the network guard: while the gate is closed no byte is
/// forwarded in either direction, so established sessions simply "hang" like a dead network
/// and are dropped after `MAX_STALL_SECS` unless the user confirms the new network.
async fn pump(
    client: &mut TcpStream,
    target: &mut TcpStream,
    guard: &Arc<NetworkGuard>,
) -> Result<(), std::io::Error> {
    let (mut cr, mut cw) = client.split();
    let (mut tr, mut tw) = target.split();
    let c2t = forward(&mut cr, &mut tw, guard);
    let t2c = forward(&mut tr, &mut cw, guard);
    tokio::try_join!(c2t, t2c)?;
    Ok(())
}

async fn forward<R, W>(
    reader: &mut R,
    writer: &mut W,
    guard: &Arc<NetworkGuard>,
) -> Result<(), std::io::Error>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut rx = guard.subscribe();
    let mut buf = vec![0u8; 16 * 1024];
    let stalled = || {
        std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "tunnel stalled: network change not confirmed",
        )
    };

    loop {
        if !wait_open(&mut rx).await {
            return Err(stalled());
        }

        let n = tokio::select! {
            res = reader.read(&mut buf) => res?,
            _ = gate_closed(&mut rx) => continue,
        };

        if n == 0 {
            let _ = writer.shutdown().await;
            return Ok(());
        }

        // Data read right before the freeze is held back until the user decides.
        if !wait_open(&mut rx).await {
            return Err(stalled());
        }
        writer.write_all(&buf[..n]).await?;
    }
}

fn parse_host_port(target: &str) -> (String, u16) {
    if let Some((h, p)) = target.rsplit_once(':') {
        let port = p.parse::<u16>().unwrap_or(443);
        (h.to_string(), port)
    } else {
        (target.to_string(), 443)
    }
}

async fn send_forbidden(client: &mut TcpStream, reason: &str) -> Result<(), std::io::Error> {
    let resp = format!(
        "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        reason.len(),
        reason
    );
    client.write_all(resp.as_bytes()).await?;
    client.flush().await?;
    Ok(())
}
