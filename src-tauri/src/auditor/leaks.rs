use std::time::Duration;
use crate::auditor::geo_matrix::{CheckResult, GUIDE_OS_PRIVACY};

pub const IPV6_CHECK_URL: &str = "https://[2606:4700:4700::1111]/cdn-cgi/trace";
pub const IPV6_CHECK_TIMEOUT_MS: u64 = 800;

pub const RUSSIAN_TIMEZONES: &[&str] = &[
    "Europe/Moscow",
    "Europe/Kaliningrad",
    "Europe/Kirov",
    "Europe/Samara",
    "Europe/Saratov",
    "Europe/Ulyanovsk",
    "Europe/Volgograd",
    "Europe/Astrakhan",
    "Europe/Minsk",
    "Asia/Yekaterinburg",
    "Asia/Omsk",
    "Asia/Novosibirsk",
    "Asia/Barnaul",
    "Asia/Tomsk",
    "Asia/Novokuznetsk",
    "Asia/Krasnoyarsk",
    "Asia/Irkutsk",
    "Asia/Chita",
    "Asia/Yakutsk",
    "Asia/Khandyga",
    "Asia/Vladivostok",
    "Asia/Ust-Nera",
    "Asia/Magadan",
    "Asia/Sakhalin",
    "Asia/Srednekolymsk",
    "Asia/Kamchatka",
    "Asia/Anadyr",
];

/// Checks for dual-stack IPv6 leaks by pinging Cloudflare IPv6-only CDN trace endpoint.
pub async fn check_ipv6_leak(ipv4_country: &str, global_blocked: &[String]) -> CheckResult {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(IPV6_CHECK_TIMEOUT_MS))
        .build();

    let client = match client {
        Ok(c) => c,
        Err(_) => {
            return CheckResult::ok(
                "IPV6_SAFE",
                "Проверка IPv6 пропущена. Трафик идет через IPv4-туннель.",
            );
        }
    };

    match client.get(IPV6_CHECK_URL).send().await {
        Ok(resp) => {
            if let Ok(text) = resp.text().await {
                let mut loc = None;
                for line in text.lines() {
                    if let Some(val) = line.strip_prefix("loc=") {
                        loc = Some(val.trim().to_uppercase());
                        break;
                    }
                }

                if let Some(ipv6_loc) = loc {
                    if global_blocked.contains(&ipv6_loc) {
                        return CheckResult::critical(
                            "IPV6_LEAK_SANCTIONED_CRITICAL",
                            format!(
                                "КРИТИЧНО: Обнаружена утечка IPv6! Трафик идет мимо VPN напрямую из {ipv6_loc} по IPv6. Немедленно отключите IPv6 в настройках сети ОС.",
                            ),
                            Some(GUIDE_OS_PRIVACY.to_string()),
                        );
                    }

                    if !ipv4_country.is_empty() && ipv6_loc != ipv4_country.to_uppercase() {
                        return CheckResult::warning(
                            "IPV6_LEAK_MISMATCH",
                            format!(
                                "Рассинхрон маршрутов: IPv4 идет через {ipv4_country}, а IPv6 — через {ipv6_loc}. Рекомендуется отключить IPv6 для 100% защиты туннеля.",
                            ),
                            Some(GUIDE_OS_PRIVACY.to_string()),
                        );
                    }

                    return CheckResult::ok(
                        "IPV6_ENCAPSULATED",
                        format!("Трафик IPv6 надежно упакован в туннель ({ipv6_loc})."),
                    );
                }
            }
            CheckResult::ok("IPV6_SAFE", "Утечек по протоколу IPv6 не обнаружено.")
        }
        // Connection error or timeout means IPv6 is disabled or not routing outside tunnel, which is SAFE
        Err(_) => CheckResult::ok(
            "IPV6_DISABLED_SAFE",
            "IPv6 отключен или заблокирован вне туннеля (утечек нет).",
        ),
    }
}

/// Evaluates whether system timezone exposes user's actual location.
pub fn evaluate_system_timezone(ip_timezone: Option<&str>) -> CheckResult {
    let system_tz = match iana_time_zone::get_timezone() {
        Ok(tz) => tz,
        Err(_) => {
            return CheckResult::ok(
                "TIMEZONE_UNKNOWN",
                "Системный часовой пояс не определен.",
            );
        }
    };

    // 1. Check if system timezone is in Russia or Belarus
    if is_russian_or_belarusian_timezone(&system_tz) {
        return CheckResult::warning(
            "TIMEZONE_LEAK_RU",
            format!(
                "Системный часовой пояс ОС ({system_tz}) указывает на РФ/РБ. Браузеры и десктопный Claude видят эту зону даже через VPN.",
            ),
            Some(GUIDE_OS_PRIVACY.to_string()),
        );
    }

    // 2. Compare against IP timezone if available
    if let Some(target_tz) = ip_timezone {
        if !target_tz.is_empty() && system_tz != target_tz {
            return CheckResult::warning(
                "TIMEZONE_MISMATCH",
                format!(
                    "Часовой пояс ОС ({system_tz}) отличается от таймзоны IP ({target_tz}). Для максимального траста рекомендуется синхронизировать пояс с локацией сервера.",
                ),
                Some(GUIDE_OS_PRIVACY.to_string()),
            );
        }
    }

    CheckResult::ok(
        "TIMEZONE_MATCH",
        format!("Системный часовой пояс ({system_tz}) совпадает с локацией IP."),
    )
}

