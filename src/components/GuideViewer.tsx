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
  Send,
} from "lucide-react";
import { openExternal, openTelegramSupport } from "../utils/opener";

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

interface VirtualCardProvider {
  id: string;
  name: string;
  badge: string;
  tier: string;
  url: string;
  description: string;
}

const VIRTUAL_CARD_PROVIDERS: VirtualCardProvider[] = [
  {
    id: "platipomiru",
    name: "Плати по миру",
    badge: "КАРТА №1 · СБП",
    tier: "Виртуальные карты Visa / Mastercard с пополнением в рублях",
    url: "https://platipomiru.com/?code=UXCAF1Z9",
    description:
      "Быстрый выпуск зарубежных карт для оплаты подписок Claude Pro, ChatGPT Plus, Cursor и зарубежных VPS через СБП.",
  },
  {
    id: "wanttopay",
    name: "WantToPay",
    badge: "TELEGRAM-БОТ №2",
    tier: "Выпуск карт в Telegram за 2 минуты (3D Secure)",
    url: "https://telegram.me/WantToPayBot?start=w17851188--ERIEX",
    description:
      "Удобный бот для выпуска виртуальных карт US / EU / HK с поддержкой 3D Secure. Проверяйте BIN во вкладке «Биллинг».",
  },
  {
    id: "epn",
    name: "e.pn",
    badge: "STRIPE PRO №3",
    tier: "Трастовые банковские BIN США и Европы с AVS",
    url: "https://e.pn?a=nomadnocode",
    description:
      "Десятки проверенных банковских BIN США и ЕС с поддержкой проверки адреса (AVS) и максимальной проходимостью в Stripe.",
  },
];

const VPS_PROVIDERS: VpsProvider[] = [
  {
    id: "hostvds",
    name: "HostVDS",
    tier: "Зарубежный VPS №1 для выходного узла (NL / US / FI)",
    badge: "ОТ $0.99/МЕС",
    price: "от ~$0.99 / мес",
    locations: ["NL", "US", "FI", "FR"],
    payments: ["Карты", "СБП", "Crypto"],
    specs: "1 vCPU · 1 ГБ RAM · NVMe · IPv4 + /64 IPv6",
    promoCode: "HOSTVDS",
    url: "https://hostvds.com/?affiliate_uuid=3d2b6c0c-5d99-4065-9d37-a941a46e9282",
    description:
      "Самый доступный выделенный статический IPv4 и чистая /64 подсеть IPv6 в Амстердаме, Хельсинки и США. Идеален как зарубежный узел.",
  },
  {
    id: "ishosting",
    name: "is*hosting",
    tier: "Премиальные выделенные VPS в 35+ странах мира",
    badge: "ЧИСТЫЙ ASN",
    price: "от ~$5.00 / мес",
    locations: ["NL", "DE", "US", "FI", "UK"],
    payments: ["Карты РФ", "СБП", "Crypto", "Cards"],
    specs: "1 vCPU · 2 ГБ RAM · NVMe · IPv4 + IPv6",
    promoCode: "ISHOSTING",
    url: "https://ishosting.com/affiliate/ODA5NyM4",
    description:
      "Безупречная репутация IP в базах Spamhaus и антифроде Anthropic/OpenAI. Поддержка Ubuntu 24.04 и выделенных подсетей IPv6.",
  },
  {
    id: "timeweb",
    name: "Timeweb Cloud",
    tier: "Облачный провайдер РФ + ЕС (идеален для входного узла Каскада)",
    badge: "КАСКАД РФ → ЕС",
    price: "от ~180 ₽/мес",
    locations: ["RU", "NL", "DE", "KZ"],
    payments: ["Карты РФ", "СБП", "T-Pay"],
    specs: "1 vCPU · 1 ГБ RAM · Dual-Stack IPv4/IPv6",
    promoCode: "TIMEWEB",
    url: "https://timeweb.cloud/?i=138893",
    description:
      "Лучший выбор для транзитного российского VPS (Москва / СПб) при сборке каскадного VPN (РФ → Зарубежье), а также узлов в Амстердаме и Франкфурте.",
  },
];

