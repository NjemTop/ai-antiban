import React, { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Sparkles,
  Bot,
  Cpu,
  ExternalLink,
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
  icon: React.ReactNode;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "anthropic",
    name: "Claude (Anthropic)",
    domain: "claude.ai",
    url: "https://claude.ai",
    icon: <Sparkles className="w-3.5 h-3.5 text-amber-300" />,
  },
  {
    id: "openai",
    name: "ChatGPT (OpenAI)",
    domain: "chatgpt.com",
    url: "https://chatgpt.com",
    icon: <Bot className="w-3.5 h-3.5 text-emerald-300" />,
  },
  {
    id: "gemini",
    name: "Gemini / AI Studio",
    domain: "gemini.google.com",
    url: "https://gemini.google.com",
    icon: <Cpu className="w-3.5 h-3.5 text-blue-300" />,
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
        <span className="text-[10px] font-mono tracking-wider uppercase text-zinc-400 font-medium">
          Provider Compatibility Matrix
        </span>
        <span className="text-[10px] font-mono text-zinc-500">3 Targets</span>
      </div>

      <div className="space-y-1.5">
        {PROVIDERS.map((p) => {
          const report = reports[p.id];
          const isExpanded = !!expanded[p.id];
          const country = report?.telemetry.country_code ?? "--";

          // Determine provider status
          const isSessionAllowed = state?.session_allowed_providers.includes(p.id);
          const isBlocked = state?.blocked_providers.includes(p.id);

          let status: CheckStatus = "ok";
          let badgeText = `SAFE · ${country}`;
          let statusPill = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
          let dotColor = "bg-emerald-400";
          let alertNote: string | null = null;

          if (isBlocked) {
            status = "critical";
            badgeText = `BLOCKED · USER`;
            statusPill = "bg-rose-500/10 text-rose-400 border-rose-500/20";
            dotColor = "bg-rose-500";
            alertNote = "Network kill-switch active until safe IP switch.";
          } else if (report) {
            if (report.overall_status === "red" || report.geo_result.status === "critical") {
              status = "critical";
              badgeText = `BLOCKED · ${country}`;
              statusPill = "bg-rose-500/10 text-rose-400 border-rose-500/20";
              dotColor = "bg-rose-500";
              alertNote = report.geo_result.message || "Region restricted or blacklisted.";
            } else if (report.overall_status === "yellow" || report.geo_result.status === "warning") {
              status = "warning";
              badgeText = `RISK · ${country}`;
              statusPill = "bg-amber-500/10 text-amber-400 border-amber-500/20";
              dotColor = "bg-amber-400";
              alertNote = report.geo_result.message || "Suboptimal connection parameters.";
            }
          }

          if (isSessionAllowed && status === "critical") {
            badgeText = `ALLOWED · SESSION`;
            statusPill = "bg-amber-500/15 text-amber-300 border-amber-500/30";
            dotColor = "bg-amber-400 animate-pulse";
          }

          return (
            <div
              key={p.id}
              className="bg-[#12141A] rounded-lg border border-white/[0.07] overflow-hidden transition-all duration-150 hover:border-white/[0.14]"
            >
              <div
                onClick={() => toggleExpand(p.id)}
                className="p-2.5 flex items-center justify-between cursor-pointer select-none"
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-zinc-900 border border-white/[0.06] flex items-center justify-center shrink-0">
                    {p.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-zinc-100 font-mono tracking-tight">
                        {p.name}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openExternal(p.url);
                        }}
                        className="text-zinc-500 hover:text-zinc-300 transition-colors"
                        title={`Open ${p.domain}`}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono leading-none mt-0.5">
                      {p.domain}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-mono tracking-tight font-medium ${statusPill}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                    <span>{badgeText}</span>
                  </div>
                  <div className="text-zinc-500">
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </div>
                </div>
              </div>

              {/* Sub-row when warning or blocked */}
              {alertNote && !isExpanded && (
                <div className="px-2.5 pb-2 -mt-1 text-[10px] font-mono text-zinc-400 flex items-start gap-1.5">
                  <span className="text-zinc-600">└─</span>
                  <span className={status === "critical" ? "text-rose-400/90" : "text-amber-400/90"}>
                    {alertNote}
                  </span>
                </div>
              )}

              {/* Expanded details */}
              {isExpanded && report && (
                <div className="px-2.5 pb-2.5 pt-1 border-t border-white/[0.04] bg-zinc-950/40 text-[11px] font-mono space-y-1.5">
                  <div className="flex justify-between text-zinc-400">
                    <span>Geo Status:</span>
                    <span
                      className={
                        report.geo_result.status === "ok"
                          ? "text-emerald-400"
                          : report.geo_result.status === "warning"
                          ? "text-amber-400"
                          : "text-rose-400"
                      }
                    >
                      {report.geo_result.code}
                    </span>
                  </div>

                  <div className="text-[10px] text-zinc-400 leading-snug">
                    {report.geo_result.message}
                  </div>

                  {report.geo_result.guide_ref && onNavigateToGuide && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateToGuide();
                      }}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 underline font-mono flex items-center gap-1 pt-1"
                    >
                      <span>Read guide & solution</span>
                      <span>-&gt;</span>
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
