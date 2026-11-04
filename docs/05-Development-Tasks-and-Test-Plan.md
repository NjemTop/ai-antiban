# 05. Декомпозиция задач на разработку (Backlog) и План тестирования (QA Spec)

> **Инструкция для Агента-Разработчика (Developer Agent):**
> Этот документ содержит пошаговый план разработки кроссплатформенного приложения **AI-AntiBan** (`macOS` + `Windows`) на стеке **Tauri v2 (Rust) + React + TypeScript + TailwindCSS**.
> Все правила, матрицы локаций и тексты гайдов уже лежат в папке `/rules/` этого репозитория. Выполняйте эпики последовательно, покрывая каждый модуль соответствующими unit- и интеграционными тестами.

---

## Эпик 1: Инициализация проекта и базового каркаса (Tauri v2 + React)

### Задачи:
- [ ] **TASK-1.1:** Инициализировать проект Tauri v2 (`src-tauri` на Rust + фронтенд на React/TypeScript/Vite/TailwindCSS).
- [ ] **TASK-1.2:** Настроить `tauri.conf.json`:
  - Два окна (или динамическое управление окном): главное окно `main` (Dashboard, скрывается в трей при нажатии на крестик) и экстренное окно `alert-popup` (`alwaysOnTop: true`, `decorations: false` или компактный диалог `520x480`, `center: true`).
  - Включить системный трей (`trayIcon` в Tauri v2) с поддержкой смены иконки статуса (🟢 Green / 🟡 Yellow / 🔴 Red) и нативным контекстным меню.
- [ ] **TASK-1.3:** Реализовать модуль локального персистентного состояния (`src-tauri/src/state/mod.rs`):
  - Хранение файла `state.json` в `app_data_dir`:
    - `pinned_ip: Option<String>` (эталонный IP личного VPS пользователя)
    - `strict_pinning_enabled: bool`
    - `ip_history: HashMap<ProviderId, Vec<IpHistoryEntry>>` (последние 10 записей `{ ip, country_code, asn, timestamp }` для каждого провайдера)
    - `session_allowed_providers: HashSet<ProviderId>` (провайдеры, для которых нажали «Принять риск и продолжить» в текущей сессии)
    - `blocked_providers: HashSet<ProviderId>` (провайдеры, для которых нажали «Блокировать запросы до смены подключения»)

---

## Эпик 2: Ядро аудита и Матрица совместимости (`Risk Auditor Engine`)

### Задачи:
- [ ] **TASK-2.1:** Загрузка и парсинг `rules/provider_matrix.json` и `rules/dangerous_asns.json` (с возможностью фонового обновления из GitHub raw URL и фолбэком на вшитые в бинарник файлы через `include_str!`).
- [ ] **TASK-2.2:** Реализовать сетевой резолвер текущего подключения (`src-tauri/src/auditor/network.rs`):
  - Каскадный опрос IPv4 гео-провайдеров (таймаут 1500 мс на каждый):
    1. `https://ipwho.is/` (парсинг `ip`, `country_code`, `connection.asn`, `connection.org`, `connection.isp`, `timezone.id`)
    2. Фолбэк: `https://ipinfo.io/json`
    3. Фолбэк: `https://1.1.1.1/cdn-cgi/trace`
  - Кэширование результата на 30 секунд (со сбросом кэша при смене сетевого интерфейса или по кнопке «Обновить»).
- [ ] **TASK-2.3:** Реализовать проверку **Provider $\times$ Country Compatibility** (`src-tauri/src/auditor/geo_matrix.rs`):
  - Функция `evaluate_provider_geo(provider: ProviderId, country_code: &str) -> CheckResult`.
  - Должна строго блокировать (`Status::Critical`):
    - `RU`, `BY`, `CN`, `HK`, `MO`, `IR`, `KP`, `SY`, `CU` для **всех** провайдеров.
    - `TR` (Турция) при обращении к **Google Gemini / AI Studio (`gemini`)** с выводом точной причины из `provider_matrix.json`.
  - Должна выдавать предупреждение (`Status::Warning`):
    - `TR`, `KZ`, `AM`, `GE`, `AE` при обращении к **Claude (`anthropic`)**.
- [ ] **TASK-2.4:** Реализовать проверку **IP Pinning & Impossible Travel** (`src-tauri/src/auditor/history.rs`):
  - Если включен `strict_pinning_enabled` и `current_ip != pinned_ip` $\rightarrow$ `Status::Critical` (Запрос остановлен, IP не совпадает с эталонным VPS).
  - Если для `anthropic` страна сменилась менее чем за 12 часов (`prev.country_code != current.country_code`) $\rightarrow$ `Status::Warning` / `Status::Critical` (Алерт «Impossible Travel: резкая смена страны»).
