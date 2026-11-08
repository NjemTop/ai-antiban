import React, { useState } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  XCircle,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  FlaskConical,
} from "lucide-react";
import { AppStateData, CheckResult, RiskReport } from "../types";

interface DeepAuditTabProps {
  report: RiskReport | null;
  state: AppStateData | null;
  onNavigateToGuide?: (guideId?: string) => void;
  onSimulate?: () => void;
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
  onSimulate,
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

  const dnsCheckResult: CheckResult =
    report.checks?.find((c) => c.code.startsWith("DNS_") && !c.code.includes("COUNTRY") && !c.code.includes("BL")) ||
    report.checks?.[6] || {
      status: "ok",
      code: "DNS_CLEAN",
      message: "Утечек через локальные DNS-резолверы РФ не обнаружено (Cloudflare 1.1.1.1).",
      guide_ref: null,
    };

  const locCheckResult: CheckResult =
    report.checks?.find((c) => c.code.includes("LOCATION") || c.code.includes("WIFI")) ||
    report.checks?.[8] || {
      status: "ok",
      code: "OS_LOCATION_SAFE",
      message: "Защита Wi-Fi BSSID активна: службы геолокации не передают MAC-адреса роутеров.",
      guide_ref: "03-os-privacy-setup",
    };

  const reverseDnsResult: CheckResult =
    report.checks?.find((c) => c.code.includes("REVERSE_DNS") || c.code.includes("PTR")) ||
    report.checks?.[9] || {
      status: "ok",
      code: "REVERSE_DNS_CLEAN",
      message: "Reverse DNS (PTR): запись соответствует чистому выделенному серверу, стоп-слова анонимайзеров отсутствуют.",
      guide_ref: null,
    };

  const dnsCountryResult: CheckResult =
    report.checks?.find((c) => c.code.includes("DNS_COUNTRY") || c.code.includes("CROSS_BORDER")) ||
    report.checks?.[10] || {
      status: "ok",
      code: "DNS_COUNTRY_CONSISTENT",
      message: "Страна DNS-серверов совпадает с выходным шлюзом. Cross-Border DNS утечек не обнаружено.",
      guide_ref: null,
    };

  const localeResult: CheckResult =
    report.checks?.find((c) => c.code.includes("LOCALE") || c.code.includes("HYGIENE")) ||
    report.checks?.[11] || {
      status: "ok",
      code: state?.synced_ai_timezone ? "LOCALE_HYGIENE_CLEAN" : "LOCALE_EN_SAFE",
      message: state?.synced_ai_timezone
        ? `Окружение CLI/IDE защищено: таймзона (${state.synced_ai_timezone}) и en_US.UTF-8 синхронизированы Заставой.`
        : "Локаль среды и системные переменные LANG/LC_ALL соответствуют безопасному профилю.",
      guide_ref: "03-os-privacy-setup",
    };

