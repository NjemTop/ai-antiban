use crate::auditor::geo_matrix::{CheckResult, ProviderId, GUIDE_PERSONAL_VPN};
use crate::state::IpHistoryEntry;

pub const IMPOSSIBLE_TRAVEL_WINDOW_SECS: u64 = 12 * 3600; // 12 hours

/// Evaluates IP Pinning rule.
pub fn evaluate_ip_pinning(
    pinned_ip: Option<&str>,
    strict_enabled: bool,
    current_ip: &str,
) -> CheckResult {
    let current_ip = current_ip.trim();

    if strict_enabled {
        match pinned_ip {
            Some(pinned) if pinned.trim() == current_ip => CheckResult::ok(
                "PINNED_IP_MATCH",
                format!("Traffic routed through your verified pinned VPS ({current_ip})."),
            ),
            Some(pinned) => CheckResult::critical(
                "PINNED_IP_MISMATCH",
                format!(
                    "Strict Pinning violation: traffic is routing via {current_ip}, but your pinned VPS server is {pinned}. Connection blocked to prevent account ban.",
                ),
                Some(GUIDE_PERSONAL_VPN.to_string()),
            ),
            None => CheckResult::warning(
                "PINNED_IP_NOT_CONFIGURED",
                "Strict IP Pinning is active, but no pinned VPS IP is set. Click 'Pin VPS' to lock your current safe IP.",
                Some(GUIDE_PERSONAL_VPN.to_string()),
            ),
        }
    } else {
        match pinned_ip {
            Some(pinned) if pinned.trim() == current_ip => CheckResult::ok(
                "PINNED_IP_MATCH",
                format!("Connected via verified pinned VPS ({current_ip})."),
            ),
            _ => CheckResult::ok(
                "STRICT_PINNING_DISABLED",
                "Strict IP Pinning is disabled. Traffic allowed.",
            ),
        }
    }
}

/// Evaluates impossible geographical travel based on provider's session history.
pub fn evaluate_impossible_travel(
    history: &[IpHistoryEntry],
    current_country_raw: &str,
    current_timestamp: u64,
    provider: ProviderId,
) -> CheckResult {
    let current_country = current_country_raw.trim().to_uppercase();

    // Look at the most recent historical entry
    let prev = match history.last() {
        Some(entry) => entry,
        None => {
            return CheckResult::ok(
                "HISTORY_CLEAN",
                "First session recorded for this provider. No travel anomalies detected.",
            );
        }
    };

    let prev_country = prev.country_code.trim().to_uppercase();

    if prev_country != current_country {
        let elapsed_secs = current_timestamp.saturating_sub(prev.timestamp);
        if elapsed_secs < IMPOSSIBLE_TRAVEL_WINDOW_SECS {
            let elapsed_hours = elapsed_secs / 3600;
            let elapsed_mins = (elapsed_secs % 3600) / 60;

            let time_str = if elapsed_hours > 0 {
                format!("{elapsed_hours}h {elapsed_mins}m")
            } else {
                format!("{elapsed_mins}m")
            };

            let msg = format!(
                "Impossible Travel detected: location jumped from {prev_country} to {current_country} in {time_str}. Claude and AI antifraud systems flag rapid country changes as account sharing or VPN hopping.",
            );

            // Anthropic is especially strict on rapid location hops
            if provider == ProviderId::Anthropic {
                return CheckResult::critical(
                    "IMPOSSIBLE_TRAVEL_CRITICAL",
                    msg,
                    Some(GUIDE_PERSONAL_VPN.to_string()),
                );
            } else {
                return CheckResult::warning(
                    "IMPOSSIBLE_TRAVEL_WARNING",
                    msg,
                    Some(GUIDE_PERSONAL_VPN.to_string()),
                );
            }
        }
    }

    CheckResult::ok(
        "TRAVEL_NORMAL",
        "Geographical travel velocity is within safe limits.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auditor::geo_matrix::CheckStatus;

    #[test]
    fn test_strict_ip_pinning() {
        // Strict enabled and matches
        let res = evaluate_ip_pinning(Some("185.10.10.10"), true, "185.10.10.10");
        assert_eq!(res.status, CheckStatus::Ok);
        assert_eq!(res.code, "PINNED_IP_MATCH");

        // Strict enabled and mismatches -> Critical
        let res = evaluate_ip_pinning(Some("185.10.10.10"), true, "185.20.20.20");
        assert_eq!(res.status, CheckStatus::Critical);
        assert_eq!(res.code, "PINNED_IP_MISMATCH");

        // Strict disabled -> Ok
        let res = evaluate_ip_pinning(Some("185.10.10.10"), false, "185.20.20.20");
        assert_eq!(res.status, CheckStatus::Ok);
    }

    #[test]
    fn test_impossible_travel_detection() {
        let now = 100000;
        let one_hour_ago = now - 3600;

        let history = vec![IpHistoryEntry::new("1.1.1.1", "DE", Some(1234), one_hour_ago)];

        // Anthropic: DE to US in 1 hour -> Critical
        let res_anthropic = evaluate_impossible_travel(&history, "US", now, ProviderId::Anthropic);
        assert_eq!(res_anthropic.status, CheckStatus::Critical);
        assert!(res_anthropic.message.contains("DE to US"));

        // OpenAI: DE to US in 1 hour -> Warning
        let res_openai = evaluate_impossible_travel(&history, "US", now, ProviderId::Openai);
        assert_eq!(res_openai.status, CheckStatus::Warning);

        // Same country (DE to DE) in 1 hour -> Ok
        let res_same = evaluate_impossible_travel(&history, "DE", now, ProviderId::Anthropic);
        assert_eq!(res_same.status, CheckStatus::Ok);

        // DE to US after 15 hours (>12h) -> Ok
        let fifteen_hours_ago = now - (15 * 3600);
        let history_old = vec![IpHistoryEntry::new("1.1.1.1", "DE", Some(1234), fifteen_hours_ago)];
        let res_old = evaluate_impossible_travel(&history_old, "US", now, ProviderId::Anthropic);
        assert_eq!(res_old.status, CheckStatus::Ok);
    }
}
