# TaskFlow — ERD и Data Dictionary (живой документ)

> Сгенерировано напрямую из живой схемы Supabase-проекта `taskflow` (`sejpmzrmtgcvevukggkx`, PostgreSQL 17.6, eu-central-1) — не из миграций и не из памяти.
> Дата снимка: 10.07.2026 (базовый); **дополнено вручную 11.07.2026** секцией `rate_limits` и историей миграций по Wave 3/4 (0021–0024) — эти правки внесены по факту миграций, без полной регенерации из живой схемы. Число строк по таблицам — снимок на 10.07, не поддерживается автоматически.
> **Версия схемы / последняя миграция: `0024_wave4_rate_limits`** (Wave 4 PR-B, rate limiting — ПРИМЕНЕНА НА ПРОД 2026-07-11). На проде применён полный набор `0001`–`0024`.
> **Правило обновления:** после каждой миграции/изменения схемы — перегенерировать этот файл (```list_tables(verbose=true)``` + ```generate_typescript_types``` через Supabase-коннектор), не редактировать вручную "по памяти".

Компаньон-файл с точными TypeScript-типами (авто-сгенерирован, 1:1 со схемой): `taskflow_schema_types.ts` — использовать в коде вместо ручных интерфейсов, чтобы фронт/эджи не расходились с реальной БД (это и есть корень багов F1-F3).

---

## 1. ER-диаграмма

```mermaid
erDiagram
    auth_users ||--|| profiles : "id = id"
    auth_users ||--o{ sync_devices : "user_id"
    auth_users ||--o{ sync_statuses : "user_id"
    auth_users ||--o{ sync_tags : "user_id"
    auth_users ||--o{ sync_tasks : "user_id"
    auth_users ||--o{ sync_task_templates : "user_id"
    auth_users ||--o{ sync_settings : "user_id"
    auth_users ||--o{ sync_overdue_events : "user_id"
    auth_users ||--o{ usage_events : "user_id (nullable)"
    auth_users ||--|| user_entitlements : "user_id (PK)"
    auth_users ||--o{ activation_requests : "user_id"
    auth_users ||--o{ payment_events : "user_id (nullable)"
    auth_users ||--o{ payment_methods : "user_id"
    auth_users ||--o{ renewal_attempts_log : "user_id"

    sync_devices ||--o{ sync_statuses : "client_id"
    sync_devices ||--o{ sync_tags : "client_id"
    sync_devices ||--o{ sync_tasks : "client_id"
    sync_devices ||--o{ sync_task_templates : "client_id"
    sync_devices ||--o{ sync_settings : "client_id"
    sync_devices ||--o{ sync_overdue_events : "client_id"

    payment_methods ||--o{ user_entitlements : "payment_method_id (FK, HIGH-RISK — см. F1)"
    payment_methods ||--o{ renewal_attempts_log : "payment_method_id"

    sync_tasks ..o{ sync_statuses : "status_id — НЕ FK, только по коду"
    sync_tasks ..o{ sync_tags : "tag_id — НЕ FK, только по коду"
    sync_task_templates ..o{ sync_statuses : "status_id — НЕ FK"
    sync_task_templates ..o{ sync_tags : "tag_id — НЕ FK"
    sync_overdue_events ..o{ sync_tasks : "task_id — НЕ FK"
```

> **`rate_limits`** (Wave 4, N13) намеренно **не связана** ни с `auth.users`, ни с другими таблицами — это серверный счётчик частоты запросов с текстовым ключом (`user:<id>:<endpoint>` / `ip:<addr>:<endpoint>`), не бизнес-сущность. Поэтому в ER-диаграмме её нет; описание — в разделе «Инфраструктура: rate limiting» ниже.

