use std::net::{Ipv4Addr, Ipv6Addr};
use std::time::Duration;
use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use url::Url;

use crate::state::UpstreamProxyConfig;

/// Decodes base64 with standard or URL-safe engines, tolerating absent padding.
fn decode_base64_flexible(input: &str) -> Result<Vec<u8>, String> {
    let clean = input.trim().trim_matches('"');
    if clean.is_empty() {
        return Err("Empty base64 payload".to_string());
    }

    if let Ok(bytes) = STANDARD.decode(clean) {
        return Ok(bytes);
    }
    if let Ok(bytes) = STANDARD_NO_PAD.decode(clean) {
        return Ok(bytes);
    }
    if let Ok(bytes) = URL_SAFE.decode(clean) {
        return Ok(bytes);
    }
    if let Ok(bytes) = URL_SAFE_NO_PAD.decode(clean) {
        return Ok(bytes);
    }

    let rem = clean.len() % 4;
    if rem > 0 {
        let padded = format!("{}{}", clean, "=".repeat(4 - rem));
        if let Ok(bytes) = STANDARD.decode(&padded) {
            return Ok(bytes);
        }
        if let Ok(bytes) = URL_SAFE.decode(&padded) {
            return Ok(bytes);
        }
    }

    Err("Could not decode base64 with standard or URL-safe encoding".to_string())
}

#[derive(Debug, Deserialize)]
struct UpstreamJson {
    protocol: String,
    host: String,
    port: u16,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    label: Option<String>,
}

fn parse_json_key(json_str: &str, raw_key: &str) -> Result<UpstreamProxyConfig, String> {
    let json: UpstreamJson = serde_json::from_str(json_str)
        .map_err(|e| format!("Invalid JSON proxy config: {e}"))?;

    let proto = match json.protocol.to_ascii_lowercase().as_str() {
        "socks5" | "socks5h" => "socks5".to_string(),
        "http" => "http".to_string(),
        other => return Err(format!("Unsupported protocol in JSON: {other}")),
    };

    let host = json.host.trim().to_string();
    if host.is_empty() {
        return Err("Proxy host cannot be empty".to_string());
    }

    if json.port == 0 {
        return Err("Proxy port cannot be 0".to_string());
    }

    Ok(UpstreamProxyConfig {
        enabled: true,
        raw_key: raw_key.to_string(),
        protocol: proto,
        host,
        port: json.port,
        username: json.username.filter(|u| !u.is_empty()),
        password: json.password.filter(|p| !p.is_empty()),
        label: json.label.filter(|l| !l.is_empty()),
    })
}

fn percent_decode_clean(input: &str) -> String {
    url::form_urlencoded::parse(format!("v={}", input).as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_else(|| input.to_string())
}

fn parse_proxy_url(url_str: &str, raw_key: &str) -> Result<UpstreamProxyConfig, String> {
    let trimmed = url_str.trim();

    // Support unescaped spaces or Russian text in fragment (#Label)
    let (url_part, raw_fragment) = match trimmed.split_once('#') {
        Some((u, f)) => (u.trim(), Some(f.trim())),
        None => (trimmed, None),
    };

    let parsed = Url::parse(url_part)
        .map_err(|e| format!("Invalid proxy URL '{url_part}': {e}"))?;

    let protocol = match parsed.scheme().to_ascii_lowercase().as_str() {
        "socks5" | "socks5h" => "socks5".to_string(),
        "http" => "http".to_string(),
        other => return Err(format!("Unsupported proxy protocol '{other}'. Supported: socks5, http")),
    };

    let host = parsed
        .host_str()
        .ok_or_else(|| "Proxy URL missing host".to_string())?
        .trim()
        .to_string();

    if host.is_empty() {
        return Err("Proxy host cannot be empty".to_string());
    }

    let default_port = if protocol == "socks5" { 1080 } else { 80 };
    let port = parsed.port().unwrap_or(default_port);

    let username = if !parsed.username().is_empty() {
        Some(percent_decode_clean(parsed.username()))
    } else {
        None
    };

    let password = parsed.password().map(percent_decode_clean);

    let label = raw_fragment
        .filter(|f| !f.is_empty())
        .map(percent_decode_clean);

    Ok(UpstreamProxyConfig {
        enabled: true,
        raw_key: raw_key.to_string(),
        protocol,
        host,
        port,
        username,
        password,
        label,
    })
}

/// Parses a Zastava upstream proxy key or standard URL into an `UpstreamProxyConfig`.
/// Supported formats:
/// 1. `zastava://<base64>` (base64 JSON or standard socks5/http URL, with or without padding).
/// 2. `socks5://[user:pass@]host:port[#Label]` or `socks5h://...`
/// 3. `http://[user:pass@]host:port[#Label]`
pub fn parse_upstream_key(input: &str) -> Result<UpstreamProxyConfig, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Upstream gateway key cannot be empty".to_string());
    }

    if let Some(rest) = trimmed.strip_prefix("zastava://") {
        let decoded_bytes = decode_base64_flexible(rest)
            .map_err(|e| format!("Invalid zastava:// base64 payload: {e}"))?;
        let decoded_str = String::from_utf8(decoded_bytes)
            .map_err(|e| format!("zastava:// payload is not valid UTF-8: {e}"))?;
        let decoded_trimmed = decoded_str.trim();

        if decoded_trimmed.starts_with('{') {
            if let Ok(cfg) = parse_json_key(decoded_trimmed, trimmed) {
                return Ok(cfg);
            }
        }

        parse_proxy_url(decoded_trimmed, trimmed)
    } else {
        parse_proxy_url(trimmed, trimmed)
    }
}

