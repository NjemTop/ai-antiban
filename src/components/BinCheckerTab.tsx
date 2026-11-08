import React, { useState } from "react";
import {
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Clock,
  MapPin,
  Copy,
  Check,
  ShieldCheck,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { BinAuditResult, RiskReport, AppStateData } from "../types";
import { checkPaymentBin, setWarmupTimer } from "../utils/api";

interface BinCheckerTabProps {
  vpnCountry?: string;
  activeReport?: RiskReport | null;
  state?: AppStateData | null;
  onStateChange?: () => void;
  onNavigateToPaymentGuide?: () => void;
  onToast?: (
    title: string,
    desc?: string,
    type?: "success" | "warning" | "error" | "info"
  ) => void;
}

interface TaxFreeAddress {
  stateName: string;
  code: string;
  street: string;
  city: string;
  zip: string;
}

const TAX_FREE_ADDRESSES: TaxFreeAddress[] = [
  {
    stateName: "Делавэр (0% Tax)",
    code: "DE",
    street: "1201 N Orange St, Ste 700",
    city: "Wilmington",
    zip: "19801",
  },
  {
    stateName: "Орегон (0% Tax)",
    code: "OR",
    street: "1001 SW 5th Ave, Ste 1100",
    city: "Portland",
    zip: "97204",
  },
  {
    stateName: "Нью-Гэмпшир (0% Tax)",
    code: "NH",
    street: "100 Market St, Ste 400",
    city: "Portsmouth",
    zip: "03801",
  },
  {
    stateName: "Монтана (0% Tax)",
    code: "MT",
    street: "208 N Broadway, Ste 320",
    city: "Billings",
    zip: "59101",
  },
  {
    stateName: "Аляска (0% Tax)",
    code: "AK",
    street: "333 W 4th Ave, Ste 200",
    city: "Anchorage",
    zip: "99501",
  },
];

export const BinCheckerTab: React.FC<BinCheckerTabProps> = ({
  vpnCountry = "NL",
  activeReport,
  state,
  onStateChange,
  onNavigateToPaymentGuide,
  onToast,
}) => {
  const [subTab, setSubTab] = useState<"card" | "warmup">("card");
  const [binInput, setBinInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<BinAuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedAddressIndex, setSelectedAddressIndex] = useState<number>(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const effectiveCountry =
    vpnCountry && vpnCountry !== "--"
      ? vpnCountry
      : activeReport?.telemetry.country_code || "NL";

  const detectBrand = (val: string): string => {
    const clean = val.replace(/\D/g, "");
    if (!clean) return "Карта";
    if (clean.startsWith("4")) return "Visa";
    if (
      clean.startsWith("51") ||
      clean.startsWith("52") ||
      clean.startsWith("53") ||
      clean.startsWith("54") ||
      clean.startsWith("55") ||
      (Number(clean.slice(0, 4)) >= 2221 && Number(clean.slice(0, 4)) <= 2720)
    ) {
      return "Mastercard";
    }
    if (
      clean.startsWith("2200") ||
      clean.startsWith("2201") ||
      clean.startsWith("2202") ||
      clean.startsWith("2203") ||
      clean.startsWith("2204")
    ) {
      return "МИР (РФ)";
    }
    if (clean.startsWith("34") || clean.startsWith("37")) return "Amex";
    if (clean.startsWith("62")) return "UnionPay";
    return "Банк";
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 8);
    setBinInput(raw);
    setError(null);
  };

  const runBinAudit = async (rawBin: string) => {
    const clean = rawBin.replace(/\D/g, "");

    if (clean.length < 6) {
      setError("Введите минимум 6 первых цифр карты (BIN)");
      return;
    }

    if (clean.length > 8) {
      setError("Для приватности вводятся только первые 6–8 цифр (BIN)");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await checkPaymentBin(clean, effectiveCountry);
      setResult(res);
      if (onToast) {
        if (res.status === "ok") {
          onToast(
            "Проверка BIN завершена",
            `${res.bank_name || "Банк"} (${res.country_code})`,
            "success"
          );
        } else if (res.status === "warning") {
          onToast("Предупреждение по карте", res.advisory, "warning");
        } else {
          onToast("Критический риск оплаты", res.advisory, "error");
        }
      }
    } catch (err: any) {
      setError(
        typeof err === "string" ? err : err?.message || "Ошибка проверки BIN"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await runBinAudit(binInput);
  };

  const copyToClipboard = async (text: string, key: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
      onToast?.("Скопировано", `${label}: ${text}`, "success");
    } catch {
      onToast?.("Ошибка", "Не удалось скопировать в буфер", "error");
    }
  };

  const handleStartWarmup = async () => {
    try {
      const now = Date.now();
      await setWarmupTimer(now);
      onToast?.("Таймер запущен", "Отсчет 96 часов (Free Tier) начат", "success");
      onStateChange?.();
    } catch (err: any) {
      onToast?.("Ошибка", err?.message || "Не удалось сохранить таймер", "error");
    }
  };

  const handleResetWarmup = async () => {
    try {
      await setWarmupTimer(null);
      onToast?.("Таймер сброшен", "Прогрев обнулен", "info");
      onStateChange?.();
    } catch (err: any) {
      onToast?.("Ошибка", err?.message || "Не удалось сбросить таймер", "error");
    }
  };

  const warmupStartedAt = state?.warmup_started_at || null;
  const now = Date.now();
  const elapsedMs = warmupStartedAt ? Math.max(0, now - warmupStartedAt) : 0;
  const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
  const targetHours = 96; // 4 days recommended from 1,693 study
  const progressPercent = warmupStartedAt
    ? Math.min(100, Math.round((elapsedHours / targetHours) * 100))
    : 0;
  const isWarmedUp = elapsedHours >= targetHours;

  const currentAddress = TAX_FREE_ADDRESSES[selectedAddressIndex];
  const detectedBrand = detectBrand(binInput);

  return (
    <div className="space-y-2.5 pb-1">
      {/* Sub-tab Navigation */}
      <div className="grid grid-cols-2 gap-1 p-0.5 bg-[#12141A] rounded-lg border border-white/[0.07] text-[11px] font-medium">
        <button
          type="button"
          onClick={() => setSubTab("card")}
          className={`py-1 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            subTab === "card"
              ? "bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold shadow-xs"
              : "text-zinc-400 hover:text-zinc-200 border border-transparent"
          }`}
        >
          <CreditCard className="w-3 h-3" strokeWidth={1.75} />
          <span>Проверка Карты и Адрес</span>
        </button>

        <button
          type="button"
          onClick={() => setSubTab("warmup")}
          className={`py-1 px-2 rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            subTab === "warmup"
              ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold shadow-xs"
              : "text-zinc-400 hover:text-zinc-200 border border-transparent"
          }`}
        >
          <Clock className="w-3 h-3" strokeWidth={1.75} />
          <span>Чеклист и Прогрев</span>
          {warmupStartedAt && (
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isWarmedUp ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
              }`}
            />
          )}
        </button>
      </div>

      {subTab === "card" && (
        <div className="space-y-2.5 animate-in fade-in duration-150">
          {/* Header Banner */}
          <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100 font-sans">
                <CreditCard className="w-3.5 h-3.5 text-amber-400" strokeWidth={1.75} />
                <span>Проверка совместимости региона биллинга (Geo-Billing)</span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-white/[0.06] text-[10px] font-mono text-zinc-400">
                Ваш шлюз: <strong className="text-emerald-400">{effectiveCountry}</strong>
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
              Проверка страны банка-эмитента и типа карты. Несовпадение региона или тип PREPAID часто приводят к мгновенному отклонению Stripe.
            </p>
          </div>

          {/* Input Form */}
          <form onSubmit={handleCheck} className="space-y-1.5">
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                <CreditCard className="w-4 h-4 text-zinc-400" strokeWidth={1.5} />
              </div>

              <input
                type="text"
                value={binInput}
                onChange={handleInputChange}
                placeholder="4833 12 (первые 6–8 цифр)"
                maxLength={8}
                className="w-full bg-[#12141A] border border-white/[0.1] rounded-lg pl-9 pr-28 py-2 text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 tabular-nums tracking-widest"
              />

              <div className="absolute inset-y-0 right-1.5 flex items-center gap-1.5">
                <span className="text-[10px] font-mono text-zinc-500 pr-1 select-none">
                  {detectedBrand}
                </span>
                <button
                  type="submit"
                  disabled={loading || binInput.length < 6}
                  className="py-1 px-2.5 rounded bg-amber-500 hover:bg-amber-400 text-zinc-950 disabled:bg-zinc-800 disabled:text-zinc-600 text-[11px] font-sans font-bold transition-all cursor-pointer disabled:cursor-not-allowed"
                >
                  {loading ? "..." : "Проверить"}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-[11px] font-sans text-rose-400 flex items-center gap-1 px-1">
                <AlertTriangle className="w-3 h-3 shrink-0" strokeWidth={1.75} />
                <span>{error}</span>
              </div>
            )}
          </form>

          {/* Pre-fill Quick Test Buttons */}
          <div className="flex items-center gap-1.5 px-0.5 text-[10px] font-mono text-zinc-500 flex-wrap">
            <span className="font-sans">Примеры BIN:</span>
            <button
              type="button"
              onClick={() => {
                setBinInput("220024");
                runBinAudit("220024");
              }}
              className="px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.06] text-zinc-300 hover:text-white cursor-pointer"
            >
              220024 (Мир РФ)
            </button>
            <button
              type="button"
              onClick={() => {
                setBinInput("483312");
                runBinAudit("483312");
              }}
              className="px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.06] text-zinc-300 hover:text-white cursor-pointer"
            >
              483312 (Virtual US)
            </button>
            <button
              type="button"
              onClick={() => {
                setBinInput("440043");
                runBinAudit("440043");
              }}
              className="px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.06] text-zinc-300 hover:text-white cursor-pointer"
            >
              440043 (Kaspi KZ)
            </button>
            <button
              type="button"
              onClick={() => {
                setBinInput("535456");
                runBinAudit("535456");
              }}
              className="px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.06] text-zinc-300 hover:text-white cursor-pointer"
            >
              535456 (Debit NL)
            </button>
          </div>

          {/* Audit Result Card */}
          {result && (
            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-2">
              <div className="flex items-center justify-between pb-1.5 border-b border-white/[0.05]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono font-bold text-white tabular-nums">
                    BIN {result.bin}
                  </span>
                  <span className="text-[11px] font-sans text-zinc-400 truncate">
                    {result.bank_name || "Зарубежный банк-эмитент"}
                  </span>
                </div>

                <div
                  className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold border shrink-0 ${
                    result.status === "ok"
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : result.status === "warning"
                      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                      : "bg-rose-500/15 text-rose-400 border-rose-500/30"
                  }`}
                >
                  {result.status === "ok" ? (
                    <CheckCircle2 className="w-3 h-3" strokeWidth={1.75} />
                  ) : result.status === "warning" ? (
                    <AlertTriangle className="w-3 h-3" strokeWidth={1.75} />
                  ) : (
                    <XCircle className="w-3 h-3" strokeWidth={1.75} />
                  )}
                  <span>
                    {result.status === "ok"
                      ? "СОВМЕСТИМО"
                      : result.status === "warning"
                      ? "ВНИМАНИЕ"
                      : "ОТКЛОНЕНО"}
                  </span>
                </div>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-3 gap-1.5 text-xs">
                <div className="bg-zinc-950/50 p-2 rounded border border-white/[0.04]">
                  <span className="text-[9.5px] font-sans text-zinc-500 block">
                    Страна банка
                  </span>
                  <span className="text-zinc-100 font-mono font-semibold text-xs">
                    {result.country_code || "--"}
                  </span>
                </div>

                <div className="bg-zinc-950/50 p-2 rounded border border-white/[0.04]">
                  <span className="text-[9.5px] font-sans text-zinc-500 block">
                    Тип карты
                  </span>
                  <span
                    className={`font-mono font-semibold text-xs ${
                      result.is_prepaid ? "text-amber-400" : "text-zinc-100"
                    }`}
                  >
                    {result.card_type || "DEBIT"}
                  </span>
                </div>

                <div className="bg-zinc-950/50 p-2 rounded border border-white/[0.04]">
                  <span className="text-[9.5px] font-sans text-zinc-500 block">
                    Виртуальная карта
                  </span>
                  <span
                    className={`font-mono font-semibold text-xs ${
                      result.is_prepaid ? "text-rose-400" : "text-emerald-400"
                    }`}
                  >
                    {result.is_prepaid ? "ДА (Ограничения)" : "НЕТ (Стандартная)"}
                  </span>
                </div>
              </div>

              {/* Antifraud Advisory */}
              <div
                className={`p-2 rounded text-[11px] font-sans leading-relaxed border ${
                  result.status === "ok"
                    ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
                    : result.status === "warning"
                    ? "bg-amber-500/5 border-amber-500/20 text-amber-300"
                    : "bg-rose-500/5 border-rose-500/20 text-rose-300"
                }`}
              >
                <div className="font-semibold text-[9.5px] font-mono uppercase tracking-wider mb-0.5 opacity-80">
                  Анализ совместимости биллинга:
                </div>
                {result.advisory}
              </div>

              {result.status !== "ok" && onNavigateToPaymentGuide && (
                <button
                  type="button"
                  onClick={onNavigateToPaymentGuide}
                  className="w-full py-1.5 px-3 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-[11px] font-sans font-medium text-zinc-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>Инструкция: безопасная оплата подписок и биллинг</span>
                  <ArrowRight className="w-3.5 h-3.5 text-amber-400" strokeWidth={1.75} />
                </button>
              )}
            </div>
          )}

          {/* Tax-Free US Billing Address Generator */}
          <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100 font-sans">
                <MapPin className="w-3.5 h-3.5 text-sky-400" strokeWidth={1.75} />
                <span>Генератор адреса без налога (0% Sales Tax US)</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">Stripe AVS</span>
            </div>

            <p className="text-[10.5px] text-zinc-400 font-sans leading-relaxed">
              Указывайте безналоговые штаты США для карт с BIN US, чтобы не переплачивать налог штата (+8–10%) и не вызывать сбой баланса при списании $20.
            </p>

            <div className="grid grid-cols-5 gap-1">
              {TAX_FREE_ADDRESSES.map((addr, idx) => (
                <button
                  key={addr.code}
                  type="button"
                  onClick={() => setSelectedAddressIndex(idx)}
                  className={`py-1 px-1 rounded text-[10px] font-mono transition-all text-center cursor-pointer ${
                    selectedAddressIndex === idx
                      ? "bg-sky-500/20 text-sky-300 border border-sky-500/30 font-bold"
                      : "bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-white/[0.05]"
                  }`}
                >
                  {addr.code}
                </button>
              ))}
            </div>

            <div className="bg-zinc-950/60 rounded-md p-2 border border-white/[0.04] space-y-1.5 text-xs font-mono">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-zinc-500 font-sans text-[10px]">Штат:</span>
                <span className="text-zinc-200 font-semibold">{currentAddress.stateName}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-500 font-sans text-[10px]">Street:</span>
                <button
                  type="button"
                  onClick={() => copyToClipboard(currentAddress.street, "street", "Улица")}
                  className="flex items-center gap-1 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  <span>{currentAddress.street}</span>
                  {copiedKey === "street" ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3 text-zinc-500" />
                  )}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-zinc-500 font-sans text-[10px]">City / ZIP:</span>
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(
                      `${currentAddress.city}, ${currentAddress.code} ${currentAddress.zip}`,
                      "city-zip",
                      "Город и индекс"
                    )
                  }
                  className="flex items-center gap-1 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  <span>
                    {currentAddress.city}, {currentAddress.code} {currentAddress.zip}
                  </span>
                  {copiedKey === "city-zip" ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3 text-zinc-500" />
                  )}
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  const full = `${currentAddress.street}, ${currentAddress.city}, ${currentAddress.code} ${currentAddress.zip}, United States`;
                  copyToClipboard(full, "full", "Полный адрес");
                }}
                className="w-full mt-1 py-1 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.07] text-[10.5px] font-sans text-sky-300 flex items-center justify-center gap-1 transition-colors cursor-pointer"
              >
                {copiedKey === "full" ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>Скопировать полный адрес для Stripe</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {subTab === "warmup" && (
        <div className="space-y-2.5 animate-in fade-in duration-150">
          {/* Warmup Progress Card */}
          <div className="bg-[#12141A] rounded-lg border border-emerald-500/25 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>Таймер прогрева аккаунта (3–5 дней)</span>
                    <span className="px-1.5 py-0.2 rounded bg-amber-500/10 border border-amber-500/20 text-[9px] font-mono text-amber-300 font-bold">
                      94% БАНОВ БЕЗ ПРОГРЕВА
                    </span>
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    По исследованию 1 693 кейсов: оплата в день регистрации ведет к бану 31 из 33 аккаунтов.
                  </div>
                </div>
              </div>
            </div>

            {/* Progress Display */}
            {warmupStartedAt ? (
              <div className="bg-zinc-950/60 rounded-lg p-2.5 border border-white/[0.05] space-y-2">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-400">
                    Прошло: <strong className="text-white">{elapsedHours} ч</strong> / {targetHours} ч (4 дня)
                  </span>
                  <span
                    className={`font-bold ${
                      isWarmedUp ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {isWarmedUp ? "ГОТОВ К ОПЛАТЕ" : `${progressPercent}%`}
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden border border-white/[0.06]">
                  <div
                    className={`h-full transition-all duration-300 ${
                      isWarmedUp
                        ? "bg-emerald-500"
                        : "bg-gradient-to-r from-amber-500 to-emerald-400"
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-[10.5px] font-sans pt-0.5">
                  <span className="text-zinc-400">
                    {isWarmedUp ? (
                      <span className="text-emerald-300 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 inline text-emerald-400" />
                        Аккаунт прогрет. Можно переходить к безопасной оплате.
                      </span>
                    ) : (
                      <span>
                        Осталось прогревать:{" "}
                        <strong className="text-zinc-200">
                          {Math.max(0, targetHours - elapsedHours)} ч
                        </strong>
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={handleResetWarmup}
                    className="text-zinc-500 hover:text-zinc-300 flex items-center gap-1 cursor-pointer transition-colors text-[10px]"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    <span>Сбросить</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-zinc-950/60 rounded-lg p-2.5 border border-white/[0.05] flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-zinc-200">
                    Таймер еще не запущен
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    Зарегистрируйтесь на Free tier и начните отсчет 96 часов.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleStartWarmup}
                  className="py-1.5 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Старт (96 ч)</span>
                </button>
              </div>
            )}
          </div>

          {/* 4 Steps Checklist from Study */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-sans tracking-wider uppercase text-zinc-400 font-semibold px-0.5">
              Чеклист перед нажатием «Pay / Upgrade»
            </div>

            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2 space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span>1. Сетевая чистота (Выделенный IP или 2-Hop)</span>
              </div>
              <p className="text-[10.5px] text-zinc-400 pl-5">
                Проверьте во вкладке «Защита», что страна IP совпадает с таймзоной ОС, а WebRTC закрыт.
              </p>
            </div>

            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2 space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                <CheckCircle2
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isWarmedUp ? "text-emerald-400" : "text-amber-400"
                  }`}
                />
                <span>2. Прогрев 3–5 дней на Free Tier</span>
              </div>
              <p className="text-[10.5px] text-zinc-400 pl-5">
                Пользуйтесь бесплатной версией Claude/ChatGPT 3–4 дня с одного IP перед вводом карты.
              </p>
            </div>

            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2 space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>3. Тариф Pro $20 и буфер баланса +$3..$5</span>
              </div>
              <p className="text-[10.5px] text-zinc-400 pl-5">
                Держите на карте $23–$25. Не берите тариф Max 20x ($200) — по нему 91.7% отказов.
              </p>
            </div>

            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2 space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>4. Строго 1 карта = 1 аккаунт (Multi-Account Linking)</span>
              </div>
              <p className="text-[10.5px] text-zinc-400 pl-5">
                Не оплачивайте подписки друзьям одной картой. Ошибка одного забанит все связанные аккаунты.
              </p>
            </div>
          </div>

          {onNavigateToPaymentGuide && (
            <button
              type="button"
              onClick={onNavigateToPaymentGuide}
              className="w-full py-2 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-sans font-medium text-zinc-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Читать полное руководство по платежам и картам</span>
              <ArrowRight className="w-3.5 h-3.5 text-zinc-400" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
