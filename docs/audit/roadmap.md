# TaskFlow — полный аудит: roadmap эволюции, архитектура, связи, безопасность и платежи

**Дата аудита:** 09.07.2026, последнее обновление 10.07.2026.
**Статус: живой рабочий документ.** Не переписывается целиком — после каждой выполненной задачи (фикс/фица/миграция) соответствующий раздел точечно дополняется. Смотри также компаньон-документ `taskflow_erd_data_dictionary.md` (точная схема из живой базы Supabase, тоже живой) — этот роадмап ссылается на него, а не дублирует структуру таблиц.
**Репозиторий:** [github.com/danny-swan/taskflow-app](https://github.com/danny-swan/taskflow-app) — единственная ветка `develop` (main не создавался), 218 коммитов, 60 merged PR, 0 open issues.
**Текущая версия:** `0.9.35-dev.6.10.5`, HEAD [`f764e23`](https://github.com/danny-swan/taskflow-app/commit/f764e23399a9d698f1d67f0537d5f5e8fe13b229).
**Метод:** git-история (`git log -p --all`), GitHub Secrets/Variables/Workflows, память прошлых сессий, три независимых кодинг-аудита (архитектура+sync-регрессия; безопасность+платежи; код-локейшны+критические связи+проверка открытых вопросов по коду).

> Навигация: раздел 0 — что горит прямо сейчас. Раздел 1 — хронология с ссылками на коммиты и код. Раздел 2 — карта сервисов/секретов. **Раздел 3 — критические связи ("что с чем жёстко связано" — прямой ответ на вопрос "что можно упустить").** Раздел 4 — регрессия sync. **Раздел 5 — блок находок (баги/дыры) с критичностью.** Раздел 6 — незакрытые пункты из прошлых обсуждений. Раздел 7 — что аудит покрыл, а что нет.

---

## 0. Самое важное одной строкой

- 🔴 **Автопродление подписки сломано прямо сейчас** — не просто "похоже на баг", а точно диагностировано на уровне кода. Причина — рассинхрон между `payment-webhook` и `renew-subscription` вокруг `payment_method_id`. См. **F1** в разделе 5. Приоритет №1, у этого уже мог быть реальный пострадавший (см. раздел 6 — открытый вопрос про E2E-тест).
- 🟡 Тот же класс проблемы дал ещё 2 более мелких бага: счётчик попыток продления (**F2**) и бренд карты (**F3**) в интерфейсе показывают неверные/пустые данные — фронт и бэкенд после миграции 0016 читают разные колонки.
- 🟡 Письмо о неудачном платеже не отправляется, если платёж пришёл как `payment.canceled` прямо в webhook, а не через cron (**F4**).
- ✅ Две view в Supabase потенциально раскрывают email/метрики всех пользователей любому залогиненному юзеру (**N4, N5**) — закрыто в Wave 2 (миграция `0020`, `security_invoker=on` + REVOKE); ✅ ПРИМЕНЕНО НА ПРОД 2026-07-10.
- 🟢 Регрессий в sync-логике (statuses/tags/tasks) не найдено.
- 🟢 Секретов уровня service_role/YooKassa production в истории git не утекало.
- ⚪ GitHub Releases не создавались с 07.07 (тег остановился на `v0.9.35-dev.6.4.3`) — разрыв в процессе релизов перед v1.0.0.
- ⚪ **Прайс-лист тарифов продублирован в 3+ местах кода** (create-payment, renew-subscription, webhook, фронт) — сам код содержит комментарий-напоминание "синхронизировать" — риск при следующем изменении цены.

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

### Разрыв в релизах
GitHub Releases/теги останавливаются на `v0.9.35-dev.6.4.3` (07.07, 11:32 UTC). Всё после (dev.6.4.4 → dev.6.10.5, 30+ версий) существует только как коммиты в `develop`, без тега и релиза.

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
- **Синхронизируемые таблицы (5):** `tasks`, `statuses`, `tags`, `task_templates`, `overdue_events`. Порядок push — родители раньше детей: `PUSH_ORDER` (`sync/mappers.ts:427-433`) = statuses → tags → tasks → templates → overdue_events.
- `settings` синхронизируется в облачной схеме (`sync_settings`), но **не пушится/не пуллится клиентом** — сделано осознанно.
- **Push:** батчи ≤50, экспоненциальный backoff 1→2→4→8→16мин, `MAX_ATTEMPTS=5`, `.upsert(onConflict:'id')` (`sync/push.ts:218`), delete — soft.
- **Pull:** курсор per-table в `settings`, LWW по `updated_at`, `DeferRowError` для сирот.
- **Realtime:** канал `sync-realtime-<userId>`, debounce 600мс, слушает 5 sync_* таблиц.

### 2.2. Supabase backend

**19 миграций** (`supabase/migrations/0001`→`0019`) — от базовой схемы до полной sync-схемы, entitlements/payments, GRANT-хардненинга (3 итерации), payment_methods + pg_cron автопродление. Полная таблица — Приложение А.

**12 Edge Functions** (`supabase/functions/`):

| Функция | Назначение | Ключевые строки |
|---|---|---|
| `create-payment` | Создание платежа (покупка / update-card 1₽) + 54-ФЗ чек | `TIERS` прайс-лист `:69-94`; `UPDATE_CARD_SPEC` `:102-106`; режим update-card `:165-170,254-257` |
| `payment-webhook` | Проверка вебхуков, entitlements, сохранение карт, refund | `savePaymentMethod` `:822-844`; `handlePaymentCanceled` `:635-691`; `initiateRefund` `:847` |
| `renew-subscription` | Часовой cron, списание, downgrade после 3 фейлов | Выборка кандидатов `:222-237`; поиск метода `:292`; `MAX_ATTEMPTS=3`, `TIER_AMOUNTS:286` |
| `change-plan` | Upgrade monthly→annual | — |
| `cancel-subscription` / `reactivate-subscription` (`:118-125`) / `detach-payment-method` (`:102-171`) | Управление подпиской | — |
| `admin-actions` | Admin-only действия | `:141-266` |
| `activation-notify` / `send-user-email` (шаблоны `:187,256,340`) | Транзакционные письма | Resend |
| `start-trial` | 14-дневный trial (`TRIAL_DAYS=14`) | `:99-130` |
| `delete_account` | Удаление аккаунта | — |

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

### 🔴 Уже сломано (см. также раздел 5, F1-F3)
**1. `payment_method_id`: внутренний uuid vs токен ЮKassa**
- А: `payment-webhook/index.ts:391,485,572` пишет туда внутренний uuid строки `payment_methods`.
- Б: `renew-subscription/index.ts:292` ищет по этому же полю **как external_id** (токен), `:324` шлёт его в ЮKassa как токен.
- Итог: никогда не совпадает → автосписание не работает ни у кого. Это регрессия dev.6.10.1: починили webhook, забыли поправить cron под новый контракт.

**2. `renewal_attempts` (миграция 0014) vs `renewal_attempts_count` (0016)** — бэкенд пишет новую колонку, фронт (`src/lib/entitlements.ts:364`) читает старую → счётчик попыток в UI всегда врёт.

**3. `card_brand` (0014/фронт) vs `card_type`/`card_first6` (0016/webhook)** — webhook перестал писать `card_brand`, фронт (`entitlements.ts:715`) продолжает его читать → бренд карты пустой в интерфейсе.

### 🟡 Пока работает, но легко сломать при следующей правке

**4. Один синкаемый столбец = 5 мест для правки.** Добавление нового поля в любую из 5 sync-таблиц требует согласованной правки: миграция → GRANT/RLS → push-mapper (`sync/mappers.ts`) → pull-mapper → TS-интерфейс. Пропуск одного — поле молча не синкается или ломает `upsert(onConflict:'id')` (`sync/push.ts:218`). Именно этот класс ошибки уже дважды сработал (statuses/tags в прошлой сессии, и card_brand/renewal_attempts выше).

**5. pgTAP-тест на GRANT/RLS хардкодит список таблиц.** `supabase/tests/01_grants_test.sql` — `plan(74)`, явно перечисляет 14 таблиц. **Новая таблица без ручного дополнения этого теста пройдёт CI, даже если права настроены неверно** — тест не поймает регрессию сам, если про него не вспомнить. Это прямой риск повторения инцидентов dev.6.4.2/6.4.3/6.4.4 на новых таблицах.

**6. Определение "кто админ" размазано по 4 местам:** `0017_admin_rpc.sql:43` (инлайн в RPC) и `:72-78` (`is_admin_user()`, повторяет ту же логику) + фронт `entitlements.ts:162-164` (`ADMIN_EMAILS` OR seed/lifetime) + `admin-actions/index.ts:141-266`. Изменение критерия в одном месте без остальных → фронт покажет `/admin`, а серверная проверка откажет (или наоборот, что хуже).

**7. Admin-гейт на фронте — это только UX, не защита.** `src/App.tsx:284` + `AdminPage.tsx` — клиентский гейт. Вся реальная защита — в `admin-actions` и RLS `0017`. Если серверная проверка когда-нибудь ослабнет, скрытие роута на фронте не защитит.

**8. `next_renewal_at` ↔ частичный индекс ↔ выборка cron.** Индекс `idx_entitlements_next_renewal` (0014:136-138, условие `auto_renew=true AND cancel_at_period_end=false`) должен совпадать с WHERE в `renew-subscription:222-237`. `reactivate-subscription` и `detach-payment-method` меняют именно эти флаги — если один из них не выставит их согласованно, строка либо выпадет из выборки (не продлится), либо попадёт туда без валидного метода оплаты.

**9. Idempotence-Key ЮKassa зависит от счётчика попыток.** `renew-subscription:316-318` строит ключ детерминированно из `(userId, valid_until, attemptNo)`. Если счётчик рассинхронен (см. пункт 2 выше) — риск коллизии ключа (повторный запрос вернёт старый результат) или, наоборот, двойного списания.

**10. Snapshot restore не ре-энкьюит outbox.** `restoreSnapshot` → `db.applyBackup('replace')` (`snapshots.ts:405`, `db.ts:1074`) заменяет локальные строки, но **не** ставит их в `sync_outbox` и не бампает `version`/`client_id`. После восстановления снимка данные могут не уехать в облако до следующей ручной правки.

**11. Изоляция аккаунтов держится на паре `bound_user_id` ↔ `registryKey`.** `setBoundUserId`/`checkAccountBinding` (`snapshots.ts:192,240`) должны быть согласованы с `registryKey(userId)` (`:44-46`). Рассинхрон = утечка снимков одного аккаунта в другой на общем устройстве. Явная миграция со старого shared-ключа в коде — маркер, что это уже когда-то путалось.

**12. Прайс-лист тарифов продублирован в 3+ местах.** `TIERS` в `create-payment:69-94`, `TIER_AMOUNTS` в `renew-subscription:286`, плюс фронт `/checkout` и `valid_until`-логика в webhook. Сам код содержит комментарий-напоминание "синхронизировать с другими местами" (`create-payment:64-68`) — это авторское признание, что цену легко забыть поменять везде сразу.

**Общий вывод:** структурно самый рискованный паттерн в проекте — "одна сущность, несколько копий состояния в разных сервисах/слоях" (счётчики, id, цены, права). Каждый раз, когда добавляется новое поле/таблица/цена/роль, стоит явно пройтись по пунктам 4-12 этого списка и проверить, не появилась ли ещё одна скрытая копия.

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
| **F3** | Бренд карты в UI пустой — webhook пишет `card_type`/`card_first6`, фронт читает `card_brand` | `payment-webhook/index.ts:823-828`, `entitlements.ts:715` | LOW-MEDIUM | Синхронизировать имена колонок либо перевести фронт на новые |
| **F4** | Письмо о неудачном платеже не шлётся, если отказ пришёл как `payment.canceled` прямо в webhook (не через cron) | `payment-webhook/index.ts:635-691` (`handlePaymentCanceled`) | MEDIUM | Добавить вызов `notifyRenewalFailed`/аналог в этой ветке |
| **F5** ✅ | Дубль письма `renewal_failed` + двойной инкремент `renewal_attempts_count`: при синхронном `canceled` от ЮKassa cron шлёт письмо/инкремент, и webhook по тому же платежу делает то же ещё раз (побочка фикса F4, дедупликации между путями нет) | `renew-subscription/index.ts:405-423` (синхр. `canceled`, письмо стр.412) вс. `payment-webhook/index.ts:704-726` | MEDIUM | **✅ ИСПРАВЛЕНО (Wave 2, ветка `wave2-fixes`).** Принцип "единственный владелец": из синхр. ветки `canceled` cron убраны `logAttempt`+`incrementAttempts`+`notifyRenewalFailed` — для СОЗДАННЫХ платежей письмо/счётчик/лог делает только webhook `payment.canceled`. Cron лишь выставляет `last_renewal_attempt_at` (чтобы не дёрнуть юзера повторно). Письмо cron сохранено ТОЛЬКО в ветке HTTP-ошибки API (платёж не создан, webhook не придёт). Покрыто unit-тестом `renew-subscription/test.ts`. ✅ ПРИМЕНЕНО НА ПРОД 2026-07-10 — edge `renew-subscription` **v9** (id `27d6ffbb-616d-4d76-bece-2ab6efb4aa90`, ACTIVE, `verify_jwt=false`); на проде синхронная `canceled`-ветка cron больше не шлёт письмо/не инкрементит счётчик/не пишет лог, только обновляет `last_renewal_attempt_at`. См. `dup_email_analysis.md` |

### 🟡 Уязвимости безопасности

| # | Находка | Где | Критичность | Что делать |
|---|---|---|---|---|
| N4 ✅ | View `admin_users_summary` без `security_invoker` (`reloptions=null` — подтверждено 10.07 на живой схеме). **Уточнение:** гранты anon/authenticated на view = только `TRUNCATE,REFERENCES,TRIGGER`, **`SELECT` НЕТ** → прямого чтения через PostgREST уже нет, фактическая утечка не воспроизводится — реальная критичность LOW | живая схема (исходно `migrations/0001_init.sql`) | LOW (было MEDIUM) | **✅ ИСПРАВЛЕНО (миграция `0020_wave2_security_hardening.sql`).** `ALTER VIEW ... SET (security_invoker = on)` + `REVOKE ALL ... FROM anon, authenticated`. Тело view не менялось. Покрыто `tests/04_wave2_test.sql`. ✅ ПРИМЕНЕНО НА ПРОД 2026-07-10 (миграция `0020`; проверено на живой схеме: `admin_users_summary` имеет `reloptions security_invoker=on`, SELECT для anon/authenticated отозван) |
| N5 ✅ | View `sync_status_summary` — аналогично (`reloptions=null`, гранты без `SELECT`, подтверждено 10.07) | живая схема (исходно `migrations/0002_sync_schema.sql`) | LOW (было MEDIUM) | **✅ ИСПРАВЛЕНО (миграция `0020`).** `security_invoker=on` + `REVOKE ALL FROM anon, authenticated`. Покрыто `tests/04_wave2_test.sql`. ✅ ПРИМЕНЕНО НА ПРОД 2026-07-10 (проверено на живой схеме: `sync_status_summary` — `security_invoker=on`, SELECT для authenticated отозван) |
| N8 | Webhook доверяет `X-Forwarded-For` в IP-whitelist (подделываемый заголовок) | `payment-webhook/index.ts:972-986` | MEDIUM | Митигировано dual-verify через `GET /v3/payments/{id}`; убедиться, что `YOOKASSA_SKIP_IP_CHECK` выключен в проде |
| N6 | `ALTER DEFAULT PRIVILEGES` авто-выдаёт SELECT на будущие таблицы — тот же класс footgun, что вызвал 3 прошлых GRANT-инцидента | миграции | LOW-MEDIUM | Убрать общий default-grant, точечные GRANT + pgTAP-тест |
| N9 | Нет сверки суммы платежа с прайсом в webhook | `payment-webhook` | LOW | Сверять `amount.value`+currency против серверного `TIERS` |
| N10 | Идемпотентность зависит от `attempt_no` — при timeout возможен повтор | `renew-subscription` | LOW | Сверка через `GET /v3/payments` до инкремента |
| N13 | Нет rate limiting на публичных эндпоинтах | `create-payment`, `start-trial`, webhook | LOW | Throttling по user_id/IP |
| N1 | Утёкшие anon JWT в старом коммите `a0a2d70` (удалены в `d2d2833`, но ключ формально валиден) | git-история | LOW | Ротация anon-ключа в Supabase |
| N2 | `.gitignore` не покрывает `.env.production/.development/.test` | — | LOW | Добавить `.env.*`, исключить `!.env.example` |
| N3 | `VITE_ADMIN_EMAILS` в клиентском бандле (UI-only) | — | LOW | Задокументировать как UI-only |
| N11 | CORS `*` на state-changing функциях | trial/cancel/detach | LOW | Ограничить `Allow-Origin` доменом приложения |
| N12 ✅ | `profiles` UPDATE-политика без `WITH CHECK` | RLS | LOW | **✅ ИСПРАВЛЕНО (миграция `0020`).** Политика `profiles_update_own` пересоздана (DROP+CREATE) с `WITH CHECK ((select auth.uid()) = id)`; `USING` сохранён. `profiles_select_own` не тронута. Покрыто `tests/04_wave2_test.sql` (в т.ч. функциональная проверка: смена `id` на чужой блокируется, SQLSTATE 42501). ✅ ПРИМЕНЕНО НА ПРОД 2026-07-10 (проверено на живой схеме: `profiles_update_own` имеет `WITH CHECK (auth.uid()=id)`, `USING` сохранён) |
| N14 | `verify_jwt` не зафиксирован в конфиге для всех функций | `config.toml` | LOW | Явно прописать для всех функций |
| **N15** ✅ | **(новое, 10.07)** RPC `get_users_emails(user_ids uuid[])` — `SECURITY DEFINER`, `EXECUTE` доступен `authenticated` (подтверждено 10.07 на живой схеме: `security_definer=true`, `can_execute=authenticated`, `search_path=public,auth` — зафиксирован, это хорошо). Любой залогиненный юзер может дёргать через `/rest/v1/rpc/get_users_emails` | Postgres function `public.get_users_emails` | **MEDIUM-HIGH** | **✅ ИСПРАВЛЕНО (миграция `0020`, см. ADR 0002).** Проверены ВСЕ вызовы: единственный — `src/pages/AdminPage.tsx:189` из КЛИЕНТА под authenticated-JWT админа (service_role на клиенте нет). Поэтому глобальный REVOKE сломал бы админку → выбран вариант "внутренний admin-гейт": EXECUTE для `authenticated` сохранён, но тело функции требует `public.is_admin_user()` (единый источник истины: `source='seed' AND plan='lifetime'`), иначе `EXCEPTION 'Forbidden: admin only'`. `search_path=public,auth` не тронут. Покрыто `tests/04_wave2_test.sql` (обычный юзер → Forbidden, admin → email). ✅ ПРИМЕНЕНО НА ПРОД 2026-07-10 (проверено на живой схеме: `get_users_emails(uuid[])` — SECURITY DEFINER с admin-гейтом `is_admin_user`, EXECUTE только authenticated, для anon отозван) |
| N16 | `auth_leaked_password_protection` выключена (проверка паролей по HaveIBeenPwned) | Auth settings | LOW | Включить в дашборде Supabase, бесплатно |
| N17 | `pg_net` установлен в схему `public`, а не в отдельную | extensions | LOW | Перенести в отдельную схему |
| N18 | `search_path` не зафиксирован у `tg_payment_methods_touch_updated_at` | triggers | LOW | `SET search_path = public` в определении функции |

### ✅ Уже исправлено ранее — регрессий не обнаружено
GRANT-инцидент 0007→0010-0013; pgTAP-тесты на гранты (dev.6.5.0); webhook на raw-fetch AdminClient (`3f63dc8`); секретов service_role/YooKassa в истории git не обнаружено.

**Рекомендуемый порядок работ (согласован с пользователем 10.07, работа начата):**
1. **Wave 1 — ✅ ЗАВЕРШЁН (10.07.2026):** F1 + F2 + F3 + F4 (один заход, один и тот же файловый контур: `payment-webhook`, `renew-subscription`, `entitlements.ts`)
2. **Wave 2 — ✅ ЗАВЕРШЁН И ПРИМЕНЁН НА ПРОД (10.07.2026, ветка `wave2-fixes` → PR #63, merge `058bfd6`):** **F5** (дубль `renewal_failed`, edge `renew-subscription`) + N4 + N5 (views, утечка PII) + N12 (RLS без WITH CHECK) + **N15** (RPC-утечка email — приоритет как у N4/N5, возможно выше). N4/N5/N12/N15 — миграция Supabase `0020`; F5 — деплой edge-функции (два разных вида применения на прод). ✅ ПРИМЕНЕНО НА ПРОД 2026-07-10: миграция `0020_wave2_security_hardening` применена, edge `renew-subscription` v9 задеплоена — см. "Wave 2 — итог" ниже
3. **Wave 3 (харденинг платежей/инфры):** N8 (подтвердить флаг в проде) + N6 (default privileges) + N9 (сверка суммы) + N10 (идемпотентность)
4. **Wave 4 (мелкий харденинг):** N11 (CORS) + N14 (verify_jwt) + N16/N17/N18 (новые находки от Supabase Advisors) + N13 (rate limiting, оставлен последним — наибольший объём)

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

---

## 6. Незакрытые пункты из прошлых обсуждений — не забыть перед v1.0.0

Собрано из мастер-плана 06.07 и обновлённого roadmap 08.07 — то, что явно обсуждалось как "надо сделать", но по git-истории либо не сделано, либо статус неясен:

1. **Подтвердить полный E2E-тест реального автосписания.** В roadmap от 08.07 стоял открытый вопрос — "провели ли вы уже полный цикл реального списания, или только привязку карты". **Теперь у этого вопроса есть техническое объяснение: если тест и проводился, он не мог пройти из-за F1.** Стоит проверить `renewal_attempts_log` за последние дни на записи `payment_method_inactive`.
2. **Telegram-бот (dev.7)** — по git-истории работа не начата ни одним коммитом. Решить: в v1.0.0 или переносим в v1.1.
3. **SberPay recurring** — ждём активации от ЮKassa (внешняя зависимость, не блокер).
4. **Merge `develop` → `main`** + первый не-pre-release GitHub Release — ещё не сделано.
5. **Решить по тегам dev.6.5-dev.6.10** — ретегировать задним числом важные вехи или сразу готовиться к v1.0.0 без промежуточных релизов.
6. **Явно перепроверить старый чек-лист "перед первым реальным платежом"** из плана 06.07 — часть пунктов помечена закрытой (магазин live, автосписания активны), но стоит подтвердить руками (не проверяется по коду, только по продовым настройкам):
   - `YOOKASSA_SKIP_IP_CHECK` выключен в проде (было `true` для тестов через ngrok)
   - webhook доступен извне и обрабатывает все нужные события в кабинете ЮKassa
   - первый реальный платёж сверен в личном кабинете ЮKassa / чек в ФНС
7. **Rewrite `SupportBlock` для CloudTips (крипта)** — сознательно отложено в прошлой сессии как неблокирующее; статические ссылки (`VITE_PAY_CLOUDTIPS_URL`, TON, USDT) не дают автоматического entitlement — это принятое решение, но стоит держать в уме, что оплата через них не активирует Pro автоматически.
8. **Обновление `/privacy.html` на продовом лендинге** — отдельный коммит с редиректом, отмечен как отложенный, статус по лендинг-репозиторию (`taskflow-landing`) в этом аудите не проверялся (аудит фокусировался на `taskflow-app`).

---

## 7. Что этот аудит покрыл, а что нет

**Покрыто:**
- Полная карта архитектуры и точек интеграции сервисов (раздел 2), с точными код-локейшнами.
- Регрессионная проверка **конкретно** для 4 известных багов синхронизации из dev.6.10.0 (раздел 4) — не сломались.
- Целевой аудит безопасности и платежей: секреты, RLS/GRANT, вебхуки, идемпотентность, авторизация (раздел 5).
- Каталог скрытых межмодульных связей (раздел 3) — целенаправленный поиск "мест, где легко забыть про вторую половину изменения", по аналогии со случаем statuses/tags.
- Точечная проверка по коду (не по документации) трёх решений из дизайн-дока dev.6.5: письма при recurring (частично не хватает одной ветки), reactivate-toggle (работает, но блокируется F1), update-card за 1₽ (работает целиком).

**НЕ покрыто — это отдельная большая задача, если нужна:**
Полный построчный аудит **каждой** фичи (канбан, календарь, шаблоны, импорт/экспорт, онбординг, кастомные темы и т.д.) на соответствие тому поведению, которое изначально задумывалось — а не только "фича существует и код на месте". Сделанные аудиты целенаправленно проверяли известные проблемные зоны (sync, платежи, безопасность) и искали скрытые связи, а не сверяли весь функционал построчно со спецификацией. Если нужен такой полный функциональный аудит — это отдельный объёмный проход (по сути, сквозной QA каждого экрана/флоу против исходного замысла), который стоит делать отдельным заходом, а не как часть текущего.

---

## Приложение А. Полная таблица миграций Supabase (0001-0020)

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

## С. Architecture Decision Records (ADR) — как и где ведём

**Решение:** ADR живут в самом репозитории (`docs/adr/000N-title.md`, один файл на решение, нумерация сквозная), а не в роадмапе. в этом файле — только короткий индекс-таблица со ссылками.

**Почему в репозитории, а не в roadmap:**
- ADR описывает решение про код — логично, чтобы он версионировался вместе с кодом (git blame, PR-история, теги), а не в отдельном внешнем документе в Space.
- Когда ты (или будущий кодинг-субагент) открываете репозиторий годами спустя — `docs/adr/` будет на месте автоматически, без необходимости сначала искать внешний roadmap.
- Roadmap остаётся тем, для чего и создавался — статус/история/связи, без разбухания полными телстами решений.

**Формат одного ADR-файла:** заголовок + статус (proposed/accepted/superseded) + контекст + решение + последствия. Пример первых кандидатов, когда дойдём до Wave-фиксов: «выбрали `payment_methods.external_id` как единственный источник истины для токена ЮKassa, `payment_method_id` — только FK», «удалили/оставили `renewal_attempts` в пользу `renewal_attempts_count`».

**Индекс ADR** _(заполняется по ходу работы, ссылки на файлы в репозитории)_:

| # | Решение | файл |
|---|---|---|
| 0001 | F1: `payment_methods.external_id` — единственный источник истины для токена ЮKassa, `payment_method_id` — только FK на внутренний uuid. Фикс смержён и задейплоен (PR #61, `renew-subscription` v8, `payment-webhook` v23), но **сам ADR-файл в `docs/adr/` ещё не создан** — следующий шаг | `docs/adr/0001-payment-method-id-vs-external-id.md` (планируется, пока отсутствует) |
| — | удалили/оставили `renewal_attempts` в пользу `renewal_attempts_count` (F2) — решение ещё не принято, фронт-часть не деплоилась | тбд |

---

## Приложение Б. Источники этого документа
- Полная git-история, теги, GitHub Releases/Secrets/Variables/Workflows — [репозиторий](https://github.com/danny-swan/taskflow-app)
- Архитектурный аудит + sync-регрессия — кодинг-субагент, HEAD `f764e23`
- Аудит безопасности и платежей — кодинг-субагент, HEAD `f764e23`
- ERD/data dictionary — напрямую из живой схемы Supabase (`list_tables`, `list_migrations`, `generate_typescript_types`, `get_advisors`) 10.07.2026 — см. `taskflow_erd_data_dictionary.md`
- Углублённый аудит: код-локейшны фич + каталог критических связей + проверка Q3/Q5/Q6 по коду — кодинг-субагент, HEAD `f764e23`
- Мастер-план и roadmap v1.0.0 — файлы Space "Programming" (`taskflow_v0.9.35_master_plan.md`, `taskflow_v1.0.0_roadmap.md`, `taskflow_v0.9.35_dev6.5_design.md`)
- Заметки прошлых сессий — память (Supabase setup, Resend SMTP, Sentry, домен)