- [ ] **TASK-2.5:** Реализовать проверку IP по спам-базам и черным спискам (`src-tauri/src/auditor/dnsbl.rs` — аналог 2ip.io):
  - Разворот текущего IPv4 (`a.b.c.d` $\rightarrow$ `d.c.b.a.<zone>`) и параллельный асинхронный DNS-лукап (`A`-запись с таймаутом 600 мс) по 4 зонам из `rules/dangerous_asns.json`:
    - `zen.spamhaus.org` (Spamhaus SBL/XBL/PBL)
    - `dnsbl.dronebl.org` (DroneBL)
    - `dnsbl.sorbs.net` (SORBS)
    - `b.barracudacentral.org` (Barracuda)
  - Если хотя бы одна зона возвращает `127.0.0.x` $\rightarrow$ статус `Warning` / `Critical` с указанием названия спам-базы. Если все возвращают `NXDOMAIN` $\rightarrow$ `0/4 Clean (Pass)`.
- [ ] **TASK-2.6:** Реализовать кроссплатформенные проверки утечек (`src-tauri/src/auditor/leaks.rs`):
  - **IPv6 Leak:** параллельный запрос к `https://[2606:4700:4700::1111]/cdn-cgi/trace` (таймаут 800 мс). Если проходит и `loc` в списке санкционных стран (`RU`/`BY`) или не совпадает со страной IPv4 $\rightarrow$ `Status::Critical`.
  - **Timezone & Locale Check:** сверка системного часового пояса (`iana-time-zone` crate) с таймзоной IP. Если системная зона `Europe/Moscow` (или любая зона РФ) $\rightarrow$ `Status::Warning`.
  - **OS Location Services Check:** проверка статуса системной геолокации на macOS и Windows (реестр `ConsentStore\location`).
- [ ] **TASK-2.7:** Реализовать утилиту очистки локальных следов после бана (`src-tauri/src/auditor/cache_cleaner.rs` — Anti-Chain-Ban):
  - Команда `clean_ai_app_cache(provider: ProviderId)` для безопасной очистки локальных идентификаторов (`Cookies`, `IndexedDB`, `Local Storage`, `Session Storage`, `Preferences` в `~/Library/Application Support/Claude` на macOS и `%APPDATA%\Claude` на Windows) при смене забаненного аккаунта.

---

## Эпик 3: Локальный Перехватчик (`Selective PAC + HTTP CONNECT Hold Proxy`)

### Задачи:
- [ ] **TASK-3.1:** Реализовать HTTP/TCP прокси-сервер на `tokio` (`127.0.0.1:8899`) в `src-tauri/src/proxy/mod.rs`:
  - Обработка `GET /proxy.pac`: возвращает PAC-скрипт, заворачивающий домены из `provider_matrix.json` в `PROXY 127.0.0.1:8899`, а все остальные — в `DIRECT`.
  - Обработка `CONNECT <host>:<port> HTTP/1.1`:
    1. Определяет `ProviderId` по `<host>`.
    2. Если провайдер в `blocked_providers` (пользователь ранее нажал «Блокировать до смены сети») $\rightarrow$ немедленно возвращает `403 Forbidden` и закрывает сокет.
    3. Вызывает `Auditor::evaluate(provider)`.
    4. Если вердикт `GREEN` (или провайдер в `session_allowed_providers`) $\rightarrow$ устанавливает TCP-соединение с `<host>:<port>`, отвечает `HTTP/1.1 200 Connection Established` и запускает `tokio::io::copy_bidirectional` (Zero-MITM, без чтения TLS).
    5. Если вердикт `YELLOW` / `RED` $\rightarrow$ ставит соединение в очередь ожидания (`HoldQueue` через `tokio::sync::oneshot` / `watch` канал с таймаутом 60 сек) и отправляет событие во фронтенд `interceptor://risk-detected` для показа попапа!
- [ ] **TASK-3.2:** Реализовать обработку ответа пользователя из попапа:
  - Команда Tauri `resolve_interception(action: InterceptionAction, provider: ProviderId)`:
    - `OpenGuideAndBlock`: закрывает удерживаемые сокеты с `403`, открывает главное окно на гайде №1.
    - `AllowSession`: добавляет `provider` в `session_allowed_providers`, разблокирует все ждущие в `HoldQueue` сокеты и пропускает трафик.
    - `BlockUntilNetworkChange`: добавляет `provider` в `blocked_providers`, сбрасывает удерживаемые сокеты с `403`. При смене сети (когда новый IP становится `GREEN`) автоматически очищает `blocked_providers` и шлет системное уведомление.
