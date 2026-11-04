import React, { useState } from "react";
import {
  ExternalLink,
  Copy,
  Check,
  Pin,
  ShieldCheck,
  Server,
  CreditCard,
  Lock,
  Terminal,
} from "lucide-react";
import { openExternal } from "../utils/opener";

interface GuideViewerProps {
  initialGuide?: string;
  currentIp?: string;
  onPinIp?: (ip: string) => void;
  onToast?: (title: string, desc?: string, type?: "success" | "warning" | "error" | "info") => void;
}

interface VpsProvider {
  id: string;
  name: string;
  tier: string;
  badge: string;
  price: string;
  locations: string[];
  payments: string[];
  specs: string;
  promoCode: string;
  promoDiscount: string;
  url: string;
  description: string;
}

const VPS_PROVIDERS: VpsProvider[] = [
  {
    id: "timeweb",
    name: "Timeweb Cloud",
    tier: "🥇 Рекомендуемый облачный провайдер",
    badge: "ТОП ВЫБОР",
    price: "от ~250 ₽/мес",
    locations: ["NL", "DE", "FI", "PL"],
    payments: ["Карты РФ", "СБП", "T-Pay"],
    specs: "1 vCPU / 1GB RAM / 100 Mbps",
    promoCode: "AIANTIBAN",
    promoDiscount: "10% скидка на VPS",
    url: "https://timeweb.cloud/?utm_source=ai_antiban",
    description: "Мгновенное развертывание Ubuntu 22.04 в Амстердаме или Франкфурте. Идеально для AmneziaWG.",
  },
  {
    id: "hostvds",
    name: "HostVDS",
    tier: "🥈 Ультра-бюджетный зарубежный VPS",
    badge: "ОТ $0.99",
    price: "от ~$0.99 / мес",
    locations: ["NL", "US", "FI", "FR"],
    payments: ["Карты РФ", "Crypto", "СБП"],
    specs: "1 vCPU / 1GB RAM / NVMe",
    promoCode: "AIANTIBAN",
    promoDiscount: "Бонусный баланс при регистрации",
    url: "https://hostvds.com/?utm_source=ai_antiban",
    description: "Самый дешевый выделенный IPv4 сервер в Европе и США. Чистые подсети без банов в OpenAI.",
  },
  {
    id: "aeza",
    name: "Aeza",
    tier: "🥉 Высокоскоростные серверы с Anti-DDoS",
    badge: "NVMe 1Gbps",
    price: "от ~€1.50 / мес",
    locations: ["NL", "DE", "FI", "AT", "SE"],
    payments: ["Карты РФ", "СБП", "Crypto", "EU Cards"],
    specs: "Ryzen 9 / NVMe / 1 Gbps",
    promoCode: "AIANTIBAN",
    promoDiscount: "15% кешбэк на первый месяц",
    url: "https://aeza.net/?utm_source=ai_antiban",
    description: "Сверхбыстрый трафик без ограничений. Отличный пинг и поддержка протоколов VLESS Reality.",
  },
  {
    id: "serveroid",
    name: "Serveroid",
    tier: "Выделенные IP для разработчиков",
    badge: "СТАТИЧЕСКИЙ IP",
    price: "от ~190 ₽/мес",
    locations: ["NL", "US", "DE"],
    payments: ["Карты РФ", "СБП"],
    specs: "KVM / 1 IPv4 / Безлимит",
    promoCode: "AIANTIBAN",
    promoDiscount: "Промокод активен по ссылке",
    url: "https://serveroid.com/?utm_source=ai_antiban",
    description: "Чистые дата-центры в Нидерландах. Без соседей по IP, нулевой фрод-скор в Stripe.",
  },
];