**Важно про пунктирные связи (`..o{`):** `status_id`, `tag_id`, `task_id` — это soft-references. На уровне Postgres FK-constraint отсутствует (проверено по `list_tables` — в constraints их нет). Целостность держится только на коде клиента/edge-функций. Это ещё один пункт в "критические взаимосвязи" — при рефакторинге синка легко создать сироту (task с несуществующим status_id), и БД это не поймает, только приложение (см. `DeferRowError` в dev.6.10.3).

---

## 2. Домен: Auth & Identity

### `profiles`
Расширение `auth.users` публичными данными. 1:1 с auth.users.

| Колонка | Тип | Null | Default | Комментарий |
|---|---|---|---|---|
| id | uuid (PK) | нет | — | = auth.users.id |
| email | text | нет | — | |
| metadata | jsonb | да | `{}` | свободная форма — **сюда логично лягут будущие поля профиля** (ник, фото, "о себе") при кастомизации пользователей |
| created_at / updated_at | timestamptz | нет | now() | |

RLS: включён. Политики: `profiles_select_own` (SELECT, `USING auth.uid()=id`), `profiles_update_own` (UPDATE, `USING auth.uid()=id` **+ `WITH CHECK (auth.uid()=id)`**). **N12 ✅ ИСПРАВЛЕНО** (миграция `0020`, применено на прод 2026-07-10): `WITH CHECK` добавлен — сменить `id` на чужой больше нельзя. INSERT/DELETE не выдаются (строки создаёт триггер на `auth.users`, удаляет каскад).

---

## 3. Домен: Sync (local-first, multi-device)

Общий паттерн всех `sync_*`-таблиц: `client_id → sync_devices.id`, `version` (optimistic concurrency), `deleted_at` (soft-delete/tombstone), `user_id` (RLS scope).

### `sync_devices`
| Колонка | Тип | Null | Default |
|---|---|---|---|
| id (PK) | text | нет | — генерируется на клиенте |
| user_id | uuid → auth.users | нет | |
| name, platform, app_version | text | да | |
| last_seen_at | timestamptz | нет | now() |

### `sync_statuses`
| Колонка | Тип | Default | Заметка |
|---|---|---|---|
| id (PK) | text | | |
| user_id | uuid → auth.users | | |
| name, color | text | | |
| behavior | text | `'middle'` | влияет на поведение канбана (первый/средний/последний статус) |
| sort_order | int4 | 0 | |
| is_seed, is_technical, hidden, default_collapsed | bool | false | |
| version | int4 | 1 | оптимистичная блокировка синка |
| client_id | text → sync_devices.id | null | какое устройство внесло последнее изменение |
| deleted_at | timestamptz | null | tombstone |

### `sync_tags`
Структурно идентичен `sync_statuses` (id, user_id, name, color, sort_order, version, client_id, deleted_at).

### `sync_tasks`
| Колонка | Тип | Default | Заметка |
|---|---|---|---|
| id (PK) | text | | |
| user_id | uuid → auth.users | | |
| title | text | | |
| comment | text | `''` | |
| status_id | text | null | **soft-ref**, не FK |
| tag_id | text | null | **soft-ref**, не FK |
| start_date, deadline, finish_date | date | null | `deadline` — источник `sync_overdue_events` |
| sort_order | int4 | 0 | |
| archived | bool | false | |
| version | int4 | 1 | |
| client_id | text → sync_devices.id | null | |
| deleted_at | timestamptz | null | |

### `sync_task_templates`
Как `sync_tasks`, но без дат (`start_date/deadline/finish_date`) и без `archived`; плюс `name` (имя шаблона, отдельно от `title` задачи).

### `sync_settings`
PK составной — **`(user_id, key)`**, а не отдельный `id`. Простая key-value модель (`value: text`). Только те настройки, что должны шариться между устройствами.

### `sync_overdue_events`
Append-only лог пересечений дедлайна (для графика на дашборде). `task_id` — soft-ref на `sync_tasks.id` (не FK). Immutable по смыслу (нет `updated_at`/`version`).

---

## 4. Домен: Платежи и права доступа