- [ ] **TASK-3.3:** Реализовать автонастройку системного PAC-прокси для **macOS и Windows** (`src-tauri/src/sysproxy/mod.rs`):
  - **macOS:** через `networksetup -setautoproxyurl <service> http://127.0.0.1:8899/proxy.pac` для активных сервисов (`Wi-Fi`, `Ethernet`).
  - **Windows:** через крейт `winreg` запись `AutoConfigURL` в `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` + вызов `InternetSetOptionW` из `winapi`/`windows-sys`.
  - **Аварийная очистка (Clean Exit Guard):** обязательное отключение системного PAC-прокси при выходе из приложения, панике (`std::panic::set_hook`) и обработке сигналов `SIGINT`/`SIGTERM`.

---

## Эпик 4: Модуль проверки платежных карт (`BIN Checker`)

### Задачи:
- [ ] **TASK-4.1:** Реализовать `src-tauri/src/bin_checker/mod.rs`:
  - Принимает строку из 6–8 цифр (очищает пробелы, отвергает ввод > 8 цифр, чтобы пользователь случайно не ввел весь номер карты).
  - Проверяет встроенные правила (например, российские карты Мир `2200..2204` и известные BIN банков РФ/РБ сразу получают статус `CRITICAL`).
  - Запрашивает публичный BIN-лукап (`https://data.handyapi.com/bin/{bin}` или `https://lookup.binlist.net/{bin}`) и возвращает:
    - Страну банка (`country_code`)
    - Тип карты (`DEBIT` / `CREDIT` / `PREPAID`)
    - Эмитента (`bank_name`)
    - Рекомендацию: безопасно ли привязывать к Claude/OpenAI/Gemini при текущем IP.

---

## Эпик 5: Пользовательский интерфейс в стиле CodeBurn (`codeburn.app` Aesthetic)

### Задачи:
- [ ] **TASK-5.1:** Настроить дизайн-систему без «ИИ-слопа» (строго по `docs/04-UI-UX-and-Monetization-Spec.md`):
  - Темная угольная палитра (`#0A0B0E` / `zinc-950`, карточки `#12141A` с тонкими рамками `border-white/[0.07]`), моноширинный шрифт (`JetBrains Mono` / `SF Mono` с `tabular-nums`) для всех IP, ASN, DNSBL, кодов стран и таймеров.
  - Компактный Segmented Control в шапке окна (`Pulse` | `Deep Audit (9)` | `VPN Guide` | `BIN`).
- [ ] **TASK-5.2:** Сверстать **Экстренный Попап Перехвата (`AlertPopup.tsx`)**:
  - Строгий инженерный модальный диалог (`480x420 px`, `AlwaysOnTop`), отображающий удерживаемый домен (`HOLDING PACKET...`), таймер TTL и моноширинный список сработавших триггеров (`Geo Matrix`, `DNSBL Spam List`, `Timezone/Leak`).
  - 3 кнопки строго по ТЗ:
    1. `⚡ 1. Инструкции по решению (Свой безопасный VPN за 15 мин)` (контрастная основная кнопка)
    2. `2. Принять риск и продолжить`
    3. `⛔ 3. Блокировать запросы до смены подключения`
- [ ] **TASK-5.3:** Сверстать **Главное Popover-окно (`Dashboard.tsx`)**:
  - Верхний блок с SVG-кольцом `Trust Score (0-100%)` (в стиле колец CodeBurn), текущим IP, страной, ASN, статусом спам-баз (`DNSBL: 0/4 Clean`) и кнопкой **«📌 Pin VPS»**.
  - Таблица совместимости `Provider Compatibility Matrix` для `Claude`, `ChatGPT`, `Gemini` (показывающая статус и причину, например `BLOCKED · TR` для Gemini).
  - Вкладка `Deep Audit (9)` с детальными результатами всех 9 проверок (включая спам-базы DNSBL как на 2ip.io).
  - Кнопки быстрых действий: **«🧹 Clean AI App Cache»** (сброс следов после бана) и **«🧪 Simulate Interception»** (тестовый вызов попапа перехвата).
