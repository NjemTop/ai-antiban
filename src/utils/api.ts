import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  AppStateData,
  BinAuditResult,
  CleanResult,
  InterceptionAction,
  ProviderId,
  RiskReport,
} from "../types";

let mockState: AppStateData = {
  pinned_ip: null,
  strict_pinning_enabled: false,
  ip_history: {},
  session_allowed_providers: [],
  blocked_providers: [],
};

let mockSysproxyActive = false;

export async function fetchAppState(): Promise<AppStateData> {
  if (isTauri()) {
    return await invoke<AppStateData>("get_state");
  }
  return { ...mockState };
}

export async function auditConnection(
  provider: ProviderId = "anthropic",
  forceRefresh: boolean = false
): Promise<RiskReport> {
  if (isTauri()) {
    return await invoke<RiskReport>("audit_connection", {
      provider,
      forceRefresh,
    });
  }

  // Realistic mock data for browser testing
  return {
    provider,
    overall_status: "green",
    trust_score: 98,
    telemetry: {
      ip: mockState.pinned_ip || "185.212.102.40",
      country_code: "NL",
      asn: 20473,
      org: "HostVDS / Choopa LLC",
      isp: "Choopa LLC",
      timezone: "Europe/Amsterdam",
      resolved_at: Math.floor(Date.now() / 1000),
    },
    geo_result: {
      status: "ok",
      code: "GEO_ALLOWED",
      message: "Country NL is officially supported by Anthropic, OpenAI, and Gemini.",
    },
    pinning_result: {
      status: mockState.pinned_ip ? "ok" : "warning",
      code: mockState.pinned_ip ? "PINNED_IP_MATCH" : "PINNED_IP_NOT_CONFIGURED",
      message: mockState.pinned_ip
        ? `Strict match: Current IP matches pinned VPS ${mockState.pinned_ip}.`
        : "Strict Pinning is disabled. Traffic routing via unpinned commercial IP.",
    },
    travel_result: {
      status: "ok",
      code: "TRAVEL_NORMAL",
      message: "Stable location velocity. Single country detected in 24 hours.",
    },
    dnsbl_result: {
      status: "ok",
      code: "DNSBL_CLEAN",
      message: "IP clean in all 4 spam blacklists (Spamhaus, SORBS, Barracuda, DroneBL).",
    },
    dnsbl_clean_count: "0/4 Clean",
    asn_result: {
      status: "ok",
      code: "ASN_CLEAN",
      message: "AS20473 (Choopa / HostVDS) is not in high-risk shared VPN pool.",
    },
    ipv6_result: {
      status: "ok",
      code: "IPV6_SAFE",
      message: "No IPv6 dual-stack bypass detected. Traffic routes cleanly via IPv4.",
    },
    timezone_result: {
      status: "ok",
      code: "TIMEZONE_MATCH",
      message: "System timezone matches IP geographical timezone (UTC+1).",
    },
    checks: [
      {
        status: "ok",
        code: "GEO_ALLOWED",
        message: "Country NL is officially supported by Anthropic, OpenAI, and Gemini.",
      },
      {
        status: mockState.pinned_ip ? "ok" : "warning",
        code: mockState.pinned_ip ? "PINNED_IP_MATCH" : "PINNED_IP_NOT_CONFIGURED",
        message: mockState.pinned_ip
          ? `Strict match: Current IP matches pinned VPS ${mockState.pinned_ip}.`
          : "Strict Pinning is disabled. Traffic routing via unpinned commercial IP.",
      },
      {
        status: "ok",
        code: "TRAVEL_NORMAL",
        message: "Stable location velocity. Single country detected in 24 hours.",
      },
      {
        status: "ok",
        code: "DNSBL_CLEAN",
        message: "IP clean in all 4 spam blacklists (Spamhaus, SORBS, Barracuda, DroneBL).",
      },
      {
        status: "ok",
        code: "ASN_CLEAN",
        message: "AS20473 (Choopa / HostVDS) is not in high-risk shared VPN pool.",
      },
      {
        status: "ok",
        code: "IPV6_SAFE",
        message: "No IPv6 dual-stack bypass detected. Traffic routes cleanly via IPv4.",
      },
      {
        status: "ok",
        code: "TIMEZONE_MATCH",
        message: "System timezone matches IP geographical timezone (UTC+1).",
      },
    ],
  };
}

