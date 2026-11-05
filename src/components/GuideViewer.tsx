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
  Award,
} from "lucide-react";
import { openExternal } from "../utils/opener";

interface GuideViewerProps {
  initialGuide?: string;
  currentIp?: string;
  onPinIp?: (ip: string) => void;
  onToast?: (
    title: string,
    desc?: string,
    type?: "success" | "warning" | "error" | "info"
  ) => void;
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
  url: string;
  description: string;
}

const VPS_PROVIDERS: VpsProvider[] = [
  {
    id: "timeweb",
    name: "Timeweb Cloud",
    tier: "Рекомендуемый облачный провайдер РФ/ЕС",
    badge: "ТОП ВЫБОР",
    price: "от ~250 ₽/мес",
    locations: ["NL", "DE", "FI", "PL"],
    payments: ["Карты РФ", "СБП", "T-Pay"],
    specs: "1 vCPU · 1 ГБ RAM · 100 Мбит/с",
    promoCode: "ZASTAVA",
    url: "https://timeweb.cloud/?utm_source=zastava",
    description:
      "Мгновенный запуск Ubuntu 22.04 в Амстердаме или Франкфурте. Идеально для AmneziaWG и XRay Reality.",
  },
  {
    id: "hostvds",
    name: "HostVDS",
    tier: "Ультра-бюджетный зарубежный VPS",
    badge: "ОТ $0.99",
    price: "от ~$0.99 / мес",
    locations: ["NL", "US", "FI", "FR"],
    payments: ["Карты РФ", "СБП", "Crypto"],
    specs: "1 vCPU · 1 ГБ RAM · NVMe",
    promoCode: "ZASTAVA",
    url: "https://hostvds.com/?utm_source=zastava",
    description:
      "Самый доступный выделенный статический IPv4 в Европе и США. Чистые подсети без ограничений.",
  },
  {
    id: "aeza",
    name: "Aeza",
    tier: "Высокоскоростные серверы с Anti-DDoS",
    badge: "NVMe 1 Гбит/с",
    price: "от ~€1.50 / мес",
    locations: ["NL", "DE", "FI", "AT", "SE"],
    payments: ["Карты РФ", "СБП", "Crypto"],
    specs: "Ryzen 9 · NVMe · 1 Гбит/с",
    promoCode: "ZASTAVA",
    url: "https://aeza.net/?utm_source=zastava",
    description:
      "Сверхбыстрый канал без лимитов трафика. Отличный пинг для комфортной работы в Cursor и Claude.",
  },
  {
    id: "serveroid",
    name: "Serveroid",
    tier: "Выделенные IP для разработчиков",
    badge: "ЧИСТЫЙ IP",
    price: "от ~190 ₽/мес",
    locations: ["NL", "US", "DE"],
    payments: ["Карты РФ", "СБП"],
    specs: "KVM · 1 IPv4 · Безлимит",
    promoCode: "ZASTAVA",
    url: "https://serveroid.com/?utm_source=zastava",
    description:
      "Европейские дата-центры без соседей по IP и с надежной репутацией в базах Spamhaus / DNSBL.",
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
      onToast(
        "Промокод скопирован",
        `Промокод ${provider.promoCode} для ${provider.name}`,
        "success"
      );
    }
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const handleOpenProvider = (provider: VpsProvider) => {
    openExternal(provider.url);
    if (onToast) {
      onToast(
        "Переход к хостингу",
        `Открываем ${provider.name} в браузере`,
        "info"
      );
    }
  };

  return (
    <div className="space-y-2.5 pb-1">
      {/* Subtabs Segmented Control */}
      <div className="grid grid-cols-3 gap-1 p-0.5 bg-[#12141A] rounded-lg border border-white/[0.07] text-[11px] font-sans">
        <button
          type="button"
          onClick={() => setActiveTab("01-personal-vpn-15min")}
          className={`py-1 px-2 rounded flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === "01-personal-vpn-15min"
              ? "bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold"
              : "text-zinc-400 hover:text-zinc-200 border border-transparent"
          }`}
        >
          <Server className="w-3 h-3" strokeWidth={1.75} />
          <span>1. Свой VPS</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("02-safe-payment-cards")}
          className={`py-1 px-2 rounded flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === "02-safe-payment-cards"
              ? "bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold"
              : "text-zinc-400 hover:text-zinc-200 border border-transparent"
          }`}
        >
          <CreditCard className="w-3 h-3" strokeWidth={1.75} />
          <span>2. Оплата</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("03-os-privacy-setup")}
          className={`py-1 px-2 rounded flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === "03-os-privacy-setup"
              ? "bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold"
              : "text-zinc-400 hover:text-zinc-200 border border-transparent"
          }`}
        >
          <Lock className="w-3 h-3" strokeWidth={1.75} />
          <span>3. Защита ОС</span>
        </button>
      </div>

      {/* Guide Content: 1. Personal VPS in 15 min */}
      {activeTab === "01-personal-vpn-15min" && (
        <div className="space-y-2.5">
          {/* Quick Problem/Solution Pitch */}
          <div className="bg-[#12141A] rounded-lg border border-emerald-500/20 p-2.5 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 font-sans">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>Почему личный VPS защищает от бана на 100%</span>
            </div>
            <p className="text-[11px] text-zinc-300 font-sans leading-relaxed">
              В массовых VPN на одном IP сидят сотни человек, а частая смена стран (Impossible Travel) вызывает мгновенный бан у Anthropic. Свой VPS дает личный статический IP в <span className="font-mono text-zinc-100">NL / DE / US</span> без соседей-спамеров.
            </p>
          </div>

          {/* Native Partner Comparison Cards */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] font-sans tracking-wider uppercase text-zinc-400 font-semibold">
                Шаг 1. Хостинги с оплатой картой РФ / СБП
              </span>
              <span className="text-[10px] font-mono text-zinc-500">Локации: NL · DE · US</span>
            </div>

            <div className="space-y-1.5 max-h-[245px] overflow-y-auto pr-0.5">
              {VPS_PROVIDERS.map((vps) => {
                const isCopied = copiedCode === vps.id;
                return (
                  <div
                    key={vps.id}
                    className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-1.5 hover:border-white/[0.14] transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <Award className="w-3.5 h-3.5 text-amber-400 shrink-0" strokeWidth={1.75} />
                          <span className="text-xs font-bold text-white font-sans">
                            {vps.name}
                          </span>
                          <span className="px-1.5 py-0.2 rounded bg-emerald-500/10 border border-emerald-500/20 text-[9px] font-mono text-emerald-400 font-semibold">
                            {vps.badge}
                          </span>
                        </div>
                        <div className="text-[10px] text-zinc-400 font-sans mt-0.5">
                          {vps.tier}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-xs font-mono font-bold text-amber-400 tabular-nums">
                          {vps.price}
                        </div>
                        <div className="text-[9px] text-zinc-500 font-mono">
                          {vps.specs}
                        </div>
                      </div>
                    </div>

                    <p className="text-[10.5px] text-zinc-400 font-sans leading-snug">
                      {vps.description}
                    </p>

                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.04]">
                      <div className="flex items-center gap-1 text-[9.5px] font-mono">
                        {vps.locations.map((loc) => (
                          <span
                            key={loc}
                            className="px-1 py-0.2 rounded bg-zinc-900 border border-white/[0.06] text-zinc-300 font-semibold"
                          >
                            {loc}
                          </span>
                        ))}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => copyPromo(vps)}
                          title="Скопировать промокод"
                          className="py-1 px-2 rounded bg-zinc-900 hover:bg-zinc-800 border border-white/[0.08] text-[10px] font-mono text-zinc-300 flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          {isCopied ? (
                            <Check className="w-3 h-3 text-emerald-400" strokeWidth={1.75} />
                          ) : (
                            <Copy className="w-3 h-3 text-zinc-400" strokeWidth={1.5} />
                          )}
                          <span>{vps.promoCode}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenProvider(vps)}
                          className="py-1 px-2.5 rounded bg-zinc-100 text-zinc-950 hover:bg-white text-[10.5px] font-semibold font-sans flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <span>Открыть</span>
                          <ExternalLink className="w-3 h-3" strokeWidth={1.75} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Step 2: AmneziaVPN Setup Instructions */}
          <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100 font-sans">
              <Terminal className="w-3.5 h-3.5 text-emerald-400" strokeWidth={1.75} />
              <span>Шаг 2. Установка AmneziaVPN в 2 клика (без консоли)</span>
            </div>
            <ol className="text-[10.5px] font-sans text-zinc-300 space-y-1 list-decimal list-inside leading-snug">
              <li>
                Скачайте бесплатный клиент <span className="text-emerald-400 font-medium">AmneziaVPN</span> и выберите «Настроить свой сервер».
              </li>
              <li>
                Вставьте полученный IP сервера, логин <code className="text-zinc-200 bg-zinc-900 px-1 py-0.2 rounded font-mono text-[10px]">root</code> и пароль.
              </li>
              <li>
                Выберите протокол <span className="text-zinc-100 font-medium">AmneziaWG</span> или <span className="text-zinc-100 font-medium">XRay Reality</span> и нажмите «Подключиться».
              </li>
            </ol>
          </div>

          {/* Step 3: Pin Reference IP */}
          <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-sans font-semibold text-zinc-100">
                Шаг 3. Закрепите IP вашего VPS
              </div>
              <div className="text-[10px] font-mono text-zinc-400 truncate">
                Текущий выход: <span className="text-emerald-400">{currentIp}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onPinIp && onPinIp(currentIp)}
              className="py-1.5 px-2.5 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 font-sans text-[11px] font-semibold flex items-center gap-1.5 shrink-0 transition-all cursor-pointer"
            >
              <Pin className="w-3.5 h-3.5" strokeWidth={1.75} />
              <span>Закрепить IP</span>
            </button>
          </div>
        </div>
      )}

      {/* Guide Content: 2. Safe Payment Cards */}
      {activeTab === "02-safe-payment-cards" && (
        <div className="space-y-2">
          <div className="bg-[#12141A] rounded-lg border border-amber-500/25 p-2.5 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 font-sans">
              <CreditCard className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>Платежная гигиена: как не получить бан в Stripe</span>
            </div>
            <p className="text-[11px] text-zinc-300 font-sans leading-relaxed">
              Более 40% блокировок в Claude Pro и ChatGPT Plus происходят при привязке виртуальной карты из серого пула или рассинхроне страны банка и VPN.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-zinc-100 font-sans">
                <span className="w-4 h-4 rounded bg-rose-500/15 border border-rose-500/25 text-rose-400 flex items-center justify-center text-[10px] font-mono">
                  1
                </span>
                <span>Используйте надежные карты с поддержкой 3D Secure</span>
              </div>
              <p className="text-[11px] text-zinc-400 font-sans leading-relaxed pl-6">
                Виртуальные карты типа <code className="text-zinc-200 font-mono">PREPAID</code> из массовых ботов часто отклоняются международными платежными системами из-за отсутствия проверки адреса (AVS) и 3D Secure. Рекомендуется использовать именные дебетовые карты зарубежных банков или оплату через мобильные маркетплейсы.
              </p>
            </div>

            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-zinc-100 font-sans">
                <span className="w-4 h-4 rounded bg-amber-500/15 border border-amber-500/25 text-amber-400 flex items-center justify-center text-[10px] font-mono">
                  2
                </span>
                <span>Страна банка карты = Страна IP при оплате</span>
              </div>
              <p className="text-[11px] text-zinc-400 font-sans leading-relaxed pl-6">
                Если у вас карта Казахстана (<code className="text-zinc-200 font-mono">KZ</code>) или Армении (<code className="text-zinc-200 font-mono">AM</code>), привязывайте её с IP соответствующей страны либо используйте оплату через мобильный стор.
              </p>
            </div>

            <div className="bg-[#12141A] rounded-lg border border-emerald-500/25 p-2.5 space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 font-sans">
                <span className="w-4 h-4 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center text-[10px] font-mono">
                  3
                </span>
                <span>Золотой стандарт: Apple App Store / Google Play</span>
              </div>
              <p className="text-[11px] text-zinc-300 font-sans leading-relaxed pl-6">
                Оформляйте подписку внутри мобильного приложения Claude / ChatGPT на iOS или Android (регион США, пополнение через Gift Card). В этом случае Anthropic и Stripe вообще не видят банковскую карту — риск платежного бана равен нулю.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Guide Content: 3. OS Privacy Setup */}
      {activeTab === "03-os-privacy-setup" && (
        <div className="space-y-2">
          <div className="bg-[#12141A] rounded-lg border border-amber-500/25 p-2.5 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 font-sans">
              <Lock className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />
              <span>Защита от утечек геолокации ОС (Wi-Fi BSSID и IPv6)</span>
            </div>
            <p className="text-[11px] text-zinc-300 font-sans leading-relaxed">
              Даже с включенным VPN настольные приложения Claude Desktop и браузеры могут вычислить вашу страну по MAC-адресам соседних Wi-Fi роутеров или через незащищенный стек IPv6.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-sans font-bold text-zinc-100">
                  macOS: Службы геолокации (CoreLocation)
                </span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 text-[9.5px] font-mono">
                  BSSID Wi-Fi
                </span>
              </div>
              <p className="text-[11px] font-sans text-zinc-400 leading-relaxed">
                Системные настройки → Конфиденциальность и безопасность → Службы геолокации: отключите доступ к геопозиции для браузеров и приложения <span className="text-zinc-200 font-medium">Claude</span>.
              </p>
            </div>

            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-sans font-bold text-zinc-100">
                  Windows 10 / 11: Службы определения местоположения
                </span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 text-[9.5px] font-mono">
                  Win Location
                </span>
              </div>
              <p className="text-[11px] font-sans text-zinc-400 leading-relaxed">
                Параметры → Конфиденциальность и защита → Расположение: выключите доступ к геопозиции для настольных приложений и браузеров.
              </p>
            </div>

            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-sans font-bold text-zinc-100">
                  Блокировка двухстековой утечки IPv6
                </span>
                <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 text-[9.5px] font-mono font-semibold">
                  ВАЖНО
                </span>
              </div>
              <p className="text-[11px] font-sans text-zinc-400 leading-relaxed">
                На macOS: Настройки сети → Wi-Fi → Подробно → TCP/IP → Конфигурация IPv6: выберите «Только локальная ссылка (Link-Local Only)». На Windows снимите галочку с «IP версии 6 (TCP/IPv6)» в свойствах адаптера.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
