import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  ShieldAlert,
  Unlock,
} from "lucide-react";
import { AppStateData, CheckResult, CheckStatus, ProviderId, RiskReport } from "../types";
import { openExternal } from "../utils/opener";

interface ProviderMatrixProps {
  reports: Partial<Record<ProviderId, RiskReport>>;
  state: AppStateData | null;
  onNavigateToGuide?: () => void;
  onAllowProvider?: (provider: ProviderId) => void;
  onUnblockProvider?: (provider: ProviderId) => void;
}

interface ProviderMeta {
  id: ProviderId;
  name: string;
  domain: string;
  url: string;
  accentColor: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "anthropic",
    name: "Claude (Anthropic)",
    domain: "claude.ai · api.anthropic.com",
    url: "https://claude.ai",
    accentColor: "#D97757",
  },
  {
    id: "openai",
    name: "ChatGPT (OpenAI)",
    domain: "chatgpt.com · openai.com",
    url: "https://chatgpt.com",
    accentColor: "#10A37F",
  },
  {
    id: "gemini",
    name: "Gemini / AI Studio",
    domain: "gemini.google.com · aistudio",
    url: "https://gemini.google.com",
    accentColor: "#4E82EE",
  },
];

export const ProviderMatrix: React.FC<ProviderMatrixProps> = ({
  reports,
  state,
  onNavigateToGuide,
  onAllowProvider,
  onUnblockProvider,
}) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10px] font-sans tracking-wider uppercase text-zinc-400 font-semibold">
          Доступ к нейросетям
        </span>
        <span className="text-[10px] font-mono text-zinc-500">3 сервиса</span>
      </div>

      <div className="bg-[#12141A] rounded-lg border border-white/[0.07] divide-y divide-white/[0.05] overflow-hidden">
        {PROVIDERS.map((p) => {
          const report = reports[p.id];
          const isExpanded = !!expanded[p.id];
          const country = report?.telemetry.country_code ?? "--";

          const isSessionAllowed = state?.session_allowed_providers.includes(p.id);
          const isBlocked = state?.blocked_providers.includes(p.id);

          // Collect all non-OK checks so we always show the REAL reason for a block or warning!
          const allChecks: CheckResult[] = report
            ? report.checks && report.checks.length > 0
              ? report.checks
              : [
                  report.geo_result,
                  report.pinning_result,
                  report.travel_result,
                  report.dnsbl_result,
                  report.asn_result,
                  report.ipv6_result,
                  report.timezone_result,
                ]
            : [];

          const criticalChecks = allChecks.filter((c) => c.status === "critical");
          const warningChecks = allChecks.filter((c) => c.status === "warning");
          const primaryIssue: CheckResult | undefined =
            criticalChecks[0] || warningChecks[0] || report?.geo_result;

          let status: CheckStatus = "ok";
          let badgeText = `ДОСТУПЕН · ${country}`;
          let statusPill = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
          let dotColor = "bg-emerald-400";
          let barColor = "bg-emerald-400";
          let barWidth = "w-full";
          let alertNote: string | null = null;

          if (isBlocked) {
            status = "critical";
            badgeText = `СТОП · БЛОК`;
            statusPill = "bg-rose-500/15 text-rose-400 border-rose-500/30";
            dotColor = "bg-rose-500";
            barColor = "bg-rose-500";
            barWidth = "w-1/4";
            alertNote =
              criticalChecks[0]?.message ||
              "Запросы заблокированы защитой. Нажмите «Разблокировать», если ваш VPN надежен.";
          } else if (isSessionAllowed) {
            status = "ok";
            badgeText = `РАЗРЕШЕНО · ${country}`;
            statusPill = "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
            dotColor = "bg-emerald-400";
            barColor = "bg-emerald-400";
            barWidth = "w-full";
            alertNote = null;
          } else if (report) {
            if (report.overall_status === "red" || criticalChecks.length > 0) {
              status = "critical";
              badgeText = `СТОП · БЛОК`;
              statusPill = "bg-rose-500/15 text-rose-400 border-rose-500/30";
              dotColor = "bg-rose-500";
              barColor = "bg-rose-500";
              barWidth = "w-1/4";
              alertNote =
                criticalChecks[0]?.message ||
                report.geo_result.message ||
                "Обнаружен высокий риск бана аккаунта.";
            } else if (report.overall_status === "yellow" || warningChecks.length > 0) {
              status = "warning";
              badgeText = `РИСК · ${country}`;
              statusPill = "bg-amber-500/15 text-amber-400 border-amber-500/30";
              dotColor = "bg-amber-400";
              barColor = "bg-amber-400";
              barWidth = "w-2/3";
              alertNote = warningChecks[0]?.message || report.geo_result.message;
            }
          }

          return (
            <div key={p.id} className="transition-colors hover:bg-white/[0.015]">
              <div
                onClick={() => toggleExpand(p.id)}
                className="px-3 py-2 flex items-center justify-between cursor-pointer select-none"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* Status Indicator Bar + Icon */}
                  <div className="relative flex items-center justify-center w-6 h-6 rounded-md bg-zinc-900/90 border border-white/[0.07] shrink-0">
                    {status === "ok" ? (
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" strokeWidth={1.75} />
                    ) : status === "warning" ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" strokeWidth={1.75} />
                    ) : (
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-400" strokeWidth={1.75} />
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-zinc-100 font-sans tracking-tight">
                        {p.name}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openExternal(p.url);
                        }}
                        className="text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                        title={`Открыть ${p.url}`}
                      >
                        <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-zinc-500 font-mono leading-none truncate">
                        {p.domain}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex flex-col items-end gap-1">
                    <div
                      className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[10px] font-mono tracking-tight font-semibold tabular-nums ${statusPill}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                      <span>{badgeText}</span>
                    </div>
                    {/* CodeBurn style micro meter */}
                    <div className="w-16 h-0.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div className={`h-full ${barColor} ${barWidth} transition-all duration-300`} />
                    </div>
                  </div>

                  <div className="text-zinc-500">
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.5} />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.5} />
                    )}
                  </div>
                </div>
              </div>

              {/* Compact warning/critical sub-row + 1-click unblock button */}
              {alertNote && !isExpanded && (
                <div className="px-3 pb-2 -mt-0.5 text-[10.5px] font-sans text-zinc-400 space-y-1.5">
                  <div className="flex items-start gap-1.5 leading-snug">
                    <span className="text-zinc-600 font-mono shrink-0">└─</span>
                    <span
                      className={`line-clamp-2 ${
                        status === "critical" ? "text-rose-400/95" : "text-amber-400/95"
                      }`}
                    >
                      {alertNote}
                    </span>
                  </div>

                  {(status === "critical" || isBlocked) && onAllowProvider && (
                    <div className="pl-3.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAllowProvider(p.id);
                        }}
                        className="px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[10px] font-sans font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Unlock className="w-2.5 h-2.5" strokeWidth={2} />
                        <span>Разблокировать и разрешить доступ</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Expanded details */}
              {isExpanded && report && primaryIssue && (
                <div className="px-3 pb-2.5 pt-1.5 border-t border-white/[0.04] bg-zinc-950/50 text-[11px] space-y-2">
                  {/* Show all triggered issues if any, otherwise show geo_result */}
                  {criticalChecks.length > 0 || warningChecks.length > 0 ? (
                    <div className="space-y-1.5">
                      {[...criticalChecks, ...warningChecks].map((chk, idx) => (
                        <div
                          key={idx}
                          className={`p-2 rounded border ${
                            chk.status === "critical"
                              ? "bg-rose-500/10 border-rose-500/25 text-rose-200"
                              : "bg-amber-500/10 border-amber-500/25 text-amber-200"
                          }`}
                        >
                          <div className="flex justify-between items-center text-[9.5px] font-mono mb-0.5">
                            <span className="uppercase font-semibold">
                              {chk.status === "critical" ? "Причина блокировки:" : "Предупреждение:"}
                            </span>
                            <span className="opacity-80">{chk.code}</span>
                          </div>
                          <div className="text-[11px] font-sans leading-snug">
                            {chk.message}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-center text-[10px] font-mono text-zinc-400">
                        <span>Статус проверки:</span>
                        <span className="text-emerald-400 font-semibold">
                          {primaryIssue.code}
                        </span>
                      </div>
                      <div className="text-[11px] font-sans text-zinc-300 leading-relaxed">
                        {primaryIssue.message}
                      </div>
                    </>
                  )}

                  {/* Direct action buttons inside expanded card */}
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    {(status !== "ok" || isBlocked) && onAllowProvider && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isBlocked && onUnblockProvider) {
                            onUnblockProvider(p.id);
                          }
                          onAllowProvider(p.id);
                        }}
                        className="px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-[10.5px] font-sans font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Unlock className="w-3 h-3" strokeWidth={2} />
                        <span>Снять блок (разрешить сессию)</span>
                      </button>
                    )}

                    {status !== "ok" && onNavigateToGuide && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigateToGuide();
                        }}
                        className="text-[10.5px] text-amber-400 hover:text-amber-300 font-sans font-medium flex items-center gap-1 cursor-pointer"
                      >
                        <span>Как настроить свой VPN</span>
                        <ArrowRight className="w-3 h-3" strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