async fn connect_socks5(
    cfg: &UpstreamProxyConfig,
    target_host: &str,
    target_port: u16,
    timeout: Duration,
) -> Result<TcpStream, std::io::Error> {
    tokio::time::timeout(timeout, async {
        let mut stream = TcpStream::connect((cfg.host.as_str(), cfg.port)).await?;

        // 1. Send SOCKS5 greeting (RFC 1928)
        let has_auth = cfg.username.is_some();
        if has_auth {
            // Offer NO_AUTH (0x00) and USER_PASS (0x02)
            stream.write_all(&[0x05, 0x02, 0x00, 0x02]).await?;
        } else {
            // Offer only NO_AUTH (0x00)
            stream.write_all(&[0x05, 0x01, 0x00]).await?;
        }
        stream.flush().await?;

        // 2. Read server method choice
        let mut method_buf = [0u8; 2];
        stream.read_exact(&mut method_buf).await?;
        if method_buf[0] != 0x05 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Invalid SOCKS version: 0x{:02x}", method_buf[0]),
            ));
        }

        match method_buf[1] {
            0x00 => {
                // No authentication required
            }
            0x02 => {
                // Username/password authentication (RFC 1929)
                let username = cfg.username.as_deref().unwrap_or("");
                let password = cfg.password.as_deref().unwrap_or("");
                let u_bytes = username.as_bytes();
                let p_bytes = password.as_bytes();
                if u_bytes.len() > 255 || p_bytes.len() > 255 {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::InvalidInput,
                        "SOCKS5 username or password exceeds 255 bytes",
                    ));
                }
                let mut auth_packet = Vec::with_capacity(3 + u_bytes.len() + p_bytes.len());
                auth_packet.push(0x01); // Auth subnegotiation version 1
                auth_packet.push(u_bytes.len() as u8);
                auth_packet.extend_from_slice(u_bytes);
                auth_packet.push(p_bytes.len() as u8);
                auth_packet.extend_from_slice(p_bytes);

                stream.write_all(&auth_packet).await?;
                stream.flush().await?;

                let mut auth_resp = [0u8; 2];
                stream.read_exact(&mut auth_resp).await?;
                if auth_resp[0] != 0x01 || auth_resp[1] != 0x00 {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        format!("SOCKS5 authentication failed (status: 0x{:02x})", auth_resp[1]),
                    ));
                }
            }
            0xFF => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::ConnectionRefused,
                    "SOCKS5: No acceptable authentication methods offered by proxy server",
                ));
            }
            other => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("Unsupported SOCKS5 auth method selected by server: 0x{:02x}", other),
                ));
            }
        }

        // 3. Send CONNECT request (RFC 1928: CMD=0x01, RSV=0x00)
        let mut req = vec![0x05, 0x01, 0x00];
        if let Ok(ipv4) = target_host.parse::<Ipv4Addr>() {
            req.push(0x01); // ATYP IPv4
            req.extend_from_slice(&ipv4.octets());
        } else if let Ok(ipv6) = target_host.parse::<Ipv6Addr>() {
            req.push(0x04); // ATYP IPv6
            req.extend_from_slice(&ipv6.octets());
        } else {
            let domain_bytes = target_host.as_bytes();
            if domain_bytes.len() > 255 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    "Target domain exceeds 255 bytes",
                ));
            }
            req.push(0x03); // ATYP Domain name
            req.push(domain_bytes.len() as u8);
            req.extend_from_slice(domain_bytes);
        }
        req.extend_from_slice(&target_port.to_be_bytes());

        stream.write_all(&req).await?;
        stream.flush().await?;

        // 4. Read server CONNECT response
        // Format: VER (1), REP (1), RSV (1), ATYP (1), BND.ADDR (var), BND.PORT (2)
        let mut resp_header = [0u8; 4];
        stream.read_exact(&mut resp_header).await?;
        if resp_header[0] != 0x05 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Invalid SOCKS response version: 0x{:02x}", resp_header[0]),
            ));
        }

        let rep = resp_header[1];
        if rep != 0x00 {
            let msg = match rep {
                0x01 => "General SOCKS server failure",
                0x02 => "Connection not allowed by ruleset",
                0x03 => "Network unreachable",
                0x04 => "Host unreachable",
                0x05 => "Connection refused",
                0x06 => "TTL expired",
                0x07 => "Command not supported",
                0x08 => "Address type not supported",
                _ => "Unknown SOCKS error",
            };
            return Err(std::io::Error::new(
                std::io::ErrorKind::ConnectionRefused,
                format!("SOCKS5 connect failed: {msg} (code: 0x{:02x})", rep),
            ));
        }

        let atyp = resp_header[3];
        match atyp {
            0x01 => {
                // IPv4: 4 bytes addr + 2 bytes port
                let mut addr_port = [0u8; 6];
                stream.read_exact(&mut addr_port).await?;
            }
            0x03 => {
                // Domain: 1 byte len, len bytes domain, 2 bytes port
                let mut len_buf = [0u8; 1];
                stream.read_exact(&mut len_buf).await?;
                let dlen = len_buf[0] as usize;
                let mut rest = vec![0u8; dlen + 2];
                stream.read_exact(&mut rest).await?;
            }
            0x04 => {
                // IPv6: 16 bytes addr + 2 bytes port
                let mut addr_port = [0u8; 18];
                stream.read_exact(&mut addr_port).await?;
            }
            other => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("Unsupported address type in SOCKS response: 0x{:02x}", other),
                ));
            }
        }

        Ok(stream)
    })
    .await
    .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "SOCKS5 upstream connection timed out"))?
}

