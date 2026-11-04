export type ProviderId = "anthropic" | "openai" | "gemini";

export type OverallStatus = "green" | "yellow" | "red";

export type CheckStatus = "ok" | "warning" | "critical" | "green" | "yellow" | "red";

export interface CheckResult {
  status: CheckStatus;
  code: string;
  message: string;
  guide_ref?: string | null;
}

export interface NetworkTelemetry {
  ip: string;
  country_code: string;
  asn?: number;
  org?: string;
  isp?: string;
  timezone?: string;
  resolved_at: number;
}

export interface RiskReport {
  provider: ProviderId;
  overall_status: OverallStatus;
  trust_score: number;
  telemetry: NetworkTelemetry;
  geo_result: CheckResult;
  pinning_result: CheckResult;
  travel_result: CheckResult;
  dnsbl_result: CheckResult;
  dnsbl_clean_count: string;
  asn_result: CheckResult;
  ipv6_result: CheckResult;
  timezone_result: CheckResult;
  checks: CheckResult[];
}

export interface CleanResult {
  provider: ProviderId;
  cleaned_targets: string[];
  files_removed: number;
  bytes_freed: number;
  success: boolean;
  message: string;
}

export interface BinAuditResult {
  bin: string;
  country_code?: string;
  card_type?: string;
  bank_name?: string;
  is_prepaid: boolean;
  status: CheckStatus;
  advisory: string;
  guide_ref?: string;
}

export interface IpHistoryEntry {
  ip: string;
  country_code: string;
  asn?: number;
  timestamp: number;
}

export interface AppStateData {
  pinned_ip: string | null;
  strict_pinning_enabled: boolean;
  ip_history: Record<string, IpHistoryEntry[]>;
  session_allowed_providers: string[];
  blocked_providers: string[];
}

export type InterceptionAction =
  | "AllowSession"
  | "BlockUntilNetworkChange"
  | "OpenGuideAndBlock"
  | "allowSession"
  | "blockUntilNetworkChange"
  | "openGuideAndBlock";

export interface RiskInterceptPayload {
  id: string;
  provider: ProviderId;
  host: string;
  report: RiskReport;
  ttl_seconds: number;
}
