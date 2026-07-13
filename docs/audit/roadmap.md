# TaskFlow — полный аудит: roadmap эволюции, архитектура, связи, безопасность и платежи

**Дата первого аудита:** 09.07.2026. Последующие изменения фиксируются внутри блоков (хронология, Wave-итоги, чек-листы) с явными датами — верхняя дата НЕ обновляется.
**Статус: живой рабочий документ.** Не переписывается целиком, дополняется точечно. Правила поддержки — в отдельном файле [`roadmap-guidelines.md`](./roadmap-guidelines.md). Кратко: историю не переписываем задним числом, релизы дополняем в хронологии, архитектура/находки — в соответствующих разделах, устаревшее переносим в **раздел 10 «Исторический архив»**, а не удаляем.
Смотри также компаньон-документ `taskflow_erd_data_dictionary.md` (точная схема из живой базы Supabase, тоже живой) — этот роадмап ссылается на него, а не дублирует структуру таблиц.
**Репозиторий:** [github.com/danny-swan/taskflow-app](https://github.com/danny-swan/taskflow-app). Ветки: `main` (production, source of truth для релизов) и `develop` (текущая работа). Первый стабильный релиз — [v1.0.0](https://github.com/danny-swan/taskflow-app/releases/tag/v1.0.0) (11.07.2026), актуальный — см. хронологию раздела 1.
**Метод (первый аудит):** git-история (`git log -p --all`), GitHub Secrets/Variables/Workflows, память прошлых сессий, три независимых кодинг-аудита (архитектура+sync-регрессия; безопасность+платежи; код-локейшны+критические связи+проверка открытых вопросов по коду).

> Навигация: раздел 1 — хронология с ссылками на коммиты и код. Раздел 2 — карта сервисов/секретов. **Раздел 3 — критические связи ("что с чем жёстко связано").** Раздел 4 — регрессия sync. **Раздел 5 — блок находок (баги/дыры) с критичностью и историей фиксов.** Раздел 6 — исторический этап `develop` (Wave 1–4). Раздел 7 — пост-v1.0.0 направления (живой). Раздел 8 — что аудит покрыл, а что нет. Приложения — миграции, источники, ADR-индекс. **Раздел 10 — исторический архив (устаревшие чек-листы и снапшоты).**

---

## 1. Хронология и ключевые milestones

### Эпоха рождения (09.05.2026) — v0.6 → v0.7
- [`f7745c0`](https://github.com/danny-swan/taskflow-app/commit/f7745c0) — первый коммит, TaskFlow v0.6.
- Попытка перейти с localStorage на файловый SQLite через Tauri ([`7a19f0c`](https://github.com/danny-swan/taskflow-app/commit/7a19f0c)) — **не удалась и была полностью откачена** ([`b805e09`](https://github.com/danny-swan/taskflow-app/commit/b805e09)..[`04670be`](https://github.com/danny-swan/taskflow-app/commit/04670be), серия "restore from v0.7.2").
- Правильная замена: [`e1528f5`](https://github.com/danny-swan/taskflow-app/commit/e1528f5) — **`tauri-plugin-sql`** с кастомным путём к файлу. Это и есть текущая архитектура БД — сам слой сегодня живёт в `src/lib/db.ts` (dual-backend: web → sql.js, desktop → tauri-plugin-sql).
- *Урок:* первый серьёзный архитектурный разворот в проекте.

### v0.8.x (09-10.05, потом 05-06.06.2026) — фичи десктоп-приложения
Сайдбар, канбан-основа, импорт JSON/CSV/XLSX, drag&drop, backup export/import, шаблоны задач, undo для удаления/завершения. Код сегодня:
- Канбан: `src/components/KanbanBoard.tsx:101-167` (`@dnd-kit`, `onDragEnd`).
- Drag&drop в списке задач: `src/components/Tasks.tsx:197-261`.
- Импорт JSON/CSV/XLSX: `src/components/Settings.tsx:854-878` (папарсер `papaparse` для CSV, `xlsx`/SheetJS для XLSX).
- Backup export/import: `db.buildBackup()` / `db.applyBackup()` — `src/lib/db.ts:1050` / `:1074` (режимы `merge`/`replace`).
- Шаблоны задач: `src/store/useStore.ts:70-85` (CRUD), `createTaskFromTemplate` — `:948-968`.
- Undo удаления/завершения (10-сек окно): `deleteTaskWithUndo` — `src/store/useStore.ts:674-694`, таймер на `:675`.

Несколько hotfix-релизов на порядок `migrate → seed` (v0.8.3/v0.8.4) и white-screen/seed-баги (v0.8.5-0.8.17) — тема "миграции выполняются раньше/позже сида" всплывёт и позже (в связке с Bug #1 раздела 4).

### v0.9.0-v0.9.34 (07.06, 02-05.07.2026) — UI-полировка
- Канбан-вид (v0.9.0), Календарь/Неделя/DatePicker — `src/components/Calendar.tsx`, `src/components/DatePicker.tsx`.
- Онбординг переписан 5+ раз (v0.9.16→v0.9.19), финальный тултип-онбординг — [`901f714`](https://github.com/danny-swan/taskflow-app/commit/901f714) (v0.9.34), код: `src/components/Onboarding.tsx`.
- Custom Theme — `src/lib/customTheme.ts` + `src/components/ThemeProvider.tsx`.
- Command Palette — `src/components/CommandPalette.tsx`, горячая клавиша Ctrl/Cmd+K: `src/App.tsx:55-67`.
- Auto-cleanup (опт-ин) — `runAutoCleanup`: `src/store/useStore.ts:485-535`, запуск при старте: `src/App.tsx:146-152`.
- Timezone fix.

### Переход в облако: v0.9.8-v0.9.24 (03-04.07.2026) — фундамент бэкенда
Ключевой этап — здесь появляются все внешние сервисы:

| Версия | Коммит | Событие | Код сегодня |
|---|---|---|---|
| v0.9.8 | [`98af5d5`](https://github.com/danny-swan/taskflow-app/commit/98af5d5) | Tauri auto-updater + Framer Motion | `src/lib/updater.ts:72`, macOS GitHub-fallback `:40`; конфиг `src-tauri/tauri.conf.json:38-45` |
| **v0.9.9** | [`1ab2298`](https://github.com/danny-swan/taskflow-app/commit/1ab2298) | **Supabase Auth впервые подключён**, телеметрия, Privacy Policy | `src/lib/supabase.ts:40` |
| v0.9.10 | [`e6eafe3`](https://github.com/danny-swan/taskflow-app/commit/e6eafe3) | CSP разрешает Supabase-домены (фикс "Failed to fetch") | — |
| v0.9.11 | [`5580b86`](https://github.com/danny-swan/taskflow-app/commit/5580b86) | Google OAuth (deep link) + `delete_account` — первая Edge Function | `signInWithGoogle` — `src/lib/auth.ts:252-272`; кнопка `src/components/AuthScreen.tsx:407-432` |
| v0.9.13 | [`d2a7f32`](https://github.com/danny-swan/taskflow-app/commit/d2a7f32) | Security-фикс: валидация JWT в `delete_account` через anon-клиент | — |
| v0.9.14/v0.9.15 | — | Password reset, change email/password; (по заметкам прошлых сессий) поднят лимит писем Supabase 2→30/час, включены bilingual email-шаблоны | `requestPasswordReset`/`updatePassword`/`updateEmail` — `src/lib/auth.ts:193-219`; UI — `src/components/PasswordResetModal.tsx:106-226` |
| **v0.9.20** | [`68f07f7`](https://github.com/danny-swan/taskflow-app/commit/68f07f7) | **Vitest** + unit-тесты + CI gate | 24 тест-файла `*.test.ts(x)`; CI `.github/workflows/test.yml:21-47` |
| **v0.9.21** | [`6694fec`](https://github.com/danny-swan/taskflow-app/commit/6694fec) | **Playwright E2E** + CI gate | 5 спеков в `e2e/`; CI `.github/workflows/test.yml:49-87` |
| **v0.9.23** | [`3144424`](https://github.com/danny-swan/taskflow-app/commit/3144424) | **Sentry** + **Cloudflare Turnstile** капча + privacy fix (имя автора в PRIVACY.md) | Sentry: `initSentry` — `src/lib/sentry.ts:68-94`, скрабинг PII — `scrubEvent:36-66`. Turnstile: виджет `src/components/AuthScreen.tsx:327-350`, токен передаётся в `signUp/signIn` через `src/lib/auth.ts:173-186,226-239` — своей edge-функции верификации нет, проверка на стороне Supabase Auth Attack Protection |
| v0.9.24 | [`dd781ff`](https://github.com/danny-swan/taskflow-app/commit/dd781ff) | Hotfix Turnstile CSP, минимальная длина пароля 6→8 | — |

Дополнительно из памяти прошлых сессий (нет прямых коммитов, настраивалось через дашборды сервисов, не в git):
- **Resend SMTP** принят взамен встроенного Supabase SMTP из-за лимита 2 письма/час: `smtp.resend.com:465`, логин `resend`, пароль — API-ключ Resend (`re_...`). Отправитель сначала `onboarding@resend.dev`, затем `noreply@yourtaskflow.app`. Сегодня в коде используется уже не SMTP, а прямой вызов Resend API из `supabase/functions/send-user-email/index.ts` и `activation-notify/index.ts`.
- **Домен** `yourtaskflow.app` зарегистрирован на Namecheap; лендинг на GitHub Pages; DNS — apex A-запись + www CNAME; TLS через Let's Encrypt; MX/DKIM/DMARC/SPF — Namecheap Private Email.
- **Sentry**: организация `swans-org`, проект `taskflow`, регион EU (Frankfurt) — сделано для соответствия региону Supabase (тоже EU/Frankfurt, GDPR-мотив).

### Sync foundation: dev.1-dev.5 (05-06.07.2026) — облачная синхронизация
| Версия | Коммит | Событие |
|---|---|---|
| dev.1 | [`d5b4873`](https://github.com/danny-swan/taskflow-app/commit/d5b4873) (облако) / [`dae3152`](https://github.com/danny-swan/taskflow-app/commit/dae3152) (клиент) | Миграции `0001_init.sql`/`0002_sync_schema.sql`, клиентская схема (`client_id`,`updated_at`,`deleted_at`,`version`) |
| dev.2 | [`268e96e`](https://github.com/danny-swan/taskflow-app/commit/268e96e) | Outbox-таблица + trigger schedule, UUIDv7 на INSERT, auto-bump `version` |
| dev.3 | [`f0e1172`](https://github.com/danny-swan/taskflow-app/commit/f0e1172) | Backfill outbox, Zustand-интеграция, `PendingSyncChip` в Sidebar |
| **dev.4** | [`fafba20`](https://github.com/danny-swan/taskflow-app/commit/fafba20) | **Первый рабочий push+pull+LWW sync** — `src/lib/sync/push.ts` (backoff 1/2/4/8/16 мин, 5 попыток), `src/lib/sync/pull.ts` (LWW по `updated_at`), `src/lib/sync/index.ts` (orchestrator, state machine) |
| dev.5 | [`6c7a06c`](https://github.com/danny-swan/taskflow-app/commit/6c7a06c) | `sync_overdue_events`, Realtime (5 каналов), debounced pull (600мс), классификация постоянных/временных ошибок |

### Монетизация и платежи: dev.6.x (06-07.07.2026) — самый насыщенный этап
| Версия | Коммит | Событие |
|---|---|---|
| dev.6 | [`a0a2d70`](https://github.com/danny-swan/taskflow-app/commit/a0a2d70) | Freemium + Trial (14 дней, `supabase/functions/start-trial/index.ts:99-130`) + Subscription + Lifetime |
| dev.6.1 | [`d2d2833`](https://github.com/danny-swan/taskflow-app/commit/d2d2833) | Secrets cleanup — секреты вынесены из кода в env |
| dev.6.2/6.3 | [`81b1f46`](https://github.com/danny-swan/taskflow-app/commit/81b1f46) / [`748c76e`](https://github.com/danny-swan/taskflow-app/commit/748c76e) | CI-фиксы (Supabase env → GitHub Secrets, release-regex под `-dev.N.M`) |
| **dev.6.4** | [`422d1a9`](https://github.com/danny-swan/taskflow-app/commit/422d1a9) | **YooKassa checkout**: `create-payment`, `payment-webhook`; фронт `ec1f079` (SubscriptionBlock), `6db25d5` (deep-link preselect) |
| dev.6.4.1 | [`086700c`](https://github.com/danny-swan/taskflow-app/commit/086700c) | Активация кнопок покупки в Settings |
| 🔺 **dev.6.4.2** | [`1c2d34e`](https://github.com/danny-swan/taskflow-app/commit/1c2d34e) | **Security-инцидент №1**: GRANT для service_role + перевод webhook на raw-fetch |
| 🔺 **dev.6.4.3** | [`8115130`](https://github.com/danny-swan/taskflow-app/commit/8115130) | **Security-инцидент №2**: GRANT SELECT для authenticated на entitlements/payment |
| 🔺 **dev.6.4.4** | [`b194764`](https://github.com/danny-swan/taskflow-app/commit/b194764) | **Security-инцидент №3 (самый широкий)**: GRANT на sync_*+profiles, REVOKE trigger functions |
| dev.6.5.0 | [`f4fb605`](https://github.com/danny-swan/taskflow-app/commit/f4fb605) | pgTAP-тесты (`supabase/tests/01_grants_test.sql`, `plan(74)`, 14 таблиц хардкодом) + CI workflow |
| dev.6.5.1 | [`058983c`](https://github.com/danny-swan/taskflow-app/commit/058983c) | Recurring/refund/cancel единым релизом — таблица `payment_methods` (миграция 0014), `renew-subscription`, `cancel-subscription` |
| dev.6.5.2 | [`26af04a`](https://github.com/danny-swan/taskflow-app/commit/26af04a) | Self-service отвязка карты — `supabase/functions/detach-payment-method/index.ts` |
| dev.6.5.3 | [`6da627d`](https://github.com/danny-swan/taskflow-app/commit/6da627d) | Schema↔code alignment (миграция 0016 — **источник F2/F3**, см. раздел 5) |
| dev.6.6 | [`127013a`](https://github.com/danny-swan/taskflow-app/commit/127013a) | Admin panel `/admin` — `src/components/AdminPage.tsx:113-734`, `admin-actions/index.ts:141-266`, RPC `0017_admin_rpc.sql` |
| dev.6.7-6.7.2 | — | UX-правки Settings |
| dev.6.8.0 | [`785b365`](https://github.com/danny-swan/taskflow-app/commit/785b365) | Trial с привязкой карты |
| — | [`3f63dc8`](https://github.com/danny-swan/taskflow-app/commit/3f63dc8) | Защитный фикс: webhook `.from()` → AdminClient raw fetch |
| dev.6.8.1 | [`7b42119`](https://github.com/danny-swan/taskflow-app/commit/7b42119) | Flash-of-free fix, вкладка "Синхронизация" возвращена |
| **dev.6.9.0** | [`1e5e3f5`](https://github.com/danny-swan/taskflow-app/commit/1e5e3f5) | **Изоляция локальной БД по аккаунту** (`bound_user_id` — `src/lib/snapshots.ts:175-240`) + снимки — safety net |
| dev.6.9.1 | [`ced8a7c`](https://github.com/danny-swan/taskflow-app/commit/ced8a7c) | Тесты на migration v8, `clearUserData`, `bound_user_id` |
| dev.6.9.2 | [`7fae387`](https://github.com/danny-swan/taskflow-app/commit/7fae387) | `renew-subscription` cron → `apikey` + `x-cron-secret`, `verify_jwt=false` |
| dev.6.9.3 | [`4d945db`](https://github.com/danny-swan/taskflow-app/commit/4d945db) | UX "автопродление" вместо "привязать карту" |
| 🔺 **dev.6.10.0** | [`261d6e1`](https://github.com/danny-swan/taskflow-app/commit/261d6e1)/[`c700473`](https://github.com/danny-swan/taskflow-app/commit/c700473) | **Sync-инцидент**: fix 4 sync/snapshot бага (детали — раздел 4) |
| dev.6.10.1 | [`d14a4e4`](https://github.com/danny-swan/taskflow-app/commit/d14a4e4) | Починка привязки СБП/карты — **побочный эффект: перевёл запись `payment_method_id` на uuid, но `renew-subscription` не обновили → породил F1, см. раздел 5** |
| dev.6.10.2 | — | Фикс 404 на `return_url` для update-card/trial → `/pay/success` |
| dev.6.10.3 | [`7bf8243`](https://github.com/danny-swan/taskflow-app/commit/7bf8243) | Defer orphan tasks, gate account-switch для free plan, seed statuses on empty cloud |
| dev.6.10.4 | [`78474de`](https://github.com/danny-swan/taskflow-app/commit/78474de) | Восстановленные строки снимка сохраняют sync-идентичность |
| **dev.6.10.5** | [`f764e23`](https://github.com/danny-swan/taskflow-app/commit/f764e23) (сегодня, 09.07) | Дашборд "Текущий срез", ручное назначение тэга, undo-delete 10с |

### Разрыв в релизах (закрыт v1.0.0)
GitHub Releases/теги останавливались на `v0.9.35-dev.6.4.3` (07.07, 11:32 UTC). Всё после (dev.6.4.4 → dev.6.10.5, 30+ версий) существовало только как коммиты в `develop`, без тега и релиза. **Закрыто** выпуском v1.0.0 (11.07.2026, см. ниже). Промежуточные dev.6.5–dev.6.10 ретегировать задним числом не стали (осознанное решение).

### v1.0.0 — первый стабильный релиз (11.07.2026)
| Событие | Коммит / ссылка | Комментарий |
|---|---|---|
| Bump 1.0.0 в `package.json` на `develop` | `0596900` | Готовность к merge to main |
| Merge `develop` → `main` | `2057048` (--no-ff) | 97 коммитов develop-линии влиты в `main` |
| Тег `v1.0.0` | [`a2d3794`](https://github.com/danny-swan/taskflow-app/commit/a2d3794b081fc96d6554020c5669b1ae3c8d335e) | Первый не-pre-release тег |
| CI сборка v1.0.0 | run 29162679376 | 179/179 unit, E2E ✅, Windows (NSIS+MSI RU/EN+portable) + macOS universal dmg |
| Публикация релиза | [v1.0.0](https://github.com/danny-swan/taskflow-app/releases/tag/v1.0.0) | Стабильный, двуязычные release notes (RU/EN) в стиле v0.9.34 |
| Анон-ключ в CI заменён на publishable | secret `SUPABASE_ANON_KEY` = `sb_publishable_EDGdl5gun3Ud60AQMymq9A_VWUFpS-a` | В клиенте через `VITE_SUPABASE_ANON_KEY` из env, ключ не хардкодится. Legacy anon ещё активен, отключать только после миграции service_role на sb_secret (см. раздел 7) |
| admin-actions передеплой (CORS для dev-origin) | edge v6 → v7 | CORS для `http://localhost:5173` восстановлен |

### v1.0.1 — патч (11.07.2026)
| Событие | Коммит / ссылка | Комментарий |
|---|---|---|
| PR #69 — `fix(sidebar): move sync status chip to bottom` | [PR #69](https://github.com/danny-swan/taskflow-app/pull/69), коммит `5a6ed65`, merge `cc6d760` | `PendingSyncChip` перенесён под навигацию (к переключателю языка) — пункты меню больше не прыгают при появлении/исчезновении sync-чипа |
| Bump 1.0.1 в `package.json` на `main` | `0c0b2bb` | Согласовано с тегом |
| Тег `v1.0.1` → релиз | [v1.0.1](https://github.com/danny-swan/taskflow-app/releases/tag/v1.0.1) | Стабильный патч, те же артефакты (NSIS+MSI+portable+dmg+latest.json), автообновление с v1.0.0 работает |
| `APP_ALLOWED_ORIGINS` добавлен `http://tauri.localhost` | Supabase Edge Functions env | Починило «Failed to fetch» в админке из собранного Tauri v2 на Windows (WebView2 шлёт origin `http://tauri.localhost`). Функции читают env в рантайме — передеплой не потребовался |
| Обновление roadmap (раздел H — чеки ФНС) | `89461e3` | Зафиксирована находка: ЮKassa с 23.12.2025 прекратила выдачу чеков НПД (в этом рефакторинге — раздел 7) |

### Post-v1.0.1 фиксы (12.07.2026)

> Серия из трёх PR-ов по багам/фичам, смёржены в `main` 12.07.2026 и выпущены как [v1.0.2](https://github.com/danny-swan/taskflow-app/releases/tag/v1.0.2) в тот же день (см. раздел 7.4). Серверная часть (миграция `0025_task_hold_periods` = supabase-name `sync_task_hold_periods`) — ✅ ПРИМЕНЕНА НА ПРОД 12.07.2026 (version `20260712112352`), бэкфилл отработал (таблица пуста — висящих холдов у 4 прод-аккаунтов нет). RLS включен, GRANT authenticated выдан, realtime-публикация обновлена.

| Событие | Коммит / ссылка | Комментарий |
|---|---|---|
| PR #70 — `fix(tasks): не открывать попап при возврате задачи в работу` | [PR #70](https://github.com/danny-swan/taskflow-app/pull/70), squash `3310aa4` | Bug B1: в `TaskCard.tsx` guard `onCardClick` не блокировал `reopenOpen` — клик по кнопке внутри `ConfirmDialog` (portal) всплывал по React-дереву в `onClick` карточки и та открывала попап со старым снимком task-объекта. Поле в базе — `finish_date` (не `completed_at`). +127/−1, 2 файла, 212 vitest тестов зелёные |
| PR #71 — `fix(entitlements): устранить race в useEntitlement` | [PR #71](https://github.com/danny-swan/taskflow-app/pull/71), squash `91d7aa1` | Bug B2: `useEntitlement` инициализировал `loading = useState(!!userId)`, `setLoading(true)` жил в `useEffect` — при `userId: null → user-1` один коммит guard `AdminPage` видел устаревшее `entLoading=false` и редиректил на `/`. Фикс — вариант А: синхронный расчёт `loading`/`status` на рендере через сравнение `userId` с `resolvedFor`. Серверная защита не тронута. +178/−15, 242 vitest теста |
| Релиз десктопа v1.0.2 | [тег v1.0.2](https://github.com/danny-swan/taskflow-app/releases/tag/v1.0.2), коммит `1f0921d`, [CI run 29191151289](https://github.com/danny-swan/taskflow-app/actions/runs/29191151289) | Собраны Windows (NSIS + MSI RU/EN + portable) и macOS (universal dmg), latest.json подписан — v1.0.0/v1.0.1 юзеры получат обновление через auto-updater. 264/264 vitest, E2E Playwright зелёные |
| PR #72 — `feat(stats): реальный расчёт столбца «Холд» (task_hold_periods)` | [PR #72](https://github.com/danny-swan/taskflow-app/pull/72), squash `2602371` | F6: новая sync-таблица `task_hold_periods (task_id, started_at, ended_at, user_id, ...)`. **Клиент — единственный автор**: записи интервалов в `addTask`/`updateTask`/`softDeleteTask` (как `overdue_events`), серверного триггера НЕТ — работает в local-only режиме, нет дубликатов при sync. Миграция `0025_task_hold_periods.sql` (RLS + GRANT + бэкфилл висящих холдов + realtime). Клиент-миграция `v10`. `Stats.tsx` теперь читает «Холд» из `holdMap`. Формула дней: `end − start` (02.06→05.06 = 3д, открытый интервал — до `now()`, несколько периодов плюсуются). +801/−6, 15 файлов, 258 vitest тестов зелёные, pgTAP `01_grants_test.sql` расширен 74→83 |
| Правка roadmap: раздел 3 (🟡-блок) | `2570a42` | Переименование в «Структурные точки...» + отметка Wave 3 future-table probe в п. 2 |

**Применение на прод (после мержа):**
- B1/B2 (фронт-фиксы) — уедут на прод только с релизом десктопа (v1.0.2 ещё не собран).
- F6 (Холд) — миграция `0025` НЕ применена на прод (требует отдельного захода через Supabase-коннектор — идемпотентна, содержит бэкфилл).

### v1.0.3 — базовая кастомизация профиля (12.07.2026)

> Первый шаг к профилям: публичный ID `TF-XXXXXX` + профильные поля (никнейм/аватар/bio). Модель аккаунтов и данных не менялась. Серверная миграция `0026_profile_customization` — ✅ ПРИМЕНЕНА НА ПРОД 12.07.2026 (подробности — в блоке «Post-v1.0.2» раздела 7 и Appendix А, строка 0026).

| Событие | Коммит / ссылка | Комментарий |
|---|---|---|
| PR #73 — `feat(profile): базовая кастомизация профиля (public ID + профильные поля)` | [PR #73](https://github.com/danny-swan/taskflow-app/pull/73), squash `7db27a6` | Новые колонки `profiles`: `public_user_id` (UNIQUE NOT NULL, `TF-XXXXXX`), `nickname` (≤32), `avatar_variant` (1..8), `bio` (≤160). Функции генерации ID + guard-триггер неизменяемости + DEFAULT `public_user_id`. UI — блок профиля в Настройки→Аккаунт (`Avatar.tsx`, `ProfileBlock.tsx`, `profile.ts`). `profiles` НЕ в sync. +1207/−1, 292 vitest, pgTAP `08_profile_test.sql` `plan(24)` — весь набор зелёный (поправлена pgTAP-регрессия через DEFAULT + assert в `04`) |
| Релиз десктопа v1.0.3 | [тег v1.0.3](https://github.com/danny-swan/taskflow-app/releases/tag/v1.0.3), коммит `a3d11a5`, [CI run 29194889212](https://github.com/danny-swan/taskflow-app/actions/runs/29194889212) | Собраны Windows (NSIS + MSI RU/EN + portable) и macOS (universal dmg), `latest.json` (`version: 1.0.3`) — v1.0.0–1.0.2 юзеры получат обновление через auto-updater. 292/292 vitest, E2E Playwright зелёные. Версия синхронизирована из тега CI-ом |

**Применение на прод:** серверная миграция `0026` (вкл. DEFAULT на `public_user_id`) — ✅ применена через Supabase-коннектор, бэкфилл 4/4 профилей, guard проверен. Клиент уехал на прод-юзеров с v1.0.3.

---

## 2. Карта архитектуры и интеграций — "что с чем связано"

### 2.1. Клиент (TypeScript/React + Tauri)

```
useStore.ts (Zustand, 981 строка) — src/store/useStore.ts
   │  мутации: addTask/updateTask/deleteTaskWithUndo/addTag/createTaskFromTemplate/...
   ▼
db.ts (1293 строки, dual-backend) — src/lib/db.ts
   │  web: sql.js (IndexedDB)     Tauri: tauri-plugin-sql (файл SQLite)
   ▼
migrations.ts (611 строк, PRAGMA user_version, TARGET_VERSION=9)
   │
   ▼
sync/outbox.ts → sync/mappers.ts → sync/push.ts ⇄ sync/pull.ts → sync/index.ts (оркестратор syncNow())
                                                                      │
                                                              sync/realtime.ts (Supabase Realtime)
snapshots.ts — снимки локальной БД, реестр per-user (bound_user_id, registryKey)
```

- **Единственный стор** — `src/store/useStore.ts:204`. Все мутации: пишет в SQLite → `enqueueOutbox` (`src/lib/outbox.ts:16-21,45`, дедуп по `(entity_table, entity_uuid)`) → `refresh()`.
- **Синхронизируемые таблицы (6, с 12.07.2026):** `tasks`, `statuses`, `tags`, `task_templates`, `overdue_events`, `task_hold_periods` (добавлена в PR #72). Порядок push — родители раньше детей: `PUSH_ORDER` = statuses → tags → tasks → templates → overdue_events → task_hold_periods.
- `settings` синхронизируется в облачной схеме (`sync_settings`), но **не пушится/не пуллится клиентом** — сделано осознанно.
- **Push:** батчи ≤50, экспоненциальный backoff 1→2→4→8→16мин, `MAX_ATTEMPTS=5`, `.upsert(onConflict:'id')` (`sync/push.ts:218`), delete — soft.
- **Pull:** курсор per-table в `settings`, LWW по `updated_at`, `DeferRowError` для сирот.
- **Realtime:** канал `sync-realtime-<userId>`, debounce 600мс, слушает 5 sync_* таблиц.

### 2.2. Supabase backend

**Миграции**: 21 применённая на проде (сверено через Supabase 12.07.2026 — `list_migrations`), локальные файлы `supabase/migrations/0001`→`0024` включают переименованные версии (см. Приложение А). Покрывают базовую схему, sync-схему, entitlements/payments, GRANT-хардненинг (3 итерации), payment_methods + pg_cron автопродление, security-хардненинг Wave 2/3/4.

**12 Edge Functions** (`supabase/functions/`) — все ACTIVE на проде. Конкретные версии здесь НЕ фиксируются (меняются при каждом деплое) — актуальные см. в Supabase Dashboard или через `list_edge_functions`. verify_jwt: там, где `true`, требуется валидный юзер-JWT; где `false` — вход по external secret (webhook/cron) или sender.

| Функция | verify_jwt | Назначение | Ключевые строки |
|---|---|---|---|
| `create-payment` | true | Создание платежа (покупка / update-card 1₽) + 54-ФЗ чек (на СМЗ/НПД со стороны ЮKassa больше не выдаётся — см. раздел 7 про ФНС) | `TIERS` прайс-лист `:69-94`; `UPDATE_CARD_SPEC` `:102-106`; режим update-card `:165-170,254-257` |
| `payment-webhook` | false (вход по IP+HMAC) | Проверка вебхуков, entitlements, сохранение карт, refund | `savePaymentMethod` `:822-844`; `handlePaymentCanceled` `:635-691`; `initiateRefund` `:847` |
| `renew-subscription` | false (вход по `CRON_SHARED_SECRET`) | Часовой cron, списание, downgrade после 3 фейлов | Выборка кандидатов `:222-237`; поиск метода `:292`; `MAX_ATTEMPTS=3`, `TIER_AMOUNTS:286` |
| `change-plan` | true | Upgrade monthly→annual | — |
| `cancel-subscription` | true | Отключение автопродления (сохраняет доступ до valid_until) | — |
| `reactivate-subscription` | true | Отмена cancel_at_period_end | `:118-125` |
| `detach-payment-method` | true | Отвязать карту (отключает auto_renew) | `:102-171` |
| `admin-actions` | true (+ admin-check внутри) | Admin-only действия | `:141-266` |
| `activation-notify` | false (вход по `INTERNAL_SHARED_SECRET`) | Письмо-активация | Resend, см. `activation_notified_at` в миграции 0009 |
| `send-user-email` | false (вход по `INTERNAL_SHARED_SECRET`) | Транзакционные письма (шаблоны `:187,256,340`) | Resend |
| `start-trial` | true | 14-дневный trial (`TRIAL_DAYS=14`) | `:99-130` |
| `delete_account` | false (сам валидирует JWT через `verifyJwt`) | Полное удаление аккаунта (auth + все связанные таблицы) | — |

**RLS** включён на всех пользовательских таблицах; платёжные таблицы — authenticated только SELECT своей строки, запись только service_role.

### 2.3. Секреты и переменные

**Клиент (публичное, попадает в бандл):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SENTRY_DSN`, `VITE_TURNSTILE_SITE_KEY`, `VITE_APP_VERSION`, `VITE_ADMIN_EMAILS`, `VITE_PAY_CLOUDTIPS_URL`, `VITE_PAY_TON`, `VITE_PAY_USDT_TRC20/ERC20`, `VITE_PAY_PRICE_MONTHLY/ANNUAL/LIFETIME`.

**Edge Functions (секретные):** `SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY/SECRET_KEYS`; `YOOKASSA_SHOP_ID/SECRET_KEY/API_BASE/RETURN_URL_BASE/SKIP_IP_CHECK`; `RESEND_API_KEY/FROM`, `ADMIN_EMAIL(S)`, `PUBLIC_APP_URL`; `INTERNAL_SHARED_SECRET`, `CRON_SHARED_SECRET`, `WEBHOOK_SECRET`.

**GitHub Actions:** Secrets — `ADMIN_EMAILS`, `SENTRY_AUTH_TOKEN`, `SENTRY_DSN`, `SUPABASE_ANON_KEY`, `SUPABASE_URL`, `TAURI_SIGNING_PRIVATE_KEY(+_PASSWORD)`, `TURNSTILE_SITE_KEY`. Variables — `SENTRY_ORG=swans-org`, `SENTRY_PROJECT=taskflow`.

**Бизнес-контекст:** YooKassa shop `account_id=1402561` — **LIVE** (`test=false`), рекуррент активен для bank_card/yoo_money/sbp/tinkoff_bank, SberPay — pending. Самозанятость (НПД 4%), ИНН 774334883780.

### 2.4. CI/CD
`build.yml` (релиз по тегу v*), `test.yml` (tsc+vitest+Playwright gate), `db-tests.yml` (pgTAP на Postgres 15), `supabase-ping.yml` (keep-alive каждые 3 дня), `generate-updater-keys.yml` (разовый).

---

## 3. Критические скрытые взаимосвязи — что с чем жёстко связано

Это прямой ответ на вопрос "что можно упустить в будущих изменениях, если не помнить о связях". Ниже — каталог мест, где два+ модуля/таблицы/функции скрыто зависят друг от друга, так что правка одной стороны без другой создаёт баг. **Формат: если трогаешь А — не забудь Б.**

> Блок «🔴 Уже сломано» (F1/F2/F3 по `payment_method_id`, `renewal_attempts`, `card_brand`), актуальный на 09.07.2026, перемещён в раздел 10 (исторический архив). F1 закрыт в Wave 1, F3 в Wave 3, F2 закрыт в десктопе v1.0.0 — в качестве активных жёстких зависимостей больше не числятся. Соответствующие находки F1–F3 (с историей фиксов и ссылками) — в разделе 5.

### 🟡 Структурные точки, которые легко сломать при следующей правке

> Это НЕ список открытых багов — это каталог мест, где два+ модуля/таблицы/функции скрыто зависят друг от друга. Сейчас всё работает, но правка одной стороны без другой создаст баг. Убрать эти связи можно только рефакторингом, поэтому каталог ведётся как чек-лист «что перепроверить при следующей правке этой области».

**1. Один синкаемый столбец = 5 мест для правки в каждой из sync-таблиц.** Добавление нового поля в любую из 6 sync-таблиц (с 12.07.2026: +`task_hold_periods`) требует согласованной правки: миграция → GRANT/RLS → push-mapper (`sync/mappers.ts`) → pull-mapper → TS-интерфейс. Пропуск одного — поле молча не синкается или ломает `upsert(onConflict:'id')` (`sync/push.ts:218`). Именно этот класс ошибки уже дважды сработал (statuses/tags в прошлой сессии, и card_brand/renewal_attempts выше). При добавлении `task_hold_periods` в PR #72 все 5 мест пройдены явно (см. чек-лист в описании PR).

**2. pgTAP-тест на GRANT/RLS хардкодит список таблиц** (частично смягчено в Wave 3, но не устранено). `supabase/tests/01_grants_test.sql` — `plan(83)` на 12.07.2026 (был 74 до PR #72), явно перечисляет таблицы. **Новая таблица без ручного дополнения этого теста пройдёт CI по целевым проверкам, даже если её собственные права настроены неверно**.

**Смягчено:** миграция `0021_wave3_revoke_default_privileges_footgun` добавила **future-table probe** — генерическую pgTAP-проверку, что у любой новой таблицы в `public` НЕТ автоматических GRANT для `authenticated`/`anon`, которые были источником инцидентов dev.6.4.2/6.4.3/6.4.4. Теперь «footgun default privileges» ловится автоматически.

**Остаётся:** сам статический `plan(...)` не обновляется автоматически — если новая таблица требует специфичные права (не только отсутствие default GRANT), тест не поймает регрессию в этих правах без ручного дополнения. Фактический счётчик `plan` растёт вручную вместе с новыми синк-таблицами: 74 (до Wave) → 83 (с PR #72 и `task_hold_periods`).

**3. Определение "кто админ" размазано по 4 местам:** `0017_admin_rpc.sql:43` (инлайн в RPC) и `:72-78` (`is_admin_user()`, повторяет ту же логику) + фронт `entitlements.ts:162-164` (`ADMIN_EMAILS` OR seed/lifetime) + `admin-actions/index.ts:141-266`. Изменение критерия в одном месте без остальных → фронт покажет `/admin`, а серверная проверка откажет (или наоборот, что хуже). Отдельно был race на входе в `/admin` с первого клика (`useEntitlement` стартовал с `loading=false`) — закрыт PR #71 (12.07.2026), guard теперь видит синхронный `loading`/`status`. Архитектурно размазанность определения админа по 4 местам — не устранена.

**4. Admin-гейт на фронте — это только UX, не защита.** `src/App.tsx:284` + `AdminPage.tsx` — клиентский гейт. Вся реальная защита — в `admin-actions` и RLS `0017`. Если серверная проверка когда-нибудь ослабнет, скрытие роута на фронте не защитит.

**5. `next_renewal_at` ↔ частичный индекс ↔ выборка cron.** Индекс `idx_entitlements_next_renewal` (0014:136-138, условие `auto_renew=true AND cancel_at_period_end=false`) должен совпадать с WHERE в `renew-subscription:222-237`. `reactivate-subscription` и `detach-payment-method` меняют именно эти флаги — если один из них не выставит их согласованно, строка либо выпадет из выборки (не продлится), либо попадёт туда без валидного метода оплаты.

**6. Idempotence-Key ЮKassa зависит от счётчика попыток.** `renew-subscription:316-318` строит ключ детерминированно из `(userId, valid_until, attemptNo)`. Если счётчик рассинхронен — риск коллизии ключа (повторный запрос вернёт старый результат) или, наоборот, двойного списания.

**7. Snapshot restore не ре-энкьюит outbox.** `restoreSnapshot` → `db.applyBackup('replace')` (`snapshots.ts:405`, `db.ts:1074`) заменяет локальные строки, но **не** ставит их в `sync_outbox` и не бампает `version`/`client_id`. После восстановления снимка данные могут не уехать в облако до следующей ручной правки.

**8. Изоляция аккаунтов держится на паре `bound_user_id` ↔ `registryKey`.** `setBoundUserId`/`checkAccountBinding` (`snapshots.ts:192,240`) должны быть согласованы с `registryKey(userId)` (`:44-46`). Рассинхрон = утечка снимков одного аккаунта в другой на общем устройстве. Явная миграция со старого shared-ключа в коде — маркер, что это уже когда-то путалось.

**9. Прайс-лист тарифов продублирован в 3+ местах.** `TIERS` в `create-payment:69-94`, `TIER_AMOUNTS` в `renew-subscription:286`, плюс фронт `/checkout` и `valid_until`-логика в webhook. Сам код содержит комментарий-напоминание "синхронизировать с другими местами" (`create-payment:64-68`) — это авторское признание, что цену легко забыть поменять везде сразу.

**Общий вывод:** структурно самый рискованный паттерн в проекте — "одна сущность, несколько копий состояния в разных сервисах/слоях" (счётчики, id, цены, права). Каждый раз, когда добавляется новое поле/таблица/цена/роль, стоит явно пройтись по пунктам 1–9 этого списка и проверить, не появилась ли ещё одна скрытая копия.

---

## 4. Регрессионная проверка: старая логика vs новая (nothing broken)

| Проверка | Результат |
|---|---|
| Полнота sync statuses/tags | ✅ push/pull симметричны, boolean 0/1↔bool конвертируется верно |
| Bug #1 (dev.6.10.0): seed-строки без uuid не попадали в облако | ✅ Фикс актуален |
| Bug #2: `AccountSwitchGate` стирал локальную БД вслепую | ✅ Фикс актуален — `cloudHasData()` гейт |
| Bug #3: общий реестр снимков между аккаунтами | ✅ Фикс актуален — изолирован по `bound_user_id` |
| Bug #4: задачи с неизвестным status_id падали в первый статус | ✅ Улучшено в dev.6.10.3 — `DeferRowError` вместо fallback |
| `deleteTaskWithUndo` (10с) × pull-синхронизация | ✅ Гонки нет |

**Вывод:** признаков регрессий ранее исправленных багов в HEAD `develop` не обнаружено.

---

## 5. Отдельный блок находок — баги, уязвимости, архитектурные риски

### 🔴 Активные баги (уже сломано, чинить первым)

| # | Находка | Где | Критичность | Что делать |
|---|---|---|---|---|
| **F1** | `payment_method_id`: webhook пишет внутренний uuid, `renew-subscription` ищет/шлёт его как external_id ЮKassa — автопродление не работает ни у кого | `payment-webhook/index.ts:391,485,572`, `renew-subscription/index.ts:292,324` | **HIGH** | В `renew-subscription` сначала резолвить `payment_methods.external_id` по внутреннему uuid, слать в ЮKassa именно `external_id`. Добавить тест "что webhook записал ↔ что renew читает". Проверить `renewal_attempts_log` на всплеск `payment_method_inactive` — возможны уже пострадавшие |
| **F2** | Счётчик попыток продления: бэкенд пишет `renewal_attempts_count`, фронт читает старую `renewal_attempts` → UI показывает неверные данные | `entitlements.ts:364`, `renew-subscription/index.ts:231` | MEDIUM | Перевести фронт-SELECT на `renewal_attempts_count`, добавить триггер синхронизации колонок или удалить старую |
| **F3** ✅ | Бренд карты в UI пустой — webhook пишет `card_type`/`card_first6`, фронт читает `card_brand` | `payment-webhook/index.ts:823-828`, `Settings.tsx` (было `card_brand`) | LOW-MEDIUM | **✅ ИСПРАВЛЕНО (Wave 3, PR #65).** `Settings.tsx` переведён на чтение `card_type` (канонная колонка бренда с миграции 0016). 🟡 фронт — на прод уедет отдельным релизом десктопа. `entitlements.ts` уже читал `card_type` ранее |
| **F4** | Письмо о неудачном платеже не шлётся, если отказ пришёл как `payment.canceled` прямо в webhook (не через cron) | `payment-webhook/index.ts:635-691` (`handlePaymentCanceled`) | MEDIUM | Добавить вызов `notifyRenewalFailed`/аналог в этой ветке |
| **B1** ✅ | (баг 12.07.2026) Кнопка «Вернуть в работу»: после выбора статуса в диалоге таск не менял статус и открывался попап детального редактирования — клики внутри `ConfirmDialog` (portal) всплывали в `onClick` карточки через React-дерево | `src/components/TaskCard.tsx` (guard `onCardClick`) | HIGH (UX-блокер основного сценария) | **✅ ИСПРАВЛЕНО (PR [#70](https://github.com/danny-swan/taskflow-app/pull/70), squash `3310aa4`, 12.07.2026).** В guard `onCardClick` добавлен `reopenOpen` рядом с `confirmDelete`. Покрыто 3 vitest-кейсами в `TaskCard.test.tsx`. ✅ Уехал на прод с [v1.0.2](https://github.com/danny-swan/taskflow-app/releases/tag/v1.0.2) 12.07.2026 |
| **B2** ✅ | (баг 12.07.2026) Первый клик по «Администрирование» редиректил на «Задачи» (второй клик работал) — race в `useEntitlement`: `loading` инициализировался `useState(!!userId)`, `setLoading(true)` жил в `useEffect`, при `userId: null→user-1` один коммит guard `AdminPage` видел `entLoading=false` → `navigate('/')` | `src/lib/entitlements.ts` (`useEntitlement`) | MEDIUM (UX) | **✅ ИСПРАВЛЕНО (PR [#71](https://github.com/danny-swan/taskflow-app/pull/71), squash `91d7aa1`, 12.07.2026).** Синхронный расчёт `loading`/`status` на рендере — через сравнение текущего `userId` с `resolvedFor`. Серверная защита не тронута. Регресс-тест `useEntitlement.race.test.tsx` (переход `null→user-1` + админ/не-админ/ошибка). ✅ Уехал на прод с [v1.0.2](https://github.com/danny-swan/taskflow-app/releases/tag/v1.0.2) 12.07.2026 |
| **F6** ✅🟡 | (фича 12.07.2026) Столбец «Холд» в статистике — раньше не отражал реальную длительность пребывания в «Приостановлено». Теперь — сумма всех холд-интервалов в днях (разница дат, открытый интервал — до `now()`, несколько периодов плюсуются) | новая таблица `task_hold_periods` + `src/lib/holdPeriods.ts` + хуки в `addTask`/`updateTask`/`softDeleteTask` + `Stats.tsx:158` | MEDIUM (точность статистики) | **✅ СМЁРЖЕНО (PR [#72](https://github.com/danny-swan/taskflow-app/pull/72), squash `2602371`, 12.07.2026) + ✅ МИГРАЦИЯ `0025_task_hold_periods.sql` ПРИМЕНЕНА НА ПРОД 12.07.2026 (version `20260712112352`) + ✅ ВЫПУЩЕНО В [v1.0.2](https://github.com/danny-swan/taskflow-app/releases/tag/v1.0.2) 12.07.2026.** Клиент — единственный автор интервалов (как `overdue_events`), серверного триггера НЕТ (архитектурное решение сабагента, одобрено пользователем 12.07.2026 — «big no new bugs»). Тесты: `holdPeriods.test.ts` (19 кейсов, вкл. `hold→work→hold`=2 интервала, soft-delete, открытый интервал), pgTAP `07_task_hold_periods_test.sql` (структура/триггеры/realtime/cascade), pgTAP `01`+`02` расширены. **Применена через Supabase-коннектор 12.07.2026**, бэкфилл отработал (0 висящих холдов в момент применения) |
| **F5** ✅ | Дубль письма `renewal_failed` + двойной инкремент `renewal_attempts_count`: при синхронном `canceled` от ЮKassa cron шлёт письмо/инкремент, и webhook по тому же платежу делает то же ещё раз (побочка фикса F4, дедупликации между путями нет) | `renew-subscription/index.ts:405-423` (синхр. `canceled`, письмо стр.412) вс. `payment-webhook/index.ts:704-726` | MEDIUM | **✅ ИСПРАВЛЕНО (Wave 2, ветка `wave2-fixes`).** Принцип "единственный владелец": из синхр. ветки `canceled` cron убраны `logAttempt`+`incrementAttempts`+`notifyRenewalFailed` — для СОЗДАННЫХ платежей письмо/счётчик/лог делает только webhook `payment.canceled`. Cron лишь выставляет `last_renewal_attempt_at` (чтобы не дёрнуть юзера повторно). Письмо cron сохранено ТОЛЬКО в ветке HTTP-ошибки API (платёж не создан, webhook не придёт). Покрыто unit-тестом `renew-subscription/test.ts`. ✅ ПРИМЕНЕНО НА ПРОД 2026-07-10 — edge `renew-subscription` **v9** (id `27d6ffbb-616d-4d76-bece-2ab6efb4aa90`, ACTIVE, `verify_jwt=false`); на проде синхронная `canceled`-ветка cron больше не шлёт письмо/не инкрементит счётчик/не пишет лог, только обновляет `last_renewal_attempt_at`. См. `dup_email_analysis.md` |

### 🟡 Уязвимости безопасности

| # | Находка | Где | Критичность | Что делать |
|---|---|---|---|---|
| N4 ✅ | View `admin_users_summary` без `security_invoker` (`reloptions=null` — подтверждено 10.07 на живой схеме). **Уточнение:** гранты anon/authenticated на view = только `TRUNCATE,REFERENCES,TRIGGER`, **`SELECT` НЕТ** → прямого чтения через PostgREST уже нет, фактическая утечка не воспроизводится — реальная критичность LOW | живая схема (исходно `migrations/0001_init.sql`) | LOW (было MEDIUM) | **✅ ИСПРАВЛЕНО (миграция `0020_wave2_security_hardening.sql`).** `ALTER VIEW ... SET (security_invoker = on)` + `REVOKE ALL ... FROM anon, authenticated`. Тело view не менялось. Покрыто `tests/04_wave2_test.sql`. ✅ ПРИМЕНЕНО НА ПРОД 2026-07-10 (миграция `0020`; проверено на живой схеме: `admin_users_summary` имеет `reloptions security_invoker=on`, SELECT для anon/authenticated отозван) |
| N5 ✅ | View `sync_status_summary` — аналогично (`reloptions=null`, гранты без `SELECT`, подтверждено 10.07) | живая схема (исходно `migrations/0002_sync_schema.sql`) | LOW (было MEDIUM) | **✅ ИСПРАВЛЕНО (миграция `0020`).** `security_invoker=on` + `REVOKE ALL FROM anon, authenticated`. Покрыто `tests/04_wave2_test.sql`. ✅ ПРИМЕНЕНО НА ПРОД 2026-07-10 (проверено на живой схеме: `sync_status_summary` — `security_invoker=on`, SELECT для authenticated отозван) |
| N8 ✅ | Webhook доверяет `X-Forwarded-For` в IP-whitelist (подделываемый заголовок) + вебхук диспетчеризовал по `event` из тела, не сверяя со статусом реального платежа | `payment-webhook/index.ts` | MEDIUM | **✅ ИСПРАВЛЕНО (Wave 3, PR #65, `payment-webhook` v24 на проде 2026-07-10).** `_shared/yookassa-verify.ts::assessVerifiedPayment` строго сверяет `event` со `status` из dual-verify (`GET /v3/payments/{id}`) — подделанное `payment.succeeded` по pending/canceled больше не активирует подписку. Отдельно: убедиться, что `YOOKASSA_SKIP_IP_CHECK` выключен в проде |
| N6 ✅ | `ALTER DEFAULT PRIVILEGES` авто-выдаёт SELECT на будущие таблицы — тот же класс footgun, что вызвал 3 прошлых GRANT-инцидента | миграции | LOW-MEDIUM | **✅ ИСПРАВЛЕНО (Wave 3, миграция `0021`, ПРИМЕНЕНА НА ПРОД 2026-07-10).** `0021` откатывает `ALTER DEFAULT PRIVILEGES` из 0010/0011 — будущие таблицы больше не получают a/r/w автоматически. pgTAP `01_grants_test.sql` расширен future-table probe. (Остаточные `Dxtm` — платформенные дефолты Supabase, не наши; см. «Wave 3 — итог») |
| N9 ✅ | Нет сверки суммы платежа с прайсом в webhook | `payment-webhook` | LOW | **✅ ИСПРАВЛЕНО (Wave 3, PR #65, `payment-webhook` v24 на проде 2026-07-10).** `_shared/pricing.ts::verifyPaymentAmount` сверяет `amount.value`+currency против серверного `TIER_PRICING` (единый источник истины) |
| N10 ✅ | Идемпотентность зависит от `attempt_no` — при timeout возможен повтор | `renew-subscription` | LOW | **✅ ИСПРАВЛЕНО (Wave 3, PR #65, см. ADR 0003, `renew-subscription` v10 на проде 2026-07-10).** `_shared/renewal-idempotency.ts::selectActiveRenewalPayment` — сверка `GET /v3/payments` до создания платежа: активный (pending/waiting_for_capture/succeeded) → второй не создаём |
| N13 ✅ | Нет rate limiting на публичных эндпоинтах | `create-payment`, `start-trial`, webhook | LOW | **✅ ИСПРАВЛЕНО (Wave 4, PR #68, ПРИМЕНЕНО НА ПРОД 2026-07-11).** Table-based limiter в Postgres: миграция `0024` (`rate_limits` + RPC `check_rate_limit`, fail-open by design, cron-cleanup `*/5`), модуль `_shared/rate-limit.ts`. Применён в 3 edge-функциях: `create-payment` **v18** (user 10/60s + IP 30/60s), `start-trial` **v10** (user 3/3600s + IP 5/3600s), `payment-webhook` **v26** (IP 60/60s). См. ADR 0004 |
| N1 | Утёкшие anon JWT в старом коммите `a0a2d70` (удалены в `d2d2833`, но ключ формально валиден) | git-история | LOW | Ротация anon-ключа в Supabase |
| N2 | `.gitignore` не покрывает `.env.production/.development/.test` | — | LOW | Добавить `.env.*`, исключить `!.env.example` |
| N3 | `VITE_ADMIN_EMAILS` в клиентском бандле (UI-only) | — | LOW | Задокументировать как UI-only |
| N11 ✅ | CORS `*` на state-changing функциях | trial/cancel/detach | LOW | **✅ ИСПРАВЛЕНО (Wave 4, PR #67, ПРИМЕНЕНО НА ПРОД 2026-07-11).** `Allow-Origin` ограничен доменом приложения; функции с CORS-фиксом передеплоены на прод |
| N12 ✅ | `profiles` UPDATE-политика без `WITH CHECK` | RLS | LOW | **✅ ИСПРАВЛЕНО (миграция `0020`).** Политика `profiles_update_own` пересоздана (DROP+CREATE) с `WITH CHECK ((select auth.uid()) = id)`; `USING` сохранён. `profiles_select_own` не тронута. Покрыто `tests/04_wave2_test.sql` (в т.ч. функциональная проверка: смена `id` на чужой блокируется, SQLSTATE 42501). ✅ ПРИМЕНЕНО НА ПРОД 2026-07-10 (проверено на живой схеме: `profiles_update_own` имеет `WITH CHECK (auth.uid()=id)`, `USING` сохранён) |
| N14 ✅ | `verify_jwt` не зафиксирован в конфиге для всех функций | `config.toml` | LOW | **✅ ИСПРАВЛЕНО (Wave 4, PR #67).** `verify_jwt` явно прописан для всех функций в `supabase/config.toml` (webhook/renew/send-email/activation-notify → `false`; клиентские → `true`). 🟡 **Known-limitation:** `delete_account` на проде задеплоена с `verify_jwt=false` (исторический артефакт), хотя код сам валидирует JWT (`userClient.auth.getUser()` → 401) и `config.toml` фиксирует intent `true`. Значение вступит в силу при следующем деплое `delete_account` (не входил в PR-A). Не расхождение по безопасности — код проверяет JWT независимо от флага |
| **N15** ✅ | **(новое, 10.07)** RPC `get_users_emails(user_ids uuid[])` — `SECURITY DEFINER`, `EXECUTE` доступен `authenticated` (подтверждено 10.07 на живой схеме: `security_definer=true`, `can_execute=authenticated`, `search_path=public,auth` — зафиксирован, это хорошо). Любой залогиненный юзер может дёргать через `/rest/v1/rpc/get_users_emails` | Postgres function `public.get_users_emails` | **MEDIUM-HIGH** | **✅ ИСПРАВЛЕНО (миграция `0020`, см. ADR 0002).** Проверены ВСЕ вызовы: единственный — `src/pages/AdminPage.tsx:189` из КЛИЕНТА под authenticated-JWT админа (service_role на клиенте нет). Поэтому глобальный REVOKE сломал бы админку → выбран вариант "внутренний admin-гейт": EXECUTE для `authenticated` сохранён, но тело функции требует `public.is_admin_user()` (единый источник истины: `source='seed' AND plan='lifetime'`), иначе `EXCEPTION 'Forbidden: admin only'`. `search_path=public,auth` не тронут. Покрыто `tests/04_wave2_test.sql` (обычный юзер → Forbidden, admin → email). ✅ ПРИМЕНЕНО НА ПРОД 2026-07-10 (проверено на живой схеме: `get_users_emails(uuid[])` — SECURITY DEFINER с admin-гейтом `is_admin_user`, EXECUTE только authenticated, для anon отозван) |
| N16 🟡 | `auth_leaked_password_protection` выключена (проверка паролей по HaveIBeenPwned) | Auth settings | LOW | **🟡 PENDING — ТРЕБУЕТ РУЧНОГО ДЕЙСТВИЯ (Wave 4, PR #67).** Код/конфиг готовы, ops-гайд `docs/ops/supabase-auth-hardening.md`. Финальный тумблер включается ВРУЧНУЮ в Supabase Dashboard (Auth → Providers → Email → Leaked password protection). На 2026-07-11 ещё не включён — ждёт ручного действия пользователя в дашборде |
| N17 🟡 | `pg_net` установлен в схему `public`, а не в отдельную | extensions | LOW | **🟡 ЧАСТИЧНО (Wave 4, PR #67, ПРИМЕНЕНО НА ПРОД 2026-07-11).** Миграция `0023` идемпотентно пытается `ALTER EXTENSION pg_net SET SCHEMA extensions` (обёрнута в EXCEPTION на случай non-relocatable версии). На проде расширение **осталось в `public`** — перенос не состоялся (known-limitation). Реального риска нет (API pg_net живёт в схеме `net`, cron-джобы её и зовут), но отклонение от «идеала» сохраняется |
| N18 ✅ | `search_path` не зафиксирован у `tg_payment_methods_touch_updated_at` | triggers | LOW | **✅ ИСПРАВЛЕНО (Wave 4, PR #67, ПРИМЕНЕНО НА ПРОД 2026-07-11).** Миграция `0022` фиксирует `SET search_path` у public-функций без явного search_path (advisor `function_search_path_mutable`) |

### ✅ Уже исправлено ранее — регрессий не обнаружено
GRANT-инцидент 0007→0010-0013; pgTAP-тесты на гранты (dev.6.5.0); webhook на raw-fetch AdminClient (`3f63dc8`); секретов service_role/YooKassa в истории git не обнаружено.

**Рекомендуемый порядок работ (согласован с пользователем 10.07, работа начата):**
1. **Wave 1 — ✅ ЗАВЕРШЁН (10.07.2026):** F1 + F2 + F3 + F4 (один заход, один и тот же файловый контур: `payment-webhook`, `renew-subscription`, `entitlements.ts`)
2. **Wave 2 — ✅ ЗАВЕРШЁН И ПРИМЕНЁН НА ПРОД (10.07.2026, ветка `wave2-fixes` → PR #63, merge `058bfd6`):** **F5** (дубль `renewal_failed`, edge `renew-subscription`) + N4 + N5 (views, утечка PII) + N12 (RLS без WITH CHECK) + **N15** (RPC-утечка email — приоритет как у N4/N5, возможно выше). N4/N5/N12/N15 — миграция Supabase `0020`; F5 — деплой edge-функции (два разных вида применения на прод). ✅ ПРИМЕНЕНО НА ПРОД 2026-07-10: миграция `0020_wave2_security_hardening` применена, edge `renew-subscription` v9 задеплоена — см. "Wave 2 — итог" ниже
3. **Wave 3 — ✅ ЗАВЕРШЁН НА ПРОДЕ (10.07.2026, ветка `wave-3-hardening` → PR #65, merge `49ec66d`; docs-follow-up `wave-3-docs-and-deploy` → PR #66):** N6 (default privileges) + N9 (сверка суммы) + N8 (dual-verify assessment) + N10 (идемпотентность) + F3 (Settings.tsx card_brand→card_type) + CI-пробел (Deno edge-job). N6 — миграция `0021` применена на прод. N9/N8/N10 — edge-функции `payment-webhook` **v24** и `renew-subscription` **v10** задеплоены на прод (`verify_jwt=false`), подтверждено через `list_edge_functions`. F3 — фронт, требует релиза десктопа.
4. **Wave 4 — ✅ ЗАВЕРШЁН НА ПРОДЕ (11.07.2026, два пакета):** PR-A `wave-4a-hardening` → PR [#67](https://github.com/danny-swan/taskflow-app/pull/67) (merge `082a3ac`) — N11 (CORS) + N14 (verify_jwt) + N18 (миграция `0022`) + N17 (миграция `0023`, частично) + N16 (ops-гайд, требует ручного тумблера). PR-B `wave-4b-rate-limit` → PR [#68](https://github.com/danny-swan/taskflow-app/pull/68) (merge `ace0c07`) — N13 (rate limiting, миграция `0024`, оставлен последним — наибольший объём). Итог см. ниже «Wave 4 — итог»

_N1/N2/N3 в текущий заход не включены по явному запросу пользователя (ротация ключа/`.gitignore`/документирование — вне очереди F1-F4+N4-N14, можно сделать отдельно, эффорт минимальный)._

### Wave 1 — итог деплоя (10.07.2026)

Код: ветка `wave1-fixes` → PR [#61](https://github.com/danny-swan/taskflow-app/pull/61) → merge commit `bc55c09` в `develop` (исходный фикс-коммит `408cf50`).

| Находка | Статус | Где живёт фикс |
|---|---|---|
| **F1** (HIGH, автопродление) | ✅ **На проде.** `renew-subscription` v8 (id `27d6ffbb-616d-4d76-bece-2ab6efb4aa90`), контент проверен через `get_edge_function` | edge function `renew-subscription` |
| **F4** (письмо `renewal_failed` из webhook-пути) | ✅ **На проде.** `payment-webhook` v23 (id `73f8fc4c-de58-401e-b588-62d98c79ea34`), содержит `MAX_RENEWAL_ATTEMPTS`/`renewal_failed` в `handlePaymentCanceled`, контент проверен через `get_edge_function` | edge function `payment-webhook` |
| **F2** (`renewal_attempts` → `renewal_attempts_count` во фронте) | 🟡 **Смержено в `develop`, НЕ на проде.** Это фронтовый файл (`entitlements.ts`), не edge function — нужен отдельный релиз приложения (десктоп/веб), путь деплоя фронта в этой сессии не выяснялся | `src/lib/entitlements.ts` |
| **F3** (`card_brand` → `card_first6` во фронте) | 🟡 **Смержено в `develop`, НЕ на проде.** Тот же файл и та же причина, что у F2 | `src/lib/entitlements.ts` |
| Bonus: `change-plan/index.ts:118` dead-код `card_brand`→`card_type` | ⏸ **Не деплоился.** Был в том же коммите, но пользователь одобрил деплой только `payment-webhook` и `renew-subscription` — `change-plan` осознанно вне текущего скоупа | edge function `change-plan` (не тронута) |

**⚠️ Инцидент во время деплоя (для прозрачности — "делаем один раз как надо"):** при деплое `renew-subscription` первая попытка (v7) по ошибке ушла на прод с placeholder-контентом вместо реального фикса — короткое окно, когда прод-функция была неработоспособна. Ошибка была замечена и исправлена в течение той же сессии повторным деплоем (v8) с верным содержимым, подтверждённым через `get_edge_function`. Активных вызовов `renew-subscription` (cron автопродления) в это окно не проверялось намеренно — при необходимости можно поднять логи/`payment_events`/`renewal_attempts_log` за это время, чтобы подтвердить отсутствие сбоев у реальных пользователей.

**Риски, требующие отдельного решения (не исправляются автоматически фиксом F1):**

> **Контекст (подтверждено пользователем 10.07):** приложение десктопное, **живых пользователей ещё не было** (только тестовые). Поэтому риски прод-данных (ниже №‖1 и №2) практически неактуальны — пострадавших нет, чинить/чистить прод-данные не нужно.

1. ~~Осиротевшие `user_entitlements` (`payment_method_id IS NULL AND plan='pro' AND auto_renew=true`)~~ — **неактуально**, живых пользователей не было.
2. ~~Ошибочно даунгрейженные в `free` из-за F1~~ — **неактуально** по той же причине.
3. ✅ **Подтверждено и оформлено как F5** (см. таблицу активных багов выше и `dup_email_analysis.md`): дубль `renewal_failed` при синхронном `canceled` от ЮKassa — реальный узкий сценарий + бонусом двойной инкремент счётчика. Включено в Wave 2 (по решению пользователя 10.07).

### Wave 2 — итог (10.07.2026)

Код: ветка `wave2-fixes` → PR [#63](https://github.com/danny-swan/taskflow-app/pull/63) → merge commit `058bfd6` в `develop`. **✅ ПРИМЕНЕНО НА ПРОД 2026-07-10** — миграция `0020_wave2_security_hardening` применена на прод Supabase (проект `sejpmzrmtgcvevukggkx`), edge `renew-subscription` задеплоена (v9). Всё проверено на живой схеме ПОСЛЕ применения.

| Находка | Статус | Где живёт фикс | Применение на прод |
|---|---|---|---|
| **F5** (дубль письма/счётчика/лога) | ✅ На проде | `supabase/functions/renew-subscription/index.ts` (синхр. `canceled`-ветка) + unit-тест `test.ts` | ✅ 2026-07-10 — edge `renew-subscription` **v9** (id `27d6ffbb-616d-4d76-bece-2ab6efb4aa90`, ACTIVE, `verify_jwt=false`) |
| **N4** (`admin_users_summary` security_invoker) | ✅ На проде | миграция `0020_wave2_security_hardening.sql` | ✅ 2026-07-10 (миграция `0020`) — на живой схеме `security_invoker=on`, SELECT для anon/authenticated отозван |
| **N5** (`sync_status_summary` security_invoker) | ✅ На проде | миграция `0020` | ✅ 2026-07-10 (миграция `0020`) — на живой схеме `security_invoker=on`, SELECT для authenticated отозван |
| **N12** (`profiles_update_own` WITH CHECK) | ✅ На проде | миграция `0020` | ✅ 2026-07-10 (миграция `0020`) — на живой схеме `WITH CHECK (auth.uid()=id)`, `USING` сохранён |
| **N15** (RPC `get_users_emails` admin-гейт) | ✅ На проде | миграция `0020` (см. ADR 0002) | ✅ 2026-07-10 (миграция `0020`) — на живой схеме SECURITY DEFINER + admin-гейт `is_admin_user`, EXECUTE только authenticated, anon отозван |
| pgTAP-покрытие Wave 2 | ✅ | `supabase/tests/04_wave2_test.sql` (plan 15, все проходят) + добавлен в `.github/workflows/db-tests.yml` | CI |

**Проверено на живой схеме после применения (2026-07-10):**
1. Миграция `0020` (идемпотентная) применена на прод; порядок соблюдён: сначала миграция (N4/N5/N12/N15), затем деплой `renew-subscription` v9 (F5). Все находки подтверждены прямым запросом к живой схеме — см. столбец «Применение на прод» выше.
2. **Пре-существующий, вне скоупа Wave 2:** downgrade при исчерпании попыток делается только в cron через `incrementAttempts`. Для платежей, отменённых webhook'ом (`payment.canceled`), после F4/F5 downgrade инициирует webhook (`handlePaymentCanceled`), а не cron. Убедиться, что webhook действительно доводит счётчик до `MAX_RENEWAL_ATTEMPTS` и делает downgrade — иначе юзер может застрять в `pro` без списаний. Это НЕ регрессия F5 (F5 лишь убрал дубль), но стоит перепроверить сквозной сценарий отдельно.
3. Docs-файлы (`docs/audit/roadmap.md`, `docs/adr/*`, `docs/architecture/erd.md`) исходно жили только на ветке `docs/setup-adr-audit`, а не на `develop`; через PR #63 они принесены в `develop` вместе с фиксами Wave 2, статус консистентен.

### Wave 3 — итог (харденинг платежей/инфры, 10.07.2026)

Код: ветка `wave-3-hardening` → PR [#65](https://github.com/danny-swan/taskflow-app/pull/65) → merge commit `49ec66d0321c7d0405748c73692b52e86dbf2b15` в `develop`. Миграция `0021_revoke_default_privileges_footgun` применена на прод Supabase (проект `sejpmzrmtgcvevukggkx`, `wave3_revoke_default_privileges_footgun` в `list_migrations`).

✅ **Wave 3 полностью на проде (10.07.2026).** Миграция `0021` применена, edge-функции `payment-webhook` **v24** и `renew-subscription` **v10** задеплоены (`verify_jwt=false`, файлы включают `_shared/pricing.ts`, `_shared/yookassa-verify.ts`, `_shared/renewal-idempotency.ts`). Подтверждено через `list_edge_functions`. Деплой выполнен из `wave-3-docs-and-deploy` (PR #66) сессионным путём через supabase-коннектор.

| Находка | Статус | Где живёт фикс | Применение на прод |
|---|---|---|---|
| **N6** (default privileges footgun) | ✅ На проде | миграция `0021_revoke_default_privileges_footgun.sql` + pgTAP `01_grants_test.sql` (future-table probe) | ✅ 2026-07-10 — миграция `0021` применена (`wave3_revoke_default_privileges_footgun`) |
| **N9** (сверка суммы платежа с прайсом) | ✅ На проде | `_shared/pricing.ts` (`TIER_PRICING`/`verifyPaymentAmount`/`isRecurringTier`), импортится в `payment-webhook` + `renew-subscription` | ✅ 2026-07-10 — `payment-webhook` v24 + `renew-subscription` v10 |
| **N8** (dual-verify assessment gap) | ✅ На проде | `_shared/yookassa-verify.ts::assessVerifiedPayment` (сверка `event` уведомления со `status` из dual-verify) | ✅ 2026-07-10 — `payment-webhook` v24 |
| **N10** (renewal idempotency-guard) | ✅ На проде | `_shared/renewal-idempotency.ts::selectActiveRenewalPayment` (сверка GET /v3/payments до создания платежа); см. ADR 0003 | ✅ 2026-07-10 — `renew-subscription` v10 |
| **F3** (Settings.tsx `card_brand` → `card_type`) | 🟡 В `develop`, требует релиза десктопа | `src/pages/Settings.tsx` (читает `card_type`, канонная колонка бренда с миграции 0016) | 🟡 фронтовый файл — уедет на прод только с отдельным релизом приложения (как F2 в Wave 1) |
| CI-пробел (test.yml + Deno edge-job) | ✅ | `.github/workflows/test.yml` (триггеры на `develop`; job «Edge Functions (Deno)» — `deno check` + `deno test`, `change-plan/test.ts` исключён) | CI |

**Что вошло:**
- **N6** — миграция `0021` откатывает `ALTER DEFAULT PRIVILEGES` из 0010/0011; будущие таблицы больше не получают SELECT/INSERT/UPDATE автоматически. Это устраняет тот же класс footgun, что вызвал 3 прошлых GRANT-инцидента (dev.6.4.2/6.4.3/6.4.4). pgTAP `01_grants_test.sql` расширен future-table probe.
- **N9** — `_shared/pricing.ts` как единый серверный источник истины по ценам (299/2990/4990 ₽, 1 ₽ верификация). `payment-webhook` и `renew-subscription` импортируют оттуда — устранено дублирование money-critical чисел (см. раздел 3, п.12). `isRecurringTier` — типобезопасная проверка авто-продлеваемости.
- **N8** — `assessVerifiedPayment` строго сверяет `event` уведомления с реальным `status` платежа из dual-verify (`GET /v3/payments/{id}`). Подделанное `payment.succeeded` по pending/canceled платежу больше не активирует подписку.
- **N10** — до создания нового платежа автопродления `renew-subscription` сверяется с ЮKassa (`GET /v3/payments`) и, если активный платёж (pending/waiting_for_capture/succeeded) уже есть, второй не создаёт — итог доводит webhook. Страховочный слой поверх детерминированного Idempotence-Key. См. ADR 0003.
- **F3** — фронт-регрессия с миграции 0016: `Settings.tsx` читал никогда не заполнявшуюся `card_brand`. Теперь читает `card_type` — ту колонку, что реально пишет `payment-webhook`.
- **CI-пробел** — `test.yml` теперь триггерится и на PR/push в `develop` (не только `main`); добавлен job «Edge Functions (Deno)» (`deno check` + `deno test` по всем edge-функциям кроме `change-plan/test.ts`, который бьёт в реальный `api.yookassa.ru`).

**Деплой edge-функций (выполнено 2026-07-10):**
- `payment-webhook` v23 → **v24**, `verify_jwt=false`, файлы: `index.ts` + `../_shared/pricing.ts` + `../_shared/yookassa-verify.ts`. Подтверждено через `list_edge_functions` (id `73f8fc4c-de58-401e-b588-62d98c79ea34`, status ACTIVE).
- `renew-subscription` v9 → **v10**, `verify_jwt=false`, файлы: `index.ts` + `../_shared/pricing.ts` + `../_shared/renewal-idempotency.ts`. Подтверждено через `list_edge_functions` (id `27d6ffbb-616d-4d76-bece-2ab6efb4aa90`, status ACTIVE).

**Замечание по остаточным default ACL (не находка Wave 3):** после `0021` в `pg_default_acl` для `postgres.public.TABLES` остаются `Dxtm` (DELETE/REFERENCES/TRIGGER/MAINTAIN) для anon/authenticated/service_role — это платформенные дефолты Supabase, НЕ добавлялись нашими миграциями. Наши 0010/0011 добавляли `a/r/w` (INSERT/SELECT/UPDATE) — они отозваны. Если понадобится — вынести в отдельную находку.

### Wave 4 — итог (мелкий харденинг + rate limiting, 11.07.2026)

Разбит на два пакета (лёгкий + тяжёлый), оба на проде (проект `sejpmzrmtgcvevukggkx`). Применены миграции `0022`, `0023`, `0024` (полный набор на проде — `0001`–`0024`).

**PR-A `wave-4a-hardening` → PR [#67](https://github.com/danny-swan/taskflow-app/pull/67) (merge `082a3ac`) — «лёгкий» пакет:**

| Находка | Статус | Где живёт фикс | Применение на прод |
|---|---|---|---|
| **N18** (search_path у public-функций) | ✅ На проде | миграция `0022_wave4_fix_function_search_paths.sql` | ✅ 2026-07-11 |
| **N17** (pg_net в схеме public) | 🟡 Частично | миграция `0023_wave4_move_pg_net.sql` (идемпотентный `ALTER EXTENSION ... SET SCHEMA extensions` в EXCEPTION-обёртке) | 🟡 2026-07-11 — на проде pg_net **остался в `public`** (перенос не состоялся, non-relocatable). Реального риска нет (API в схеме `net`), но отклонение от идеала фиксируем как known-limitation |
| **N14** (verify_jwt в конфиге) | ✅ На проде | `supabase/config.toml` (явный `verify_jwt` для всех функций) | ✅ 2026-07-11. 🟡 Known-limitation: `delete_account` на проде `verify_jwt=false` (исторический артефакт), код валидирует JWT сам; intent `true` вступит в силу при следующем деплое функции |
| **N11** (CORS `*` на state-changing функциях) | ✅ На проде | `_shared/cors.ts` + передеплой затронутых функций (`Allow-Origin` → домен приложения) | ✅ 2026-07-11 |
| **N16** (leaked password protection) | 🟡 Pending — ручное действие | код/конфиг + ops-гайд `docs/ops/supabase-auth-hardening.md` | 🟡 Тумблер включается ВРУЧНУЮ в Supabase Dashboard (Auth → Providers → Email → Leaked password protection). На 2026-07-11 ещё не включён — ждёт действия пользователя |

**PR-B `wave-4b-rate-limit` → PR [#68](https://github.com/danny-swan/taskflow-app/pull/68) (merge `ace0c07`) — «тяжёлый» пакет:**

| Находка | Статус | Где живёт фикс | Применение на прод |
|---|---|---|---|
| **N13** (rate limiting) | ✅ На проде **полностью** | миграция `0024_wave4_rate_limits.sql` (таблица `rate_limits` + RPC `check_rate_limit` + cron `rate-limits-cleanup`) + модуль `_shared/rate-limit.ts`; см. ADR 0004 | ✅ 2026-07-11 — edge `create-payment` **v18**, `start-trial` **v10**, `payment-webhook` **v26** (все ACTIVE) |

**Детали N13 (rate limiting):**
- **Реализация:** table-based limiter в Postgres (`public.rate_limits` + RPC `public.check_rate_limit`), **fail-open by design** — при сбое БД запрос пропускается (потерять платёж хуже, чем на время потерять throttle; симметрично ADR 0003). Выбор table-based вместо in-memory (stateless многоинстансные edge-функции) и вместо Redis (нет своей инфры) — см. ADR 0004.
- **Миграция `0024`:** таблица `rate_limits`, индекс по `expires_at`, RLS deny-by-default + REVOKE anon/authenticated, RPC SECURITY DEFINER с атомарным `INSERT ... ON CONFLICT` (fixed window), EXECUTE только `service_role`. **Применена на прод в ДВЕ части** — `CREATE EXTENSION IF NOT EXISTS pg_cron` падал (pg_cron уже установлен → dependent privileges exist): сначала core (таблица/RPC/RLS), затем cron-job без `CREATE EXTENSION`.
- **Cron `rate-limits-cleanup`** (`*/5 * * * *`) — чистит истёкшие строки.
- **Лимиты (после auth, оба user+IP где есть user):**
  - `create-payment` v18: per-user 10/60s + per-IP 30/60s
  - `start-trial` v10: per-user 3/3600s + per-IP 5/3600s
  - `payment-webhook` v26: per-IP 60/60s (после валидации payload, до dual-verify)
- **`getClientIp`:** `x-forwarded-for` (первый hop) → `x-real-ip` → `cf-connecting-ip` → `null`. При `null` per-IP лимит **пропускается** (per-user остаётся). Заменил прежний `'unknown'`, который схлопывал всех в один бакет и превращал per-IP в глобальный лимит.

**Наблюдение (не меняли код, только фиксируем):** `delete_account` на проде имеет `verify_jwt=false` при `config.toml` intent=`true`. Это осознанно задокументированный исторический артефакт (см. N14 выше и комментарий в `supabase/config.toml`), а не расхождение по безопасности — функция сама валидирует JWT. Значение флага синхронизируется при следующем деплое `delete_account`.

---

## 6. Исторические волны улучшений (`develop`, Wave 1–4)

> Контекст-блок. Период 09.07–11.07.2026, ветка `develop` до мерджа в `main`. Замкнувшаяся серия из 4 волн безопасности/хардненинга, выведшая проект к v1.0.0. Детали каждой волны (какие N# закрыты, миграции, PR-ы) уже отражены в соответствующих пунктах раздела 5 (F1–F5, N1–N18) и Приложения А. Новые "wave 5/6/..." не заводим — работа после v1.0.0 ведётся в виде направлений/этапов, см. раздел 7.

- **Wave 1** (`develop`, 09–10.07): F1 — `payment_method_id` внутренний uuid vs токен ЮKassa. PR #61.
- **Wave 2** (`develop`, 10.07): N4, N5, N12, N15 — безопасность view и admin-гейт. PR #63, миграция `0020_wave2_security_hardening` (ADR 0002).
- **Wave 3** (`develop`, 10.07): N6 — откат `ALTER DEFAULT PRIVILEGES` (footgun для будущих таблиц). PR #65, миграция `0021`, pgTAP future-table probe.
- **Wave 4** (`develop`, 11.07): N17 (pg_net, known-limitation), N18 (function search_path), N13 (rate-limits). PR #67 (PR-A) + #68 (PR-B, rate-limits), миграции `0022`–`0024`, ADR 0004.
- **PR #66**: сопроводительная документация волн.

**Итог волн 1–4:** к v1.0.0 закрыты F1/F4/F5 и N4/N5/N6/N8–N15/N18. Открыты на момент релиза: F2/F3 (закрылись выпуском десктопа v1.0.0), N16 (осознанно не включаем — платный тариф Supabase), N17 (known-limitation), N1/N2/N3 (низкая критичность, N1 — см. раздел 7).

---

## 7. Пост-v1.0.0 направления

Живой блок. Сюда добавляются текущие и будущие этапы улучшений после v1.0.0. Не разбиваем на "wave 5/6/..." — по направлениям. Закрытые пункты переезжают в раздел 10 (архив) с датой закрытия.

### 7.1. Фискализация — чеки ФНС для самозанятого (НПД)

**Проблема (обнаружена 11.07.2026):** реальные тестовые платежи прошли, но чек в «Мой налог» не пришёл, и вкладки «Чеки» для самозанятых в ЛК ЮKassa нет.

**Корневая причина — НЕ в коде.** Проверено: `create-payment` и `renew-subscription` корректно передают объект `receipt` (`tax_system_code: 6` — НПД, `vat_code: 1` — без НДС, `customer.email`, `items[]`). Проблема на стороне ЮKassa: [по официальной истории изменений API](https://yookassa.ru/developers/payment-acceptance/receipts/self-employed/basics) **ЮKassa с 23 декабря 2025 прекратила поддержку сервисов для самозанятых** — чеки при платежах и возвратах, а также выплаты самозанятым. Переданный `receipt` теперь просто игнорируется, чек в «Мой налог» не регистрируется.

**Юридический контекст:** самозанятый (НПД, 422-ФЗ ст. 14) обязан сформировать чек на каждый полученный доход. Срок для оплат картой/электронными средствами — в момент расчёта; штраф за пропуск — 20% суммы (100% при повторном нарушении в течение 6 мес). Возвращённые платежи (тестовые 299 ₽ + 1 ₽-проверки) дохода не образуют — по ним чек не нужен.

**Варианты решения (выбрать перед первым реальным клиентским потоком):**

1. **Ручное формирование чеков в «Мой налог»** — бесплатно, но вручную на каждую продажу. Приемлемо на старте, пока платежей мало. За уже прошедшие июльские платежи можно пробить задним числом.
2. **Сервис-посредник с автоматическими чеками НПД** (например [Robokassa](https://robokassa.ru/) или [Prodamus](https://prodamus.ru/)) — интеграция с «Мой налог» через партнёрство ФНС, чек пробивается автоматически. Потребует замены/добавления платёжного провайдера рядом с ЮKassa (переработка `create-payment` / `payment-webhook`).
3. **Прямая автоматизация против API «Мой налог»** через уполномоченного оператора ФНС — вызывать из `renew-subscription` после успешного списания. Больше всего работы, но полностью автоматически на ЮKassa.
4. **Возможная чистка кода:** объект `receipt` с `tax_system_code: 6` теперь ЮKassa не использует. Отправка безвредна, но при желании логику можно упростить/убрать после выбора решения выше.

**Приоритет:** разобраться и выбрать подход ДО того, как появится реальный поток сторонних клиентов. На старте (0 пользователей) допустим вариант 1 вручную. Решение задокументировать здесь после выбора.

### 7.2. Отключение legacy anon-ключа (N1)

- CI уже переведён на publishable-ключ `sb_publishable_EDGdl5gun3Ud60AQMymq9A_VWUFpS-a` (в v1.0.0). Legacy JWT anon-ключ ещё активен, но в новых билдах не используется.
- **Действие:** дождаться, пока все пользователи обновятся до v1.0.0+ → Dashboard → Project Settings → API → «Disable legacy anon key». Не блокер, но до публичного анонса желательно закрыть.

### 7.3. Отложенные направления

- **SupportBlock (CloudTips/крипта)** — вне scope v1.0.0. Статические донат-ссылки не активируют Pro — осознанное решение.
- **Telegram-бот (бывший dev.7)** — перенесён в v1.1+. Код не начат.
- **SberPay recurring** — внешняя зависимость от ЮKassa, ждём активации.
- **F2 (`renewal_attempts_count` во фронте)** — вышел в десктопе v1.0.0. ADR по окончательному решению "удалять ли старую колонку `renewal_attempts`" — тбд.

### 7.4. Релиз v1.0.2 (✅ ВЫПУЩЕН 12.07.2026)

**[Тег v1.0.2](https://github.com/danny-swan/taskflow-app/releases/tag/v1.0.2)** — выпущен 12.07.2026 ~14:49 MSK. Build run [29191151289](https://github.com/danny-swan/taskflow-app/actions/runs/29191151289), все 5 jobs зелёные (type-check + unit → E2E Playwright → build-macos → build (Windows) → release).

**Содержание v1.0.2:**
- B1 — фикс «Вернуть в работу» (PR #70, squash `3310aa4`).
- B2 — фикс race первого клика по «Администрирование» (PR #71, squash `91d7aa1`).
- F6 (фронт) — столбец «Холд» + клиент-миграция v10 (PR #72, squash `2602371`).

**Шаги выпуска (все выполнены):**
1. ✅ Bump `package.json` version → `1.0.2` (коммит `1f0921d`, локальный прогон: 264/264 vitest зелёные, `tsc + vite build` ✓).
2. ✅ Сборка десктоп-артефактов через тег `v1.0.2` → CI `build.yml` (Tauri NSIS + MSI RU/EN + portable + universal dmg). CI автоматически синхронизирует версии в `src-tauri/tauri.conf.json` и `src-tauri/Cargo.toml` из тега (Sync version from tag step) — в git-истории эти файлы остаются со старыми dev-версиями, для Tauri-билдов это OK.
2a. ✅ Миграция `0025_task_hold_periods.sql` применена на прод 12.07.2026 (до выпуска тега), версия `20260712112352`.
3. ✅ [Release v1.0.2](https://github.com/danny-swan/taskflow-app/releases/tag/v1.0.2) опубликован с билингвальными release notes, 6 артефактов (NSIS + 2 MSI + portable + dmg + `latest.json`), подпись для Windows-updater проверена.

**Автообновление:** `latest.json` указывает на `1.0.2` → все текущие десктоп-юзеры (v1.0.0/v1.0.1) получат предложение обновиться при следующем запуске приложения (через endpoint `https://github.com/danny-swan/taskflow-app/releases/latest/download/latest.json`).

### 7.5. Пространства (Workspaces) — Wave A (✅ завершена 2026-07-13)

Первый этап многопространственной модели. Ведётся в интеграционной ветке `feat/workspaces` (мержится в `main` единым PR после стабилизации, целевой десктоп-релиз v1.1.0). Техплан — `docs/architecture/workspaces-plan.md`.

- **PR-1..PR-4 — влиты** в `feat/workspaces`: схема/RLS/бэкфилл (`0027`), sync под `workspace_id`, стор + переключатель + ws-scoped UI, per-workspace настройки и CRUD пространств.
- **PR-5 (тарифные лимиты) — влит**: серверный триггер `enforce_workspace_limit` + `get_workspace_limit` (`0029`), Free = 2 / Pro = 7, UX-гейт в модалке + fallback на sync-ошибку. pgTAP `11_workspace_limits_test.sql`.
- **PR-6 (hardening/доки) — влит**: regression-pgTAP `12_workspaces_regression_test.sql` (`plan(45)`: 18 RLS-изоляция двух юзеров / 12 удаление ws / 15 integrity) в CI; локально 11 файлов / 310 тестов PASS на PG15-совместимых ассершенах. Продуктовых изменений нет.
- **Известные ограничения для Wave B** (зафиксированы тестами PR-6, осознанный дизайн PR-1): `workspace_id` — `text` без FK (целостность только через RLS, следствие offline-first sync) → в Wave B рассмотреть FK/orphan-cleanup; нет `ON DELETE CASCADE` (продукт на soft-delete, hard DELETE осиротит дочерние строки) → в Wave B каскадить явно. Пред-существующий TODO: тест `10_workspace_management_test.sql` не в CI и красный (soft-delete shared vs guard) — отдельным тикетом.
- **Shared-пространства (Wave B)** — ещё НЕ открыты: `kind='shared'` заблокирован check-constraint'ом `block_shared_workspaces` + триггером; лимитная логика уже форвард-совместима.

**Итог:** Wave A завершена 2026-07-13, все 6 PR смерджены в `feat/workspaces` (последний PR #80). `main` не тронут, ждёт финального merge-PR после Wave B (или Wave C, если такая будет планироваться).

**Known constraints for Wave B (унаследованы из Wave A):** два инварианта — `workspace_id` хранится как `text` без FK на `sync_workspaces(id)` и отсутствие `ON DELETE CASCADE` — решаются в **PR-b-01** через миграцию FK + `ON DELETE CASCADE` (`workspace_id`: text → uuid). Обоснование и trade-off'ы — [ADR 0005](../adr/0005-shared-workspaces.md).

### 7.6. Пространства (Workspaces) — Wave B: shared workspaces (в планировании, doc-PR pending)

Второй этап: открытие общих пространств (роли, инвайты по TF-ID, RLS для editor/viewer). Ведётся в `feat/workspaces` (не в `main`). Техплан — `docs/architecture/wave-b-plan.md`; ключевое инженерное решение (FK+CASCADE) — [ADR 0005](../adr/0005-shared-workspaces.md); living-анализ — `docs/architecture/tf_workspaces_architecture.md`.

Строгая последовательность из 6 подветок (каждая ответвляется от предыдущей после мержа):

1. **`feat/ws-b-01-integrity`** — миграция FK + `ON DELETE CASCADE` для 6 sync-таблиц + members + settings; снятие check-constraint `block_shared_workspaces`; регресс-тесты на integrity/удаление.
2. **`feat/ws-b-02-rls-roles`** — расширенные RLS-политики: editor пишет задачи/статусы/теги, viewer — SELECT-only, owner — всё (включая настройки/участников).
3. **`feat/ws-b-03-invites`** — RPC `invite_to_workspace` / `accept_invite`, таблица `sync_workspace_invites` (`pending/accepted/rejected/expired`), 403 для free. Только API.
4. **`feat/ws-b-04-ui-invites`** — UI вкладки «Участники»: приглашение по TF-ID, список участников с ролями, смена ролей (owner), «покинуть workspace» (editor/viewer).
5. **`feat/ws-b-05-navigation`** — UX-раздел «Личные / Общие» в переключателе + индикатор роли (edit/view badge).
6. **`feat/ws-b-06-hardening`** — regression pgTAP (3 роли × 6 таблиц × CRUD ≈ 72 теста), проверка лимитов shared у paid owner, проверка недоступности shared для free.

**Статус:** в планировании. Первым идёт документационный фундамент (этот doc-PR: импорт `tf_workspaces_architecture.md`, `wave-b-plan.md`, ADR 0005) — код Wave B стартует после него. После всех шести — единый merge-PR `feat/workspaces → main`.

---

## 8. Что этот аудит покрыл, а что нет

Границы первого аудита 09.07.2026 (обновляется при последующих аудитах, если их будет несколько).

**Покрыто:**
- Полная карта архитектуры и точек интеграции сервисов (раздел 2), с точными код-локейшнами.
- Регрессионная проверка **конкретно** для 4 известных багов синхронизации из dev.6.10.0 (раздел 4) — не сломались.
- Целевой аудит безопасности и платежей: секреты, RLS/GRANT, вебхуки, идемпотентность, авторизация (раздел 5).
- Каталог скрытых межмодульных связей (раздел 3) — целенаправленный поиск "мест, где легко забыть про вторую половину изменения", по аналогии со случаем statuses/tags.
- Точечная проверка по коду (не по документации) трёх решений из дизайн-дока dev.6.5: письма при recurring (частично не хватает одной ветки), reactivate-toggle (работает, но блокируется F1), update-card за 1₽ (работает целиком).

**НЕ покрыто — это отдельная большая задача, если нужна:**
Полный построчный аудит **каждой** фичи (канбан, календарь, шаблоны, импорт/экспорт, онбординг, кастомные темы и т.д.) на соответствие тому поведению, которое изначально задумывалось — а не только "фича существует и код на месте". Сделанные аудиты целенаправленно проверяли известные проблемные зоны (sync, платежи, безопасность) и искали скрытые связи, а не сверяли весь функционал построчно со спецификацией. Если нужен такой полный функциональный аудит — это отдельный объёмный проход (по сути, сквозной QA каждого экрана/флоу против исходного замысла), который стоит делать отдельным заходом, а не как часть текущего.

---

## Приложение А. Полная таблица миграций Supabase (файлы 0001–0025, все 22 применены на проде на 12.07.2026)

| # | Файл | Суть |
|---|------|------|
| 0001 | init | `profiles` + `usage_events`, триггеры, own-row RLS |
| 0002 | sync_schema | Все `sync_*` таблицы, UUIDv7 PK, soft-delete/version, realtime |
| 0003 | harden_functions | `search_path` для SECURITY DEFINER, revoke EXECUTE |
| 0004 | optimize_rls_and_indexes | `auth.uid()` → `(select auth.uid())`, индексы |
| 0005 | server_updated_at_triggers | Серверные BEFORE-UPDATE триггеры (LWW) |
| 0006 | realtime_overdue | `sync_overdue_events` в realtime |
| 0007 | entitlements | `user_entitlements`, `activation_requests`, `payment_events` — **триггер GRANT-инцидентов** |
| 0008 | activation_notified_at | Идемпотентность `activation-notify` |
| 0009 | admin_seed | Grandfathered-admin lifetime |
| **0010** | grant_service_role_on_payment_tables | **Фикс инцидента №1** |
| **0011** | grant_authenticated_select_on_entitlements | **Фикс инцидента №2** |
| **0012** | grant_authenticated_on_sync_and_profiles | **Фикс инцидента №3** |
| 0013 | revoke_execute_on_trigger_functions | Revoke EXECUTE на 4 триггер-функции |
| 0014 | payment_methods_and_recurring | `payment_methods` + `renewal_attempts_log`, автопродление — **источник F1/F2/F3 (старые имена колонок)** |
| 0015 | pg_cron_recurring | Часовой pg_cron |
| 0016 | schema_code_alignment | Досыпка колонок под код функций — **не все места чтения переведены, см. F2/F3** |
| 0017 | admin_rpc | SECURITY DEFINER RPC для admin-панели |
| 0018 | pg_cron_renew | pg_cron/pg_net через Vault |
| 0019 | cron_new_apikey_auth | Cron на apikey + x-cron-secret |
| **0020** | wave2_security_hardening | **Wave 2 (✅ ПРИМЕНЕНО НА ПРОД 2026-07-10):** N4/N5 — `security_invoker=on` + REVOKE на view `admin_users_summary`/`sync_status_summary`; N12 — `WITH CHECK` для `profiles_update_own`; N15 — admin-гейт `is_admin_user()` в `get_users_emails` (см. ADR 0002) |
| **0021** | revoke_default_privileges_footgun | **Wave 3 (✅ ПРИМЕНЕНО НА ПРОД 2026-07-10):** N6 — откат `ALTER DEFAULT PRIVILEGES` из 0010/0011; будущие таблицы больше не получают a/r/w автоматически. pgTAP `01_grants_test.sql` расширен future-table probe |
| **0022** | wave4_fix_function_search_paths | **Wave 4 PR-A (✅ ПРИМЕНЕНО НА ПРОД 2026-07-11):** N18 — фиксация `SET search_path` у public-функций без явного search_path (advisor `function_search_path_mutable`) |
| **0023** | wave4_move_pg_net | **Wave 4 PR-A (🟡 ПРИМЕНЕНО НА ПРОД 2026-07-11, частично):** N17 — идемпотентная попытка `ALTER EXTENSION pg_net SET SCHEMA extensions` (в EXCEPTION-обёртке). На проде pg_net **остался в `public`** (non-relocatable) — known-limitation, риска нет (API в схеме `net`) |
| **0024** | wave4_rate_limits | **Wave 4 PR-B (✅ ПРИМЕНЕНО НА ПРОД 2026-07-11):** N13 — таблица `rate_limits` + RPC `check_rate_limit` (SECURITY DEFINER, атомарный INSERT..ON CONFLICT, EXECUTE только service_role) + cron `rate-limits-cleanup` (`*/5`). RLS deny-by-default. Применена в 2 части (pg_cron уже установлен). См. ADR 0004 |
| **0026** | profile_customization | **Post-v1.0.2 (✅ ПРИМЕНЕНО НА ПРОД 2026-07-12):** Кастомизация профиля — новые колонки `profiles`: `public_user_id` (text UNIQUE NOT NULL, `TF-XXXXXX`), `nickname` (≤32), `avatar_variant` (smallint 1..8 DEFAULT 1), `bio` (≤160) + CHECK-ограничения. Функции `gen_public_user_id()` (алфавит без I/L/O/0/1) + `assign_public_user_id()` (retry ≤10). Обновлён `handle_new_user` (проставляет public ID новым). Backfill всем + `SET NOT NULL`. Guard-триггер `profiles_guard_immutable` (запрещает менять `id`/`public_user_id`). REVOKE EXECUTE на новые функции. Добавлен DEFAULT `public_user_id = assign_public_user_id()` — прямые INSERT (в т.ч. тестовые, без триггера) получают ID автоматически. `profiles` НЕ в sync — upsert/conflict не затронут. Проверено: 4/4 backfill, guard блокирует перезапись. **PR [#73](https://github.com/danny-swan/taskflow-app/pull/73) — ✅ СМЁРЖЕН (squash `7db27a6`) 12.07.2026.** pgTAP `08_profile_test.sql` `plan(24)`, весь набор зелёный |
| **0025** | task_hold_periods | **Post-v1.0.1 (✅ ПРИМЕНЕНО НА ПРОД 2026-07-12, version `20260712112352`):** F6 — таблица `public.sync_task_hold_periods` (локальное имя в SQLite — `task_hold_periods`), колонки: id/task_id/user_id/started_at/ended_at/created_at/updated_at/deleted_at/version/client_id + RLS own-row + GRANT authenticated (SELECT/INSERT/UPDATE) + BEFORE-UPDATE trigger `updated_at` + realtime + индексы (`task_id`, `user_id`, частичный `WHERE ended_at IS NULL`) + идемпотентный бэкфилл для тасков в текущем статусе «Приостановлено» (INSERT одной открытой строки с `started_at = tasks.updated_at`). Клиент (PR #72) — единственный автор интервалов (серверного триггера нет). Покрыто pgTAP `07_task_hold_periods_test.sql`. Клиент (PR #72) уехал на прод-юзеров с [выпуском v1.0.2](https://github.com/danny-swan/taskflow-app/releases/tag/v1.0.2) 12.07.2026 (см. раздел 7.4). Схема на проде готова, клиент пушит интервалы со своей стороны |

### Post-v1.0.2: кастомизация профиля (12.07.2026)

> Базовая кастомизация профиля: публичный ID + профильные поля. **PR [#73](https://github.com/danny-swan/taskflow-app/pull/73) — ✅ СМЁРЖЕН (squash `7db27a6`) 12.07.2026.** Серверная миграция `0026_profile_customization.sql` — ✅ ПРИМЕНЕНА НА ПРОД 12.07.2026 (вкл. DEFAULT на `public_user_id`).

**Модель идентификаторов (важно):**
- **Внутренний ID** — `profiles.id` (uuid, PK = `auth.users.id`). Для связности данных/логики (FK, RLS own-row, join'ы). Пользователю **не показывается**.
- **Публичный ID** — `public_user_id` (text UNIQUE NOT NULL, формат `TF-XXXXXX`). Показывается юзеру, сообщается другим (будущий поиск/друзья). **Неизменяем** после присвоения.
- **Профильные поля** — `nickname` (≤32), `avatar_variant` (smallint 1..8, DEFAULT 1), `bio` (≤160). Косметика, не замена ID.

**Генерация public ID:** функция `gen_public_user_id()` (алфавит `A-Z` + `2-9` без `I L O 0 1`) + `assign_public_user_id()` (retry ≤10 при коллизии). Новым юзерам — в триггере `handle_new_user`; прямым INSERT в `profiles` — через **DEFAULT** `public_user_id = assign_public_user_id()` (покрывает тестовые и любые будущие вставки без триггера). Уникальность — UNIQUE-constraint `profiles_public_user_id_key`.

**Гарантия неизменяемости:** BEFORE-UPDATE триггер `profiles_guard_immutable` молча возвращает старые значения `id` и `public_user_id` при попытке их переписать (у `authenticated` есть UPDATE ON profiles). Легальные правки nickname/bio/avatar/email не блокируются. Проверено на проде: попытка `UPDATE public_user_id='TF-HACKED'` не прошла (0 строк), nickname в том же запросе обновился.

**Sync:** `profiles` НЕ в sync-цикле (outbox/push/pull/mappers работают только с `sync_*`) — добавление полей НЕ затронуло upsert/conflict flow. Профиль читается/пишется отдельным Supabase-запросом (`src/lib/profile.ts`).

**Backfill:** всем существующим профилям (4 прод-аккаунта) автоматически присвоен TF-ID в миграции, затем `public_user_id SET NOT NULL`. На проде: 4/4 заполнены, все уникальны, все валидного формата.

**UI:** блок `ProfileBlock` в `AccountSection` (Settings): публичный ID + «Скопировать» + подсказка, поле ника, `AvatarPicker` из 8 встроенных SVG-аватаров, «о себе» со счётчиком `N/160`. Внутренний id не отображается.

**Тесты:** vitest 292/292, `tsc --noEmit` чисто, `npm run build` ✓, pgTAP `08_profile_test.sql` `plan(24)`. В CI (`db-tests.yml`) дополнительно подключён ранее пропущенный `07_task_hold_periods_test.sql`.

**Документация:** `docs/architecture/profile-identity.md` (разница внутренний/публичный ID, контексты использования).

**НЕ включено (сознательно):** система друзей/контактов, настройки приватности, загрузка произвольных картинок-аватаров.

## Приложение Б. Источники этого документа
- Полная git-история, теги, GitHub Releases/Secrets/Variables/Workflows — [репозиторий](https://github.com/danny-swan/taskflow-app)
- Архитектурный аудит + sync-регрессия — кодинг-субагент, HEAD `f764e23`
- Аудит безопасности и платежей — кодинг-субагент, HEAD `f764e23`
- ERD/data dictionary — напрямую из живой схемы Supabase (`list_tables`, `list_migrations`, `generate_typescript_types`, `get_advisors`) 10.07.2026 — см. `taskflow_erd_data_dictionary.md`
- Углублённый аудит: код-локейшны фич + каталог критических связей + проверка Q3/Q5/Q6 по коду — кодинг-субагент, HEAD `f764e23`
- Мастер-план и roadmap v1.0.0 — файлы Space "Programming" (`taskflow_v0.9.35_master_plan.md`, `taskflow_v1.0.0_roadmap.md`, `taskflow_v0.9.35_dev6.5_design.md`)
- Заметки прошлых сессий — память (Supabase setup, Resend SMTP, Sentry, домен)

---

## Приложение С. Architecture Decision Records (ADR) — как и где ведём

**Решение:** ADR живут в самом репозитории (`docs/adr/000N-title.md`, один файл на решение, нумерация сквозная), а не в роадмапе. в этом файле — только короткий индекс-таблица со ссылками.

**Почему в репозитории, а не в roadmap:**
- ADR описывает решение про код — логично, чтобы он версионировался вместе с кодом (git blame, PR-история, теги), а не в отдельном внешнем документе в Space.
- Когда ты (или будущий кодинг-субагент) открываете репозиторий годами спустя — `docs/adr/` будет на месте автоматически, без необходимости сначала искать внешний roadmap.
- Roadmap остаётся тем, для чего и создавался — статус/история/связи, без разбухания полными телстами решений.

**Формат одного ADR-файла:** заголовок + статус (proposed/accepted/superseded) + контекст + решение + последствия. Пример первых кандидатов, когда дойдём до Wave-фиксов: «выбрали `payment_methods.external_id` как единственный источник истины для токена ЮKassa, `payment_method_id` — только FK», «удалили/оставили `renewal_attempts` в пользу `renewal_attempts_count`».

**Индекс ADR** _(заполняется по ходу работы, ссылки на файлы в репозитории)_:

| # | Решение | файл |
|---|---|---|
| 0001 | F1: `payment_methods.external_id` — единственный источник истины для токена ЮKassa, `payment_method_id` — только FK на внутренний uuid (accepted) | `docs/adr/0001-payment-method-id-vs-external-id.md` |
| 0002 | N15: `get_users_emails` — внутренний admin-гейт (`is_admin_user()`) вместо REVOKE от authenticated (accepted) | `docs/adr/0002-get-users-emails-internal-admin-gate.md` |
| 0003 | N10: renewal idempotency-guard — сверка `GET /v3/payments` до создания платежа автопродления как страховочный слой поверх Idempotence-Key (accepted) | `docs/adr/0003-renewal-idempotency-guard.md` |
| 0004 | N13: rate limiting — table-based счётчик в Postgres (`rate_limits` + RPC `check_rate_limit`) вместо in-memory/Redis, fail-open by design (accepted) | `docs/adr/0004-rate-limiting-table-based.md` |
| 0005 | Wave B: shared workspaces — роли owner/editor/viewer, инвайты по TF-ID, `workspace_id` text→uuid + FK + ON DELETE CASCADE (accepted) | `docs/adr/0005-shared-workspaces.md` |
| — | удалили/оставили `renewal_attempts` в пользу `renewal_attempts_count` (F2) — решение ещё не принято, фронт-часть не деплоилась | тбд |

---

## 10. Исторический архив (до v1.0.0)

Собраны блоки, которые были актуальны до выхода v1.0.0 (11.07.2026), но сейчас устарели. **Не удалять** — текст важен для восстановления контекста, как принимались решения. Все пункты ниже — **✅ выполнено 11.07.2026** или перешли в пост-v1.0.0 (раздел 7).

### 10.1. Снапшот «Самое важное одной строкой» (09.07.2026)

> **Архивный снапшот** — был вверху roadmap в первый день аудита 09.07.2026. Многое устарело к 11.07.2026 (выход v1.0.0).

Автосписание стоит на проде с багом-блокером: сейчас сохранённые способы оплаты помечаются как `inactive` в момент сохранения, а `renew-subscription` выбирает только `active`-записи — поэтому автосписание успевает сломаться тихо перед тем, как вообще попытаться списать деньги. Фикс в `create-payment` — сохранять способ оплаты как `active` в момент успешной первой оплаты, откат — `soft-delete` по `payment_method_id`.

Помимо этого качественно реализованы: полный backend, `payment_methods` с versioning, cron активен, RLS без дыр, логика с idempotency (`renewal_attempts_log`, Idempotence-Key), корректная обработка `succeeded/canceled/refunded` в `payment-webhook`, RPC с `SECURITY DEFINER` и `search_path`.

**Статус к 11.07.2026:** F1 исправлен в Wave 1 (PR #61). Все остальные баги F2-F5 в Wave 1. Подтверждено выходом v1.0.0.

### 10.2. F1–F3 (до Wave 1): старый блок «🔴 Уже сломано»

> **Архивный снапшот** — был в разделе 3 как п. 1–3. Все три — ✅ **закрыты в Wave 1** (PR #61, мердж 06.07.2026), прод обновлён.

1. **F1** — `create-payment` сохранял `payment_methods.status = 'inactive'` для совершенного (`payment.succeeded`) первого платежа — автосписание не могло найти способ оплаты. Фикс: сохранять `active`, если `payment.status='succeeded'`. Код-локейшн: `supabase/functions/create-payment/index.ts`. ✅ Wave 1.
2. **F2** — `renewal_attempts` вместо `renewal_attempts_count` в фронт-коде (`src/lib/entitlements.ts`) — счётчик попыток автосписания не отображался. ✅ Wave 1.
3. **F3** — бренд сохранённой карты не показывался в Settings (`src/pages/Settings.tsx`) — UX-мелочь. ✅ Wave 1.

### 10.3. Незакрытые пункты (снапшот из мастер-плана 06.07 и roadmap 08.07)

> **Архивный снапшот** — был в разделе 6 как список 1–8. Все пункты — ✅ закрыты к v1.0.0 или перешли в пост-v1.0.0 (см. раздел 7).

1. **Подтвердить полный E2E-тест реального автосписания.** В roadmap от 08.07 стоял открытый вопрос — "провели ли вы уже полный цикл реального списания, или только привязку карты". **Теперь у этого вопроса есть техническое объяснение: если тест и проводился, он не мог пройти из-за F1.** Стоит проверить `renewal_attempts_log` за последние дни на записи `payment_method_inactive`. ✅ F1 закрыт, cron активен.
2. **Telegram-бот (dev.7)** — по git-истории работа не начата ни одним коммитом. Решить: в v1.0.0 или переносим в v1.1. ✅ вынесено в пост-v1.0.0.
3. **SberPay recurring** — ждём активации от ЮKassa (внешняя зависимость, не блокер). ✅ вынесено в пост-v1.0.0.
4. **Merge `develop` → `main`** + первый не-pre-release GitHub Release — ещё не сделано. ✅ v1.0.0 выпущен 11.07.2026.
5. **Решить по тегам dev.6.5-dev.6.10** — ретегировать задним числом важные вехи или сразу готовиться к v1.0.0 без промежуточных релизов. ✅ решено: ретегирование пропущено, сразу v1.0.0.
6. **Явно перепроверить старый чек-лист "перед первым реальным платежом"** из плана 06.07 — часть пунктов помечена закрытой (магазин live, автосписания активны), но стоит подтвердить руками (не проверяется по коду, только по продовым настройкам):
   - `YOOKASSA_SKIP_IP_CHECK` выключен в проде (было `true` для тестов через ngrok)
   - webhook доступен извне и обрабатывает все нужные события в кабинете ЮKassa
   - первый реальный платёж сверен в личном кабинете ЮKassa / чек в ФНС
   ✅ пункты C-D чек-листа 10.4 пройдены; ФНС-чеки — в пост-v1.0.0 (раздел 7.1).
7. **Rewrite `SupportBlock` для CloudTips (крипта)** — сознательно отложено в прошлой сессии как неблокирующее; статические ссылки (`VITE_PAY_CLOUDTIPS_URL`, TON, USDT) не дают автоматического entitlement — это принятое решение, но стоит держать в уме, что оплата через них не активирует Pro автоматически. ✅ вынесено в пост-v1.0.0.
8. **Обновление `/privacy.html` на продовом лендинге** — отдельный коммит с редиректом, отмечен как отложенный, статус по лендинг-репозиторию (`taskflow-landing`) в этом аудите не проверялся (аудит фокусировался на `taskflow-app`). ✅ вынесено в пост-v1.0.0 (раздел 7).

### 10.4. Финальный чек-лист перед merge `develop` → `main` (снапшот 11.07.2026)

> **Архивный снапшот** — был в разделе 8. Мердж сделан 11.07.2026, тег `v1.0.0` опубликован. Пункты A-G либо выполнены, либо вынесены в пост-v1.0.0 (раздел 7); H (ФНС-чеки) — в пост-v1.0.0 как 7.1.

Обновление от 11.07.2026. **Wave 1–4 полностью на проде** (F1-F5, N4-N18). Бэкенд-часть (миграции `0001`–`0024`, edge-функции) закрыта. Ниже — всё, что ещё стояло между `develop` и первым не-pre-release релизом v1.0.0.

### Известные ограничения — осознанные решения, НЕ блокеры

- **N16 (Leaked Password Protection)** — **не включаем.** Требует платного тарифа Supabase, которого у пользователя сейчас нет. Код/конфиг и ops-гайд (`docs/ops/supabase-auth-hardening.md`) готовы — тумблер можно включить позже, когда/если тариф появится. **Осознанное решение, не блокер v1.0.0.**
- **N17 (pg_net в схеме `public`)** — **оставлен как есть, риска нет.** `pg_net` нужен для функционирования pg_cron-автопродления; попытка перенести расширение (миграция `0023`) не состоялась на проде (non-relocatable), и принудительный перенос оборвёт cron-цепочку. API pg_net живёт в схеме `net`, cron-джобы зовут именно её. **Осознанное решение, не блокер.**
- **SupportBlock (CloudTips/крипта) и Telegram-бот (dev.7)** — **вне scope v1.0.0** по решению пользователя. Статические донат-ссылки не дают автоматического entitlement — это принятое поведение (см. раздел 6, п.7).

### A. Frontend release (F2/F3) — 🟡 требует релиза десктопа

- **F2** (`src/lib/entitlements.ts` — правки счётчика авто-продления) и **F3** (`src/pages/Settings.tsx` — бренд карты) закоммичены в `develop`, но **НЕ на проде**: это фронтовые файлы, а не edge-функции, и уезжают на прод только с новым релизом приложения.
- `develop` опережает `main` на **96 коммитов**.
- **Требуется:** сборка Tauri-приложения из `develop` (после merge — из `main`) и релиз пользователям. До этого UI автопродления и бренда карты у существующих пользователей останется с багами.
- Делать **параллельно с merge to main или сразу после** — `main` = source of truth для релиза.

### B. E2E автопродления вживую — 🟡 требует участия пользователя (не автоматизируется)

- Cron `taskflow-renew-subscriptions` (jobid=2, расписание `0 * * * *`) **активен**.
- Единственная активная pro-подписка с `auto_renew` истекает **2026-08-06** (через ~25 дней) — до этого срока функция `renew-subscription` не будет пытаться списать.
- `renewal_attempts_log` сейчас **пуст** — ни одной попытки продления ещё не было.
- **Действие (один из двух путей):**
  1. Дождаться реального срока (2026-08-06) и проверить лог; **или**
  2. Принудительно выставить `valid_until` активной подписки на near-future (например, `now() + 5 минут`), дождаться срабатывания cron, проверить `renewal_attempts_log` на запись с корректным `status` (`renewed_ok`, либо `payment_method_inactive`/`no_payment_method`/`payment_failed` в зависимости от состояния сохранённого способа оплаты), затем **откатить `valid_until` обратно**.
- Проверка **не автоматизирована**: у пользователя живая подписка с сохранённым способом оплаты (метка `payment_method_id`), которую не хочется потерять — поэтому нужен ручной контроль.

### C. Ручной чек-лист перед первым реальным платежом от постороннего пользователя

Продовые настройки проверяются в Supabase Dashboard → Project Settings → Edge Functions → Secrets и в личном кабинете ЮKassa (по коду не проверяется):

1. **`YOOKASSA_SKIP_IP_CHECK=false`** (или переменная удалена — по умолчанию `false`). Ранее могла ставиться `true` для тестов через ngrok.
2. **`YOOKASSA_SHOP_ID` и `YOOKASSA_SECRET_KEY`** — актуальные **production**-креды из ЛК ЮKassa (не тестовые).
3. **В ЛК ЮKassa проверить webhook:** URL = `https://sejpmzrmtgcvevukggkx.supabase.co/functions/v1/payment-webhook`, включены события `payment.succeeded`, `payment.canceled`, `refund.succeeded`.
4. **`APP_ALLOWED_ORIGINS`** содержит `tauri://localhost`, `https://tauri.localhost`, `https://yourtaskflow.app` (и `http://localhost:5173` для dev — уже добавлено).
5. **Провести один реальный тестовый платёж** на минимальный тариф с реальной карты (можно свою) и убедиться:
   - webhook принят (`200 OK` в логах `payment-webhook`);
   - `user_entitlements.plan = 'pro'`, `valid_until` рассчитан корректно, `payment_method_id` сохранён;
   - платёж виден в ЛК ЮKassa;
   - **⚠️ фискальный чек в ФНС — см. раздел H.** ЮKassa с 23.12.2025 **прекратила** формирование чеков для самозанятых (НПД). Вкладки «Чеки» для самозанятых в ЛК больше нет, чек в «Мой налог» автоматически не приходит. Проверка «чек ушёл в ФНС» в этом пункте **более неактуальна** — фискализация решается отдельно (раздел H).

### D. Ротация anon-ключа (N1) — 🟡 не блокер merge, но до публичного анонса v1.0.0

- У проекта уже есть modern publishable key `sb_publishable_EDGdl5gun3Ud60AQMymq9A_VWUFpS-a` (создан Supabase автоматически).
- Legacy JWT anon-ключ ещё активен и был утёкшим в старом коммите. **Он безопасен по дизайну** (только anon, ограничен RLS-политиками), но для чистоты стоит мигрировать.
- **Действие:** в клиенте (`src/lib/supabase.ts`) переключиться на publishable key → сбилдить новый релиз приложения → дождаться, пока все пользователи обновятся → отключить legacy anon в Dashboard → Project Settings → API → «Disable legacy anon key».
- **Не блокер для merge to main**, но должно быть сделано перед публичным анонсом v1.0.0.

### E. Ретегирование dev.6.5–dev.6.10 — ✅ решено: пропускаем, НЕ блокер

- В репозитории есть только git-теги `dev.6.1`–`dev.6.4.3`. Версии 6.5–6.9 упоминаются только в файлах `RELEASE_NOTES_v0.9.35-dev.6.X.md`, git-тегов для них нет.
- **Решение:** ретегирование задним числом **пропустить.** При релизе v1.0.0 создать один аннотированный тег `v1.0.0` на HEAD `main`.

### F. Внешние зависимости — не блокеры

- **SberPay recurring** — ждём активации от ЮKassa (внешняя зависимость).

### G. Landing (отдельный репо `taskflow-landing`)

- Обновить `/privacy.html` на прод-лендинге, если он давно не сверялся с политикой обработки данных приложения. В этом аудите репозиторий лендинга **не проверялся** (аудит фокусировался на `taskflow-app`).

### H. Фискальные чеки ФНС для самозанятого (НПД) — 🔴 требует решения ПОСТ-v1.0.0

**Проблема (обнаружена 11.07.2026):** реальные тестовые платежи прошли, но чек в «Мой налог» не пришёл, и вкладки «Чеки» для самозанятых в ЛК ЮKassa нет.

**Корневая причина — НЕ в коде.** Проверено: `create-payment` и `renew-subscription` корректно передают объект `receipt` (`tax_system_code: 6` — НПД, `vat_code: 1` — без НДС, `customer.email`, `items[]`). Проблема на стороне ЮKassa: [по официальной истории изменений API](https://yookassa.ru/developers/payment-acceptance/receipts/self-employed/basics) **ЮKassa с 23 декабря 2025 прекратила поддержку сервисов для самозанятых** — чеки при платежах и возвратах, а также выплаты самозанятым. Переданный `receipt` теперь просто игнорируется, чек в «Мой налог» не регистрируется.

**Юридический контекст:** самозанятый (НПД, 422-ФЗ ст. 14) обязан сформировать чек на каждый полученный доход. Срок для оплат картой/электронными средствами — в момент расчёта; штраф за пропуск — 20% суммы (100% при повторном нарушении в течение 6 мес). Возвращённые платежи (тестовые 299 ₽ + 1 ₽-проверки) дохода не образуют — по ним чек не нужен.

**Что надо разобраться / варианты решения (выбрать перед первым реальным клиентским потоком):**

1. **Ручное формирование чеков в «Мой налог»** — бесплатно, но вручную на каждую продажу. Приемлемо на старте, пока платежей мало. За уже прошедшие июльские платежи можно пробить задним числом.
2. **Сервис-посредник с автоматическими чеками НПД** (например [Robokassa](https://robokassa.ru/) или [Prodamus](https://prodamus.ru/)) — интеграция с «Мой налог» через партнёрство ФНС, чек пробивается автоматически. Потребует замены/добавления платёжного провайдера рядом с ЮKassa (переработка `create-payment` / `payment-webhook`).
3. **Прямая автоматизация против API «Мой налог»** через уполномоченного оператора ФНС — вызывать из `renew-subscription` после успешного списания. Больше всего работы, но полностью автоматически на ЮKassa.
4. **Возможная чистка кода:** объект `receipt` с `tax_system_code: 6` теперь ЮKassa не использует. Отправка безвредна, но при желании логику можно упростить/убрать после выбора решения выше.

**Приоритет:** разобраться и выбрать подход ДО того, как появится реальный поток сторонних клиентов. На старте (0 пользователей) допустим вариант 1 вручную. Решение задокументировать здесь после выбора.

---

### 10.5. Порядок действий для v1.0.0 (снапшот 11.07.2026)

> **Архивный снапшот** — все пункты выполнены (v1.0.0 + v1.0.1 на проде).


1. Провести **E2E автопродления** (пункт B) — по возможности до merge.
2. **Merge `develop` → `main`.**
3. Сбилдить **Tauri-релиз с `main`**, опубликовать в GitHub Releases как **v1.0.0** (первый не-pre-release).
4. Обновить клиент на **publishable key** (может быть в том же релизе — см. D).
5. Пройти **чек-лист C** перед первым реальным платежом от постороннего пользователя.
6. **Отключить legacy anon** в Dashboard после того, как пользователи обновятся (D).
7. Обновить **`/privacy.html`** на лендинге (G).
