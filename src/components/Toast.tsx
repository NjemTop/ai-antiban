import React from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";

export type ToastType = "success" | "warning" | "error" | "info";

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((t) => {
        const icon =
          t.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : t.type === "warning" ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          ) : t.type === "error" ? (
            <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-blue-400 shrink-0" />
          );

        const borderCol =
          t.type === "success"
            ? "border-emerald-500/30"
            : t.type === "warning"
            ? "border-amber-500/30"
            : t.type === "error"
            ? "border-rose-500/30"
            : "border-blue-500/30";

        return (
          <div
            key={t.id}
            onClick={() => onDismiss(t.id)}
            className={`pointer-events-auto cursor-pointer p-3 rounded-lg bg-[#12141A] border ${borderCol} shadow-2xl backdrop-blur-md flex items-start gap-2.5 transition-all animate-in fade-in duration-200`}
          >
            {icon}
            <div className="flex-1">
              <div className="text-xs font-semibold text-zinc-100 font-mono tracking-tight">
                {t.title}
              </div>
              {t.description && (
                <div className="text-[11px] text-zinc-400 font-mono mt-0.5 leading-relaxed">
                  {t.description}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
