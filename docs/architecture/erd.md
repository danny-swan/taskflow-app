# TaskFlow — ERD и Data Dictionary (живой документ)

> Сгенерировано напрямую из живой схемы Supabase-проекта `taskflow` (`sejpmzrmtgcvevukggkx`, PostgreSQL 17.6, eu-central-1) — не из миграций и не из памяти.
> Дата снимка: 10.07.2026. Число строк по таблицам — снимок на эту дату, не поддерживается автоматически.
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

RLS: включён. **N12 (открытая уязвимость):** UPDATE-политика без `WITH CHECK` — см. security-таблицу в roadmap.

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
`tx_ref`, `plan_requested` (enum: monthly/annual/lifetime), `provider_hint`, `status` (pending/approved/rejected), `admin_notes`, `notified_at` (идемпотентный флаг отправки уведомления админу).

### `renewal_attempts_log` — append-only аудит автопродлений
`attempt_number` (CHECK 1..10), `status` (CHECK: succeeded/canceled/error), `payment_method_id` (FK), `yookassa_payment_id`, `error_code/message`. **Это таблица, по которой можно проверить открытый вопрос из roadmap п.6.1** — искать `error_code = payment_method_inactive` за последние дни, чтобы понять, сколько юзеров уже пострадало от F1.

---

## 5. Телеметрия

### `usage_events`
`event_type`, `app_version`, `os`, `os_version`, `metadata` (jsonb). `user_id` nullable — события могут прилетать до логина.

---

## 6. Views (замаскированные под таблицы — обе требуют внимания по RLS)

| View | Колонки | Риск |
|---|---|---|
| `admin_users_summary` | email, id, last_sign_in_at, latest_app_version, latest_os, registered_at, sessions_count, tasks_created_count | **N4** — без `security_invoker`, потенциальная утечка email всех юзеров кому угодно с доступом к view |
| `sync_status_summary` | user_id, active_statuses/tags/tasks, deleted_tasks, devices_count, last_change_at, last_device_seen_at | **N5** — аналогично, кросс-пользовательские метрики |

---

## 7. RPC-функции (Functions), доступные из клиента — 🔴 новая находка

Проверено напрямую через Supabase Advisors (`get_advisors`, security) 10.07.2026 — этого не было в предыдущем аудите:

| Функция | SECURITY DEFINER | Кто может вызвать | Риск |
|---|---|---|---|
| `get_users_emails(user_ids uuid[])` | ✅ да | **любой `authenticated`** через `/rest/v1/rpc/get_users_emails` | 🔴 **потенциальная утечка email по произвольным user_id** — это тот же класс проблемы, что и N4, но хуже: N4/N5 — views без явного запрета, а тут прямой RPC, который вообще не должен быть доступен обычным юзерам. Нужно проверить: используется ли это только из admin-контекста, и если да — сделать `REVOKE EXECUTE FROM authenticated` + grant только service_role/явной admin-проверке внутри |
| `is_admin_user()` | ✅ да | `authenticated` через `/rest/v1/rpc/is_admin_user` | Ожидаемо (юзер должен уметь спросить "я админ?"), но подтверждает пункт 6 из "критических связей" в roadmap — это ещё одно из 4 мест, где живёт admin-логика |

**Рекомендация:** добавить как отдельную позицию в security-таблицу roadmap (кандидат N15) — приоритет как у N4/N5, возможно выше, т.к. RPC не имеет даже теоретического where-фильтра, который есть у view.

Дополнительно замечено линтером (не критично, но стоит знать):
- `function_search_path_mutable` — у `tg_payment_methods_touch_updated_at` не зафиксирован `search_path` (та же категория риска, что и вокруг GRANT-инцидентов).
- `extension_in_public` — `pg_net` установлен в схему `public`, а не в отдельную.
- `auth_leaked_password_protection` выключена (проверка паролей по HaveIBeenPwned) — быстро включить в Auth-настройках, бесплатно и без риска.

---

## 8. Enums

| Enum | Значения |
|---|---|
| `plan_kind` | free, trial, pro, lifetime |
| `entitlement_source` | admin, trial, manual, yookassa, cloudpayments, crypto, seed |
| `activation_status` | pending, approved, rejected |
| `plan_requested_kind` | monthly, annual, lifetime |

---

## 9. Активные расширения (реально установлены, не просто доступны)

| Extension | Schema | Версия | Назначение |
|---|---|---|---|
| pg_cron | pg_catalog | 1.6.4 | планировщик — на нём висит `renew-subscription` cron |
| pg_net | public ⚠️ | 0.20.3 | async HTTP из БД — см. finding выше про public-схему |
| pgcrypto | extensions | 1.3 | криптофункции |
| uuid-ossp | extensions | 1.1 | генерация uuid (`gen_random_uuid()` использует его косвенно) |
| supabase_vault | vault | 0.3.1 | секреты |
| pg_stat_statements | extensions | 1.11 | мониторинг запросов |
| plpgsql | pg_catalog | 1.0 | язык функций/триггеров |

---

## 10. История миграций (по факту в БД, 16 применённых)

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

---

## 11. Как использовать этот файл при добавлении новых фич

Перед тем как проектировать что-то новое (например, общие пространства/friends из следующего этапа):
1. Смотри сюда, а не в память/старые заметки — этот файл генерируется из живой БД.
2. Ищи, куда новая сущность встраивается в существующие связи (особенно `user_id`-scoped RLS-паттерн — он будет ломаться первым при переходе к "общим" данным).
3. После любой миграции — перегенерируй файл тем же способом (Supabase MCP: `list_tables(verbose=true)` + `generate_typescript_types`), обновление делать через `edit`, не переписывать весь файл с нуля.