**RLS (кратко):** own-строка на чтение для `authenticated` (`user_entitlements_select_own`, `payment_methods_select`, `payment_events_select_own`, `renewal_log_select`); запись только `service_role` через Edge Functions. Админ-доступ ко всем строкам — через политики `admin_select_all_entitlements` / `admin_select_all_payment_events` / `admin_select_all_renewal_log` с предикатом `is_admin_user()` (SECURITY DEFINER STABLE; критерий `source='seed' AND plan='lifetime'`). `activation_requests` — `insert_own` (WITH CHECK own) + `select_own`.

### `user_entitlements` — самая критичная таблица проекта
PK = `user_id` (1:1 с пользователем, не история).

| Колонка | Тип | Default | ⚠️ Заметка |
|---|---|---|---|
| plan | enum `plan_kind` (free/trial/pro/lifetime) | `free` | |
| valid_until | timestamptz | null | |
| source | enum `entitlement_source` (admin/trial/manual/yookassa/cloudpayments/crypto/seed) | `trial` | |
| trial_used | bool | false | |
| auto_renew | bool | false | |
| cancel_at_period_end | bool | false | |
| next_renewal_at | timestamptz | null | связан с частичным индексом `idx_entitlements_next_renewal` — см. п.8 критических связей в roadmap |
| **payment_method_id** | **uuid → `payment_methods.id`** | null | **F1: это FK на внутренний uuid.** Код `renew-subscription` исторически трактовал это поле как внешний токен ЮKassa (`external_id`) — отсюда сломанное автопродление |
| **renewal_attempts** | int4 | 0 | **устаревшая колонка (0014).** Оставлена в схеме, но живая логика пишет в `renewal_attempts_count` (0016) → рассинхрон = F2 |
| **renewal_attempts_count** | int4 | 0 | актуальная колонка, комментарий в БД: "Number of consecutive renewal failures. Reset to 0 on success" |
| last_renewal_attempt_at | timestamptz | null | используется cron-окном `ATTEMPT_WINDOW_HOURS` |
| last_payment_id | text | null | id платежа ЮKassa (последний успешный) |
| last_payment_at | timestamptz | null | |

**Обе "старая/новая" колонки (`renewal_attempts` vs `_count`) физически существуют в БД одновременно** — это подтверждает F2 напрямую по живой схеме, а не только по коду.

### `payment_methods`
| Колонка | Тип | Default | ⚠️ Заметка |
|---|---|---|---|
| id (PK) | uuid | gen_random_uuid() | это и есть тот uuid, который неверно трактуется как external_id в F1 |
| external_id | text | | **настоящий** токен способа оплаты в ЮKassa |
| provider | text | `'yookassa'` | |
| method_type | text | `'bank_card'` | bank_card / sber_pay / sbp / t_pay / yoo_money и т.д. |
| **card_brand** | text | null | **устаревшая колонка (0014)** |
| **card_type** | text | null | актуальная (0016), БД-комментарий: "Card network: Visa, MasterCard, Mir, etc." — рассинхрон с `card_brand` = F3 |
| **card_first6** | text | null | актуальная (0016), BIN |
| card_last4 | text | null | CHECK: ровно 4 символа |
| card_expiry_month/year | int4 | null | CHECK на диапазон |
| is_active | bool | true | |
| saved_at | timestamptz | now() | БД-комментарий: "UI alias; mirrors created_at for new rows" |

### `payment_events` — сырой лог вебхуков
`provider`, `external_id` (id платежа у провайдера), `raw_payload` (jsonb, весь вебхук целиком), `signature_valid`, `processed_at`, `error`. Append-only, `user_id` nullable (не все вебхуки успевают резолвить юзера).

### `activation_requests` — ручная активация (CloudTips/крипта)
`tx_ref`, `plan_requested` (enum `plan_kind`: free/trial/pro/lifetime), `provider_hint`, `status` (enum `activation_status`: pending/approved/rejected), `admin_notes`, `notified_at` (идемпотентный флаг отправки уведомления админу).