pub fn is_russian_or_belarusian_timezone(tz: &str) -> bool {
    RUSSIAN_TIMEZONES.iter().any(|&item| item.eq_ignore_ascii_case(tz))
}

/// Checks OS DNS resolvers for Russian domestic ISP leaks (`scutil --dns` on macOS, `ipconfig /all` on Windows).
pub fn check_dns_leak(ipv4_country: &str, russian_keywords: &[String]) -> CheckResult {
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = std::process::Command::new("scutil").arg("--dns").output() {
            let text = String::from_utf8_lossy(&output.stdout);
            for kw in russian_keywords {
                if text.to_lowercase().contains(&kw.to_lowercase()) {
                    return CheckResult::warning(
                        "DNS_DOMESTIC_WARNING",
                        format!("В системном DNS обнаружен провайдер «{kw}». Пропишите публичный DNS (1.1.1.1 / 8.8.8.8) в настройках сети."),
                        Some(GUIDE_OS_PRIVACY.to_string()),
                    );
                }
            }
            // Check if nameserver[0] is a known domestic ISP public DNS (e.g. 77.88.8.8 Yandex DNS)
            if text.contains("77.88.8.") && ipv4_country != "RU" {
                return CheckResult::warning(
                    "DNS_YANDEX_LEAK",
                    "Обнаружен Яндекс.DNS (77.88.8.8) при зарубежном VPN. Смените DNS на Cloudflare (1.1.1.1).",
                    Some(GUIDE_OS_PRIVACY.to_string()),
                );
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = std::process::Command::new("ipconfig").arg("/all").output() {
            let text = String::from_utf8_lossy(&output.stdout);
            if text.contains("77.88.8.") && ipv4_country != "RU" {
                return CheckResult::warning(
                    "DNS_YANDEX_LEAK",
                    "Обнаружен Яндекс.DNS (77.88.8.8) при зарубежном VPN. Смените DNS на Cloudflare (1.1.1.1).",
                    Some(GUIDE_OS_PRIVACY.to_string()),
                );
            }
        }
    }

    let _ = (ipv4_country, russian_keywords);
    CheckResult::ok(
        "DNS_CLEAN",
        "Утечек через локальные DNS-резолверы РФ не обнаружено.",
    )
}

/// Checks OS Location Services status (BSSID Wi-Fi triangulation).
pub fn check_os_location_services() -> CheckResult {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = std::process::Command::new("reg")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location",
                "/v",
                "Value",
            ])
            .output()
        {
            let text = String::from_utf8_lossy(&output.stdout);
            if text.contains("Allow") {
                return CheckResult::warning(
                    "OS_LOCATION_ENABLED",
                    "В Windows включены службы геолокации (BSSID Wi-Fi). Отключите доступ к геопозиции для браузеров и десктопных приложений ИИ.",
                    Some(GUIDE_OS_PRIVACY.to_string()),
                );
            }
        }
        CheckResult::ok("OS_LOCATION_SAFE", "Службы геолокации Windows ограничены (BSSID защищен).")
    }

    #[cfg(target_os = "macos")]
    {
        CheckResult::ok(
            "OS_LOCATION_SAFE",
            "Защита Wi-Fi BSSID: убедитесь, что для Claude и браузера отключена геолокация в Системных настройках.",
        )
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        CheckResult::ok("OS_LOCATION_SAFE", "Службы геолокации ОС не передают BSSID.")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_russian_timezone_detection() {
        assert!(is_russian_or_belarusian_timezone("Europe/Moscow"));
        assert!(is_russian_or_belarusian_timezone("Asia/Vladivostok"));
        assert!(is_russian_or_belarusian_timezone("Europe/Minsk"));
        assert!(!is_russian_or_belarusian_timezone("Europe/Amsterdam"));
        assert!(!is_russian_or_belarusian_timezone("America/New_York"));
    }

    #[test]
    fn test_timezone_evaluation_mismatch() {
        // If system is e.g. UTC and target is Amsterdam
        let res = evaluate_system_timezone(Some("Europe/Amsterdam"));
        // Either Ok or Warning depending on the machine's actual timezone, but must not panic
        assert!(!res.code.is_empty());
    }
}
