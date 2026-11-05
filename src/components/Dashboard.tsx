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
  ChevronRight,
} from "lucide-react";
import {
  AppStateData,
  ProviderId,
  RiskInterceptPayload,
  RiskReport,
} from "../types";
import {
  allowProviderSession,
  auditConnection,
  cleanAppCache,
  fetchAppState,
  getMockScenario,
  getSysproxyStatus,
  MockScenario,
  pinCurrentIp,
  setMockScenario,
  simulateInterception,
  toggleStrictPinning,
  toggleSysproxy,
  unblockProvider,
  unpinIp,
} from "../utils/api";
import { AlertPopup } from "./AlertPopup";
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
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t === "audit" || t === "guide" || t === "bin" || t === "pulse") return t;
    return "pulse";
  });
  const [state, setState] = useState<AppStateData | null>(null);
  const [reports, setReports] = useState<Partial<Record<ProviderId, RiskReport>>>({});
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [scanLatencyMs, setScanLatencyMs] = useState<number>(42);
  const [sysproxyActive, setSysproxyActive] = useState<boolean>(true);
  const [copiedIp, setCopiedIp] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [interceptPayload, setInterceptPayload] = useState<RiskInterceptPayload | null>(null);
  const [initialGuideTarget, setInitialGuideTarget] = useState<string>("01-personal-vpn-15min");
  const [scenario, setScenario] = useState<MockScenario>(() => {
    const s = new URLSearchParams(window.location.search).get("scenario") as MockScenario | null;
    if (s === "clean" || s === "turkey" || s === "ru") {
      setMockScenario(s);
      return s;
    }
    return getMockScenario();
  });

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

  const runFullAudit = async (force: boolean = false) => {
    const startTime = performance.now();
    setRefreshing(true);

    try {
      const st = await fetchAppState();
      setState(st);

      const proxyActive = await getSysproxyStatus();
      setSysproxyActive(proxyActive);

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
      showToast("Ошибка аудита", err?.message || String(err), "error");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    runFullAudit(false);

    const unlisteners: Array<() => void> = [];
    if (isTauri()) {
      listen<string>("interceptor://open-guide", (event) => {
        setInitialGuideTarget(event.payload || "01-personal-vpn-15min");
        setActiveTab("guide");
      }).then((un) => unlisteners.push(un));

      listen("tray://rescan", () => {
        runFullAudit(true);
      }).then((un) => unlisteners.push(un));

      listen("tray://pin-current-ip", async () => {
        const rep = await auditConnection("anthropic", false);
        if (rep.telemetry.ip) {
          await pinCurrentIp(rep.telemetry.ip);
          runFullAudit(false);
        }
      }).then((un) => unlisteners.push(un));

      listen("network://changed", () => {
        runFullAudit(true);
      }).then((un) => unlisteners.push(un));

      listen<RiskInterceptPayload>("interceptor://risk-detected", (event) => {
        setInterceptPayload(event.payload);
      }).then((un) => unlisteners.push(un));

      listen("interceptor://resolved", () => {
        setInterceptPayload(null);
        runFullAudit(false);
      }).then((un) => unlisteners.push(un));
    }

    return () => {
      unlisteners.forEach((u) => u());
    };
  }, []);

  const activeReport =
    reports.anthropic || reports.openai || reports.gemini || null;
  const currentIp = activeReport?.telemetry.ip || "--";
  const currentCountry = activeReport?.telemetry.country_code || "--";
  const trustScore = activeReport?.trust_score ?? 100;

  const handleSwitchScenario = (next: MockScenario) => {
    setMockScenario(next);
    setScenario(next);
    runFullAudit(true);
  };

  const handleCopyIp = () => {
    if (currentIp && currentIp !== "--") {
      navigator.clipboard.writeText(currentIp);
      setCopiedIp(true);
      showToast("IP скопирован", currentIp, "success");
      setTimeout(() => setCopiedIp(false), 2000);
    }
  };

  const handleToggleSysproxy = async () => {
    try {
      const next = !sysproxyActive;
      const res = await toggleSysproxy(next);
      setSysproxyActive(res);
      showToast(
        res ? "PAC-перехват включен" : "PAC-перехват отключен",
        res
          ? "Селективная маршрутизация ИИ-доменов :8899 активна"
          : "Восстановлена прямая системная маршрутизация",
        res ? "success" : "info"
      );
    } catch (err: any) {
      showToast("Ошибка прокси", err?.message || String(err), "error");
    }
  };

  const handlePinIp = async (ip: string) => {
    try {
      await pinCurrentIp(ip);
      const st = await fetchAppState();
      setState(st);
      showToast("VPS закреплен", `IP ${ip} сохранен как эталонный узел`, "success");
      runFullAudit(false);
    } catch (err: any) {
      showToast("Ошибка закрепления", err?.message || String(err), "error");
    }
  };

  const handleUnpinIp = async () => {
    try {
      await unpinIp();
      const st = await fetchAppState();
      setState(st);
      showToast("VPS откреплен", "Привязка к эталонному IP сброшена", "info");
      runFullAudit(false);
    } catch (err: any) {
      showToast("Ошибка", err?.message || String(err), "error");
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
        next ? "Строгий режим включен" : "Строгий режим отключен",
        next
          ? "Любая смена IP будет перехвачена до отправки запроса"
          : "Включен режим уведомлений",
        next ? "warning" : "info"
      );
      runFullAudit(false);
    } catch (err: any) {
      showToast("Ошибка", err?.message || String(err), "error");
    }
  };

  const handleAllowProvider = async (provider: ProviderId) => {
    try {
      await allowProviderSession(provider);
      showToast(
        "Доступ разрешен",
        `Блокировка для ${provider === "anthropic" ? "Claude" : provider === "openai" ? "ChatGPT" : "Gemini"} снята на текущую сессию`,
        "success"
      );
      await runFullAudit(false);
    } catch (err: any) {
      showToast("Ошибка", err?.message || String(err), "error");
    }
  };

  const handleUnblockProvider = async (provider: ProviderId) => {
    try {
      await unblockProvider(provider);
      await runFullAudit(false);
    } catch (err: any) {
      showToast("Ошибка", err?.message || String(err), "error");
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
        "Кэш ИИ-клиентов очищен",
        `Удалено файлов: ${totalFiles} (${mbFreed} МБ). Локальные трекеры сброшены.`,
        "success"
      );
    } catch (err: any) {
      showToast("Очистка кэша", err?.message || String(err), "error");
    }
  };

  const handleSimulate = async () => {
    try {
      await simulateInterception("anthropic");
      showToast("Тест перехвата", "Вызвано окно экстренного удержания трафика", "info");
      if (onSimulateInBrowser) {
        onSimulateInBrowser();
      }
    } catch (err: any) {
      showToast("Ошибка симуляции", err?.message || String(err), "error");
    }
  };

  const isPinned = state?.pinned_ip != null && state.pinned_ip === currentIp;
  const anyRed =
    reports.anthropic?.overall_status === "red" ||
    reports.openai?.overall_status === "red" ||
    reports.gemini?.overall_status === "red";
  const anyYellow =
    reports.anthropic?.overall_status === "yellow" ||
    reports.openai?.overall_status === "yellow" ||
    reports.gemini?.overall_status === "yellow";

  const trayBadgeText = anyRed
    ? `${currentCountry} · БЛОК`
    : anyYellow
    ? `${currentCountry} · РИСК`
    : `${currentCountry} · ${trustScore}%`;

  const trayDotClass = anyRed
    ? "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]"
    : anyYellow
    ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
    : "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]";

  const ipv6Leak = activeReport?.ipv6_result?.status === "red";
  const tzMismatch = activeReport?.timezone_result?.status && activeReport.timezone_result.status !== "green";

  return (
    <div className="w-[380px] min-h-[560px] max-w-[380px] bg-[#0A0B0E] text-zinc-100 flex flex-col justify-between p-3 select-none font-sans border border-white/[0.08] rounded-xl shadow-2xl relative">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* In-window Emergency Interception Overlay (guarantees user always sees hold prompt) */}
      {interceptPayload && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-2">
          <div className="scale-[0.78] origin-center">
            <AlertPopup
              initialPayload={interceptPayload}
              onResolved={() => {
                setInterceptPayload(null);
                runFullAudit(false);
              }}
            />
          </div>
        </div>
      )}

      {/* Top Header */}
      <div>
        {/* Simulated / Live macOS Menu Bar Status Strip */}
        <div className="flex items-center justify-between px-2 py-1 mb-2 rounded-md bg-[#12141A] border border-white/[0.06] text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${trayDotClass}`} />
            <span className="text-zinc-400 font-medium">Трей macOS:</span>
            <span className="font-mono font-bold text-zinc-100 tracking-tight tabular-nums">
              {trayBadgeText}
            </span>
            {isPinned && (
              <span className="px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-300 font-mono text-[9px]">
                PIN
              </span>
            )}
          </div>
          {!isTauri() && (
            <div className="flex items-center gap-1 font-mono text-[9px]">
              {(["clean", "turkey", "ru"] as MockScenario[]).map((sc) => (
                <button
                  key={sc}
                  type="button"
                  onClick={() => handleSwitchScenario(sc)}
                  className={`px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                    scenario === sc
                      ? "bg-white/[0.12] text-white font-bold"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {sc === "clean" ? "NL" : sc === "turkey" ? "TR" : "RU"}
                </button>
              ))}
            </div>
          )}
        </div>

        <header className="flex items-center justify-between pb-2.5 border-b border-white/[0.07]">
          {/* Logo & Title */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400">
              <Shield className="w-3.5 h-3.5" strokeWidth={1.75} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="text-xs font-bold tracking-tight text-white">
                  AI-AntiBan
                </h1>
                <span className="text-[9px] px-1 py-0.2 rounded bg-zinc-900 border border-white/[0.07] text-zinc-400 font-mono tabular-nums">
                  v1.0.2
                </span>
              </div>
              <p className="text-[9.5px] text-zinc-500 leading-none mt-0.5">
                Защита ИИ-аккаунтов · Zero-MITM
              </p>
            </div>
          </div>

          {/* Controls: PAC Proxy Toggle & Refresh */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleToggleSysproxy}
              title={sysproxyActive ? "Отключить защиту трафика" : "Включить защиту трафика ИИ"}
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
              <span>{sysproxyActive ? "ЗАЩИТА ВКЛ" : "ЗАЩИТА ВЫКЛ"}</span>
            </button>

            <button
              type="button"
              disabled={refreshing}
              onClick={() => runFullAudit(true)}
              title="Перепроверить соединение"
              className="flex items-center gap-1 px-1.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-[10px] font-mono text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              <RotateCw
                className={`w-3 h-3 ${refreshing ? "animate-spin text-emerald-400" : ""}`}
              />
              <span className="tabular-nums text-[9px]">{scanLatencyMs}мс</span>
            </button>
          </div>
        </header>

        {/* Segmented Control Navigation */}
        <nav className="mt-2.5 grid grid-cols-4 gap-1 p-0.5 bg-[#12141A] rounded-lg border border-white/[0.07] text-[11px] font-medium">
          <button
            type="button"
            onClick={() => setActiveTab("pulse")}
            className={`py-1 px-1.5 rounded transition-all text-center cursor-pointer ${
              activeTab === "pulse"
                ? "bg-white/[0.09] text-white font-semibold shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Главная
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("audit")}
            className={`py-1 px-1.5 rounded transition-all text-center cursor-pointer ${
              activeTab === "audit"
                ? "bg-white/[0.09] text-white font-semibold shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Проверки (9)
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("guide")}
            className={`py-1 px-1.5 rounded transition-all text-center cursor-pointer ${
              activeTab === "guide"
                ? "bg-white/[0.09] text-white font-semibold shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            VPN Гайд
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("bin")}
            className={`py-1 px-1.5 rounded transition-all text-center cursor-pointer ${
              activeTab === "bin"
                ? "bg-white/[0.09] text-white font-semibold shadow-xs"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Карты (BIN)
          </button>
        </nav>

        {/* Main Tab Content */}
        <main className="mt-2.5 flex-1">
          {activeTab === "pulse" && (
            <div className="space-y-2.5 animate-in fade-in duration-150">
              {/* Telemetry Card */}
              <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-2">
                <div className="flex items-center justify-between text-[10px] text-zinc-400 pb-1.5 border-b border-white/[0.04]">
                  <span className="uppercase tracking-wider font-semibold">
                    Ваш IP и соединение
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${trayDotClass}`} />
                    <span className="text-zinc-300 font-mono text-[9.5px]">LIVE</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <TrustRing score={trustScore} size={50} strokeWidth={4} />

                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center justify-between">
                      <div
                        onClick={handleCopyIp}
                        className="flex items-center gap-1.5 cursor-pointer group"
                        title="Нажмите, чтобы скопировать IP"
                      >
                        <span className="text-xs font-bold text-white font-mono tabular-nums tracking-tight group-hover:text-emerald-400 transition-colors">
                          {currentIp}
                        </span>
                        {copiedIp ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-2.5 h-2.5 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </div>

                      <span className="px-1.5 py-0.2 rounded bg-zinc-900 border border-white/[0.07] text-[10px] font-mono text-zinc-200 font-bold">
                        {currentCountry}
                      </span>
                    </div>

                    <div className="text-[10.5px] text-zinc-400 font-mono truncate">
                      {activeReport?.telemetry.asn
                        ? `AS${activeReport.telemetry.asn} · ${
                            activeReport.telemetry.isp || activeReport.telemetry.org || "Хостинг"
                          }`
                        : "Определение ASN..."}
                    </div>

                    <div className="flex items-center gap-2 text-[9.5px] font-mono text-zinc-500 pt-0.5 tabular-nums">
                      <span>
                        DNSBL:{" "}
                        <strong className="text-emerald-400">
                          {activeReport?.dnsbl_clean_count || "4/4 чисто"}
                        </strong>
                      </span>
                      <span>·</span>
                      <span>
                        IPv6:{" "}
                        <strong className={ipv6Leak ? "text-rose-400" : "text-emerald-400"}>
                          {ipv6Leak ? "УТЕЧКА" : "Выкл"}
                        </strong>
                      </span>
                      <span>·</span>
                      <span>
                        TZ:{" "}
                        <strong className={tzMismatch ? "text-amber-400" : "text-zinc-300"}>
                          {tzMismatch ? "Рассинхрон" : "OK"}
                        </strong>
                      </span>
                    </div>
                  </div>
                </div>

                {/* VPS Pinning Row */}
                <div className="pt-1.5 border-t border-white/[0.04] flex items-center justify-between text-[10px]">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Pin className={`w-3 h-3 shrink-0 ${isPinned ? "text-emerald-400" : "text-zinc-500"}`} />
                    <span className="text-zinc-400 truncate font-mono">
                      {state?.pinned_ip
                        ? `Мой IP: ${state.pinned_ip}`
                        : "Личный IP не закреплен"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {state?.pinned_ip ? (
                      <>
                        <button
                          type="button"
                          onClick={handleToggleStrict}
                          title="Строгий режим блокирует трафик при любой смене IP"
                          className={`px-1.5 py-0.5 rounded border text-[9px] font-mono cursor-pointer ${
                            state.strict_pinning_enabled
                              ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-400 font-bold"
                              : "bg-zinc-900 border-white/[0.06] text-zinc-400"
                          }`}
                        >
                          {state.strict_pinning_enabled ? "СТРОГИЙ" : "УВЕДОМЛ."}
                        </button>
                        <button
                          type="button"
                          onClick={handleUnpinIp}
                          className="px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.06] text-[9px] text-zinc-400 hover:text-rose-400 cursor-pointer"
                        >
                          Сброс
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handlePinIp(currentIp)}
                        className="flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-semibold cursor-pointer"
                      >
                        <Pin className="w-2.5 h-2.5" />
                        <span>Закрепить IP</span>
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
                onAllowProvider={handleAllowProvider}
                onUnblockProvider={handleUnblockProvider}
              />

              {/* Quick Actions & Hygiene */}
              <div className="space-y-1.5">
                <span className="text-[10px] tracking-wider uppercase text-zinc-400 font-semibold px-0.5">
                  Быстрые действия
                </span>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={handleCleanCache}
                    className="p-2 rounded-lg bg-[#12141A] hover:bg-zinc-900 border border-white/[0.07] hover:border-white/[0.15] text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200 group-hover:text-emerald-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" strokeWidth={1.75} />
                      <span className="truncate">Очистить кэш ИИ</span>
                    </div>
                    <div className="text-[9.5px] text-zinc-500 mt-0.5 truncate leading-tight">
                      Сброс ID Claude / ChatGPT
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={handleSimulate}
                    className="p-2 rounded-lg bg-[#12141A] hover:bg-zinc-900 border border-white/[0.07] hover:border-white/[0.15] text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200 group-hover:text-amber-400 transition-colors">
                      <FlaskConical className="w-3.5 h-3.5 text-amber-400 shrink-0" strokeWidth={1.75} />
                      <span className="truncate">Тест перехвата</span>
                    </div>
                    <div className="text-[9.5px] text-zinc-500 mt-0.5 truncate leading-tight">
                      Симуляция 403 / окна HOLD
                    </div>
                  </button>
                </div>
              </div>

              {/* Monetization / Quick Jump Banner */}
              <div
                onClick={() => setActiveTab("guide")}
                className="p-2.5 rounded-lg bg-gradient-to-r from-emerald-950/30 to-[#12141A] border border-emerald-500/25 hover:border-emerald-500/40 cursor-pointer flex items-center justify-between transition-all group"
              >
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <Zap className="w-3 h-3" strokeWidth={1.75} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white group-hover:text-emerald-300 transition-colors">
                      Свой чистый VPN за 15 мин
                    </div>
                    <div className="text-[9.5px] text-zinc-400">
                      Статический IP в NL/DE · Оплата картой РФ / СБП
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
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
      <footer className="mt-3 pt-2 border-t border-white/[0.07] text-[9.5px] text-zinc-500 flex items-center justify-between">
        <span className="flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-500/80" />
          <span>100% локально · Без телеметрии</span>
        </span>
        <span className="text-zinc-500 font-mono tabular-nums">PAC :8899</span>
      </footer>
    </div>
  );
};
