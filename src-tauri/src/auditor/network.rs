use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

pub const CACHE_TTL_SECONDS: u64 = 15;
pub const REQUEST_TIMEOUT_MS: u64 = 1500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkTelemetry {
    pub ip: String,
    pub country_code: String,
    pub asn: Option<u32>,
    pub org: Option<String>,
    pub isp: Option<String>,
    pub timezone: Option<String>,
    pub resolved_at: u64,
}

impl NetworkTelemetry {
    pub fn is_fresh(&self, ttl_seconds: u64) -> bool {
        let now = current_timestamp();
        now.saturating_sub(self.resolved_at) < ttl_seconds
    }
}

pub fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// Models for ipwho.is
#[derive(Deserialize)]
struct IpWhoIsResponse {
    ip: Option<String>,
    country_code: Option<String>,
    connection: Option<IpWhoIsConnection>,
    timezone: Option<IpWhoIsTimezone>,
}

#[derive(Deserialize)]
struct IpWhoIsConnection {
    asn: Option<u32>,
    org: Option<String>,
    isp: Option<String>,
}

#[derive(Deserialize)]
struct IpWhoIsTimezone {
    id: Option<String>,
}

// Models for ipinfo.io
#[derive(Deserialize)]
struct IpInfoResponse {
    ip: Option<String>,
    country: Option<String>,
    org: Option<String>,
    timezone: Option<String>,
}

#[derive(Clone)]
pub struct NetworkResolver {
    client: reqwest::Client,
    cache: Arc<RwLock<Option<NetworkTelemetry>>>,
}

impl Default for NetworkResolver {
    fn default() -> Self {
        Self::new()
    }
}

