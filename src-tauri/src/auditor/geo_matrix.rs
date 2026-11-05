use serde::{Deserialize, Serialize};
use crate::auditor::rules::ProviderMatrix;

pub const GUIDE_PERSONAL_VPN: &str = "01-personal-vpn-15min";
pub const GUIDE_PAYMENT_CARDS: &str = "02-safe-payment-cards";
pub const GUIDE_OS_PRIVACY: &str = "03-os-privacy-setup";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Anthropic,
    Openai,
    Gemini,
}

impl ProviderId {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderId::Anthropic => "anthropic",
            ProviderId::Openai => "openai",
            ProviderId::Gemini => "gemini",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            ProviderId::Anthropic => "Claude (Anthropic)",
            ProviderId::Openai => "ChatGPT (OpenAI)",
            ProviderId::Gemini => "Google Gemini / AI Studio",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        match id.to_lowercase().as_str() {
            "anthropic" | "claude" => Some(ProviderId::Anthropic),
            "openai" | "chatgpt" => Some(ProviderId::Openai),
            "gemini" | "google" => Some(ProviderId::Gemini),
            _ => None,
        }
    }

    /// Determines target AI provider from HTTP CONNECT or request hostname.
    pub fn from_host(raw_host: &str) -> Option<Self> {
        let host = raw_host
            .split(':')
            .next()
            .unwrap_or(raw_host)
            .trim()
            .to_lowercase();

        // 1. Anthropic / Claude
        if host == "claude.ai"
            || host.ends_with(".claude.ai")
            || host == "anthropic.com"
            || host.ends_with(".anthropic.com")
            || host.ends_with(".claudeusercontent.com")
        {
            return Some(ProviderId::Anthropic);
        }

        // 2. OpenAI / ChatGPT
        if host == "chatgpt.com"
            || host.ends_with(".chatgpt.com")
            || host == "openai.com"
            || host.ends_with(".openai.com")
            || host.ends_with(".oaistatic.com")
            || host.ends_with(".oaiusercontent.com")
        {
            return Some(ProviderId::Openai);
        }

        // 3. Google Gemini / AI Studio
        if host == "gemini.google.com"
            || host == "aistudio.google.com"
            || host == "makersuite.google.com"
            || host == "generativelanguage.googleapis.com"
            || host.ends_with(".clients6.google.com")
        {
            return Some(ProviderId::Gemini);
        }

        None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Ok,
    Warning,
    Critical,
}

impl CheckStatus {
    pub fn is_critical(&self) -> bool {
        matches!(self, CheckStatus::Critical)
    }

    pub fn is_warning(&self) -> bool {
        matches!(self, CheckStatus::Warning)
    }