### `renewal_attempts_log` — append-only аудит автопродлений
`attempt_number` (CHECK 1..10), `status` (CHECK: succeeded/canceled/error), `payment_method_id` (FK), `yookassa_payment_id`, `error_code/message`. **Это таблица, по которой можно проверить открытый вопрос из roadmap п.6.1** — искать `error_code = payment_method_inactive` за последние дни, чтобы понять, сколько юзеров уже пострадало от F1.

---

## 5. Телеметрия

### `usage_events`
`event_type`, `app_version`, `os`, `os_version`, `metadata` (jsonb). `user_id` nullable — события могут прилетать до логина.

---

## 5a. Инфраструктура: rate limiting (Wave 4, N13)

### `rate_limits` — серверный счётчик частоты запросов
Добавлена миграцией `0024_wave4_rate_limits` (ПРИМЕНЕНА НА ПРОД 2026-07-11). Не бизнес-сущность и не связана FK ни с одной таблицей — общий счётчик fixed-window для stateless многоинстансных edge-функций. См. ADR 0004.

| Колонка | Тип | Null | Default | Комментарий |
|---|---|---|---|---|
| key | text (PK) | нет | — | ключ бакета: `user:<uuid>:<endpoint>` или `ip:<addr>:<endpoint>` |
| window_start | timestamptz | нет | now() | начало текущего окна (fixed window) |
| count | integer | нет | 0 | число запросов в окне; RPC инкрементит атомарно |
| expires_at | timestamptz | нет | — | конец окна; cron удаляет строки с `expires_at < now()` |

**Индекс:** `idx_rate_limits_expires_at` на `(expires_at)` — под cleanup-DELETE.

**RLS/привилегии:** RLS включён **без политик** (deny-by-default) + явный `REVOKE ALL FROM anon, authenticated`. `GRANT SELECT/INSERT/UPDATE/DELETE` только `service_role`. Таблица чисто серверная — клиенты к ней не ходят.

**RPC `check_rate_limit(p_key text, p_max_requests integer, p_window_seconds integer)`** → `TABLE(allowed boolean, retry_after integer)`. Единственная точка входа для edge-функций. `SECURITY DEFINER` + `SET search_path = public, pg_temp` (N18), `EXECUTE` только `service_role`. Один UPSERT `INSERT ... ON CONFLICT (key) DO UPDATE` под row-lock делает логику окна атомарно (нет строки → count=1; окно истекло → сброс; окно активно → count+1). При превышении возвращает `allowed=false` + `retry_after` (секунды).

**Cleanup:** cron-job `rate-limits-cleanup` (`*/5 * * * *`, pg_cron) — `DELETE ... WHERE expires_at < now()`. Создаётся идемпотентно (unschedule+schedule) с двухшаговым guard по pg_cron (как в 0015).

**Использование (edge, после auth):** `create-payment` v18 (user 10/60s + IP 30/60s), `start-trial` v10 (user 3/3600s + IP 5/3600s), `payment-webhook` v26 (IP 60/60s, после валидации payload до dual-verify). fail-open by design: сбой RPC → запрос пропускается.

---

## 6. Views (после Wave 2 — `security_invoker=on`)

Обе view после миграции `0020` (применена на прод 2026-07-10) имеют `reloptions security_invoker=on` (исполняются с правами вызывающего, т.е. под его RLS) **и** `REVOKE ALL FROM anon, authenticated` (прямого `SELECT` через PostgREST у обычных ролей нет).

