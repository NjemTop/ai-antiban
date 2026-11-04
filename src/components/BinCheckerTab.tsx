import React, { useState } from "react";
import {
  CreditCard,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ArrowRight,
} from "lucide-react";
import { BinAuditResult } from "../types";
import { checkPaymentBin } from "../utils/api";

interface BinCheckerTabProps {
  vpnCountry?: string;
  onNavigateToPaymentGuide?: () => void;
  onToast?: (title: string, desc?: string, type?: "success" | "warning" | "error" | "info") => void;
}

export const BinCheckerTab: React.FC<BinCheckerTabProps> = ({
  vpnCountry = "NL",
  onNavigateToPaymentGuide,
  onToast,
}) => {
  const [binInput, setBinInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<BinAuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Detect card network brand based on IIN prefix
  const detectBrand = (val: string): string => {
    const clean = val.replace(/\D/g, "");
    if (!clean) return "Card";
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
    if (clean.startsWith("2200") || clean.startsWith("2201") || clean.startsWith("2202") || clean.startsWith("2203") || clean.startsWith("2204")) {
      return "MIR (Мир)";
    }
    if (clean.startsWith("34") || clean.startsWith("37")) return "American Express";
    if (clean.startsWith("62")) return "UnionPay";
    return "Bank Card";
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 8);
    setBinInput(raw);
    setError(null);
  };

  const handleCheck = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = binInput.replace(/\D/g, "");

    if (clean.length < 6) {
      setError("Введите минимум 6 первых цифр карты (BIN)");
      return;
    }

    if (clean.length > 8) {
      setError("Принимаются только 6–8 цифр для сохранения конфиденциальности");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await checkPaymentBin(clean, vpnCountry);
      setResult(res);
      if (onToast) {
        if (res.status === "ok") {
          onToast("Проверка BIN завершена", `${res.bank_name || "Банк"} (${res.country_code})`, "success");
        } else if (res.status === "warning") {
          onToast("Предупреждение по карте", res.advisory, "warning");
        } else {
          onToast("Критический риск", res.advisory, "error");
        }
      }
    } catch (err: any) {
      setError(typeof err === "string" ? err : err?.message || "Ошибка проверки BIN");
    } finally {
      setLoading(false);
    }
  };

  const detectedBrand = detectBrand(binInput);

  return (
    <div className="space-y-3 pb-2 animate-in fade-in duration-150">
      {/* Header Banner */}
      <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100 font-mono">
            <CreditCard className="w-4 h-4 text-emerald-400" />
            <span>Card BIN Antifraud Checker</span>
          </div>
          <span className="px-2 py-0.5 rounded bg-zinc-900 border border-white/[0.06] text-[10px] font-mono text-zinc-400">
            VPN Exit: <strong className="text-emerald-400">{vpnCountry}</strong>
          </span>
        </div>
        <p className="text-[11px] text-zinc-400 font-mono leading-relaxed">
          Проверьте первые 6-8 цифр зарубежной или виртуальной карты перед привязкой в Stripe / Claude Pro, чтобы избежать моментального бана подписки.
        </p>
      </div>

      {/* Input Form */}
      <form onSubmit={handleCheck} className="space-y-2">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500 font-mono text-xs">
            <CreditCard className="w-4 h-4 text-zinc-400" />
          </div>

          <input
            type="text"
            value={binInput}
            onChange={handleInputChange}
            placeholder="4833 12 (первые 6-8 цифр)"
            maxLength={8}
            className="w-full bg-[#12141A] border border-white/[0.1] rounded-lg pl-9 pr-24 py-2.5 text-xs font-mono text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 tabular-nums tracking-widest"
          />

          <div className="absolute inset-y-0 right-1.5 flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-zinc-500 pr-1 select-none">
              {detectedBrand}
            </span>
            <button
              type="submit"
              disabled={loading || binInput.length < 6}
              className="py-1 px-2.5 rounded bg-white text-zinc-950 disabled:bg-zinc-800 disabled:text-zinc-600 text-xs font-mono font-semibold transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? "..." : "Check"}
            </button>
          </div>
        </div>

        {error && (
          <div className="text-[11px] font-mono text-rose-400 flex items-center gap-1 px-1">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </form>

      {/* Pre-fill Quick Test Buttons */}
      <div className="flex items-center gap-1.5 px-0.5 text-[10px] font-mono text-zinc-500">
        <span>Быстрый тест:</span>
        <button
          type="button"
          onClick={() => {
            setBinInput("220024");
            setError(null);
          }}
          className="text-zinc-400 hover:text-white underline cursor-pointer"
        >
          220024 (Mir RU)
        </button>
        <span>·</span>
        <button
          type="button"
          onClick={() => {
            setBinInput("483312");
            setError(null);
          }}
          className="text-zinc-400 hover:text-white underline cursor-pointer"
        >
          483312 (Prepaid US)
        </button>
        <span>·</span>
        <button
          type="button"
          onClick={() => {
            setBinInput("535456");
            setError(null);
          }}
          className="text-zinc-400 hover:text-white underline cursor-pointer"
        >
          535456 (Debit NL)
        </button>
      </div>

      {/* Audit Result Card */}
      {result && (
        <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-3 space-y-2.5 animate-in fade-in duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-white/[0.04]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-white">
                BIN {result.bin}
              </span>
              <span className="text-[10px] font-mono text-zinc-400">
                {result.bank_name || "Unknown Bank"}
              </span>
            </div>

            <div
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium border ${
                result.status === "ok"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  : result.status === "warning"
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-rose-500/10 text-rose-400 border-rose-500/20"
              }`}
            >
              {result.status === "ok" ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : result.status === "warning" ? (
                <AlertTriangle className="w-3 h-3" />
              ) : (
                <XCircle className="w-3 h-3" />
              )}
              <span>{result.status.toUpperCase()}</span>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-3 gap-2 text-xs font-mono">
            <div className="bg-zinc-950/40 p-2 rounded border border-white/[0.03]">
              <span className="text-[10px] text-zinc-500 block">Страна карты</span>
              <span className="text-zinc-200 font-semibold">
                {result.country_code || "--"}
              </span>
            </div>

            <div className="bg-zinc-950/40 p-2 rounded border border-white/[0.03]">
              <span className="text-[10px] text-zinc-500 block">Тип карты</span>
              <span
                className={`font-semibold ${
                  result.is_prepaid ? "text-amber-400" : "text-zinc-200"
                }`}
              >
                {result.card_type || "UNKNOWN"}
              </span>
            </div>

            <div className="bg-zinc-950/40 p-2 rounded border border-white/[0.03]">
              <span className="text-[10px] text-zinc-500 block">Предоплаченная</span>
              <span
                className={`font-semibold ${
                  result.is_prepaid ? "text-rose-400" : "text-emerald-400"
                }`}
              >
                {result.is_prepaid ? "YES (Риск)" : "NO (Чистая)"}
              </span>
            </div>
          </div>

          {/* Antifraud Advisory */}
          <div
            className={`p-2.5 rounded-md text-[11px] font-mono leading-relaxed border ${
              result.status === "ok"
                ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
                : result.status === "warning"
                ? "bg-amber-500/5 border-amber-500/20 text-amber-300"
                : "bg-rose-500/5 border-rose-500/20 text-rose-300"
            }`}
          >
            <div className="font-semibold text-[10px] uppercase tracking-wider mb-1 opacity-80">
              Antifraud Risk Analysis:
            </div>
            {result.advisory}
          </div>

          {/* Jump to safe payment guide */}
          {result.status !== "ok" && onNavigateToPaymentGuide && (
            <button
              type="button"
              onClick={onNavigateToPaymentGuide}
              className="w-full py-1.5 px-3 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-mono text-zinc-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>Как оплатить без бана (Гайд по картам)</span>
              <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