    pub fn is_ok(&self) -> bool {
        matches!(self, CheckStatus::Ok)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CheckResult {
    pub status: CheckStatus,
    pub code: String,
    pub message: String,
    pub guide_ref: Option<String>,
}

impl CheckResult {
    pub fn ok(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            status: CheckStatus::Ok,
            code: code.into(),
            message: message.into(),
            guide_ref: None,
        }
    }

    pub fn warning(
        code: impl Into<String>,
        message: impl Into<String>,
        guide_ref: Option<String>,
    ) -> Self {
        Self {
            status: CheckStatus::Warning,
            code: code.into(),
            message: message.into(),
            guide_ref,
        }
    }

    pub fn critical(
        code: impl Into<String>,
        message: impl Into<String>,
        guide_ref: Option<String>,
    ) -> Self {
        Self {
            status: CheckStatus::Critical,
            code: code.into(),
            message: message.into(),
            guide_ref,
        }
    }
}

/// Evaluates provider compatibility against country code according to the Provider Matrix.
pub fn evaluate_provider_geo(
    matrix: &ProviderMatrix,
    provider: ProviderId,
    country_code_raw: &str,
) -> CheckResult {
    let country_code = country_code_raw.trim().to_uppercase();

    // 1. Check Global Sanctioned List (RU, BY, CN, HK, MO, IR, KP, SY, CU)
    if matrix.global_blocked_countries.contains(&country_code) {
        let msg = if country_code == "HK" {
            "Гонконг (HK) глобально заблокирован в Claude, OpenAI и Google Gemini. Многие ставят HK как «быстрый узел», что ведет к мгновенному бану аккаунта. Переключитесь на NL, DE или US."
        } else if country_code == "RU" || country_code == "BY" {
            "Подключение идет из неподдерживаемого региона. Прямой доступ к сервису ограничен политиками платформы в этой юрисдикции. Переключитесь на доверенный рабочий шлюз (NL, DE, US)."
        } else {
            "Доступ из этой юрисдикции заблокирован всеми основными ИИ-провайдерами. Соединение остановлено для защиты аккаунта."
        };

        return CheckResult::critical(
            "GLOBAL_SANCTIONED_COUNTRY",
            msg,
            Some(GUIDE_PERSONAL_VPN.to_string()),
        );
    }

    let rules = matrix.get_provider_rules(provider.as_str());

    // 2. Provider-specific blocked countries
    if let Some(r) = rules {
        if r.blocked_countries.contains(&country_code) {
            let reason = r
                .country_block_reasons
                .get(&country_code)
                .cloned()
                .unwrap_or_else(|| {
                    format!(
                        "Доступ к {} заблокирован для локации {}.",
                        provider.display_name(),
                        country_code
                    )
                });

            return CheckResult::critical(
                format!("{}_GEO_BLOCKED", provider.as_str().to_uppercase()),
                reason,
                Some(GUIDE_PERSONAL_VPN.to_string()),
            );
        }

        // 3. Provider-specific warning countries
        if let Some(warn_msg) = r.warning_countries.get(&country_code) {
            return CheckResult::warning(
                format!("{}_GEO_WARNING", provider.as_str().to_uppercase()),
                warn_msg.clone(),
                Some(GUIDE_PERSONAL_VPN.to_string()),
            );
        }
    }

    // 4. Regional specifics for transit CIS & Middle East hubs
    // ("KZ", "AM", "GE", "UZ", "KG", "RS", "AE")
    let cis_transit = ["KZ", "AM", "GE", "UZ", "KG", "RS", "AE"];
    if cis_transit.contains(&country_code.as_str()) {
        match provider {
            ProviderId::Anthropic => {
                return CheckResult::warning(
                    "ANTHROPIC_TRANSIT_HUB_RISK",
                    format!(
                        "Локация {} — транзитный хаб СНГ/Ближнего Востока. Антифрод Claude жестко банит при малейшем несовпадении страны карты или часового пояса.",
                        country_code
                    ),
                    Some(GUIDE_PERSONAL_VPN.to_string()),
                );
            }
            ProviderId::Gemini => {
                return CheckResult::warning(
                    "GEMINI_TRANSIT_RESTRICTION",
                    format!(
                        "В локации {} могут действовать лимиты бесплатного тарифа Google AI Studio API.",
                        country_code
                    ),
                    Some(GUIDE_PERSONAL_VPN.to_string()),
                );
            }
            ProviderId::Openai => {
                // OpenAI allows transit hubs cleanly
            }
        }
    }

    CheckResult::ok(
        "GEO_ALLOWED",
        format!(
            "Локация {} полностью совместима и безопасна для {}.",
            country_code,
            provider.display_name()
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_geo_matrix_russia_blocked() {
        let matrix = ProviderMatrix::load_bundled().unwrap();
        for &provider in &[ProviderId::Anthropic, ProviderId::Openai, ProviderId::Gemini] {
            let res = evaluate_provider_geo(&matrix, provider, "RU");
            assert_eq!(res.status, CheckStatus::Critical);
            assert_eq!(res.code, "GLOBAL_SANCTIONED_COUNTRY");
        }
    }

    #[test]
    fn test_provider_geo_matrix_hongkong_blocked() {
        let matrix = ProviderMatrix::load_bundled().unwrap();
        for &provider in &[ProviderId::Anthropic, ProviderId::Openai, ProviderId::Gemini] {
            let res = evaluate_provider_geo(&matrix, provider, "HK");
            assert_eq!(res.status, CheckStatus::Critical);
            assert_eq!(res.code, "GLOBAL_SANCTIONED_COUNTRY");
            assert!(res.message.contains("HK") || res.message.contains("Гонконг"));
        }
    }

    #[test]
    fn test_provider_geo_matrix_turkey_gemini_blocked() {
        let matrix = ProviderMatrix::load_bundled().unwrap();

        // Gemini in Turkey -> Critical
        let res_gemini = evaluate_provider_geo(&matrix, ProviderId::Gemini, "TR");
        assert_eq!(res_gemini.status, CheckStatus::Critical);
        assert!(res_gemini.message.contains("Google Gemini"));

        // Anthropic in Turkey -> Warning
        let res_anthropic = evaluate_provider_geo(&matrix, ProviderId::Anthropic, "TR");
        assert_eq!(res_anthropic.status, CheckStatus::Warning);

        // OpenAI in Turkey -> Ok
        let res_openai = evaluate_provider_geo(&matrix, ProviderId::Openai, "TR");
        assert_eq!(res_openai.status, CheckStatus::Ok);
    }

    #[test]
    fn test_provider_geo_matrix_netherlands_allowed() {
        let matrix = ProviderMatrix::load_bundled().unwrap();
        for &country in &["NL", "DE", "US", "FI"] {
            for &provider in &[ProviderId::Anthropic, ProviderId::Openai, ProviderId::Gemini] {
                let res = evaluate_provider_geo(&matrix, provider, country);
                assert_eq!(res.status, CheckStatus::Ok);
                assert_eq!(res.code, "GEO_ALLOWED");
            }
        }
    }

    #[test]
    fn test_provider_from_host_matching() {
        assert_eq!(ProviderId::from_host("claude.ai:443"), Some(ProviderId::Anthropic));
        assert_eq!(ProviderId::from_host("api.anthropic.com"), Some(ProviderId::Anthropic));
        assert_eq!(ProviderId::from_host("chatgpt.com"), Some(ProviderId::Openai));
        assert_eq!(ProviderId::from_host("gemini.google.com:443"), Some(ProviderId::Gemini));
        assert_eq!(ProviderId::from_host("aistudio.google.com"), Some(ProviderId::Gemini));
        assert_eq!(ProviderId::from_host("example.com"), None);
    }
}
