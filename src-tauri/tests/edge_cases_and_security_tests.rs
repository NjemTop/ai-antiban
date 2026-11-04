use ai_antiban_lib::auditor::dnsbl::{evaluate_asn_reputation, format_dnsbl_query, reverse_ipv4};
use ai_antiban_lib::auditor::geo_matrix::{evaluate_provider_geo, CheckStatus, ProviderId};
use ai_antiban_lib::auditor::history::{evaluate_impossible_travel, evaluate_ip_pinning};
use ai_antiban_lib::auditor::leaks::{is_russian_or_belarusian_timezone, RUSSIAN_TIMEZONES};
use ai_antiban_lib::auditor::rules::{DangerousAsns, ProviderMatrix};
use ai_antiban_lib::bin_checker::BinChecker;
use ai_antiban_lib::state::IpHistoryEntry;

#[test]
fn test_edge_case_turkey_gemini_special_rules() {
    let matrix = ProviderMatrix::load_bundled().expect("Failed to load bundled provider matrix");

    // Gemini in Turkey must be strictly Critical with explanation
    let gemini_tr = evaluate_provider_geo(&matrix, ProviderId::Gemini, "TR");
    assert_eq!(gemini_tr.status, CheckStatus::Critical);
    assert_eq!(gemini_tr.code, "GEMINI_GEO_BLOCKED");
    assert!(
        gemini_tr.message.contains("Turkey") || gemini_tr.message.contains("Google"),
        "Gemini TR block message missing key details: {}",
        gemini_tr.message
    );

    // Claude (Anthropic) in Turkey is Warning
    let anthropic_tr = evaluate_provider_geo(&matrix, ProviderId::Anthropic, "TR");
    assert_eq!(anthropic_tr.status, CheckStatus::Warning);

    // ChatGPT (OpenAI) in Turkey is Ok
    let openai_tr = evaluate_provider_geo(&matrix, ProviderId::Openai, "TR");
    assert_eq!(openai_tr.status, CheckStatus::Ok);
}

#[test]
fn test_edge_case_impossible_travel_exact_window() {
    let now = 1_000_000;
    // Window is 12 hours = 43200 seconds
    let inside_window = now - (11 * 3600 + 59 * 60); // 11h 59m ago
    let outside_window = now - (12 * 3600 + 60); // 12h 1m ago

    let history_inside = vec![IpHistoryEntry::new("1.1.1.1", "DE", Some(1234), inside_window)];
    let res_inside = evaluate_impossible_travel(&history_inside, "US", now, ProviderId::Anthropic);
    assert_eq!(res_inside.status, CheckStatus::Critical);
    assert_eq!(res_inside.code, "IMPOSSIBLE_TRAVEL_CRITICAL");

    let history_outside = vec![IpHistoryEntry::new("1.1.1.1", "DE", Some(1234), outside_window)];
    let res_outside = evaluate_impossible_travel(&history_outside, "US", now, ProviderId::Anthropic);
    assert_eq!(res_outside.status, CheckStatus::Ok);
    assert_eq!(res_outside.code, "TRAVEL_NORMAL");
}

#[test]
fn test_edge_case_dnsbl_all_configured_zones_formatting() {
    let dangerous_asns = DangerousAsns::load_bundled().expect("Failed to load dangerous asns");
    let test_ip = "185.220.101.5";
    let reversed = reverse_ipv4(test_ip).expect("Valid IP");

    for zone_cfg in &dangerous_asns.dnsbl_zones {
        let fqdn = format_dnsbl_query(test_ip, &zone_cfg.zone).expect("Format query");
        assert_eq!(fqdn, format!("{reversed}.{}", zone_cfg.zone.trim_matches('.')));
        assert!(!fqdn.ends_with('.'));
    }
}

#[test]
fn test_edge_case_russian_timezones_exhaustiveness() {
    // Check known high-risk timezones
    assert!(is_russian_or_belarusian_timezone("Europe/Moscow"));
    assert!(is_russian_or_belarusian_timezone("Europe/Minsk"));
    assert!(is_russian_or_belarusian_timezone("Asia/Vladivostok"));
    assert!(is_russian_or_belarusian_timezone("Asia/Novosibirsk"));
    assert!(is_russian_or_belarusian_timezone("europe/moscow")); // case-insensitivity

    // Clean international timezones
    assert!(!is_russian_or_belarusian_timezone("Europe/Berlin"));
    assert!(!is_russian_or_belarusian_timezone("Europe/Amsterdam"));
    assert!(!is_russian_or_belarusian_timezone("America/New_York"));
    assert!(!is_russian_or_belarusian_timezone("UTC"));

    assert!(RUSSIAN_TIMEZONES.len() >= 25);
}

#[test]
fn test_edge_case_bin_checker_strict_privacy_and_lengths() {
    // 6-digit BIN is valid
    assert_eq!(BinChecker::sanitize_bin("4111 11").unwrap(), "411111");

    // 7-digit BIN is valid
    assert_eq!(BinChecker::sanitize_bin("4111-112").unwrap(), "4111112");

    // 8-digit BIN is valid
    assert_eq!(BinChecker::sanitize_bin("4111 1122").unwrap(), "41111122");

    // < 6 digits is rejected
    assert!(BinChecker::sanitize_bin("41111").is_err());

    // > 8 digits (e.g. 16-digit card number) is strictly rejected to prevent card leaks
    let card_leak = BinChecker::sanitize_bin("4111 2222 3333 4444");
    assert!(card_leak.is_err());
    assert!(card_leak.unwrap_err().contains("For your privacy"));

    // Letters only is rejected
    assert!(BinChecker::sanitize_bin("abcdef").is_err());
}

#[test]
fn test_edge_case_vps_pinning_and_russian_telecom() {
    let asns = DangerousAsns::load_bundled().expect("Failed to load bundled ASNs");

    // Datacenter / Commercial ASN (DigitalOcean: AS14061)
    // 1. Unpinned -> Warning
    let res_unpinned = evaluate_asn_reputation(Some(14061), Some("DigitalOcean, LLC"), None, &asns, false);
    assert_eq!(res_unpinned.status, CheckStatus::Warning);

    // 2. User pinned this IP as their personal dedicated VPS -> suppressed (Ok)
    let res_pinned = evaluate_asn_reputation(Some(14061), Some("DigitalOcean, LLC"), None, &asns, true);
    assert_eq!(res_pinned.status, CheckStatus::Ok);
    assert_eq!(res_pinned.code, "ASN_VERIFIED_PINNED");

    // 3. BUT Russian domestic telecom (Rostelecom, MTS, MegaFon) is NEVER suppressed by pinning!
    let res_pinned_ru = evaluate_asn_reputation(Some(12389), Some("PJSC Rostelecom"), None, &asns, true);
    assert_eq!(res_pinned_ru.status, CheckStatus::Critical);
    assert_eq!(res_pinned_ru.code, "RUSSIAN_ISP_DETECTED");

    // 4. Strict IP Pinning test with country match
    let res_strict_mismatch = evaluate_ip_pinning(Some("1.2.3.4"), true, "5.6.7.8");
    assert_eq!(res_strict_mismatch.status, CheckStatus::Critical);
    assert_eq!(res_strict_mismatch.code, "PINNED_IP_MISMATCH");
}