impl NetworkResolver {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(REQUEST_TIMEOUT_MS))
            // Fresh socket per lookup: a pooled keep-alive connection could still use the old route
            // after a VPN switch and report the previous IP / ASN.
            .pool_max_idle_per_host(0)
            .user_agent("AI-AntiBan/1.0")
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        Self {
            client,
            cache: Arc::new(RwLock::new(None)),
        }
    }

    /// Invalidate existing cached telemetry
    pub async fn invalidate_cache(&self) {
        let mut w = self.cache.write().await;
        *w = None;
    }

    /// Pre-populate or override cached telemetry (useful for deterministic tests and simulation)
    pub async fn set_cached(&self, telemetry: NetworkTelemetry) {
        let mut w = self.cache.write().await;
        *w = Some(telemetry);
    }

    /// Resolve network telemetry using fresh cache or cascading endpoints
    pub async fn resolve(&self, force_refresh: bool) -> Result<NetworkTelemetry, String> {
        if !force_refresh {
            let r = self.cache.read().await;
            if let Some(telemetry) = &*r {
                if telemetry.is_fresh(CACHE_TTL_SECONDS) {
                    return Ok(telemetry.clone());
                }
            }
        }

        let telemetry = self.cascade_query().await?;

        // Cache the newly acquired telemetry
        {
            let mut w = self.cache.write().await;
            *w = Some(telemetry.clone());
        }

        Ok(telemetry)
    }

    async fn cascade_query(&self) -> Result<NetworkTelemetry, String> {
        let mut errors = Vec::new();

        // 1. Primary: ipwho.is
        match self.query_ipwhois().await {
            Ok(t) => return Ok(t),
            Err(e) => errors.push(format!("ipwho.is failed: {e}")),
        }

        // 2. Fallback 1: ipinfo.io
        match self.query_ipinfo().await {
            Ok(t) => return Ok(t),
            Err(e) => errors.push(format!("ipinfo.io failed: {e}")),
        }

        // 3. Fallback 2: 1.1.1.1/cdn-cgi/trace
        match self.query_cloudflare_trace().await {
            Ok(t) => return Ok(t),
            Err(e) => errors.push(format!("1.1.1.1/cdn-cgi/trace failed: {e}")),
        }

        Err(format!("All geo resolvers failed: {}", errors.join("; ")))
    }

    async fn query_ipwhois(&self) -> Result<NetworkTelemetry, String> {
        let resp = self
            .client
            .get("https://ipwho.is/")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let parsed: IpWhoIsResponse = resp.json().await.map_err(|e| e.to_string())?;

        let ip = parsed.ip.ok_or("ipwho.is missing 'ip'")?;
        let country_code = parsed
            .country_code
            .ok_or("ipwho.is missing 'country_code'")?
            .to_uppercase();

        let (asn, org, isp) = match parsed.connection {
            Some(conn) => (conn.asn, conn.org, conn.isp),
            None => (None, None, None),
        };

        let timezone = parsed.timezone.and_then(|tz| tz.id);

        Ok(NetworkTelemetry {
            ip,
            country_code,
            asn,
            org,
            isp,
            timezone,
            resolved_at: current_timestamp(),
        })
    }

    async fn query_ipinfo(&self) -> Result<NetworkTelemetry, String> {
        let resp = self
            .client
            .get("https://ipinfo.io/json")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let parsed: IpInfoResponse = resp.json().await.map_err(|e| e.to_string())?;

        let ip = parsed.ip.ok_or("ipinfo.io missing 'ip'")?;
        let country_code = parsed
            .country
            .ok_or("ipinfo.io missing 'country'")?
            .to_uppercase();

        let mut asn = None;
        let mut org_name = None;

        if let Some(org_str) = parsed.org {
            // E.g. "AS20473 The Constant Company, LLC"
            let trimmed = org_str.trim();
            if let Some(rest) = trimmed.strip_prefix("AS") {
                let mut parts = rest.splitn(2, ' ');
                if let Some(asn_str) = parts.next() {
                    asn = asn_str.parse::<u32>().ok();
                }
                if let Some(name) = parts.next() {
                    org_name = Some(name.to_string());
                }
            } else {
                org_name = Some(trimmed.to_string());
            }
        }

        Ok(NetworkTelemetry {
            ip,
            country_code,
            asn,
            org: org_name.clone(),
            isp: org_name,
            timezone: parsed.timezone,
            resolved_at: current_timestamp(),
        })
    }

    async fn query_cloudflare_trace(&self) -> Result<NetworkTelemetry, String> {
        let resp = self
            .client
            .get("https://1.1.1.1/cdn-cgi/trace")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let text = resp.text().await.map_err(|e| e.to_string())?;
        let mut ip = None;
        let mut loc = None;

        for line in text.lines() {
            if let Some(val) = line.strip_prefix("ip=") {
                ip = Some(val.trim().to_string());
            } else if let Some(val) = line.strip_prefix("loc=") {
                loc = Some(val.trim().to_uppercase());
            }
        }

        let ip = ip.ok_or("1.1.1.1/cdn-cgi/trace missing 'ip'")?;
        let country_code = loc.ok_or("1.1.1.1/cdn-cgi/trace missing 'loc'")?;

        Ok(NetworkTelemetry {
            ip,
            country_code,
            asn: None,
            org: None,
            isp: None,
            timezone: None,
            resolved_at: current_timestamp(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_telemetry_freshness() {
        let mut tel = NetworkTelemetry {
            ip: "185.1.1.1".to_string(),
            country_code: "NL".to_string(),
            asn: Some(20473),
            org: Some("Choopa".to_string()),
            isp: Some("Choopa".to_string()),
            timezone: Some("Europe/Amsterdam".to_string()),
            resolved_at: current_timestamp(),
        };

        assert!(tel.is_fresh(30));

        // Expired telemetry
        tel.resolved_at = current_timestamp().saturating_sub(35);
        assert!(!tel.is_fresh(30));
    }

    #[test]
    fn test_ipinfo_org_parsing() {
        let org_str = "AS20473 The Constant Company, LLC";
        let rest = org_str.strip_prefix("AS").unwrap();
        let mut parts = rest.splitn(2, ' ');
        let asn: u32 = parts.next().unwrap().parse().unwrap();
        let org = parts.next().unwrap();
        assert_eq!(asn, 20473);
        assert_eq!(org, "The Constant Company, LLC");
    }
}
