import React, { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  ShieldX,
  Clock,
  Zap,
  CheckCircle2,
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
      message:
        "Локация Турция (TR): высокий фрод-скор для Claude, полная блокировка для Google Gemini.",
      guide_ref: "01-personal-vpn-15min",
    },
    pinning_result: {
      status: "warning",
      code: "PINNED_IP_NOT_CONFIGURED",
      message:
        "Трафик идет НЕ через закрепленный VPS. Обнаружен публичный коммерческий пул.",
      guide_ref: "01-personal-vpn-15min",
    },
    travel_result: {
      status: "ok",
      code: "TRAVEL_NORMAL",
      message: "Конфликтов перемещения за 12ч нет.",
      guide_ref: null,
    },
    dnsbl_result: {
      status: "warning",
      code: "DNSBL_LISTED",
      message:
        "IP числится в спам-базе DroneBL / AS9009 (M247 Shared VPN — 400+ соседей на узле).",
      guide_ref: "01-personal-vpn-15min",
    },
    dnsbl_clean_count: "1/4 В базе",
    asn_result: {
      status: "warning",
      code: "ASN_SHARED_VPN",
      message:
        "Подсеть AS9009 (M247) принадлежит массовому коммерческому VPN.",
      guide_ref: "01-personal-vpn-15min",
    },
    ipv6_result: {
      status: "ok",
      code: "IPV6_SAFE",
      message: "Утечек по протоколу IPv6 не обнаружено.",
      guide_ref: null,
    },
    timezone_result: {
      status: "warning",
      code: "TIMEZONE_MISMATCH",
      message:
        "Часовой пояс ОС (Europe/Moscow) выдает реальную локацию (IP: Europe/Istanbul).",
      guide_ref: "03-os-privacy-setup",
    },
    checks: [],
  },
};

interface AlertPopupProps {
  initialPayload?: RiskInterceptPayload;
  onResolved?: (action?: InterceptionAction) => void;
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
          host: e.detail.host || "api.anthropic.com:443 (Claude Desktop)",
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