export const GuideViewer: React.FC<GuideViewerProps> = ({
  initialGuide = "01-personal-vpn-15min",
  currentIp = "185.212.102.40",
  onPinIp,
  onToast,
}) => {
  const [activeTab, setActiveTab] = useState<string>(initialGuide);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const copyPromo = (provider: VpsProvider) => {
    navigator.clipboard.writeText(provider.promoCode);
    setCopiedCode(provider.id);
    if (onToast) {
      onToast("Промокод скопирован", `${provider.promoCode} для ${provider.name}`, "success");
    }
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const handleOpenProvider = (provider: VpsProvider) => {
    openExternal(provider.url);
    if (onToast) {
      onToast("Переход на сайт", `Открываем ${provider.name} в браузере`, "info");
    }
  };

  return (
    <div className="space-y-3 pb-2">
      {/* Subtabs Segmented Control */}
      <div className="grid grid-cols-3 gap-1 p-0.5 bg-[#12141A] rounded-lg border border-white/[0.07] text-[11px] font-mono">
        <button
          type="button"
          onClick={() => setActiveTab("01-personal-vpn-15min")}
          className={`py-1.5 px-2 rounded flex items-center justify-center gap-1.5 transition-all ${
            activeTab === "01-personal-vpn-15min"
              ? "bg-white/[0.08] text-white font-medium shadow-xs"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Server className="w-3 h-3 text-emerald-400" />
          <span>1. VPS за 15м</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("02-safe-payment-cards")}
          className={`py-1.5 px-2 rounded flex items-center justify-center gap-1.5 transition-all ${
            activeTab === "02-safe-payment-cards"
              ? "bg-white/[0.08] text-white font-medium shadow-xs"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <CreditCard className="w-3 h-3 text-blue-400" />
          <span>2. Оплата карт</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("03-os-privacy-setup")}
          className={`py-1.5 px-2 rounded flex items-center justify-center gap-1.5 transition-all ${
            activeTab === "03-os-privacy-setup"
              ? "bg-white/[0.08] text-white font-medium shadow-xs"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Lock className="w-3 h-3 text-amber-400" />
          <span>3. Приватность ОС</span>
        </button>
      </div>

      {/* Guide Content: 1. Personal VPS in 15 min */}
      {activeTab === "01-personal-vpn-15min" && (
        <div className="space-y-3 animate-in fade-in duration-150">
          {/* Quick Problem/Solution Pitch */}
          <div className="bg-[#12141A] rounded-lg border border-emerald-500/20 p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 font-mono">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>Почему персональный VPS спасает от бана 100%</span>
            </div>
            <p className="text-[11px] text-zinc-300 font-mono leading-relaxed">
              На обычных VPN один IP делят сотни пользователей, а прыжки между странами (Impossible Travel) мгновенно триггерят антифрод Stripe & Anthropic. Личный VPS дает чистый статический IP в Нидерландах/Германии, где только вы являетесь владельцем.
            </p>
          </div>

          {/* Native Partner Comparison Cards */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] font-mono tracking-wider uppercase text-zinc-400 font-medium">
                Проверенные VPS с оплатой РФ картами / СБП
              </span>
              <span className="text-[10px] font-mono text-zinc-500">4 провайдера</span>
            </div>

            <div className="space-y-2">
              {VPS_PROVIDERS.map((vps) => {
                const isCopied = copiedCode === vps.id;
                return (
                  <div
                    key={vps.id}
                    className="bg-[#12141A] rounded-lg border border-white/[0.07] p-3 space-y-2 hover:border-white/[0.15] transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white font-mono">
                            {vps.name}
                          </span>
                          <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-mono text-emerald-400 font-medium">
                            {vps.badge}
                          </span>
                        </div>
                        <div className="text-[10px] text-zinc-400 font-mono mt-0.5">
                          {vps.tier}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-xs font-mono font-bold text-zinc-100">
                          {vps.price}
                        </div>
                        <div className="text-[9px] text-zinc-500 font-mono">
                          {vps.specs}
                        </div>
                      </div>
                    </div>

                    <p className="text-[11px] text-zinc-400 font-mono leading-relaxed">
                      {vps.description}
                    </p>

                    {/* Locations & Payment Badges */}
                    <div className="flex flex-wrap items-center gap-1 pt-0.5 text-[10px] font-mono">
                      <span className="text-zinc-500 text-[9px]">Локации:</span>
                      {vps.locations.map((loc) => (
                        <span
                          key={loc}
                          className="px-1.5 py-0.5 rounded bg-zinc-900 border border-white/[0.06] text-zinc-300 font-medium"
                        >
                          {loc}
                        </span>
                      ))}
                      <span className="text-zinc-600 px-1">|</span>
                      {vps.payments.map((p) => (
                        <span
                          key={p}
                          className="px-1.5 py-0.5 rounded bg-white/[0.03] text-zinc-400"
                        >
                          {p}
                        </span>
                      ))}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 pt-1 border-t border-white/[0.04]">
                      <button
                        type="button"
                        onClick={() => handleOpenProvider(vps)}
                        className="flex-1 py-1.5 px-3 rounded bg-zinc-100 text-zinc-950 hover:bg-white text-xs font-semibold font-mono flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <span>Перейти на сайт</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>

                      <button
                        type="button"
                        onClick={() => copyPromo(vps)}
                        title="Скопировать промокод"
                        className="py-1.5 px-2.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-xs font-mono text-zinc-300 flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        {isCopied ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3 text-zinc-400" />
                        )}
                        <span className="text-[11px] font-mono">{vps.promoCode}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Step 2: AmneziaVPN Setup Instructions */}
          <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200 font-mono">
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Шаг 2. Настройка AmneziaVPN без терминала (3 минуты)</span>
            </div>
            <ol className="text-[11px] font-mono text-zinc-300 space-y-1.5 list-decimal list-inside leading-relaxed">
              <li>
                Скачайте официальный клиент <span className="text-emerald-400">AmneziaVPN</span> с официального репозитория GitHub.
              </li>
              <li>
                Нажмите <span className="text-zinc-100 font-semibold">«Настроить свой сервер»</span> и введите полученный IP, логин <code className="text-zinc-200 bg-zinc-900 px-1 py-0.5 rounded">root</code> и пароль VPS.
              </li>
              <li>
                Выберите протокол <span className="text-zinc-100 font-semibold">AmneziaWG</span> или <span className="text-zinc-100 font-semibold">XRay Reality</span> (маскирует трафик под HTTPS).
              </li>
              <li>
                Нажмите <span className="text-emerald-400 font-semibold">«Подключиться»</span>.
              </li>
            </ol>
          </div>

          {/* Step 3: Pin Reference IP */}
          <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold text-zinc-200">
                Шаг 3. Закрепите IP как эталонный
              </span>
              <span className="text-[11px] font-mono text-emerald-400 font-medium">
                {currentIp}
              </span>
            </div>
            <p className="text-[11px] font-mono text-zinc-400 leading-relaxed">
              После подключения к своему новому VPS закрепите его IP в AI-AntiBan. Программа перехватит любой случайный запрос при разрыве туннеля.
            </p>
            <button
              type="button"
              onClick={() => onPinIp && onPinIp(currentIp)}
              className="w-full py-2 px-3 rounded bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-mono text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Pin className="w-3.5 h-3.5" />
              <span>📌 Verify & Pin Current IP ({currentIp})</span>
            </button>
          </div>
        </div>
      )}

      {/* Guide Content: 2. Safe Payment Cards */}
      {activeTab === "02-safe-payment-cards" && (
        <div className="space-y-3 animate-in fade-in duration-150">
          <div className="bg-[#12141A] rounded-lg border border-blue-500/20 p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-400 font-mono">
              <CreditCard className="w-4 h-4 shrink-0" />
              <span>Платежная гигиена: как не получить бан в Stripe</span>
            </div>
            <p className="text-[11px] text-zinc-300 font-mono leading-relaxed">
              Более 40% банов в Claude Pro и ChatGPT Plus происходят в момент привязки банковской карты или автоматического списания ежемесячной подписки.
            </p>
          </div>

          <div className="space-y-2">
            {/* Rule 1 */}
            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-3 space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-zinc-100 font-mono">
                <span className="w-5 h-5 rounded-full bg-rose-500/15 border border-rose-500/20 text-rose-400 flex items-center justify-center text-[10px]">
                  1
                </span>
                <span>Избегайте массовых карт «Prepaid BIN»</span>
              </div>
              <p className="text-[11px] text-zinc-400 font-mono leading-relaxed pl-7">
                Карты из ботов и виртуальных сервисов часто имеют тип <code className="text-zinc-200">PREPAID</code>. Когда тысячи аккаунтов привязывают один и тот же BIN эмитента, антифрод Stripe блокирует всю серию карт вместе со всеми аккаунтами.
              </p>
            </div>

            {/* Rule 2 */}
            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-3 space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-zinc-100 font-mono">
                <span className="w-5 h-5 rounded-full bg-amber-500/15 border border-amber-500/20 text-amber-400 flex items-center justify-center text-[10px]">
                  2
                </span>
                <span>Страна карты = Страна IP при оплате</span>
              </div>
              <p className="text-[11px] text-zinc-400 font-mono leading-relaxed pl-7">
                Если у вас карта банка Казахстана (KZ) или Армении (AM), а вы привязываете её через VPN США или Нидерландов, платежный шлюз пометит транзакцию как High Fraud Risk и запросит подтверждение 3D-Secure.
              </p>
            </div>

            {/* Rule 3 */}
            <div className="bg-[#12141A] rounded-lg border border-emerald-500/20 bg-emerald-950/10 p-3 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 font-mono">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center text-[10px]">
                  3
                </span>
                <span>Золотой стандарт: Оплата через App Store / Google Play</span>
              </div>
              <p className="text-[11px] text-zinc-300 font-mono leading-relaxed pl-7">
                Оформляйте подписку через официальное приложение Claude / ChatGPT на iOS или Android с регионом США, пополняя баланс через Apple Gift Card. Anthropic вообще не видит банковскую карту — оплата проходит на 100% через защищенный биллинг Apple.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Guide Content: 3. OS Privacy Setup */}
      {activeTab === "03-os-privacy-setup" && (
        <div className="space-y-3 animate-in fade-in duration-150">
          <div className="bg-[#12141A] rounded-lg border border-amber-500/20 p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 font-mono">
              <Lock className="w-4 h-4 shrink-0" />
              <span>Скрываем реальные координаты ОС от Claude и ChatGPT</span>
            </div>
            <p className="text-[11px] text-zinc-300 font-mono leading-relaxed">
              Даже с включенным VPN приложения Claude Desktop и браузеры могут получить реальную геолокацию через службы BSSID Wi-Fi роутеров и IPv6 утечки.
            </p>
          </div>

          <div className="space-y-2">
            {/* macOS Setting */}
            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-zinc-100">
                  macOS: Отключение Wi-Fi геолокации
                </span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 text-[10px] font-mono">
                  Apple BSSID
                </span>
              </div>
              <p className="text-[11px] font-mono text-zinc-400 leading-relaxed">
                Системные настройки -&gt; Конфиденциальность и безопасность -&gt; Службы геолокации: отключите доступ для браузеров и настольного приложения Claude.
              </p>
            </div>

            {/* Windows Setting */}
            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-zinc-100">
                  Windows 10 / 11: Службы определения местоположения
                </span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 text-[10px] font-mono">
                  Win Location
                </span>
              </div>
              <p className="text-[11px] font-mono text-zinc-400 leading-relaxed">
                Параметры -&gt; Конфиденциальность и защита -&gt; Расположение: отключите тумблер «Службы определения местоположения» для классических приложений.
              </p>
            </div>

            {/* IPv6 Leak Fix */}
            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-zinc-100">
                  Отключение IPv6 утечек
                </span>
                <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 text-[10px] font-mono">
                  КРИТИЧНО
                </span>
              </div>
              <p className="text-[11px] font-mono text-zinc-400 leading-relaxed">
                Если домашний провайдер выдает IPv6, а VPN туннелирует только IPv4, запросы к Claude пойдут мимо туннеля напрямую из РФ. В свойствах сетевого адаптера отключите протокол IPv6 (TCP/IPv6).
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