| View | Колонки | Статус (Wave 2) |
|---|---|---|
| `admin_users_summary` | id, email, registered_at, last_sign_in_at, sessions_count, tasks_created_count, latest_app_version, latest_os | **N4 ✅ ИСПРАВЛЕНО** — `security_invoker=on`, SELECT для anon/authenticated отозван (подтверждено на живой схеме 2026-07-10). Тело view не менялось |
| `sync_status_summary` | user_id, active_tasks, deleted_tasks, active_statuses, active_tags, devices_count, last_device_seen_at, last_change_at | **N5 ✅ ИСПРАВЛЕНО** — `security_invoker=on`, SELECT для authenticated отозван (подтверждено на живой схеме 2026-07-10) |

---

## 7. RPC-функции (Functions), доступные из клиента

Состояние на живой схеме после миграции `0020` (Wave 2, применена на прод 2026-07-10):

| Функция | SECURITY DEFINER | Кто может вызвать | Статус / защита |
|---|---|---|---|
| `get_users_emails(user_ids uuid[])` | ✅ да (volatile, `search_path=public,auth`) | `EXECUTE` только `authenticated` (для `anon`/`PUBLIC` отозван) | **N15 ✅ ИСПРАВЛЕНО** (миграция `0020`, см. ADR 0002): тело функции требует `public.is_admin_user()` — иначе `EXCEPTION 'Forbidden: admin only'`; без сессии → `'Not authenticated'`. Затем `SELECT id,email FROM auth.users WHERE id=ANY(user_ids)`. Единственный вызов — `src/pages/AdminPage.tsx` под authenticated-JWT админа, поэтому выбран внутренний admin-гейт, а не глобальный REVOKE |
| `is_admin_user()` | ✅ да, **STABLE** | `authenticated` через `/rest/v1/rpc/is_admin_user` | Ожидаемо (юзер должен уметь спросить "я админ?"). Логика: `EXISTS(SELECT 1 FROM user_entitlements WHERE user_id=auth.uid() AND source='seed' AND plan='lifetime')`. Единый источник истины admin-проверки (используется и в admin-RLS-политиках, и в гейте `get_users_emails`) |

**Итог Wave 2:** RPC-утечка email закрыта — обычный залогиненный юзер получает `Forbidden: admin only`, доступ к email имеет только админ (подтверждено на живой схеме 2026-07-10 и pgTAP-тестом `tests/04_wave2_test.sql`).

Дополнительно замечено линтером (статус после Wave 4, 2026-07-11):
- `function_search_path_mutable` — **N18 ✅ ИСПРАВЛЕНО** (миграция `0022`, на проде 2026-07-11): `SET search_path` зафиксирован у public-функций без явного search_path (в т.ч. `tg_payment_methods_touch_updated_at`).
- `extension_in_public` — **N17 🟡 ЧАСТИЧНО** (миграция `0023`, на проде 2026-07-11): идемпотентная попытка `ALTER EXTENSION pg_net SET SCHEMA extensions` не состоялась (non-relocatable) — на проде pg_net **остался в `public`**. Риска нет (вызываемый API в схеме `net`), но отклонение от идеала — known-limitation.
- `auth_leaked_password_protection` — **N16 🟡 PENDING** (Wave 4): код/конфиг готовы + ops-гайд `docs/ops/supabase-auth-hardening.md`, но тумблер включается ВРУЧНУЮ в Supabase Dashboard (Auth → Providers → Email); на 2026-07-11 ещё не включён.

---

## 8. Enums

На живой схеме (0020) — три USER-DEFINED enum:

| Enum | Значения | Использование |
|---|---|---|
| `plan_kind` | free, trial, pro, lifetime | `user_entitlements.plan`, `activation_requests.plan_requested` |
| `entitlement_source` | admin, trial, manual, yookassa, cloudpayments, crypto, seed | `user_entitlements.source` |
| `activation_status` | pending, approved, rejected | `activation_requests.status` |

---

## 9. Активные расширения (реально установлены, не просто доступны)