- [ ] **TASK-5.4:** Сверстать **Встроенный Ридер Гайдов (`GuideViewer.tsx`)** и **Вкладку проверки карт (`BinCheckerModal.tsx`)**:
  - Рендеринг гайдов из `/rules/guides/*.md` с нативными карточками VPS-партнеров и открытием ссылок в системном браузере.

---

## Эпик 6: CI/CD и кроссплатформенная сборка (macOS + Windows)

### Задачи:
- [x] **TASK-6.1:** Создать GitHub Actions workflow (`.github/workflows/release.yml`) на базе `tauri-apps/tauri-action`:
  - Матрица сборки: `macos-latest` (Universal `.dmg` и `.app`) и `windows-latest` (`.msi` и `.exe` NSIS).

---

## План тестирования и приемки (Test Plan & QA Spec)

Разработчик обязан написать и прогнать следующие автоматические и интеграционные тесты перед сдачей проекта:

### 1. Unit-тесты ядра (`cargo test`)
* **`test_provider_geo_matrix_russia_blocked`:**
  * *Вход:* `country_code = "RU"`, провайдеры `anthropic`, `openai`, `gemini`.
  * *Ожидание:* Для всех трех возвращается `Status::Critical`.
* **`test_provider_geo_matrix_turkey_gemini_blocked`:**
  * *Вход:* `country_code = "TR"`.
  * *Ожидание:* Для `gemini` возвращается `Status::Critical` (блокировка с текстом про Турцию), для `anthropic` — `Status::Warning`, для `openai` — `Status::Ok`.
* **`test_provider_geo_matrix_hongkong_blocked`:**
  * *Вход:* `country_code = "HK"`.
  * *Ожидание:* Для всех трех провайдеров возвращается `Status::Critical`.
* **`test_provider_geo_matrix_netherlands_allowed`:**
  * *Вход:* `country_code = "NL"` (или `"DE"`, `"US"`).
  * *Ожидание:* Для всех трех провайдеров `Status::Ok`.
* **`test_strict_ip_pinning`:**
  * *Вход:* `pinned_ip = Some("185.10.10.10")`, `strict_pinning = true`, текущий IP `"185.20.20.20"` (`NL`).
  * *Ожидание:* Даже несмотря на разрешенную страну `NL`, возвращается `Status::Critical` (несовпадение с закрепленным IP).
* **`test_impossible_travel_detection`:**
  * *Вход:* В истории `anthropic` 1 час назад записан вход из `"DE"`, текущий вход из `"US"`.
  * *Ожидание:* Срабатывает триггер `ImpossibleTravel`.
* **`test_dnsbl_reverse_ip_query_formatting`:**
  * *Вход:* `ip = "185.220.101.1"`, зона `"zen.spamhaus.org"`.
  * *Ожидание:* Формируется корректный реверсный запрос `"1.101.220.185.zen.spamhaus.org"`; при ответе `127.0.0.2` возвращается статус `Listed (Critical/Warning)`, при `NXDOMAIN` — `Clean`.
* **`test_bin_checker_validation`:**
  * *Вход:* `"220220"` (Мир РФ) $\rightarrow$ `Critical`; ввод 16 цифр номера карты $\rightarrow$ ошибка валидации (принимаются только 6–8 цифр BIN для приватности).

### 2. Интеграционные тесты Перехватчика (Proxy Hold & Release)
* **`test_pac_file_generation`:**
  * Запрос `GET http://127.0.0.1:8899/proxy.pac` возвращает статус `200 OK` и валидный JS-код, где `claude.ai`, `chatgpt.com`, `gemini.google.com` маршрутизируются через `PROXY`, а `ya.ru` или `apple.com` — через `DIRECT`.
* **`test_connect_hold_and_block`:**
  * При симуляции опасного IP (`RU` или `TR` для Gemini) отправляется `CONNECT gemini.google.com:443` на локальный прокси.
  * Прокси ставит соединение на паузу (не отправляя пакет в сеть!).
  * При подаче команды `UserAction::BlockUntilNetworkChange` прокси возвращает `HTTP/1.1 403 Forbidden` и закрывает соединение.
* **`test_connect_hold_and_allow_session`:**
  * При подаче команды `UserAction::AllowSession` удерживаемое соединение получает `HTTP/1.1 200 Connection Established` и устанавливает туннель.
* **`test_graceful_proxy_cleanup`:**
  * Проверка, что вызов `SysProxy::disable()` гарантированно возвращает системные настройки macOS/Windows в исходное состояние (`AutoProxy = off`).