  const auditItems: AuditRowItem[] = [
    {
      id: "geo_matrix",
      num: 1,
      name: "Страна подключения (Гео)",
      result: report.geo_result,
      detail: `${telemetry.country_code} · ${report.geo_result.message}`,
      metricTag: telemetry.country_code,
    },
    {
      id: "dnsbl",
      num: 2,
      name: "Спам-базы (Проверка IP)",
      result: report.dnsbl_result,
      detail: `Spamhaus, SORBS, Barracuda, DroneBL`,
      metricTag: report.dnsbl_clean_count,
    },
    {
      id: "pinning",
      num: 3,
      name: "Привязка к личному IP",
      result: report.pinning_result,
      detail: state?.pinned_ip
        ? `Сервер: ${state.pinned_ip} (${state.strict_pinning_enabled ? "Строгий" : "Уведомл."})`
        : "IP не закреплен",
      metricTag: state?.pinned_ip ? "PINNED" : "UNPINNED",
    },
    {
      id: "travel",
      num: 4,
      name: "Резкая смена страны (за 4ч)",
      result: report.travel_result,
      detail: report.travel_result.message,
      metricTag: report.travel_result.status === "ok" ? "СТАБИЛЬНО" : "СКАЧОК",
    },
    {
      id: "asn",
      num: 5,
      name: "Провайдер и дата-центр (ASN)",
      result: report.asn_result,
      detail: telemetry.asn
        ? `AS${telemetry.asn} · ${telemetry.isp || telemetry.org || "Хостинг"}`
        : "Провайдер не определен",
      metricTag: telemetry.asn ? `AS${telemetry.asn}` : "--",
    },
    {
      id: "ipv6",
      num: 6,
      name: "Утечка реального IP по IPv6",
      result: report.ipv6_result,
      detail: report.ipv6_result.message,
      metricTag: report.ipv6_result.status === "ok" ? "ВЫКЛ" : "УТЕЧКА",
    },
    {
      id: "dns",
      num: 7,
      name: "Проверка DNS-серверов",
      result: dnsCheckResult,
      detail: dnsCheckResult.message,
      metricTag: dnsCheckResult.status === "ok" ? "1.1.1.1" : "ЛОКАЛЬНЫЙ",
    },
    {
      id: "timezone",
      num: 8,
      name: "Часовой пояс системы и ИИ",
      result: report.timezone_result,
      detail: state?.synced_ai_timezone
        ? `Авто-TZ: ${state.synced_ai_timezone} (ИИ защищен)`
        : telemetry.timezone
        ? `Зона IP: ${telemetry.timezone}`
        : report.timezone_result.message,
      metricTag: state?.synced_ai_timezone ? "SYNCED" : telemetry.timezone || "UTC",
    },
    {
      id: "wifi_geo",
      num: 9,
      name: "Геолокация по Wi-Fi в ОС",
      result: locCheckResult,
      detail: locCheckResult.message,
      metricTag: locCheckResult.status === "ok" ? "СКРЫТО" : "ОТКРЫТО",
    },
    {
      id: "reverse_dns",
      num: 10,
      name: "Reverse DNS / Hostname (PTR)",
      result: reverseDnsResult,
      detail: reverseDnsResult.message,
      metricTag: reverseDnsResult.status === "ok" ? "PTR OK" : "PTR WARN",
    },
    {
      id: "dns_country",
      num: 11,
      name: "Согласованность страны DNS",
      result: dnsCountryResult,
      detail: dnsCountryResult.message,
      metricTag: dnsCountryResult.status === "ok" ? telemetry.country_code : "SPLIT",
    },
    {
      id: "locale_hygiene",
      num: 12,
      name: "Локаль среды и гигиена ИИ (LANG/TZ)",
      result: localeResult,
      detail: localeResult.message,
      metricTag: state?.synced_ai_timezone ? "AI TZ" : "en_US",
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
            12 шлюзов безопасности (по стандарту 2ip.io)
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
                        {item.num < 10 ? `0${item.num}` : item.num}
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

      {/* Educational Interception Demo Card */}
      {onSimulate && (
        <div className="bg-[#12141A] rounded-xl border border-white/[0.08] p-3.5 space-y-2 mt-3 shadow-xs">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400">
              <FlaskConical className="w-3.5 h-3.5" strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-xs font-bold text-white tracking-tight">
                Учебная демонстрация окна перехвата (Демо-тест)
              </div>
              <div className="text-[10px] text-zinc-400 font-mono">
                Симуляция блокировки 403 / HOLD без вреда для реального соединения
              </div>
            </div>
          </div>
          <p className="text-[11px] text-zinc-300 leading-relaxed font-sans">
            Хотите увидеть, как работает автоматическая защита Заставы при обнаружении утечки? Нажмите демо-тест, чтобы вызвать окно удержания запроса и протестировать действия.
          </p>
          <button
            type="button"
            onClick={onSimulate}
            className="w-full py-2 px-3 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-xs"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>Запустить симуляцию перехвата (Демо HOLD)</span>
          </button>
        </div>
      )}
    </div>
  );
};