export const GuideViewer: React.FC<GuideViewerProps> = ({
  initialGuide = "01-personal-vpn-15min",
  currentIp = "185.212.102.40",
  onPinIp,
  onToast,
}) => {
  const [activeTab, setActiveTab] = useState<string>(initialGuide);
  const [vpnMethod, setVpnMethod] = useState<"cascade" | "cdn" | "ipv6">("cascade");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const copyCommand = (id: string, cmd: string, label: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCode(id);
    if (onToast) {
      onToast("Команда скопирована", label, "success");
    }
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const handleOpenCard = (card: VirtualCardProvider) => {
    openExternal(card.url);
    if (onToast) {
      onToast("Переход к сервису карт", `Открываем ${card.name} в браузере`, "info");
    }
  };

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

          {/* Step 2: 3 Proven VPN Architectures (Cascade Xray / Russian CDN XHTTP / IPv6 Revival) */}
          <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-100 font-sans">
                <Terminal className="w-3.5 h-3.5 text-emerald-400" strokeWidth={1.75} />
                <span>Шаг 2. Настройка непробиваемого Xray (3 метода)</span>
              </div>
              <span className="text-[9.5px] font-mono text-zinc-500">Ubuntu 22.04 / 24.04</span>
            </div>

            {/* Method Selector */}
            <div className="grid grid-cols-3 gap-1 p-0.5 bg-zinc-950/70 rounded border border-white/[0.06] text-[10px]">
              <button
                type="button"
                onClick={() => setVpnMethod("cascade")}
                className={`py-1 px-1.5 rounded font-medium transition-all cursor-pointer ${
                  vpnMethod === "cascade"
                    ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                1. Каскад / Xray
              </button>
              <button
                type="button"
                onClick={() => setVpnMethod("cdn")}
                className={`py-1 px-1.5 rounded font-medium transition-all cursor-pointer ${
                  vpnMethod === "cdn"
                    ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                2. CDN + XHTTP
              </button>
              <button
                type="button"
                onClick={() => setVpnMethod("ipv6")}
                className={`py-1 px-1.5 rounded font-medium transition-all cursor-pointer ${
                  vpnMethod === "ipv6"
                    ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                3. IPv6 + 3x-ui
              </button>
            </div>

            {vpnMethod === "cascade" && (
              <div className="space-y-1.5 text-[10.5px] text-zinc-300 leading-snug">
                <p className="text-zinc-400">
                  <strong className="text-zinc-100">Голое ядро Xray + Каскад (РФ → Зарубежье):</strong> быстрая установка без тяжелых панелей. Можно использовать 1 зарубежный VPS или связать входной VPS в РФ (Timeweb) с выходным VPS в Европе/США (HostVDS / is*hosting).
                </p>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400">
                    <span>1. Установка VLESS + Reality на сервер (или XHTTP):</span>
                    <button
                      type="button"
                      onClick={() =>
                        copyCommand(
                          "cmd-xray-core",
                          "wget -qO- https://raw.githubusercontent.com/ServerTechnologies/simple-xray-core/refs/heads/main/xray-install | bash",
                          "Автоустановка голого ядра Xray VLESS Reality"
                        )
                      }
                      className="text-emerald-400 hover:text-emerald-300 font-mono flex items-center gap-1 cursor-pointer"
                    >
                      {copiedCode === "cmd-xray-core" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>Копировать</span>
                    </button>
                  </div>
                  <div className="p-1.5 bg-black/50 rounded border border-white/[0.06] font-mono text-[9.5px] text-zinc-200 select-all break-all">
                    wget -qO- https://raw.githubusercontent.com/ServerTechnologies/simple-xray-core/refs/heads/main/xray-install | bash
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400">
                    <span>2. На входном VPS в РФ — скрипт связки в каскад:</span>
                    <button
                      type="button"
                      onClick={() =>
                        copyCommand(
                          "cmd-xray-cascade",
                          "wget -qO- https://raw.githubusercontent.com/ServerTechnologies/cascade-for-x-ray/refs/heads/main/cascad | bash",
                          "Скрипт настройки каскадного моста Xray"
                        )
                      }
                      className="text-emerald-400 hover:text-emerald-300 font-mono flex items-center gap-1 cursor-pointer"
                    >
                      {copiedCode === "cmd-xray-cascade" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>Копировать</span>
                    </button>
                  </div>
                  <div className="p-1.5 bg-black/50 rounded border border-white/[0.06] font-mono text-[9.5px] text-zinc-200 select-all break-all">
                    wget -qO- https://raw.githubusercontent.com/ServerTechnologies/cascade-for-x-ray/refs/heads/main/cascad | bash
                  </div>
                </div>
                <div className="text-[10px] text-zinc-400">
                  Команды управления ключами в терминале: <code className="text-emerald-300 font-mono">mainuser</code>, <code className="text-emerald-300 font-mono">newuser</code>, <code className="text-emerald-300 font-mono">userlist</code>, <code className="text-emerald-300 font-mono">sharelink</code>, <code className="text-emerald-300 font-mono">rmuser</code>.
                </div>
              </div>
            )}

            {vpnMethod === "cdn" && (
              <div className="space-y-1.5 text-[10.5px] text-zinc-300 leading-snug">
                <p className="text-zinc-400">
                  <strong className="text-zinc-100">VLESS + XHTTP через российский CDN:</strong> обход жестких блокировок и «белых списков» мобильных операторов через Yandex Cloud CDN / EdgeCenter.
                </p>
                <ol className="list-decimal list-inside space-y-1 text-[10px] text-zinc-300">
                  <li>
                    Направьте поддомен <code className="text-zinc-100 font-mono">origin.domain.ru</code> на ваш зарубежный VPS, установите Nginx + TLS сертификат Let&apos;s Encrypt и проксируйте <code className="text-zinc-100 font-mono">/api/stream</code> на локальный порт Xray (<code className="text-zinc-100 font-mono">127.0.0.1:8080</code>).
                  </li>
                  <li>
                    Чтобы российский CDN не блокировал <code className="text-zinc-100 font-mono">POST</code>-запросы, в настройках <code className="text-zinc-100 font-mono">xhttpSettings</code> включите передачу данных методом <code className="text-emerald-300 font-mono">GET</code> в заголовках:
                  </li>
                </ol>
                <div className="p-1.5 bg-black/50 rounded border border-white/[0.06] font-mono text-[9.5px] text-zinc-200 select-all space-y-0.5">
                  <div>&quot;mode&quot;: &quot;packet-up&quot;, &quot;uplinkHTTPMethod&quot;: &quot;GET&quot;,</div>
                  <div>&quot;uplinkDataPlacement&quot;: &quot;header&quot;, &quot;uplinkDataKey&quot;: &quot;x-edge-data&quot;, &quot;enableXmux&quot;: true</div>
                </div>
              </div>
            )}

            {vpnMethod === "ipv6" && (
              <div className="space-y-1.5 text-[10.5px] text-zinc-300 leading-snug">
                <p className="text-zinc-400">
                  <strong className="text-zinc-100">Оживление заблокированных серверов через IPv6:</strong> ТСПУ блокирует IPv4-адреса, но почти не трогает подсети <code className="text-zinc-100 font-mono">IPv6 (/64)</code>.
                </p>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400">
                    <span>Установка панели 3x-ui с поддержкой IPv6 и XHTTP:</span>
                    <button
                      type="button"
                      onClick={() =>
                        copyCommand(
                          "cmd-3xui",
                          "bash <(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)",
                          "Установка панели 3x-ui"
                        )
                      }
                      className="text-emerald-400 hover:text-emerald-300 font-mono flex items-center gap-1 cursor-pointer"
                    >
                      {copiedCode === "cmd-3xui" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>Копировать</span>
                    </button>
                  </div>
                  <div className="p-1.5 bg-black/50 rounded border border-white/[0.06] font-mono text-[9.5px] text-zinc-200 select-all break-all">
                    bash &lt;(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)
                  </div>
                </div>
                <p className="text-[10px] text-zinc-400">
                  В Inbound укажите <code className="text-zinc-200 font-mono">Listen: [::]</code> и подключайтесь к <code className="text-emerald-300 font-mono">[IPv6_СЕРВЕРА]:443</code> напрямую либо через Dual-Stack каскад из РФ (Timeweb IPv4 → Зарубежный IPv6).
                </p>
              </div>
            )}
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
              <span>Платежная гигиена: зарубежные карты для Claude, ChatGPT и VPS</span>
            </div>
            <p className="text-[11px] text-zinc-300 font-sans leading-relaxed">
              Для оплаты зарубежных подписок в Stripe и хостингов используйте проверенные сервисы выпуска виртуальных карт и проверяйте первые 6 цифр (BIN) во вкладке «Биллинг».
            </p>
          </div>

          {/* Partner Virtual Card Services */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[10px] font-sans tracking-wider uppercase text-zinc-400 font-semibold">
                Проверенные сервисы зарубежных виртуальных карт
              </span>
              <span className="text-[10px] font-mono text-zinc-500">Visa / Mastercard · 3DS</span>
            </div>

            {VIRTUAL_CARD_PROVIDERS.map((card) => (
              <div
                key={card.id}
                className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-1.5 hover:border-white/[0.14] transition-all"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <CreditCard className="w-3.5 h-3.5 text-amber-400 shrink-0" strokeWidth={1.75} />
                      <span className="text-xs font-bold text-white font-sans">{card.name}</span>
                      <span className="px-1.5 py-0.2 rounded bg-amber-500/10 border border-amber-500/20 text-[9px] font-mono text-amber-300 font-semibold">
                        {card.badge}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-400 font-sans mt-0.5">{card.tier}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenCard(card)}
                    className="py-1 px-2.5 rounded bg-zinc-100 text-zinc-950 hover:bg-white text-[10.5px] font-semibold font-sans flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                  >
                    <span>Оформить</span>
                    <ExternalLink className="w-3 h-3" strokeWidth={1.75} />
                  </button>
                </div>
                <p className="text-[10.5px] text-zinc-400 font-sans leading-snug">{card.description}</p>
              </div>
            ))}
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

            <div className="bg-[#12141A] rounded-lg border border-white/[0.07] p-2.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-sans font-bold text-zinc-100">
                  Защита VS Code, Cursor и CLI (Claude Code, OpenCode, Antigravity)
                </span>
                <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 text-[9.5px] font-mono font-semibold">
                  АВТО В 1 КЛИК
                </span>
              </div>
              <p className="text-[11px] font-sans text-zinc-400 leading-relaxed">
                Застава автоматически прописывает шлюз <code className="text-zinc-200 font-mono">127.0.0.1:8899</code> в настройки <span className="text-zinc-200 font-medium">VS Code, Cursor, Claude Code</span> (<code className="text-zinc-200 font-mono">~/.claude/settings.json</code>) и в <code className="text-zinc-200 font-mono">~/.zshrc</code> с умной проверкой активности. При выходе из Заставы настройки очищаются сами:
              </p>
              <div className="p-1.5 bg-black/40 rounded border border-white/[0.05] font-mono text-[10px] text-zinc-300 select-all space-y-0.5">
                <div>export HTTP_PROXY=&quot;http://127.0.0.1:8899&quot; HTTPS_PROXY=&quot;http://127.0.0.1:8899&quot;</div>
              </div>
              <p className="text-[10px] text-zinc-500">
                Не-ИИ трафик (git, npm, brew, расширения VS Code) проходит через шлюз Zastava прозрачно и без задержек.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Direct Contact Banner */}
      <div className="bg-gradient-to-r from-sky-500/10 to-indigo-500/10 rounded-lg border border-sky-500/20 p-2.5 flex items-center justify-between gap-2 mt-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-sky-500/15 text-sky-400 flex items-center justify-center shrink-0">
            <Send className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-zinc-100">Нужна помощь или консультация?</div>
            <div className="text-[10px] text-zinc-400 truncate">Поддержка и связь с разработчиком в Telegram</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (onToast) onToast("Поддержка", "Переход в Telegram: @nomadnocode", "info");
            openTelegramSupport();
          }}
          className="shrink-0 px-2 py-1 rounded-md bg-sky-500 hover:bg-sky-400 text-zinc-950 font-bold text-[10px] flex items-center gap-1 transition-all cursor-pointer"
        >
          <span>@nomadnocode</span>
        </button>
      </div>
    </div>
  );
};
