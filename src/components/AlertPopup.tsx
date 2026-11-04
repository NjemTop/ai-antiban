import React, { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import {
  AlertOctagon,
  ArrowRight,
  ShieldX,
  Clock,
} from "lucide-react";
import { InterceptionAction, RiskInterceptPayload } from "../types";
import { resolveInterception } from "../utils/api";

const DEFAULT_PAYLOAD: RiskInterceptPayload = {
  id: "sim-default",
  provider: "anthropic",
  host: "api.anthropic.com:443 (Claude Desktop)",
  ttl_seconds: 60,
  report: {
    provider: "anthropic",
    overall_status: "red",
    trust_score: 28,
    telemetry: {
      ip: "185.220.101.5",
      country_code: "TR",
      asn: 9009,
      isp: "M247 Europe SRL",
      org: "M247 Europe SRL",
      timezone: "Europe/Istanbul",
      resolved_at: Math.floor(Date.now() / 1000),
    },
    geo_result: {
      status: "critical",
      code: "GEO_HIGH_RISK_TR",
      message: "Turkey (TR): High fraud score for Claude, restricted for Gemini.",
      guide_ref: "01-personal-vpn-15min",
    },
    pinning_result: {
      status: "warning",
      code: "PINNED_IP_NOT_CONFIGURED",
      message: "Strict Pinning disabled. Traffic routing via unpinned commercial IP.",
      guide_ref: "01-personal-vpn-15min",
    },
    travel_result: {
      status: "ok",
      code: "TRAVEL_NORMAL",
      message: "No previous travel conflict.",
      guide_ref: null,
    },
    dnsbl_result: {
      status: "warning",
      code: "DNSBL_LISTED",
      message: "Listed in DroneBL / AS9009 (M247 Shared Pool - 400+ users on IP).",
      guide_ref: "01-personal-vpn-15min",
    },
    dnsbl_clean_count: "1/4 Listed",
    asn_result: {
      status: "warning",
      code: "ASN_SHARED_VPN",
      message: "AS9009 (M247) belongs to known shared commercial VPN network.",
      guide_ref: "01-personal-vpn-15min",
    },
    ipv6_result: {
      status: "ok",
      code: "IPV6_SAFE",
      message: "No IPv6 dual-stack leak.",
      guide_ref: null,
    },
    timezone_result: {
      status: "warning",
      code: "TIMEZONE_MISMATCH",
      message: "system_tz: Europe/Moscow != ip_tz: Europe/Istanbul",
      guide_ref: "03-os-privacy-setup",
    },
    checks: [],
  },
};

interface AlertPopupProps {
  initialPayload?: RiskInterceptPayload;
  onResolved?: () => void;
}

export const AlertPopup: React.FC<AlertPopupProps> = ({
  initialPayload,
  onResolved,
}) => {
  const [payload, setPayload] = useState<RiskInterceptPayload>(
    initialPayload || DEFAULT_PAYLOAD
  );
  const [secondsRemaining, setSecondsRemaining] = useState<number>(
    initialPayload?.ttl_seconds || 60
  );
  const [resolving, setResolving] = useState<boolean>(false);

  // Listen for interceptor event from Rust backend
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    if (isTauri()) {
      listen<RiskInterceptPayload>("interceptor://risk-detected", (event) => {
        setPayload(event.payload);
        setSecondsRemaining(event.payload.ttl_seconds || 60);
      }).then((unlisten) => {
        unlistenFn = unlisten;
      });
    }

    const handleCustomSim = (e: any) => {
      if (e.detail) {
        setPayload({
          ...DEFAULT_PAYLOAD,
          id: e.detail.id || "sim-" + Date.now(),
          provider: e.detail.provider || "anthropic",
          host: e.detail.host || "api.anthropic.com:443",
        });
        setSecondsRemaining(60);
      }
    };
    window.addEventListener("simulate-interceptor-event", handleCustomSim);

    return () => {
      if (unlistenFn) unlistenFn();
      window.removeEventListener("simulate-interceptor-event", handleCustomSim);
    };
  }, []);

  // Countdown timer
  useEffect(() => {
    if (secondsRemaining <= 0) {
      // Auto-block on timeout to protect account
      handleAction("BlockUntilNetworkChange");
      return;
    }

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsRemaining]);

  const handleAction = async (action: InterceptionAction) => {
    if (resolving) return;
    setResolving(true);

    try {
      await resolveInterception(payload.id, action, payload.provider);
      if (onResolved) onResolved();
    } catch (err) {
      console.error("Failed to resolve interception:", err);
    } finally {
      setResolving(false);
    }
  };

  // Keyboard ergonomics: 1, 2, 3 or Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "1") {
        e.preventDefault();
        handleAction("OpenGuideAndBlock");
      } else if (e.key === "2") {
        e.preventDefault();
        handleAction("AllowSession");
      } else if (e.key === "3" || e.key === "Escape") {
        e.preventDefault();
        handleAction("BlockUntilNetworkChange");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [payload, resolving]);

  const { report } = payload;

  return (
    <div className="w-[480px] h-[440px] max-h-screen bg-[#0A0B0E] text-zinc-100 flex flex-col justify-between border-t-2 border-rose-500 p-4 select-none overflow-hidden font-mono shadow-2xl">
      {/* Header Bar */}
      <div>
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-rose-400">
              INTERCEPTED REQUEST
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-400 tracking-wider">
              HOLDING PACKET...
            </span>
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[10px] font-bold tabular-nums">
              <Clock className="w-3 h-3 text-rose-400" />
              <span>{secondsRemaining}s</span>
            </div>
          </div>
        </div>

        {/* Target Info */}
        <div className="mt-2.5 flex items-center justify-between text-xs px-0.5">
          <div className="flex items-center gap-1.5 truncate">
            <span className="text-zinc-500">Target:</span>
            <span className="text-zinc-200 font-semibold truncate">
              {payload.host}
            </span>
          </div>
          <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-white/[0.06] text-[10px] uppercase text-zinc-400 shrink-0">
            {payload.provider}
          </span>
        </div>

        {/* Advisory Subtitle */}
        <div className="mt-2 text-[11px] text-zinc-400 leading-snug">
          Запрос заморожен до отправки. Обнаружены факторы блокировки аккаунта:
        </div>

        {/* Risk Trigger Items */}
        <div className="mt-2 space-y-1.5">
          {/* Item 1: Geo / Travel */}
          <div className="bg-[#12141A] rounded p-2 border border-rose-500/30 text-xs space-y-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-rose-400 font-bold flex items-center gap-1">
                <AlertOctagon className="w-3 h-3" /> [CRITICAL] Geo / Travel Anomaly
              </span>
              <span className="text-zinc-500">{report.telemetry.country_code}</span>
            </div>
            <div className="text-[11px] text-zinc-300">
              {report.geo_result.message ||
                `country_code: ${report.telemetry.country_code} -> Banned / High Fraud Score`}
            </div>
          </div>

          {/* Item 2: DNSBL / Spam */}
          <div className="bg-[#12141A] rounded p-2 border border-amber-500/25 text-xs space-y-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-amber-400 font-bold">
                [WARNING] Spam & Shared VPN Database (DNSBL)
              </span>
              <span className="text-zinc-500">
                {report.telemetry.asn ? `AS${report.telemetry.asn}` : "AS9009"}
              </span>
            </div>
            <div className="text-[11px] text-zinc-300 truncate">
              {report.dnsbl_result.message ||
                "Listed in DroneBL / Shared commercial VPN IP pool"}
            </div>
          </div>

          {/* Item 3: Environment / Timezone */}
          <div className="bg-[#12141A] rounded p-2 border border-white/[0.06] text-xs space-y-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-400 font-bold">
                [WARNING] Environment Mismatch
              </span>
              <span className="text-zinc-500">TZ Check</span>
            </div>
            <div className="text-[11px] text-zinc-300 truncate">
              {report.timezone_result.message ||
                "system_tz != ip_tz (Timezone location leak detected)"}
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons (3 Actions) */}
      <div className="space-y-2 pt-2 border-t border-white/[0.08]">
        <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
          ВЫБЕРИТЕ ДЕЙСТВИЕ:
        </div>

        {/* Primary Action Button */}
        <button
          type="button"
          disabled={resolving}
          onClick={() => handleAction("OpenGuideAndBlock")}
          className="w-full py-2.5 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs flex items-center justify-between transition-all shadow-lg shadow-emerald-500/10 cursor-pointer disabled:opacity-50"
        >
          <div className="flex items-center gap-2">
            <span>⚡</span>
            <span>1. Инструкция по решению (Свой чистый VPN за 15 мин)</span>
          </div>
          <ArrowRight className="w-4 h-4 shrink-0" />
        </button>

        {/* Secondary Action Buttons Grid */}
        <div className="grid grid-cols-2 gap-2">
          {/* Action 3: Block until network change */}
          <button
            type="button"
            disabled={resolving}
            onClick={() => handleAction("BlockUntilNetworkChange")}
            className="py-2 px-2.5 rounded-lg bg-[#12141A] hover:bg-zinc-900 border border-white/[0.08] hover:border-rose-500/40 text-rose-300 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <ShieldX className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">⛔ 3. Блокировать до смены сети</span>
          </button>

          {/* Action 2: Accept risk and continue */}
          <button
            type="button"
            disabled={resolving}
            onClick={() => handleAction("AllowSession")}
            className="py-2 px-2.5 rounded-lg bg-[#12141A] hover:bg-zinc-900 border border-white/[0.08] hover:border-white/[0.18] text-zinc-300 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <span className="truncate">2. Принять риск (Сессия)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
