use crate::auditor::rules::ProviderMatrix;

pub const DEFAULT_AI_DOMAINS: &[&str] = &[
    "claude.ai",
    "claude.com",
    "anthropic.com",
    "claudeusercontent.com",
    "chatgpt.com",
    "openai.com",
    "oaistatic.com",
    "oaiusercontent.com",
    "gemini.google.com",
    "aistudio.google.com",
    "makersuite.google.com",
    "generativelanguage.googleapis.com",
    "aiplatform.googleapis.com",
    "cloudaicompanion.googleapis.com",
    "alkalimakersuite-pa.clients6.google.com",
    "daily-cloudcode-pa.googleapis.com",
    "cloudcode-pa.googleapis.com",
    "daily-cloudcode-pa.sandbox.googleapis.com",
    "autopush-cloudcode-pa.sandbox.googleapis.com",
    "preprod-daily-cloudcode-pa.sandbox.googleapis.com",
    "aicode.googleapis.com",
    "autopush-aicode.sandbox.googleapis.com",
    "preprod-aicode.sandbox.googleapis.com",
    "alkalimakersuiteapplets.pa.googleapis.com",
    "antigravity.google",
    "antigravity.google.com",
    "share.gemini.google",
];

/// Collects all configured AI domains from the matrix.
pub fn get_all_ai_domains(matrix: &ProviderMatrix) -> Vec<String> {
    let mut domains = Vec::new();
    for provider in matrix.providers.values() {
        for domain in &provider.domains {
            if !domains.contains(domain) {
                domains.push(domain.clone());
            }
        }
    }

    if domains.is_empty() {
        DEFAULT_AI_DOMAINS.iter().map(|s| s.to_string()).collect()
    } else {
        domains
    }
}

/// Generates a standard Proxy Auto-Configuration (PAC) script routing AI domains to proxy.
pub fn generate_pac_script(domains: &[String], proxy_host_port: &str) -> String {
    let domains_json = serde_json::to_string_pretty(domains).unwrap_or_else(|_| "[]".to_string());

    format!(
        r#"// Zastava Selective PAC Script
// Automatically routes known AI domains through local hold proxy, keeping everything else DIRECT.
function FindProxyForURL(url, host) {{
    var aiDomains = {domains_json};

    for (var i = 0; i < aiDomains.length; i++) {{
        var d = aiDomains[i];
        if (host === d || shExpMatch(host, "*." + d)) {{
            return "PROXY {proxy_host_port}";
        }}
    }}
    return "DIRECT";
}}
"#
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pac_file_generation() {
        let domains = vec![
            "claude.ai".to_string(),
            "chatgpt.com".to_string(),
            "gemini.google.com".to_string(),
        ];
        let pac = generate_pac_script(&domains, "127.0.0.1:8899");

        assert!(pac.contains("function FindProxyForURL(url, host)"));
        assert!(pac.contains("\"claude.ai\""));
        assert!(pac.contains("\"chatgpt.com\""));
        assert!(pac.contains("\"gemini.google.com\""));
        assert!(pac.contains("return \"PROXY 127.0.0.1:8899\";"));
        assert!(pac.contains("return \"DIRECT\";"));
    }
}
