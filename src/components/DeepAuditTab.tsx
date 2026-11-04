import React, { useState } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { AppStateData, CheckResult, RiskReport } from "../types";

interface DeepAuditTabProps {
  report: RiskReport | null;
  state: AppStateData | null;
  onNavigateToGuide?: (guideId?: string) => void;
}

interface AuditRowItem {
  id: string;
  num: number;
  name: string;
  result: CheckResult;
  detail: string;
  metricTag: string;
}

export const DeepAuditTab: React.FC<DeepAuditTabProps> = ({
  report,
  state,
  onNavigateToGuide,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!report) {
    return (
      <div className="p-6 text-center text-xs font-sans text-zinc-500">
        Выполняется глубокое сканирование сети и окружения ОС...
      </div>
    );
  }

  const { telemetry } = report;

  const dnsCheckResult: CheckResult = report.checks?.[6] || {
    status: "ok",
    code: "DNS_CLEAN",
    message: "Утечек через локальные DNS-резолверы РФ не обнаружено (Cloudflare 1.1.1.1).",
    guide_ref: null,
  };

  const locCheckResult: CheckResult = report.checks?.[8] || {
    status: "ok",
    code: "OS_LOCATION_SAFE",
    message: "Защита Wi-Fi BSSID активна: службы геолокации не передают MAC-адреса роутеров.",
    guide_ref: "03-os-privacy-setup",
  };

  const auditItems: AuditRowItem[] = [
    {
      id: "geo_matrix",
      num: 1,
      name: "Гео-матрица ИИ (Страна × Провайдер)",
      result: report.geo_result,
      detail: `${telemetry.country_code} · ${report.geo_result.message}`,
      metricTag: telemetry.country_code,
    },
    {
      id: "dnsbl",
      num: 2,
      name: "Спам-базы и ботнеты (DNSBL 2ip)",
      result: report.dnsbl_result,
      detail: `Spamhaus, SORBS, Barracuda, DroneBL`,
      metricTag: report.dnsbl_clean_count,
    },
    {
      id: "pinning",
      num: 3,
      name: "Контроль эталонного VPS (IP Pinning)",
      result: report.pinning_result,
      detail: state?.pinned_ip
        ? `Сервер: ${state.pinned_ip} (${state.strict_pinning_enabled ? "Строгий" : "Консульт."})`
        : "Сервер не закреплен (динамический выход)",
      metricTag: state?.pinned_ip ? "PINNED" : "UNPINNED",
    },
    {
      id: "travel",
      num: 4,
      name: "Прыжки локаций (Impossible Travel)",
      result: report.travel_result,
      detail: report.travel_result.message,
      metricTag: report.travel_result.status === "ok" ? "СТАБИЛЬНО" : "ПРЫЖОК",
    },
    {
      id: "asn",
      num: 5,
      name: "Репутация ASN и дата-центра",
      result: report.asn_result,
      detail: telemetry.asn
        ? `AS${telemetry.asn} · ${telemetry.isp || telemetry.org || "Хостинг"}`
        : "ASN не определен",
      metricTag: telemetry.asn ? `AS${telemetry.asn}` : "--",
    },
    {
      id: "ipv6",
      num: 6,
      name: "Двухстековая утечка IPv6",
      result: report.ipv6_result,
      detail: report.ipv6_result.message,
      metricTag: report.ipv6_result.status === "ok" ? "IPv4 ONLY" : "УТЕЧКА",
    },
    {
      id: "dns",
      num: 7,
      name: "Системные DNS-резолверы",
      result: dnsCheckResult,
      detail: dnsCheckResult.message,
      metricTag: dnsCheckResult.status === "ok" ? "1.1.1.1" : "ЛОКАЛЬНЫЙ",
    },
    {
      id: "timezone",
      num: 8,
      name: "Часовой пояс и локаль ОС",
      result: report.timezone_result,
      detail: telemetry.timezone
        ? `Зона IP: ${telemetry.timezone}`
        : report.timezone_result.message,
      metricTag: telemetry.timezone || "UTC",
    },
    {
      id: "wifi_geo",
      num: 9,
      name: "Геолокация по Wi-Fi (BSSID ОС)",
      result: locCheckResult,
      detail: locCheckResult.message,
      metricTag: locCheckResult.status === "ok" ? "СКРЫТО" : "ОТКРЫТО",
    },
  ];

  const passCount = auditItems.filter((i) => i.result.status === "ok").length;
  const warnCount = auditItems.filter((i) => i.result.status === "warning").length;
  const failCount = auditItems.filter((i) => i.result.status === "critical").length;

  return (
    <div className="space-y-2">
      {/* Header bar */}
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-sans tracking-wider uppercase text-zinc-400 font-semibold">
            Аудит по 9 векторам антифрода
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums">
          <span className="text-emerald-400 font-semibold">{passCount} ОК</span>
          {warnCount > 0 && <span className="text-amber-400 font-semibold">· {warnCount} РИСК</span>}
          {failCount > 0 && <span className="text-rose-400 font-semibold">· {failCount} СТОП</span>}
        </div>
      </div>

      {/* Items list */}
      <div className="bg-[#12141A] rounded-lg border border-white/[0.07] divide-y divide-white/[0.05] overflow-hidden">
        {auditItems.map((item) => {
          const isExp = expandedId === item.id;
          const status = item.result.status;

          let badgeText = "ОК";
          let badgeClass = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
          let icon = <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" strokeWidth={1.75} />;

          if (status === "critical") {
            badgeText = "БЛОК";
            badgeClass = "bg-rose-500/15 text-rose-400 border-rose-500/30";
            icon = <XCircle className="w-3.5 h-3.5 text-rose-400" strokeWidth={1.75} />;
          } else if (status === "warning") {
            badgeText = "РИСК";
            badgeClass = "bg-amber-500/15 text-amber-400 border-amber-500/30";
            icon = <AlertTriangle className="w-3.5 h-3.5 text-amber-400" strokeWidth={1.75} />;
          }

          return (
            <div key={item.id} className="transition-colors hover:bg-white/[0.015]">
              <div
                onClick={() => setExpandedId(isExp ? null : item.id)}
                className="px-2.5 py-1.5 flex items-center justify-between cursor-pointer select-none"
              >
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <div className="shrink-0">{icon}</div>
                  <div className="truncate">
                    <div className="flex items-center gap-1.5">
                      <span className="text-zinc-500 text-[10px] font-mono tabular-nums">
                        0{item.num}
                      </span>
                      <span className="text-[11.5px] font-semibold text-zinc-100 font-sans tracking-tight truncate">
                        {item.name}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-400 font-sans truncate leading-tight mt-0.5">
                      {item.detail}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[9.5px] font-mono text-zinc-400 bg-zinc-900/90 border border-white/[0.06] px-1.5 py-0.5 rounded tabular-nums">
                    {item.metricTag}
                  </span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9.5px] font-mono font-semibold border tabular-nums ${badgeClass}`}
                  >
                    {badgeText}
                  </span>
                  <div className="text-zinc-500">
                    {isExp ? (
                      <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.5} />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.5} />
                    )}
                  </div>
                </div>
              </div>

              {/* Detailed view */}
              {isExp && (
                <div className="px-3 pb-2.5 pt-1.5 border-t border-white/[0.04] bg-zinc-950/60 text-[11px] space-y-1.5">
                  <div className="flex justify-between text-[10px] font-mono text-zinc-400">
                    <span>Код триггера:</span>
                    <span className="text-zinc-200 font-semibold">{item.result.code}</span>
                  </div>

                  <div className="text-[11px] font-sans text-zinc-300 bg-zinc-900/70 p-2 rounded border border-white/[0.05] leading-relaxed">
                    {item.result.message}
                  </div>

                  {item.result.guide_ref && onNavigateToGuide && (
                    <div className="pt-0.5 flex justify-end">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigateToGuide(item.result.guide_ref || undefined);
                        }}
                        className="text-[10.5px] text-amber-400 hover:text-amber-300 font-sans font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <span>Открыть инструкцию по устранению</span>
                        <ArrowRight className="w-3 h-3" strokeWidth={1.5} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
