import React, { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import {
  Shield,
  RotateCw,
  Pin,
  Trash2,
  FlaskConical,
  Zap,
  Radio,
  Copy,
  Check,
  CheckCircle2,
} from "lucide-react";
import {
  AppStateData,
  ProviderId,
  RiskReport,
} from "../types";
import {
  auditConnection,
  cleanAppCache,
  fetchAppState,
  getSysproxyStatus,
  pinCurrentIp,
  simulateInterception,
  toggleStrictPinning,
  toggleSysproxy,
  unpinIp,
} from "../utils/api";
import { TrustRing } from "./TrustRing";
import { ProviderMatrix } from "./ProviderMatrix";
import { DeepAuditTab } from "./DeepAuditTab";
import { GuideViewer } from "./GuideViewer";
import { BinCheckerTab } from "./BinCheckerTab";
import { ToastContainer, ToastMessage } from "./Toast";

type ActiveTab = "pulse" | "audit" | "guide" | "bin";

interface DashboardProps {
  onSimulateInBrowser?: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onSimulateInBrowser }) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>("pulse");
  const [state, setState] = useState<AppStateData | null>(null);
  const [reports, setReports] = useState<Partial<Record<ProviderId, RiskReport>>>({});
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [scanLatencyMs, setScanLatencyMs] = useState<number>(42);
  const [sysproxyActive, setSysproxyActive] = useState<boolean>(false);
  const [copiedIp, setCopiedIp] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [initialGuideTarget, setInitialGuideTarget] = useState<string>("01-personal-vpn-15min");

  const showToast = (
    title: string,
    description?: string,
    type: "success" | "warning" | "error" | "info" = "info"
  ) => {
    const id = Date.now().toString() + Math.random().toString(36).substring(2, 6);
    setToasts((prev) => [...prev, { id, title, description, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Perform full scan for all 3 target providers
  const runFullAudit = async (force: boolean = false) => {
    const startTime = performance.now();
    setRefreshing(true);

    try {
      // 1. Fetch app state (pinned IP, strict pinning, blocked/allowed lists)
      const st = await fetchAppState();
      setState(st);

      // 2. Fetch sysproxy status
      const proxyActive = await getSysproxyStatus();
      setSysproxyActive(proxyActive);

      // 3. Audit all 3 providers
      // The first audit resolves network telemetry and caches it for 30s in the Rust core
      const claudeReport = await auditConnection("anthropic", force);
      const [gptReport, geminiReport] = await Promise.all([
        auditConnection("openai", false),
        auditConnection("gemini", false),
      ]);

      setReports({
        anthropic: claudeReport,
        openai: gptReport,
        gemini: geminiReport,
      });

      const elapsed = Math.round(performance.now() - startTime);
      setScanLatencyMs(Math.max(18, elapsed));
    } catch (err: any) {
      console.error("Failed to run audit:", err);
      showToast("Audit Error", err?.message || String(err), "error");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    runFullAudit(false);

    // Listen for open-guide event from backend
    let unlistenGuide: (() => void) | undefined;
    if (isTauri()) {
      listen<string>("interceptor://open-guide", (event) => {
        setInitialGuideTarget(event.payload || "01-personal-vpn-15min");
        setActiveTab("guide");
      }).then((un) => {
        unlistenGuide = un;
      });
    }

    return () => {
      if (unlistenGuide) unlistenGuide();
    };
  }, []);

  // Primary telemetry is taken from Anthropic report or whichever is available
  const activeReport =
    reports.anthropic || reports.openai || reports.gemini || null;
  const currentIp = activeReport?.telemetry.ip || "--";
  const currentCountry = activeReport?.telemetry.country_code || "--";
  const trustScore = activeReport?.trust_score ?? 100;

  const handleCopyIp = () => {
    if (currentIp && currentIp !== "--") {
      navigator.clipboard.writeText(currentIp);
      setCopiedIp(true);
      showToast("IP Copied", currentIp, "success");
      setTimeout(() => setCopiedIp(false), 2000);
    }
  };

  const handleToggleSysproxy = async () => {
    try {
      const next = !sysproxyActive;
      const res = await toggleSysproxy(next);
      setSysproxyActive(res);
      showToast(
        res ? "Auto-PAC Active" : "Proxy Disabled",
        res ? "Local selective PAC routing :8899 enabled" : "System direct routing restored",
        res ? "success" : "info"
      );
    } catch (err: any) {
      showToast("Proxy Error", err?.message || String(err), "error");
    }
  };

  const handlePinIp = async (ip: string) => {
    try {
      await pinCurrentIp(ip);
      const st = await fetchAppState();
      setState(st);
      showToast("VPS Pinned", `IP ${ip} is now saved as reference server`, "success");
      runFullAudit(false);
    } catch (err: any) {
      showToast("Pin Error", err?.message || String(err), "error");
    }
  };

  const handleUnpinIp = async () => {
    try {
      await unpinIp();
      const st = await fetchAppState();
      setState(st);
      showToast("VPS Unpinned", "Strict reference IP cleared", "info");
      runFullAudit(false);
    } catch (err: any) {
      showToast("Unpin Error", err?.message || String(err), "error");
    }
  };

  const handleToggleStrict = async () => {
    if (!state) return;
    try {
      const next = !state.strict_pinning_enabled;
      await toggleStrictPinning(next);
      const st = await fetchAppState();
      setState(st);
      showToast(
        next ? "Strict Pinning Enabled" : "Strict Pinning Disabled",
        next ? "Non-pinned connections will be held" : "Advisory mode active",
        next ? "warning" : "info"
      );
      runFullAudit(false);
    } catch (err: any) {
      showToast("Error", err?.message || String(err), "error");
    }
  };

  const handleCleanCache = async () => {
    try {
      const [res1, res2] = await Promise.all([
        cleanAppCache("anthropic"),
        cleanAppCache("openai"),
      ]);
      const totalFiles = (res1.files_removed || 0) + (res2.files_removed || 0);
      const totalBytes = (res1.bytes_freed || 0) + (res2.bytes_freed || 0);
      const mbFreed = (totalBytes / (1024 * 1024)).toFixed(1);

      showToast(
        "AI App Cache Cleaned",
        `Removed ${totalFiles} cached files (${mbFreed} MB freed). Local browser/app tracking IDs reset.`,
        "success"
      );
    } catch (err: any) {
      showToast("Cache Cleaner", err?.message || String(err), "error");
    }
  };

  const handleSimulate = async () => {
    try {
      await simulateInterception("anthropic");
      showToast("Simulation Dispatched", "Emergency interception modal invoked", "info");
      if (onSimulateInBrowser) {
        onSimulateInBrowser();
      }
    } catch (err: any) {
      showToast("Simulation Error", err?.message || String(err), "error");
    }
  };

  const isPinned = state?.pinned_ip != null && state.pinned_ip === currentIp;

  return (
    <div className="w-[380px] min-h-[560px] max-w-[380px] bg-[#0A0B0E] text-zinc-100 flex flex-col justify-between p-3 select-none font-mono">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Top Header */}
      <div>
        <header className="flex items-center justify-between pb-2.5 border-b border-white/[0.07]">
          {/* Logo & Title */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400">
              <Shield className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-xs font-bold tracking-tight text-white font-mono">
                  AI-AntiBan
                </h1>
                <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-900 border border-white/[0.06] text-zinc-400">
                  v0.1
                </span>
              </div>
              <p className="text-[9px] text-zinc-500 font-mono leading-none">
                Risk Auditor Engine
              </p>
            </div>
          </div>

          {/* Controls: PAC Proxy Toggle & Refresh */}
          <div className="flex items-center gap-1.5">
            {/* Auto-PAC System Proxy Toggle */}
            <button
              type="button"
              onClick={handleToggleSysproxy}
              title={sysproxyActive ? "Disable Auto-PAC Proxy" : "Enable Auto-PAC System Proxy"}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono border transition-all cursor-pointer ${
                sysproxyActive
                  ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 font-semibold shadow-xs"
                  : "bg-zinc-900 border-white/[0.08] text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Radio
                className={`w-3 h-3 ${
                  sysproxyActive ? "text-emerald-400 animate-pulse" : "text-zinc-500"
                }`}
              />
              <span>{sysproxyActive ? "PAC ON" : "PAC OFF"}</span>
            </button>

            {/* Refresh Scan Button */}
            <button
              type="button"
              disabled={refreshing}
              onClick={() => runFullAudit(true)}
              title="Rescan connection (bypasses telemetry cache)"
              className="flex items-center gap-1 px-1.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-[10px] font-mono text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <RotateCw
                className={`w-3 h-3 ${refreshing ? "animate-spin text-emerald-400" : ""}`}
              />
              <span className="tabular-nums text-[9px]">{scanLatencyMs}ms</span>
            </button>
          </div>
        </header>

        {/* Segmented Control Navigation */}
        <nav className="mt-2.5 grid grid-cols-4 gap-1 p-0.5 bg-[#12141A] rounded-lg border border-white/[0.07] text-[11px] font-mono">
          <button
            type="button"
            onClick={() => setActiveTab("pulse")}
            className={`py-1 px-1.5 rounded transition-all text-center cursor-pointer ${
              activeTab === "pulse"
                ? "bg-white/[0.08] text-white font-semibold shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Pulse
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("audit")}
            className={`py-1 px-1.5 rounded transition-all text-center cursor-pointer ${
              activeTab === "audit"
                ? "bg-white/[0.08] text-white font-semibold shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Audit (9)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("guide")}
            className={`py-1 px-1.5 rounded transition-all text-center cursor-pointer ${
              activeTab === "guide"
                ? "bg-white/[0.08] text-white font-semibold shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            VPN Guide
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("bin")}
            className={`py-1 px-1.5 rounded transition-all text-center cursor-pointer ${
              activeTab === "bin"
                ? "bg-white/[0.08] text-white font-semibold shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            BIN
          </button>
        </nav>

        {/* Main Tab Content */}
        <main className="mt-2.5 flex-1">
          {activeTab === "pulse" && (
            <div className="space-y-2.5 animate-in fade-in duration-150">
              {/* Telemetry Card */}
              <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 pb-1.5 border-b border-white/[0.04]">
                  <span className="uppercase tracking-wider font-semibold">
                    Connection Telemetry
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-zinc-300">Live</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Trust Score Ring */}
                  <TrustRing score={trustScore} size={48} strokeWidth={3.5} />

                  {/* IP & Host details */}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center justify-between">
                      <div
                        onClick={handleCopyIp}
                        className="flex items-center gap-1.5 cursor-pointer group"
                        title="Click to copy IP"
                      >
                        <span className="text-xs font-bold text-white font-mono tracking-tight group-hover:text-emerald-400 transition-colors">
                          {currentIp}
                        </span>
                        {copiedIp ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-2.5 h-2.5 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </div>

                      <span className="px-1.5 py-0.2 rounded bg-zinc-900 border border-white/[0.06] text-[10px] font-mono text-zinc-300 font-bold">
                        {currentCountry}
                      </span>
                    </div>

                    <div className="text-[10px] text-zinc-400 font-mono truncate">
                      {activeReport?.telemetry.asn
                        ? `AS${activeReport.telemetry.asn} · ${
                            activeReport.telemetry.isp || activeReport.telemetry.org || "Hosting"
                          }`
                        : "Detecting ASN..."}
                    </div>

                    {/* Compact Specs line */}
                    <div className="flex items-center gap-2 text-[9.5px] font-mono text-zinc-500 pt-0.5">
                      <span>DNSBL: <strong className="text-emerald-400">{activeReport?.dnsbl_clean_count || "0/4 Clean"}</strong></span>
                      <span>·</span>
                      <span>IPv6: <strong className="text-zinc-400">Off</strong></span>
                      <span>·</span>
                      <span>TZ: <strong className="text-zinc-400">{activeReport?.telemetry.timezone ? "UTC" : "Local"}</strong></span>
                    </div>
                  </div>
                </div>

                {/* VPS Pinning Row */}
                <div className="pt-1.5 border-t border-white/[0.04] flex items-center justify-between text-[10px] font-mono">
                  <div className="flex items-center gap-1.5">
                    <Pin className={`w-3 h-3 ${isPinned ? "text-emerald-400" : "text-zinc-500"}`} />
                    <span className="text-zinc-400">
                      {state?.pinned_ip
                        ? `Pinned: ${state.pinned_ip.slice(0, 15)}...`
                        : "Unpinned VPS"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {state?.pinned_ip ? (
                      <>
                        <button
                          type="button"
                          onClick={handleToggleStrict}
                          title="Toggle Strict Pinning (Rejects any IP switch)"
                          className={`px-1.5 py-0.5 rounded border text-[9px] cursor-pointer ${
                            state.strict_pinning_enabled
                              ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400 font-bold"
                              : "bg-zinc-900 border-white/[0.06] text-zinc-400"
                          }`}
                        >
                          {state.strict_pinning_enabled ? "STRICT ON" : "ADVISORY"}
                        </button>
                        <button
                          type="button"
                          onClick={handleUnpinIp}
                          className="px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.06] text-[9px] text-zinc-400 hover:text-rose-400 cursor-pointer"
                        >
                          Unpin
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handlePinIp(currentIp)}
                        className="px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-semibold cursor-pointer"
                      >
                        📌 Pin Current IP
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Provider Compatibility Matrix */}
              <ProviderMatrix
                reports={reports}
                state={state}
                onNavigateToGuide={() => setActiveTab("guide")}
              />

              {/* Quick Actions & Hygiene */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-mono tracking-wider uppercase text-zinc-400 font-medium px-0.5">
                  Quick Actions & Hygiene
                </span>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={handleCleanCache}
                    className="p-2 rounded-lg bg-[#12141A] hover:bg-zinc-900 border border-white/[0.07] hover:border-white/[0.15] text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200 group-hover:text-emerald-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate">🧹 Clean AI Cache</span>
                    </div>
                    <div className="text-[9px] text-zinc-500 font-mono mt-0.5 truncate leading-tight">
                      Reset Claude/GPT local IDs
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleSimulate}
                    className="p-2 rounded-lg bg-[#12141A] hover:bg-zinc-900 border border-white/[0.07] hover:border-white/[0.15] text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200 group-hover:text-amber-400 transition-colors">
                      <FlaskConical className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="truncate">🧪 Test Popup</span>
                    </div>
                    <div className="text-[9px] text-zinc-500 font-mono mt-0.5 truncate leading-tight">
                      Simulate 403 Hold packet
                    </div>
                  </button>
                </div>
              </div>

              {/* Monetization / Quick Jump Banner */}
              <div
                onClick={() => setActiveTab("guide")}
                className="p-2.5 rounded-lg bg-gradient-to-r from-emerald-950/30 to-zinc-900 border border-emerald-500/25 hover:border-emerald-500/40 cursor-pointer flex items-center justify-between transition-all group"
              >
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <Zap className="w-3 h-3" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white font-mono group-hover:text-emerald-300 transition-colors">
                      Свой чистый VPN за 15 мин
                    </div>
                    <div className="text-[9px] text-zinc-400 font-mono">
                      Статический IP в NL/DE · Оплата РФ картой
                    </div>
                  </div>
                </div>
                <span className="text-xs text-emerald-400 font-mono font-bold group-hover:translate-x-0.5 transition-transform">
                  -&gt;
                </span>
              </div>
            </div>
          )}

          {activeTab === "audit" && (
            <div className="animate-in fade-in duration-150">
              <DeepAuditTab
                report={activeReport}
                state={state}
                onNavigateToGuide={(ref) => {
                  if (ref) setInitialGuideTarget(ref);
                  setActiveTab("guide");
                }}
              />
            </div>
          )}

          {activeTab === "guide" && (
            <div className="animate-in fade-in duration-150">
              <GuideViewer
                initialGuide={initialGuideTarget}
                currentIp={currentIp}
                onPinIp={handlePinIp}
                onToast={showToast}
              />
            </div>
          )}

          {activeTab === "bin" && (
            <div className="animate-in fade-in duration-150">
              <BinCheckerTab
                vpnCountry={currentCountry}
                onNavigateToPaymentGuide={() => {
                  setInitialGuideTarget("02-safe-payment-cards");
                  setActiveTab("guide");
                }}
                onToast={showToast}
              />
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="mt-3 pt-2 border-t border-white/[0.07] text-[9.5px] text-zinc-500 font-mono flex items-center justify-between">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-500/80" />
          <span>Zero-Telemetry Engine</span>
        </span>
        <span className="text-zinc-600">Local PAC :8899</span>
      </footer>
    </div>
  );
};
