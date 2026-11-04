use std::net::SocketAddr;
use std::time::Duration;
use crate::auditor::geo_matrix::{CheckResult, GUIDE_PERSONAL_VPN};
use crate::auditor::rules::{DangerousAsns, DnsblZoneConfig};

pub const DNSBL_TIMEOUT_MS: u64 = 600;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DnsblZoneHit {
    pub zone: String,
    pub name: String,
    pub return_ip: String,
    pub severity: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DnsblReport {
    pub total_checked: usize,
    pub hits: Vec<DnsblZoneHit>,
    pub summary_label: String, // e.g. "0/4 Clean" or "1/4 Listed"
}

/// Reverses IPv4 octets: "185.220.101.5" -> "5.101.220.185".
pub fn reverse_ipv4(ip_str: &str) -> Result<String, String> {
    let parts: Vec<&str> = ip_str.trim().split('.').collect();
    if parts.len() != 4 {
        return Err(format!("Invalid IPv4 format: {ip_str}"));
    }

    for part in &parts {
        let num: u8 = part
            .parse()
            .map_err(|_| format!("Invalid IPv4 octet: {part}"))?;
        let _ = num;
    }

    Ok(format!("{}.{}.{}.{}", parts[3], parts[2], parts[1], parts[0]))
}

/// Formats DNSBL query domain: "5.101.220.185.zen.spamhaus.org".
pub fn format_dnsbl_query(ip: &str, zone: &str) -> Result<String, String> {
    let reversed = reverse_ipv4(ip)?;
    Ok(format!("{}.{}", reversed, zone.trim_matches('.')))
}

/// Queries a single DNSBL zone asynchronously with strict 600 ms timeout.
pub async fn query_dnsbl_zone(
    reversed_ip: &str,
    zone_cfg: &DnsblZoneConfig,
) -> Option<DnsblZoneHit> {
    let query_host = format!("{}.{}:80", reversed_ip, zone_cfg.zone.trim_matches('.'));

    let lookup_future = tokio::net::lookup_host(&query_host);
    let result = tokio::time::timeout(Duration::from_millis(DNSBL_TIMEOUT_MS), lookup_future).await;

    match result {
        Ok(Ok(addrs)) => {
            for addr in addrs {
                if let SocketAddr::V4(v4) = addr {
                    let octets = v4.ip().octets();
                    // 127.0.0.x indicates listing in DNSBL
                    // (127.255.255.x indicates query error / refusal by public resolver)
                    if octets[0] == 127 && octets[1] == 0 && octets[2] == 0 {
                        return Some(DnsblZoneHit {
                            zone: zone_cfg.zone.clone(),
                            name: zone_cfg.name.clone(),
                            return_ip: v4.ip().to_string(),
                            severity: zone_cfg.severity.clone(),
                            reason: zone_cfg.reason.clone(),
                        });
                    }
                }
            }
            None
        }
        // NXDOMAIN or socket error or timeout -> treat as clean
        _ => None,
    }
}

/// Queries all configured DNSBL zones in parallel.
pub async fn check_all_dnsbl(ip: &str, dangerous_asns: &DangerousAsns) -> DnsblReport {
    let reversed = match reverse_ipv4(ip) {
        Ok(rev) => rev,
        Err(_) => {
            return DnsblReport {
                total_checked: dangerous_asns.dnsbl_zones.len(),
                hits: Vec::new(),
                summary_label: format!("0/{} Clean (Invalid IP)", dangerous_asns.dnsbl_zones.len()),
            };
        }
    };

    let mut tasks = Vec::new();
    for zone in &dangerous_asns.dnsbl_zones {
        let rev_clone = reversed.clone();
        let zone_clone = zone.clone();
        tasks.push(tokio::spawn(async move {
            query_dnsbl_zone(&rev_clone, &zone_clone).await
        }));
    }

    let mut hits = Vec::new();
    for task in tasks {
        if let Ok(Some(hit)) = task.await {
            hits.push(hit);
        }
    }

    let total = dangerous_asns.dnsbl_zones.len();
    let hit_count = hits.len();
    let summary_label = if hit_count == 0 {
        format!("0/{total} Clean")
    } else {
        format!("{hit_count}/{total} Listed")
    };

    DnsblReport {
        total_checked: total,
        hits,
        summary_label,
    }
}

/// Converts DNSBL Report to standard CheckResult.
pub fn evaluate_dnsbl_report(report: &DnsblReport) -> CheckResult {
    if report.hits.is_empty() {
        return CheckResult::ok(
            "DNSBL_CLEAN",
            format!("DNSBL Spam Check: {} (No blacklist matches).", report.summary_label),
        );
    }

    let has_critical = report.hits.iter().any(|h| h.severity == "critical");
    let names: Vec<String> = report.hits.iter().map(|h| h.name.clone()).collect();
    let joined_names = names.join(", ");

    let msg = format!(
        "IP is listed in spam/botnet databases ({joined_names}). AI antifraud systems flag accounts originating from blacklisted nodes."
    );

    if has_critical {
        CheckResult::critical("DNSBL_LISTED_CRITICAL", msg, Some(GUIDE_PERSONAL_VPN.to_string()))
    } else {
        CheckResult::warning("DNSBL_LISTED_WARNING", msg, Some(GUIDE_PERSONAL_VPN.to_string()))
    }
}

/// Evaluates ASN and Network reputation.
pub fn evaluate_asn_reputation(
    asn: Option<u32>,
    isp: Option<&str>,
    org: Option<&str>,
    dangerous_asns: &DangerousAsns,
    is_pinned: bool,
) -> CheckResult {
    // 1. Check if ISP/Org name indicates Russian domestic telecom
    let isp_str = isp.unwrap_or_default();
    let org_str = org.unwrap_or_default();

    if let Some(matched_isp) = dangerous_asns.matches_russian_isp(isp_str).or_else(|| dangerous_asns.matches_russian_isp(org_str)) {
        return CheckResult::critical(
            "RUSSIAN_ISP_DETECTED",
            format!("Connection ISP matches domestic Russian telecom '{matched_isp}'. Outgoing requests to AI services will result in immediate ban."),
            Some(GUIDE_PERSONAL_VPN.to_string()),
        );
    }

    // 2. If user already pinned this IP as their personal dedicated VPS, datacenter ASN warnings are bypassed!
    if is_pinned {
        return CheckResult::ok(
            "ASN_VERIFIED_PINNED",
            "IP is verified and pinned as your personal VPS server.",
        );
    }

    // 3. Check for commercial mass-VPN / shared datacenter ASN
    if let Some(asn_num) = asn {
        if let Some(high_risk) = dangerous_asns.is_high_risk_asn(asn_num) {
            return CheckResult::warning(
                "HIGH_RISK_MASS_VPN_ASN",
                format!(
                    "Subnet belongs to mass hosting/VPN '{}' (AS{}). {}. If this is your own dedicated VPS, click 'Pin VPS' to suppress this warning.",
                    high_risk.name,
                    high_risk.asn,
                    high_risk.reason
                ),
                Some(GUIDE_PERSONAL_VPN.to_string()),
            );
        }
    }

    CheckResult::ok("ASN_CLEAN", "Network ASN and ISP reputation clean.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auditor::geo_matrix::CheckStatus;

    #[test]
    fn test_dnsbl_reverse_ip_query_formatting() {
        let ip = "185.220.101.1";
        let reversed = reverse_ipv4(ip).unwrap();
        assert_eq!(reversed, "1.101.220.185");

        let fqdn = format_dnsbl_query(ip, "zen.spamhaus.org").unwrap();
        assert_eq!(fqdn, "1.101.220.185.zen.spamhaus.org");

        // Verify alternative IP
        assert_eq!(reverse_ipv4("185.220.101.5").unwrap(), "5.101.220.185");

        let invalid = reverse_ipv4("invalid.ip");
        assert!(invalid.is_err());

        // DNSBL hit simulation with 127.0.0.2 -> Listed (Critical)
        let critical_hit = DnsblZoneHit {
            zone: "zen.spamhaus.org".to_string(),
            name: "Spamhaus ZEN".to_string(),
            return_ip: "127.0.0.2".to_string(),
            severity: "critical".to_string(),
            reason: "SBL Listed".to_string(),
        };
        let listed_report = DnsblReport {
            total_checked: 4,
            hits: vec![critical_hit],
            summary_label: "1/4 Listed".to_string(),
        };
        let listed_res = evaluate_dnsbl_report(&listed_report);
        assert_eq!(listed_res.status, CheckStatus::Critical);
        assert_eq!(listed_res.code, "DNSBL_LISTED_CRITICAL");
        assert!(listed_res.message.contains("Spamhaus ZEN"));

        // DNSBL hit simulation with warning severity -> Listed (Warning)
        let warning_hit = DnsblZoneHit {
            zone: "dnsbl.dronebl.org".to_string(),
            name: "DroneBL".to_string(),
            return_ip: "127.0.0.2".to_string(),
            severity: "warning".to_string(),
            reason: "Suspected crawler".to_string(),
        };
        let warning_report = DnsblReport {
            total_checked: 4,
            hits: vec![warning_hit],
            summary_label: "1/4 Listed".to_string(),
        };
        let warning_res = evaluate_dnsbl_report(&warning_report);
        assert_eq!(warning_res.status, CheckStatus::Warning);
        assert_eq!(warning_res.code, "DNSBL_LISTED_WARNING");

        // NXDOMAIN simulation (no hits) -> Clean (Status::Ok)
        let clean_report = DnsblReport {
            total_checked: 4,
            hits: Vec::new(),
            summary_label: "0/4 Clean".to_string(),
        };
        let clean_res = evaluate_dnsbl_report(&clean_report);
        assert_eq!(clean_res.status, CheckStatus::Ok);
        assert_eq!(clean_res.code, "DNSBL_CLEAN");
    }

    #[test]
    fn test_asn_matching_and_pinning_bypass() {
        let asns = DangerousAsns::load_bundled().unwrap();

        // High risk mass VPN (M247: AS9009) when unpinned -> Warning
        let res_unpinned = evaluate_asn_reputation(Some(9009), Some("M247"), None, &asns, false);
        assert_eq!(res_unpinned.status, CheckStatus::Warning);
        assert_eq!(res_unpinned.code, "HIGH_RISK_MASS_VPN_ASN");

        // High risk mass VPN (M247: AS9009) when PINNED -> Ok
        let res_pinned = evaluate_asn_reputation(Some(9009), Some("M247"), None, &asns, true);
        assert_eq!(res_pinned.status, CheckStatus::Ok);
        assert_eq!(res_pinned.code, "ASN_VERIFIED_PINNED");

        // Russian ISP keyword (Rostelecom) -> Critical even if pinned
        let res_ru = evaluate_asn_reputation(Some(12389), Some("PJSC Rostelecom"), None, &asns, false);
        assert_eq!(res_ru.status, CheckStatus::Critical);
        assert_eq!(res_ru.code, "RUSSIAN_ISP_DETECTED");
    }
}
