import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";
import { AppStateData, CheckStatus, ProviderId, RiskReport } from "../types";
import { openExternal } from "../utils/opener";

interface ProviderMatrixProps {
  reports: Partial<Record<ProviderId, RiskReport>>;
  state: AppStateData | null;
  onNavigateToGuide?: () => void;
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
}) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10px] font-sans tracking-wider uppercase text-zinc-400 font-semibold">
          Матрица совместимости ИИ
        </span>
        <span className="text-[10px] font-mono text-zinc-500">3 шлюза</span>
      </div>

      <div className="bg-[#12141A] rounded-lg border border-white/[0.07] divide-y divide-white/[0.05] overflow-hidden">
        {PROVIDERS.map((p) => {
          const report = reports[p.id];
          const isExpanded = !!expanded[p.id];
          const country = report?.telemetry.country_code ?? "--";

          const isSessionAllowed = state?.session_allowed_providers.includes(p.id);
          const isBlocked = state?.blocked_providers.includes(p.id);

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
            alertNote = "Активен жесткий Kill-Switch до смены IP на безопасный.";
          } else if (report) {
            if (report.overall_status === "red" || report.geo_result.status === "critical") {
              status = "critical";
              badgeText = `БЛОК · ${country}`;
              statusPill = "bg-rose-500/15 text-rose-400 border-rose-500/30";
              dotColor = "bg-rose-500";
              barColor = "bg-rose-500";
              barWidth = "w-1/4";
              alertNote = report.geo_result.message || "Регион заблокирован провайдером.";
            } else if (report.overall_status === "yellow" || report.geo_result.status === "warning") {
              status = "warning";
              badgeText = `РИСК · ${country}`;
              statusPill = "bg-amber-500/15 text-amber-400 border-amber-500/30";
              dotColor = "bg-amber-400";
              barColor = "bg-amber-400";
              barWidth = "w-2/3";
              alertNote =
                report.geo_result.status !== "ok"
                  ? report.geo_result.message
                  : report.dnsbl_result.status !== "ok"
                  ? report.dnsbl_result.message
                  : report.asn_result.message;
            }
          }

          if (isSessionAllowed && status === "critical") {
            badgeText = `РАЗРЕШЕН · СЕССИЯ`;
            statusPill = "bg-amber-500/15 text-amber-300 border-amber-500/30";
            dotColor = "bg-amber-400 animate-pulse";
            barColor = "bg-amber-400";
            barWidth = "w-1/2";
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

              {/* Compact warning/critical sub-row */}
              {alertNote && !isExpanded && (
                <div className="px-3 pb-2 -mt-0.5 text-[10.5px] font-sans text-zinc-400 flex items-start gap-1.5 leading-snug">
                  <span className="text-zinc-600 font-mono shrink-0">└─</span>
                  <span
                    className={`line-clamp-2 ${
                      status === "critical" ? "text-rose-400/95" : "text-amber-400/95"
                    }`}
                  >
                    {alertNote}
                  </span>
                </div>
              )}

              {/* Expanded details */}
              {isExpanded && report && (
                <div className="px-3 pb-2.5 pt-1.5 border-t border-white/[0.04] bg-zinc-950/50 text-[11px] space-y-1.5">
                  <div className="flex justify-between items-center text-[10px] font-mono text-zinc-400">
                    <span>Код правила:</span>
                    <span
                      className={
                        report.geo_result.status === "ok"
                          ? "text-emerald-400 font-semibold"
                          : report.geo_result.status === "warning"
                          ? "text-amber-400 font-semibold"
                          : "text-rose-400 font-semibold"
                      }
                    >
                      {report.geo_result.code}
                    </span>
                  </div>

                  <div className="text-[11px] font-sans text-zinc-300 leading-relaxed">
                    {report.geo_result.message}
                  </div>

                  {status !== "ok" && onNavigateToGuide && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateToGuide();
                      }}
                      className="text-[10.5px] text-amber-400 hover:text-amber-300 font-sans font-medium flex items-center gap-1 pt-0.5 cursor-pointer"
                    >
                      <span>Открыть гайд по настройке чистого VPS (NL / DE / US)</span>
                      <ArrowRight className="w-3 h-3" strokeWidth={1.5} />
                    </button>
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
