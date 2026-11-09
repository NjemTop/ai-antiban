import React, { useState } from "react";
import {
  Settings,
  X,
  Lock,
  Cpu,
  Globe,
  ExternalLink,
} from "lucide-react";
import { openExternal } from "../utils/opener";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  autoUpdateEnabled: boolean;
  onToggleAutoUpdate: (enabled: boolean) => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  autoUpdateEnabled,
  onToggleAutoUpdate,
}) => {
  const [updatingToggle, setUpdatingToggle] = useState(false);

  if (!isOpen) return null;

  const handleToggle = async () => {
    if (updatingToggle) return;
    setUpdatingToggle(true);
    try {
      await onToggleAutoUpdate(!autoUpdateEnabled);
    } finally {
      setUpdatingToggle(false);
    }
  };

  const handleOpenGitHub = async () => {
    await openExternal("https://github.com/kingbest1195/ai-antiban");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-dialog-title"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-[400px] bg-[#12141A] border border-white/[0.12] rounded-xl p-4 shadow-2xl space-y-3.5 select-none font-sans">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="settings-dialog-title"
                className="text-xs font-bold text-white tracking-tight"
              >
                Настройки и сетевая прозрачность
              </h2>
              <p className="text-[10px] text-zinc-400 font-mono">
                Zastava v1.2.0 · Без чтения чатов
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer transition-colors"
            title="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Section 1: Auto-Update Toggle */}
        <div className="bg-[#0c0e14] rounded-lg p-3 border border-white/[0.06] space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 pr-2">
              <div className="text-xs font-semibold text-white">
                Автоматическое обновление
              </div>
              <div className="text-[10px] text-zinc-400 leading-tight">
                Фоновая проверка стабильных релизов в GitHub Releases
              </div>
            </div>

            <button
              type="button"
              disabled={updatingToggle}
              onClick={handleToggle}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden disabled:opacity-50 ${
                autoUpdateEnabled ? "bg-emerald-500" : "bg-zinc-800"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                  autoUpdateEnabled ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="text-[9.5px] font-mono text-zinc-400 flex items-center gap-1.5 pt-1 border-t border-white/[0.04]">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                autoUpdateEnabled ? "bg-emerald-400" : "bg-zinc-600"
              }`}
            />
            <span>
              Статус:{" "}
              <strong
                className={
                  autoUpdateEnabled ? "text-emerald-300 font-bold" : "text-zinc-500"
                }
              >
                {autoUpdateEnabled ? "ВКЛЮЧЕНО (Рекомендуется)" : "ВЫКЛЮЧЕНО"}
              </strong>
            </span>
          </div>
        </div>

        {/* Section 2: 3-Point Network Transparency List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-400 font-semibold uppercase tracking-wider">
              Гарантии сетевой приватности
            </span>
            <span className="text-emerald-400 font-mono text-[9px] font-bold">
              100% Локально
            </span>
          </div>

          <div className="bg-[#0c0e14] rounded-lg p-2.5 border border-white/[0.06] space-y-2 text-[10.5px]">
            {/* Point 1 */}
            <div className="flex items-start gap-2">
              <div className="w-5 h-5 rounded bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <Lock className="w-3 h-3" />
              </div>
              <div className="space-y-0.5">
                <div className="font-semibold text-zinc-200">
                  Сквозное TLS (Чаты зашифрованы)
                </div>
                <div className="text-[10px] text-zinc-400 leading-relaxed">
                  Застава не устанавливает корневые сертификаты и не читает переписку с ИИ. Трафик туннелируется в неизменном зашифрованном виде.
                </div>
              </div>
            </div>

            {/* Point 2 */}
            <div className="flex items-start gap-2 pt-2 border-t border-white/[0.04]">
              <div className="w-5 h-5 rounded bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0 mt-0.5">
                <Cpu className="w-3 h-3" />
              </div>
              <div className="space-y-0.5">
                <div className="font-semibold text-zinc-200">
                  Куда Застава ходит в сеть
                </div>
                <div className="text-[10px] text-zinc-400 leading-relaxed space-y-1">
                  <div>
                    <span className="text-zinc-300">Проверка вашего IP и страны:</span> ipwho.is, ipinfo.io, 1.1.1.1 (Cloudflare), api.ipify.org. Уходит только запрос «какой у меня IP».
                  </div>
                  <div>
                    <span className="text-zinc-300">Спам-базы:</span> DNS-запросы к zen.spamhaus.org и аналогам. Передаётся только IP выхода.
                  </div>
                  <div>
                    <span className="text-zinc-300">Проверка карты (вкладка «Подписка»):</span> только по кнопке, первые 6 цифр BIN уходят на data.handyapi.com.
                  </div>
                  <div>
                    <span className="text-zinc-300">Обновления:</span> api.github.com. Отключаются переключателем выше.
                  </div>
                  <div className="text-zinc-500">
                    Ваши промпты, ключи и переписка никуда не отправляются. Аналитики и телеметрии нет.
                  </div>
                </div>
              </div>
            </div>

            {/* Point 3 */}
            <div className="flex items-start gap-2 pt-2 border-t border-white/[0.04]">
              <div className="w-5 h-5 rounded bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <Globe className="w-3 h-3" />
              </div>
              <div className="space-y-0.5">
                <div className="font-semibold text-zinc-200">
                  Селективный перехват (Только домены ИИ)
                </div>
                <div className="text-[10px] text-zinc-400 leading-relaxed">
                  Через шлюз идут только эндпоинты anthropic.com, openai.com и gemini.google.com. Банки, стриминги, GitHub и рабочие сервисы идут напрямую на полной скорости.
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: GitHub Source & Actions */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={handleOpenGitHub}
            className="px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-[10.5px] text-zinc-300 hover:text-white flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <span>GitHub Исходный код</span>
            <ExternalLink className="w-3 h-3 text-zinc-400" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-bold text-[11px] cursor-pointer transition-colors shadow-xs"
          >
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
};