async fn connect_http(
    cfg: &UpstreamProxyConfig,
    target_host: &str,
    target_port: u16,
    timeout: Duration,
) -> Result<TcpStream, std::io::Error> {
    tokio::time::timeout(timeout, async {
        let mut stream = TcpStream::connect((cfg.host.as_str(), cfg.port)).await?;

        let mut req = format!(
            "CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\n"
        );

        if let Some(ref u) = cfg.username {
            let p = cfg.password.as_deref().unwrap_or("");
            let creds = format!("{u}:{p}");
            let encoded = STANDARD.encode(creds.as_bytes());
            req.push_str(&format!("Proxy-Authorization: Basic {encoded}\r\n"));
        }
        req.push_str("Proxy-Connection: Keep-Alive\r\n\r\n");

        stream.write_all(req.as_bytes()).await?;
        stream.flush().await?;

        // Read response headers byte-by-byte until \r\n\r\n to avoid buffering any target payload
        let mut header_bytes = Vec::with_capacity(512);
        let mut b = [0u8; 1];
        let mut matched = 0;
        let mut total_read = 0;

        while total_read < 8192 {
            let n = stream.read(&mut b).await?;
            if n == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "HTTP proxy closed connection prematurely",
                ));
            }
            total_read += 1;
            header_bytes.push(b[0]);

            match (matched, b[0]) {
                (0, b'\r') => matched = 1,
                (1, b'\n') => matched = 2,
                (2, b'\r') => matched = 3,
                (3, b'\n') => break,
                (_, b'\r') => matched = 1,
                _ => matched = 0,
            }
        }

        let resp_str = String::from_utf8_lossy(&header_bytes);
        let status_line = resp_str.lines().next().unwrap_or("");
        let mut parts = status_line.split_whitespace();
        let _http_ver = parts.next();
        let status_code = parts.next().unwrap_or("");

        if status_code != "200" {
            return Err(std::io::Error::new(
                std::io::ErrorKind::ConnectionRefused,
                format!("HTTP CONNECT proxy returned status {status_code}: {status_line}"),
            ));
        }

        Ok(stream)
    })
    .await
    .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "HTTP proxy upstream connection timed out"))?
}