export async function pinCurrentIp(ip: string): Promise<void> {
  if (isTauri()) {
    await invoke("pin_current_ip", { ip });
  } else {
    mockState.pinned_ip = ip;
  }
}

export async function unpinIp(): Promise<void> {
  if (isTauri()) {
    await invoke("unpin_ip");
  } else {
    mockState.pinned_ip = null;
  }
}

export async function toggleStrictPinning(enabled: boolean): Promise<void> {
  if (isTauri()) {
    await invoke("toggle_strict_pinning", { enabled });
  } else {
    mockState.strict_pinning_enabled = enabled;
  }
}

export async function cleanAppCache(provider: ProviderId): Promise<CleanResult> {
  if (isTauri()) {
    return await invoke<CleanResult>("clean_app_cache", { provider });
  }

  return {
    provider,
    cleaned_targets: [
      `${provider}/Cache`,
      `${provider}/Code Cache`,
      `${provider}/DawnCache`,
      `${provider}/GPUCache`,
    ],
    files_removed: 38,
    bytes_freed: 14_892_032,
    success: true,
    message: `Cache and device fingerprint store for ${provider} cleaned successfully.`,
  };
}

export async function resolveInterception(
  id: string,
  action: InterceptionAction,
  provider: string
): Promise<void> {
  if (isTauri()) {
    await invoke("resolve_interception", { id, action, provider });
  } else {
    console.log("Interception resolved in browser mock:", { id, action, provider });
  }
}

export async function simulateInterception(
  provider: ProviderId = "anthropic"
): Promise<void> {
  if (isTauri()) {
    await invoke("simulate_interception", { provider });
  } else {
    console.log("Simulating interception in browser mock for", provider);
    window.dispatchEvent(
      new CustomEvent("simulate-interceptor-event", {
        detail: {
          id: "sim-" + Date.now(),
          provider,
          host: provider === "anthropic" ? "api.anthropic.com:443" : "chatgpt.com:443",
        },
      })
    );
  }
}

export async function toggleSysproxy(enable: boolean): Promise<boolean> {
  if (isTauri()) {
    return await invoke<boolean>("toggle_sysproxy", { enable });
  }
  mockSysproxyActive = enable;
  return mockSysproxyActive;
}

export async function getSysproxyStatus(): Promise<boolean> {
  if (isTauri()) {
    return await invoke<boolean>("get_sysproxy_status");
  }
  return mockSysproxyActive;
}

export async function checkPaymentBin(
  bin: string,
  vpnCountry?: string
): Promise<BinAuditResult> {
  if (isTauri()) {
    return await invoke<BinAuditResult>("check_payment_bin", {
      bin,
      vpnCountry: vpnCountry ?? null,
    });
  }

  // Browser Mock for testing BIN checker
  const clean = bin.replace(/\D/g, "");
  if (clean.startsWith("2200") || clean.startsWith("2202")) {
    return {
      bin: clean,
      country_code: "RU",
      card_type: "DEBIT",
      bank_name: "T-Bank (Tinkoff) / Mir",
      is_prepaid: false,
      status: "critical",
      advisory: "Russian bank card detected. Direct payment to OpenAI/Anthropic will be rejected with 100% certainty.",
      guide_ref: "02-safe-payment-cards",
    };
  }

  if (clean.startsWith("4833") || clean.startsWith("5329")) {
    return {
      bin: clean,
      country_code: "US",
      card_type: "PREPAID",
      bank_name: "Sutton Bank / Virtual Prepaid",
      is_prepaid: true,
      status: "warning",
      advisory: "Virtual Prepaid card detected. Stripe Antifraud scores mass virtual BINs with high fraud rate. Recommended to subscribe via App Store or use Tier-1 Debit card.",
      guide_ref: "02-safe-payment-cards",
    };
  }

  return {
    bin: clean,
    country_code: "NL",
    card_type: "DEBIT",
    bank_name: "ING Bank N.V.",
    is_prepaid: false,
    status: "ok",
    advisory: "Tier-1 European Debit card. Region matches exit node, low fraud risk for Stripe & Claude Pro.",
  };
}