| Extension | Schema | Версия | Назначение |
|---|---|---|---|
| pg_cron | pg_catalog | 1.6.4 | планировщик — на нём висит `renew-subscription` cron |
| pg_net | public ⚠️ | 0.20.3 | async HTTP из БД. **N17 🟡:** миграция `0023` (Wave 4) пыталась перенести в схему `extensions`, но перенос не состоялся (non-relocatable) — на проде осталось в `public`. Вызываемый API живёт в схеме `net` (не трогали) |
| pgcrypto | extensions | 1.3 | криптофункции |
| uuid-ossp | extensions | 1.1 | генерация uuid (`gen_random_uuid()` использует его косвенно) |
| supabase_vault | vault | 0.3.1 | секреты |
| pg_stat_statements | extensions | 1.11 | мониторинг запросов |
| plpgsql | pg_catalog | 1.0 | язык функций/триггеров |

---

## 10. История миграций (по факту на проде — полный набор `0001`–`0024`)

| Версия (timestamp) | Название |
|---|---|
| 20260705214859 | sync_schema |
| 20260705214948 | harden_functions |
| 20260705215049 | optimize_rls_and_indexes |
| 20260706090719 | server_updated_at_triggers |
| 20260706100448 | 0006_realtime_overdue |
| 20260706112652 | 0007_entitlements |
| 20260706120708 | activation_notified_at |
| 20260707105757 | grant_service_role_on_payment_tables |
| 20260707111709 | grant_authenticated_select_on_entitlements |
| 20260707115150 | grant_authenticated_on_sync_and_profiles |
| 20260707115151 | revoke_execute_on_trigger_functions |
| 20260707140740 | payment_methods_and_recurring |
| 20260707175629 | 0016_schema_code_alignment — **добавил `renewal_attempts_count`/`card_type`/`card_first6` без удаления старых колонок → корень F1-F3** |
| 20260707184130 | 0017_admin_rpc |
| 20260708134841 | pg_cron_renew_subscription |
| 20260708141740 | 0019_cron_new_apikey_auth |
| 0020 (применена на прод 2026-07-10) | 0020_wave2_security_hardening — **Wave 2:** `security_invoker=on` + REVOKE на view `admin_users_summary`/`sync_status_summary` (N4/N5); `WITH CHECK` для `profiles_update_own` (N12); admin-гейт `is_admin_user()` в `get_users_emails` (N15, см. ADR 0002) |
| 0021 (применена на прод 2026-07-10) | 0021_revoke_default_privileges_footgun — **Wave 3:** N6 — откат `ALTER DEFAULT PRIVILEGES` из 0010/0011; будущие таблицы больше не получают a/r/w автоматически |
| 0022 (применена на прод 2026-07-11) | 0022_wave4_fix_function_search_paths — **Wave 4 PR-A:** N18 — фиксация `SET search_path` у public-функций без явного search_path |
| 0023 (применена на прод 2026-07-11, частично) | 0023_wave4_move_pg_net — **Wave 4 PR-A:** N17 — попытка переноса pg_net в схему `extensions`; на проде осталось в `public` (non-relocatable, known-limitation) |
| 0024 (применена на прод 2026-07-11) | 0024_wave4_rate_limits — **Wave 4 PR-B:** N13 — таблица `rate_limits` + RPC `check_rate_limit` + cron `rate-limits-cleanup`; RLS deny-by-default (см. ADR 0004, раздел 5a). Применена в 2 части (pg_cron уже установлен) |

---

## 11. Как использовать этот файл при добавлении новых фич

Перед тем как проектировать что-то новое (например, общие пространства/friends из следующего этапа):
1. Смотри сюда, а не в память/старые заметки — этот файл генерируется из живой БД.
2. Ищи, куда новая сущность встраивается в существующие связи (особенно `user_id`-scoped RLS-паттерн — он будет ломаться первым при переходе к "общим" данным).
3. После любой миграции — перегенерируй файл тем же способом (Supabase MCP: `list_tables(verbose=true)` + `generate_typescript_types`), обновление делать через `edit`, не переписывать весь файл с нуля.