/// Connects to a target host:port via an upstream SOCKS5 or HTTP gateway proxy.
pub async fn connect_via_upstream(
    cfg: &UpstreamProxyConfig,
    target_host: &str,
    target_port: u16,
    timeout: Duration,
) -> Result<TcpStream, std::io::Error> {
    match cfg.protocol.to_ascii_lowercase().as_str() {
        "socks5" => connect_socks5(cfg, target_host, target_port, timeout).await,
        "http" => connect_http(cfg, target_host, target_port, timeout).await,
        other => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!("Unsupported upstream proxy protocol: {other}"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[test]
    fn test_parse_socks5_url_direct() {
        let input = "socks5://user:pass@185.10.10.1:1080#Zastava%202-Hop%20(NL)";
        let cfg = parse_upstream_key(input).expect("parse failed");
        assert!(cfg.enabled);
        assert_eq!(cfg.protocol, "socks5");
        assert_eq!(cfg.host, "185.10.10.1");
        assert_eq!(cfg.port, 1080);
        assert_eq!(cfg.username.as_deref(), Some("user"));
        assert_eq!(cfg.password.as_deref(), Some("pass"));
        assert_eq!(cfg.label.as_deref(), Some("Zastava 2-Hop (NL)"));
    }

    #[test]
    fn test_parse_socks5h_and_unescaped_label() {
        let input = "socks5h://192.168.1.100:9050#Custom Gateway";
        let cfg = parse_upstream_key(input).expect("parse failed");
        assert_eq!(cfg.protocol, "socks5");
        assert_eq!(cfg.host, "192.168.1.100");
        assert_eq!(cfg.port, 9050);
        assert_eq!(cfg.username, None);
        assert_eq!(cfg.password, None);
        assert_eq!(cfg.label.as_deref(), Some("Custom Gateway"));
    }

    #[test]
    fn test_parse_http_url_direct() {
        let input = "http://admin:secret@proxy.org:8080#HTTP Gate";
        let cfg = parse_upstream_key(input).expect("parse failed");
        assert_eq!(cfg.protocol, "http");
        assert_eq!(cfg.host, "proxy.org");
        assert_eq!(cfg.port, 8080);
        assert_eq!(cfg.username.as_deref(), Some("admin"));
        assert_eq!(cfg.password.as_deref(), Some("secret"));
        assert_eq!(cfg.label.as_deref(), Some("HTTP Gate"));
    }

    #[test]
    fn test_parse_zastava_json_base64_standard() {
        let json = r#"{"protocol":"socks5","host":"45.1.2.3","port":1080,"username":"u1","password":"p1","label":"NL-Fast"}"#;
        let b64 = STANDARD.encode(json.as_bytes());
        let input = format!("zastava://{b64}");

        let cfg = parse_upstream_key(&input).expect("parse failed");
        assert_eq!(cfg.protocol, "socks5");
        assert_eq!(cfg.host, "45.1.2.3");
        assert_eq!(cfg.port, 1080);
        assert_eq!(cfg.username.as_deref(), Some("u1"));
        assert_eq!(cfg.password.as_deref(), Some("p1"));
        assert_eq!(cfg.label.as_deref(), Some("NL-Fast"));
        assert_eq!(cfg.raw_key, input);
    }

    #[test]
    fn test_parse_zastava_url_base64_url_safe_no_pad() {
        let url = "socks5://u2:p2@nl-node.example.com:1085#Zastava 2-Hop";
        let b64 = URL_SAFE_NO_PAD.encode(url.as_bytes());
        let input = format!("zastava://{b64}");

        let cfg = parse_upstream_key(&input).expect("parse failed");
        assert_eq!(cfg.protocol, "socks5");
        assert_eq!(cfg.host, "nl-node.example.com");
        assert_eq!(cfg.port, 1085);
        assert_eq!(cfg.username.as_deref(), Some("u2"));
        assert_eq!(cfg.password.as_deref(), Some("p2"));
        assert_eq!(cfg.label.as_deref(), Some("Zastava 2-Hop"));
    }

    #[test]
    fn test_parse_invalid_keys() {
        assert!(parse_upstream_key("").is_err());
        assert!(parse_upstream_key("   ").is_err());
        assert!(parse_upstream_key("ftp://1.2.3.4:21").is_err());
        assert!(parse_upstream_key("zastava://not-valid-base64???").is_err());
    }

    #[tokio::test]
    async fn test_connect_via_upstream_socks5_no_auth() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        // Spawn mock SOCKS5 server
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            // Read greeting [0x05, 0x01, 0x00]
            let mut greeting = [0u8; 3];
            socket.read_exact(&mut greeting).await.unwrap();
            assert_eq!(greeting[0], 0x05);
            // Select NO_AUTH (0x00)
            socket.write_all(&[0x05, 0x00]).await.unwrap();

            // Read connect request [0x05, 0x01, 0x00, 0x03, domain_len, ...domain, port]
            let mut req_head = [0u8; 4];
            socket.read_exact(&mut req_head).await.unwrap();
            assert_eq!(req_head[0], 0x05);
            assert_eq!(req_head[1], 0x01); // CONNECT
            assert_eq!(req_head[3], 0x03); // Domain

            let mut dlen = [0u8; 1];
            socket.read_exact(&mut dlen).await.unwrap();
            let mut domain = vec![0u8; dlen[0] as usize];
            socket.read_exact(&mut domain).await.unwrap();
            let mut port_bytes = [0u8; 2];
            socket.read_exact(&mut port_bytes).await.unwrap();

            assert_eq!(String::from_utf8_lossy(&domain), "api.anthropic.com");
            assert_eq!(u16::from_be_bytes(port_bytes), 443);

            // Send success reply (IPv4 bind 0.0.0.0:0)
            socket.write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await.unwrap();

            // Echo test
            let mut buf = [0u8; 4];
            socket.read_exact(&mut buf).await.unwrap();
            socket.write_all(&buf).await.unwrap();
        });

        let cfg = UpstreamProxyConfig {
            enabled: true,
            raw_key: format!("socks5://127.0.0.1:{port}"),
            protocol: "socks5".to_string(),
            host: "127.0.0.1".to_string(),
            port,
            username: None,
            password: None,
            label: None,
        };

        let mut stream = connect_via_upstream(&cfg, "api.anthropic.com", 443, Duration::from_secs(3))
            .await
            .expect("socks5 connection failed");

        stream.write_all(b"ping").await.unwrap();
        let mut resp = [0u8; 4];
        stream.read_exact(&mut resp).await.unwrap();
        assert_eq!(&resp, b"ping");
    }

    #[tokio::test]
    async fn test_connect_via_upstream_socks5_with_auth() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut greeting = [0u8; 4];
            socket.read_exact(&mut greeting).await.unwrap();
            assert_eq!(greeting[0], 0x05);
            // Select USER_PASS (0x02)
            socket.write_all(&[0x05, 0x02]).await.unwrap();

            // Read auth subnegotiation: 0x01, ulen, username..., plen, password...
            let mut ver = [0u8; 2];
            socket.read_exact(&mut ver).await.unwrap();
            assert_eq!(ver[0], 0x01);
            let ulen = ver[1] as usize;
            let mut uname = vec![0u8; ulen];
            socket.read_exact(&mut uname).await.unwrap();

            let mut plen_buf = [0u8; 1];
            socket.read_exact(&mut plen_buf).await.unwrap();
            let plen = plen_buf[0] as usize;
            let mut pword = vec![0u8; plen];
            socket.read_exact(&mut pword).await.unwrap();

            assert_eq!(String::from_utf8_lossy(&uname), "testuser");
            assert_eq!(String::from_utf8_lossy(&pword), "testpass");

            // Auth success
            socket.write_all(&[0x01, 0x00]).await.unwrap();

            // Connect request
            let mut req_head = [0u8; 4];
            socket.read_exact(&mut req_head).await.unwrap();
            assert_eq!(req_head[1], 0x01);
            let mut dlen = [0u8; 1];
            socket.read_exact(&mut dlen).await.unwrap();
            let mut domain = vec![0u8; dlen[0] as usize + 2]; // domain + port
            socket.read_exact(&mut domain).await.unwrap();

            // Success reply
            socket.write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await.unwrap();
        });

        let cfg = UpstreamProxyConfig {
            enabled: true,
            raw_key: format!("socks5://testuser:testpass@127.0.0.1:{port}"),
            protocol: "socks5".to_string(),
            host: "127.0.0.1".to_string(),
            port,
            username: Some("testuser".to_string()),
            password: Some("testpass".to_string()),
            label: None,
        };

        let stream = connect_via_upstream(&cfg, "api.openai.com", 443, Duration::from_secs(3))
            .await
            .expect("authenticated socks5 connect failed");
        drop(stream);
    }

    #[tokio::test]
    async fn test_connect_via_upstream_socks5_auth_rejection() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut greeting = [0u8; 4];
            let _ = socket.read_exact(&mut greeting).await;
            socket.write_all(&[0x05, 0x02]).await.unwrap();

            let mut ver = [0u8; 2];
            let _ = socket.read_exact(&mut ver).await;
            let ulen = ver[1] as usize;
            let mut uname = vec![0u8; ulen];
            let _ = socket.read_exact(&mut uname).await;
            let mut plen_buf = [0u8; 1];
            let _ = socket.read_exact(&mut plen_buf).await;
            let plen = plen_buf[0] as usize;
            let mut pword = vec![0u8; plen];
            let _ = socket.read_exact(&mut pword).await;

            // Reject auth
            socket.write_all(&[0x01, 0x01]).await.unwrap();
        });

        let cfg = UpstreamProxyConfig {
            enabled: true,
            raw_key: format!("socks5://bad:wrong@127.0.0.1:{port}"),
            protocol: "socks5".to_string(),
            host: "127.0.0.1".to_string(),
            port,
            username: Some("bad".to_string()),
            password: Some("wrong".to_string()),
            label: None,
        };

        let res = connect_via_upstream(&cfg, "api.openai.com", 443, Duration::from_secs(3)).await;
        assert!(res.is_err());
    }

    #[tokio::test]
    async fn test_connect_via_upstream_http_with_basic_auth() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let n = socket.read(&mut buf).await.unwrap();
            let req = String::from_utf8_lossy(&buf[..n]);

            assert!(req.starts_with("CONNECT api.openai.com:443 HTTP/1.1"));
            assert!(req.contains("Proxy-Authorization: Basic YWRtaW46c2VjcmV0")); // admin:secret in b64

            let resp = "HTTP/1.1 200 Connection Established\r\n\r\n";
            socket.write_all(resp.as_bytes()).await.unwrap();

            // Echo test
            let mut echo_buf = [0u8; 5];
            socket.read_exact(&mut echo_buf).await.unwrap();
            socket.write_all(&echo_buf).await.unwrap();
        });

        let cfg = UpstreamProxyConfig {
            enabled: true,
            raw_key: format!("http://admin:secret@127.0.0.1:{port}"),
            protocol: "http".to_string(),
            host: "127.0.0.1".to_string(),
            port,
            username: Some("admin".to_string()),
            password: Some("secret".to_string()),
            label: None,
        };

        let mut stream = connect_via_upstream(&cfg, "api.openai.com", 443, Duration::from_secs(3))
            .await
            .expect("http connect failed");

        stream.write_all(b"hello").await.unwrap();
        let mut echo = [0u8; 5];
        stream.read_exact(&mut echo).await.unwrap();
        assert_eq!(&echo, b"hello");
    }

    #[tokio::test]
    async fn test_connect_via_upstream_http_forbidden() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let _ = socket.read(&mut buf).await;
            let resp = "HTTP/1.1 403 Forbidden\r\n\r\n";
            socket.write_all(resp.as_bytes()).await.unwrap();
        });

        let cfg = UpstreamProxyConfig {
            enabled: true,
            raw_key: format!("http://127.0.0.1:{port}"),
            protocol: "http".to_string(),
            host: "127.0.0.1".to_string(),
            port,
            username: None,
            password: None,
            label: None,
        };

        let res = connect_via_upstream(&cfg, "api.openai.com", 443, Duration::from_secs(3)).await;
        assert!(res.is_err());
    }
}