  useEffect(() => {
    if (secondsRemaining <= 0) {
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
      if (onResolved) onResolved(action);
    } catch (err) {
      console.error("Failed to resolve interception:", err);
    } finally {
      setResolving(false);
    }
  };

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
    <div className="w-[480px] h-[440px] max-h-screen bg-[#0A0B0E] text-zinc-100 flex flex-col justify-between border border-white/[0.1] border-t-2 border-t-rose-500 rounded-xl p-4 select-none overflow-hidden shadow-2xl">
      {/* Header Bar */}
      <div>
        <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
            </span>
            <span className="text-xs font-bold uppercase tracking-wider text-rose-400 font-sans">
              ПЕРЕХВАТ ОПАСНОГО ЗАПРОСА
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-zinc-400 tracking-wider">
              ПАКЕТ НА ПАУЗЕ
            </span>
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[10px] font-mono font-bold tabular-nums">
              <Clock className="w-3 h-3 text-rose-400" strokeWidth={1.75} />
              <span>{secondsRemaining}с</span>
            </div>
          </div>
        </div>

        {/* Target Info */}
        <div className="mt-2.5 flex items-center justify-between text-xs bg-[#12141A] px-2.5 py-1.5 rounded-lg border border-white/[0.06]">
          <div className="flex items-center gap-2 truncate">
            <span className="text-[10px] font-sans uppercase tracking-wider text-zinc-500 font-semibold">
              Цель:
            </span>
            <span className="text-zinc-100 font-mono text-[11.5px] font-semibold truncate">
              {payload.host}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-mono text-zinc-400">
              IP: {report.telemetry.ip} ({report.telemetry.country_code})
            </span>
            <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-white/[0.08] text-[9.5px] font-mono uppercase text-amber-400 font-semibold">
              {payload.provider}
            </span>
          </div>
        </div>

        {/* Advisory Subtitle */}
        <div className="mt-2 text-[11px] font-sans text-zinc-400 leading-snug">
          Соединение заморожено до отправки на сервер ИИ. Выявлены триггеры блокировки аккаунта:
        </div>

        {/* Risk Trigger Items */}
        <div className="mt-2 space-y-1.5">
          {/* Item 1: Geo / Travel */}
          <div className="bg-[#12141A] rounded-lg p-2 border border-rose-500/30 space-y-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-rose-400 font-bold font-sans flex items-center gap-1">
                <AlertOctagon className="w-3 h-3" strokeWidth={1.75} />
                <span>[КРИТИЧНО] Гео-матрица / Юрисдикция IP</span>
              </span>
              <span className="font-mono text-rose-300 font-semibold">
                {report.telemetry.country_code} · Траст {report.trust_score}%
              </span>
            </div>
            <div className="text-[11px] font-sans text-zinc-200 leading-snug line-clamp-2">
              {report.geo_result.message}
            </div>
          </div>

          {/* Item 2: DNSBL / Spam */}
          <div className="bg-[#12141A] rounded-lg p-2 border border-amber-500/25 space-y-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-amber-400 font-bold font-sans flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" strokeWidth={1.75} />
                <span>[РИСК] Спам-базы DNSBL и публичный пул ASN</span>
              </span>
              <span className="font-mono text-zinc-400">
                {report.telemetry.asn ? `AS${report.telemetry.asn}` : "AS9009"} · {report.dnsbl_clean_count}
              </span>
            </div>
            <div className="text-[11px] font-sans text-zinc-300 truncate">
              {report.dnsbl_result.status !== "ok"
                ? report.dnsbl_result.message
                : report.asn_result.message}
            </div>
          </div>

          {/* Item 3: Environment / Timezone */}
          <div className="bg-[#12141A] rounded-lg p-2 border border-white/[0.07] space-y-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-300 font-semibold font-sans flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-amber-400" strokeWidth={1.75} />
                <span>[СРЕДА ОС] Часовой пояс и привязка VPS</span>
              </span>
              <span className="font-mono text-zinc-500">Контроль утечек</span>
            </div>
            <div className="text-[11px] font-sans text-zinc-400 truncate">
              {report.timezone_result.message}
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons (3 Actions strictly per spec) */}
      <div className="space-y-2 pt-2 border-t border-white/[0.08]">
        <div className="flex items-center justify-between text-[10px] font-sans text-zinc-500 uppercase tracking-wider font-semibold">
          <span>ВЫБЕРИТЕ ДЕЙСТВИЕ (ГОРЯЧИЕ КЛАВИШИ 1 · 2 · 3):</span>
          <span className="font-mono text-[9.5px] text-zinc-600">Zero-MITM Hold</span>
        </div>

        {/* Action 1: Primary Solution Guide */}
        <button
          type="button"
          disabled={resolving}
          onClick={() => handleAction("OpenGuideAndBlock")}
          className="w-full py-2.5 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-sans font-bold text-xs flex items-center justify-between transition-all shadow-lg shadow-emerald-500/15 cursor-pointer disabled:opacity-50"
        >
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 fill-zinc-950 shrink-0" strokeWidth={2} />
            <span>1. Инструкция по решению (Свой чистый VPN за 15 мин)</span>
          </div>
          <ArrowRight className="w-4 h-4 shrink-0" strokeWidth={2} />
        </button>

        {/* Secondary Action Buttons Grid */}
        <div className="grid grid-cols-2 gap-2">
          {/* Action 3: Block until network change */}
          <button
            type="button"
            disabled={resolving}
            onClick={() => handleAction("BlockUntilNetworkChange")}
            className="py-2 px-2.5 rounded-lg bg-[#12141A] hover:bg-zinc-900 border border-rose-500/30 hover:border-rose-500/50 text-rose-300 text-[11px] font-sans font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <ShieldX className="w-3.5 h-3.5 shrink-0 text-rose-400" strokeWidth={1.75} />
            <span className="truncate">3. Блокировать до смены сети</span>
          </button>

          {/* Action 2: Accept risk and continue */}
          <button
            type="button"
            disabled={resolving}
            onClick={() => handleAction("AllowSession")}
            className="py-2 px-2.5 rounded-lg bg-[#12141A] hover:bg-zinc-900 border border-white/[0.08] hover:border-white/[0.18] text-zinc-300 text-[11px] font-sans font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <span className="truncate">2. Принять риск и продолжить</span>
          </button>
        </div>
      </div>
    </div>
  );
};
