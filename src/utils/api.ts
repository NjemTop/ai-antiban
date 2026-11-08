import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  AppStateData,
  BinAuditResult,
  CleanResult,
  ClaudeExportResult,
  ClaudeLocalDataSummary,
  CliProtectionReport,
  GatewayStatsSnapshot,
  InstallUpdateResult,
  InterceptionAction,
  ProviderId,
  RiskReport,
  UpdateCheckResult,
  UpstreamProxyConfig,
} from "../types";

let mockState: AppStateData = {
  pinned_ip: "185.212.102.40",
  strict_pinning_enabled: true,
  ip_history: {},
  session_allowed_providers: [],
  blocked_providers: [],
  upstream_proxy: null,
  warmup_started_at: null,
};

export type MockScenario = "clean" | "turkey" | "ru";

let mockSysproxyActive = true;
let mockCountryOverride: string | null = null;
let currentMockScenario: MockScenario = "clean";

export function setBrowserMockCountry(country: string | null) {
  mockCountryOverride = country;
  if (country === "TR") currentMockScenario = "turkey";
  else if (country === "RU") currentMockScenario = "ru";
  else currentMockScenario = "clean";
}

export function getMockScenario(): MockScenario {
  return currentMockScenario;
}

export function setMockScenario(scenario: MockScenario) {
  currentMockScenario = scenario;
  if (scenario === "turkey") {
    mockCountryOverride = "TR";
  } else if (scenario === "ru") {
    mockCountryOverride = "RU";
  } else {
    mockCountryOverride = "NL";
  }
}

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

  const hasUpstream = mockState.upstream_proxy?.enabled;
  const country = hasUpstream ? "NL" : mockCountryOverride || "NL";
  const isTurkey = !hasUpstream && country === "TR";
  const isRu = !hasUpstream && country === "RU";

  let overall: "green" | "yellow" | "red" = "green";
  let score = 98;
  let geoResult = {
    status: "ok" as "ok" | "warning" | "critical",
    code: "GEO_ALLOWED",
    message: `Локация ${country} полностью совместима и безопасна для ${
      provider === "anthropic"
        ? "Claude (Anthropic)"
        : provider === "openai"
        ? "ChatGPT (OpenAI)"
        : "Google Gemini / AI Studio"
    }.`,
  };

  if (isRu) {
    overall = "red";
    score = 15;
    geoResult = {
      status: "critical",
      code: "GLOBAL_SANCTIONED_COUNTRY",
      message:
        "Подключение идет из неподдерживаемого региона. Прямой доступ к сервису ограничен политиками платформы в этой юрисдикции. Переключитесь на доверенный рабочий шлюз (NL, DE, US).",
    };
  } else if (isTurkey) {
    if (provider === "gemini") {
      overall = "red";
      score = 22;
      geoResult = {
        status: "critical",
        code: "GEMINI_GEO_BLOCKED",
        message:
          "Google Gemini и AI Studio не работают или жестко ограничены с турецких IP-адресов (Turkey / TR). Переключитесь на Нидерланды (NL), Германию (DE) или США (US).",
      };
    } else if (provider === "anthropic") {
      overall = "yellow";
      score = 65;
      geoResult = {
        status: "warning",
        code: "ANTHROPIC_GEO_WARNING",
        message:
          "Локация Турция (TR) находится в зоне повышенного риска у Anthropic из-за массового реселлинга и дешевых прокси.",
      };
    }
  }

  const currentIp = isTurkey ? "185.220.101.5" : isRu ? "95.165.10.22" : mockState.pinned_ip || "185.212.102.40";
  const isPinned = mockState.pinned_ip === currentIp;

  const pinningResult = {
    status: isPinned ? ("ok" as const) : mockState.strict_pinning_enabled ? ("critical" as const) : ("warning" as const),
    code: isPinned ? "PINNED_IP_MATCH" : mockState.strict_pinning_enabled ? "PINNED_IP_MISMATCH" : "PINNED_IP_NOT_CONFIGURED",
    message: isPinned
      ? `Трафик идет через ваш закрепленный личный VPS (${currentIp}).`
      : mockState.strict_pinning_enabled
      ? `Нарушение Strict Pinning: текущий IP (${currentIp}) не совпадает с эталонным VPS (${mockState.pinned_ip}).`
      : "Строгая привязка IP отключена. Рекомендуется закрепить личный VPS.",
    guide_ref: "01-personal-vpn-15min",
  };

  const travelResult = {
    status: "ok" as const,
    code: "TRAVEL_NORMAL",
    message: "География сессий стабильна (1 локация за 24ч, аномалий Impossible Travel нет).",
  };

  const dnsblResult = {
    status: isTurkey ? ("warning" as const) : ("ok" as const),
    code: isTurkey ? "DNSBL_LISTED_WARNING" : "DNSBL_CLEAN",
    message: isTurkey
      ? "IP найден в базе абузных прокси DroneBL (пул M247 Europe SRL — 400+ соседей на IP)."
      : "Проверка DNSBL: 0/4 Clean — IP чист во всех 4 спам-базах (Spamhaus, SORBS, Barracuda, DroneBL).",
  };

  const asnResult = {
    status: isTurkey ? ("warning" as const) : ("ok" as const),
    code: isTurkey ? "HIGH_RISK_MASS_VPN_ASN" : "ASN_VERIFIED_PINNED",
    message: isTurkey
      ? "Подсеть массового VPN «M247 Europe SRL» (AS9009). Сотни пользователей на одном IP."
      : "AS20473 (HostVDS / Choopa LLC) подтвержден как выделенный личный сервер.",
  };

  const ipv6Result = {
    status: "ok" as const,
    code: "IPV6_DISABLED_SAFE",
    message: "Утечек по протоколу IPv6 не обнаружено (трафик идет строго через IPv4-туннель).",
  };

  const dnsResult = {
    status: "ok" as const,
    code: "DNS_CLEAN",
    message: "Утечек через локальные DNS-резолверы РФ не обнаружено (Cloudflare 1.1.1.1).",
  };

  const tzResult = {
    status: isTurkey ? ("warning" as const) : ("ok" as const),
    code: isTurkey ? "TIMEZONE_MISMATCH" : "TIMEZONE_MATCH",
    message: isTurkey
      ? "Часовой пояс ОС (Europe/Moscow) конфликтует с таймзоной IP (Europe/Istanbul)."
      : "Системный часовой пояс совпадает с регионом сервера (Europe/Amsterdam).",
  };

  const locResult = {
    status: "ok" as const,
    code: "OS_LOCATION_SAFE",
    message: "Защита Wi-Fi BSSID активна: передача координат роутеров заблокирована.",
  };

  return {
    provider,
    overall_status: overall,
    trust_score: score,
    telemetry: {
      ip: currentIp,
      country_code: country,
      asn: isTurkey ? 9009 : 20473,
      org: isTurkey ? "M247 Europe SRL" : "HostVDS / Choopa LLC",
      isp: isTurkey ? "M247 Europe SRL" : "HostVDS Cloud NL",
      timezone: isTurkey ? "Europe/Istanbul" : "Europe/Amsterdam",
      resolved_at: Math.floor(Date.now() / 1000),
    },
    geo_result: geoResult,
    pinning_result: pinningResult,
    travel_result: travelResult,
    dnsbl_result: dnsblResult,
    dnsbl_clean_count: isTurkey ? "1/4 в базе" : isRu ? "2/4 в базе" : "4/4 чисто",
    asn_result: asnResult,
    ipv6_result: ipv6Result,
    timezone_result: tzResult,
    checks: [
      geoResult,
      pinningResult,
      travelResult,
      dnsblResult,
      asnResult,
      ipv6Result,
      dnsResult,
      tzResult,
      locResult,
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

export async function allowProviderSession(provider: ProviderId): Promise<void> {
  if (isTauri()) {
    await invoke("allow_provider_session", { provider });
  } else {
    if (!mockState.session_allowed_providers.includes(provider)) {
      mockState.session_allowed_providers.push(provider);
    }
    mockState.blocked_providers = mockState.blocked_providers.filter((p) => p !== provider);
  }
}

export async function unblockProvider(provider: ProviderId): Promise<void> {
  if (isTauri()) {
    await invoke("unblock_provider_cmd", { provider });
  } else {
    mockState.blocked_providers = mockState.blocked_providers.filter((p) => p !== provider);
  }
}

export async function cleanAppCache(provider: ProviderId): Promise<CleanResult> {
  if (isTauri()) {
    return await invoke<CleanResult>("clean_app_cache", { provider });
  }

  return {
    provider,
    cleaned_targets: [
      `${provider}/Cookies`,
      `${provider}/IndexedDB`,
      `${provider}/Local Storage`,
      `${provider}/Cache`,
    ],
    files_removed: 42,
    bytes_freed: 18_450_944,
    success: true,
    message: `Следы старой сессии и кэш ${provider} успешно очищены.`,
  };
}

export async function scanClaudeLocalData(): Promise<ClaudeLocalDataSummary> {
  if (isTauri()) {
    return await invoke<ClaudeLocalDataSummary>("scan_claude_data_cmd");
  }

  return {
    exists: true,
    claude_dir_path: "~/.claude",
    projects_count: 3,
    sessions_count: 14,
    plans_count: 2,
    memory_files_count: 3,
    total_size_bytes: 4_200_000,
    projects: [
      {
        slug: "-Users-putiniye-local-projects-zastava",
        decoded_path: "/Users/putiniye/local-projects/zastava",
        sessions_count: 8,
        has_memory: true,
        total_bytes: 2_400_000,
        last_modified: Math.floor(Date.now() / 1000) - 300,
      },
      {
        slug: "-Users-putiniye-local-projects-cf-scanner",
        decoded_path: "/Users/putiniye/local-projects/cf-scanner",
        sessions_count: 4,
        has_memory: false,
        total_bytes: 1_100_000,
        last_modified: Math.floor(Date.now() / 1000) - 3600,
      },
      {
        slug: "-Users-putiniye-local-projects-ai-gateway",
        decoded_path: "/Users/putiniye/local-projects/ai-gateway",
        sessions_count: 2,
        has_memory: true,
        total_bytes: 700_000,
        last_modified: Math.floor(Date.now() / 1000) - 86400,
      },
    ],
    has_claude_md: true,
    has_history: true,
    has_settings: true,
    has_desktop_config: true,
    has_claude_json: true,
  };
}

export async function exportClaudeLocalData(): Promise<ClaudeExportResult> {
  if (isTauri()) {
    return await invoke<ClaudeExportResult>("export_claude_data_cmd");
  }

  return {
    export_dir_path: "~/Desktop/Claude_Handover_2026-11-08_195500",
    zip_archive_path: "~/Desktop/Claude_Handover_2026-11-08_195500.zip",
    index_summary_path: "~/Desktop/Claude_Handover_2026-11-08_195500/INDEX_SUMMARY.md",
    restore_prompt_path: "~/Desktop/Claude_Handover_2026-11-08_195500/RESTORE_PROMPT.md",
    restore_prompt_text: `# Системная директива переноса инженерного контекста

Ты — ведущий инженер-архитектор. Пользователь подключил архив полного рабочего контекста из предыдущей сессии разработки.

Корень архива контекста:
~/Desktop/Claude_Handover_2026-11-08_195500

Ключевые точки входа:
1. Инженерная карта проектов: ~/Desktop/Claude_Handover_2026-11-08_195500/INDEX_SUMMARY.md
2. Директории проектов и сессий: ~/Desktop/Claude_Handover_2026-11-08_195500/projects/
3. Директория планов: ~/Desktop/Claude_Handover_2026-11-08_195500/plans/`,
    projects_exported: 3,
    sessions_exported: 14,
    total_bytes: 4_200_000,
  };
}

export async function resolveInterception(
  id: string,
  action: InterceptionAction,
  provider: string,
  scope?: string
): Promise<void> {
  if (isTauri()) {
    await invoke("resolve_interception", { id, action, provider, scope });
  } else {
    if (scope === "simulation" || id.startsWith("sim-")) {
      return;
    }
    if (action === "AllowSession") {
      if (scope === "network") {
        mockState.session_allowed_providers = ["anthropic", "openai", "gemini"];
        mockState.blocked_providers = [];
      } else {
        if (!mockState.session_allowed_providers.includes(provider)) {
          mockState.session_allowed_providers.push(provider);
        }
        mockState.blocked_providers = mockState.blocked_providers.filter((p) => p !== provider);
      }
    } else if (action === "BlockUntilNetworkChange" || action === "OpenGuideAndBlock") {
      if (scope === "network") {
        mockState.blocked_providers = ["anthropic", "openai", "gemini"];
      } else {
        if (!mockState.blocked_providers.includes(provider)) {
          mockState.blocked_providers.push(provider);
        }
      }
    }
  }
}

export async function simulateInterception(
  provider: ProviderId = "anthropic"
): Promise<void> {
  if (isTauri()) {
    await invoke("simulate_interception", { provider });
  } else {
    window.dispatchEvent(
      new CustomEvent("simulate-interceptor-event", {
        detail: {
          id: "sim-" + Date.now(),
          provider,
          host:
            provider === "anthropic"
              ? "api.anthropic.com:443 (Claude Desktop)"
              : provider === "gemini"
              ? "gemini.google.com:443"
              : "chatgpt.com:443",
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

export async function enableCliProtection(): Promise<CliProtectionReport> {
  if (isTauri()) {
    try {
      const res = await invoke<CliProtectionReport>("enable_cli_protection");
      try {
        localStorage.setItem("zastava_cli_protected", "true");
      } catch {}
      return res;
    } catch (e) {
      try {
        localStorage.setItem("zastava_cli_protected", "true");
      } catch {}
      throw e;
    }
  }
  try {
    localStorage.setItem("zastava_cli_protected", "true");
  } catch {}
  return {
    enabled: true,
    proxy_url: "http://127.0.0.1:8899",
    configured_targets: ["VS Code", "Claude Code", "Терминал (~/.zshrc)"],
    shell_command:
      'export HTTP_PROXY="http://127.0.0.1:8899" HTTPS_PROXY="http://127.0.0.1:8899" ALL_PROXY="http://127.0.0.1:8899"',
  };
}

export async function disableCliProtection(): Promise<boolean> {
  if (isTauri()) {
    try {
      await invoke("disable_cli_protection");
    } catch {
      // fallback
    }
  }
  try {
    localStorage.setItem("zastava_cli_protected", "false");
  } catch {}
  return false;
}

export async function checkCliProtectionStatus(): Promise<boolean> {
  if (isTauri()) {
    try {
      return await invoke<boolean>("check_cli_protection_status");
    } catch {
      // fallback
    }
  }
  try {
    return localStorage.getItem("zastava_cli_protected") === "true";
  } catch {
    return false;
  }
}

export async function syncAiAgentsTimezone(timezone: string): Promise<string> {
  if (isTauri()) {
    return await invoke<string>("sync_ai_agents_timezone", { timezone });
  }
  mockState.synced_ai_timezone = timezone;
  return `Таймзона ${timezone} и en_US.UTF-8 синхронизированы для VS Code, Claude Code и терминала.`;
}

export async function openOsDatetimeSettings(): Promise<void> {
  if (isTauri()) {
    return await invoke<void>("open_os_datetime_settings_cmd");
  }
  console.log("[Mock] Opening OS date & time settings");
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

  const clean = bin.replace(/\D/g, "");
  if (
    clean.startsWith("2200") ||
    clean.startsWith("2201") ||
    clean.startsWith("2202") ||
    clean.startsWith("2203") ||
    clean.startsWith("2204")
  ) {
    return {
      bin: clean,
      country_code: "RU",
      card_type: "DEBIT",
      bank_name: "НСПК «Мир» (Т-Банк / Сбер / РФ)",
      is_prepaid: false,
      status: "critical",
      advisory:
        "Обнаружена карта «Мир» (Mir). Международные платежные системы не обслуживают карты этой платежной системы.",
      guide_ref: "02-safe-payment-cards",
    };
  }

  if (clean.startsWith("4833") || clean.startsWith("5329") || clean.startsWith("4040")) {
    return {
      bin: clean,
      country_code: "US",
      card_type: "PREPAID",
      bank_name: "Sutton Bank / Virtual Prepaid Card",
      is_prepaid: true,
      status: "warning",
      advisory:
        "Виртуальная предоплаченная (PREPAID) карта. Международные сервисы подписок часто отклоняют такие карты из-за отсутствия проверки адреса (AVS). Рекомендуется именная Debit-карта или оплата через магазины приложений.",
      guide_ref: "02-safe-payment-cards",
    };
  }

  if (clean.startsWith("4400") || clean.startsWith("5169")) {
    const mismatch = vpnCountry && vpnCountry !== "KZ";
    return {
      bin: clean,
      country_code: "KZ",
      card_type: "DEBIT",
      bank_name: "Kaspi Bank / Freedom Bank (Казахстан)",
      is_prepaid: false,
      status: mismatch ? "warning" : "ok",
      advisory: mismatch
        ? `Именная карта Казахстана (KZ), но ваш активный шлюз сейчас в локации ${vpnCountry}. На момент проведения платежа рекомендуется синхронизировать регион шлюза с регионом карты.`
        : "Именная дебетовая карта (KZ). Регион карты совпадает с сетевым шлюзом, оптимальная совместимость с международным биллингом.",
      guide_ref: "02-safe-payment-cards",
    };
  }

  return {
    bin: clean,
    country_code: "NL",
    card_type: "DEBIT",
    bank_name: "ING Bank N.V. (Евросоюз)",
    is_prepaid: false,
    status: "ok",
    advisory:
      "Европейская дебетовая карта Tier-1. Регион банка совпадает с локацией вашего сетевого шлюза (NL), максимальная совместимость с международным биллингом.",
  };
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (isTauri()) {
    return await invoke<UpdateCheckResult>("check_for_updates");
  }

  return {
    current_version: "1.0.4",
    latest_version: "1.0.4",
    update_available: false,
    release_name: "Zastava v1.0.4",
    release_notes: "Установлена актуальная версия приложения.",
    release_url: "https://github.com/kingbest1195/ai-antiban/releases/latest",
    published_at: new Date().toISOString(),
    download_url: null,
    asset_name: null,
    asset_size: null,
  };
}

export async function installUpdate(
  downloadUrl: string,
  assetName: string
): Promise<InstallUpdateResult> {
  if (isTauri()) {
    return await invoke<InstallUpdateResult>("install_update", {
      downloadUrl,
      assetName,
    });
  }

  return {
    success: true,
    message: "Обновление скачано и готово к установке.",
    will_restart: false,
  };
}

export async function setUpstreamProxy(key: string): Promise<UpstreamProxyConfig> {
  if (isTauri()) {
    return await invoke<UpstreamProxyConfig>("set_upstream_proxy", { key });
  }

  const isHttp = key.toLowerCase().includes("http://");
  const cfg: UpstreamProxyConfig = {
    enabled: true,
    raw_key: key,
    protocol: isHttp ? "http" : "socks5",
    host: "nl-exit.zastava.network",
    port: isHttp ? 8080 : 1080,
    username: key.includes("@") ? "user" : null,
    password: key.includes(":") ? "pass" : null,
    label: key.includes("#") ? decodeURIComponent(key.split("#")[1]) : "Zastava 2-Hop (NL)",
  };

  mockState = {
    ...mockState,
    upstream_proxy: cfg,
  };

  return cfg;
}

export async function toggleUpstreamProxy(enabled: boolean): Promise<UpstreamProxyConfig | null> {
  if (isTauri()) {
    return await invoke<UpstreamProxyConfig | null>("toggle_upstream_proxy", { enabled });
  }

  if (mockState.upstream_proxy) {
    const updated: UpstreamProxyConfig = { ...mockState.upstream_proxy, enabled };
    mockState = { ...mockState, upstream_proxy: updated };
    return updated;
  }
  return null;
}

export async function clearUpstreamProxy(): Promise<boolean> {
  if (isTauri()) {
    return await invoke<boolean>("clear_upstream_proxy");
  }

  mockState = { ...mockState, upstream_proxy: null };
  return true;
}

export async function setWarmupTimer(timestamp: number | null): Promise<number | null> {
  if (isTauri()) {
    return await invoke<number | null>("set_warmup_timer", { timestamp });
  }

  mockState = { ...mockState, warmup_started_at: timestamp };
  return timestamp;
}

let mockGatewayStats: GatewayStatsSnapshot = {
  protected_ai_requests: 38,
  intercepted_leaks: 1,
  direct_bypassed_requests: 114,
  active_ai_tunnels: 0,
  uptime_seconds: 3600,
  last_protected_host: "api.anthropic.com",
  recent_events: [
    {
      timestamp: Math.floor(Date.now() / 1000) - 12,
      host: "api.anthropic.com",
      provider: "anthropic",
      action: "PROTECTED",
      country: "GB",
    },
    {
      timestamp: Math.floor(Date.now() / 1000) - 34,
      host: "daily-cloudcode-pa.googleapis.com",
      provider: "gemini",
      action: "PROTECTED",
      country: "GB",
    },
    {
      timestamp: Math.floor(Date.now() / 1000) - 78,
      host: "api.openai.com",
      provider: "openai",
      action: "PROTECTED",
      country: "GB",
    },
  ],
};

export async function getGatewayStats(): Promise<GatewayStatsSnapshot> {
  if (isTauri()) {
    return await invoke<GatewayStatsSnapshot>("get_gateway_stats");
  }
  return {
    ...mockGatewayStats,
    uptime_seconds: mockGatewayStats.uptime_seconds + 2,
    recent_events: [...mockGatewayStats.recent_events],
  };
}


