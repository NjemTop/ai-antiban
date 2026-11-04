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
  onToast?: (
    title: string,
    desc?: string,
    type?: "success" | "warning" | "error" | "info"
  ) => void;
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
      const res = await checkPaymentBin(clean, vpnCountry);
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

  const detectedBrand = detectBrand(binInput);

  return (
    <div className="space-y-2.5 pb-1">
      {/* Header Banner */}
      <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100 font-sans">
            <CreditCard className="w-3.5 h-3.5 text-amber-400" strokeWidth={1.75} />
            <span>Антифрод-аудит карты перед оплатой (BIN)</span>
          </div>
          <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-white/[0.06] text-[10px] font-mono text-zinc-400">
            Ваш VPN: <strong className="text-emerald-400">{vpnCountry}</strong>
          </span>
        </div>
        <p className="text-[11px] text-zinc-400 font-sans leading-relaxed">
          Введите первые 6 цифр зарубежной или виртуальной карты перед привязкой в Stripe / Claude Pro, чтобы проверить тип эмитента (<code className="font-mono text-zinc-300">DEBIT</code> vs <code className="font-mono text-zinc-300">PREPAID</code>) и совпадение регионов.
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
          483312 (Prepaid US)
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
                  ? "БЕЗОПАСНО"
                  : result.status === "warning"
                  ? "РИСК ФРОДА"
                  : "ОТКАЗ / БАН"}
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
                Категория
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
                Prepaid-пул
              </span>
              <span
                className={`font-mono font-semibold text-xs ${
                  result.is_prepaid ? "text-rose-400" : "text-emerald-400"
                }`}
              >
                {result.is_prepaid ? "ДА (Риск)" : "НЕТ (Чистая)"}
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
              Вердикт Stripe Radar / Antifraud:
            </div>
            {result.advisory}
          </div>

          {result.status !== "ok" && onNavigateToPaymentGuide && (
            <button
              type="button"
              onClick={onNavigateToPaymentGuide}
              className="w-full py-1.5 px-3 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-[11px] font-sans font-medium text-zinc-200 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>Инструкция: как оплатить подписку без бана карты</span>
              <ArrowRight className="w-3.5 h-3.5 text-amber-400" strokeWidth={1.75} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
