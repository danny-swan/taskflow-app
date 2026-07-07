# TaskFlow v0.9.35-dev.6.4.4 — Sync GRANT'ы + REVOKE trigger funcs + deploy start-trial/activation-notify

## TL;DR

Полный аудит регрессий dev.1–dev.6.4.3 выявил, что **весь sync полностью сломан на сервере** ровно по той же причине, что была с `user_entitlements` в dev.6.4.3: миграции `0001_init` и `0002_sync_schema` создали таблицы + RLS policies, но не выдали `GRANT`'ы. Плюс 4 триггерные функции доступны через REST, что ловит Security Advisor. Плюс `start-trial` и `activation-notify` были только в репо, не задеплоены в prod.

Этот релиз всё это чинит одним батчем.

## Что было сломано

### 🔴 Critical — sync полностью сломан

От имени `authenticated` через `SET LOCAL ROLE authenticated`:

```
ERROR: 42501: permission denied for table sync_tasks
HINT:  GRANT SELECT ON public.sync_tasks TO authenticated;
```

Проверка `has_table_privilege('authenticated', 'public.<t>', 'SELECT')` до миграции 0012:

| Таблица | authenticated SELECT | service_role SELECT | RLS |
|---|---|---|---|
| profiles | ❌ | ❌ | ✅ |
| sync_tasks | ❌ | ❌ | ✅ |
| sync_settings | ❌ | ❌ | ✅ |
| sync_statuses | ❌ | ❌ | ✅ |
| sync_tags | ❌ | ❌ | ✅ |
| sync_task_templates | ❌ | ❌ | ✅ |
| sync_devices | ❌ | ❌ | ✅ |
| sync_overdue_events | ❌ | ❌ | ✅ |

RLS policies корректные (`auth.uid() = user_id`, WITH CHECK на месте), но PostgREST отклонял запросы ещё до применения policy — как и с `user_entitlements` в dev.6.4.3. Именно поэтому «неиспользуемых индексов» на sync_* столько (24 штуки в Performance Advisor) — по ним ни разу не прошёл ни один запрос.

### 🟡 WARN — 4 триггерные функции доступны через REST

- `set_updated_at` — SECURITY DEFINER, EXECUTE открыт для `anon`/`authenticated`
- `set_user_entitlements_updated_at` — то же
- `sync_bump_updated_at` — не SECURITY DEFINER, но всё равно нет причины давать REST-доступ
- `sync_bump_version` — то же

Security Advisor ловил только первые две (из-за SECURITY DEFINER), но правильнее закрыть все четыре.

### 🟠 Deploy gap — start-trial и activation-notify не в prod

Функции есть в `supabase/functions/` (написаны в dev.6), но никогда не деплоились в prod. Значит:
- Free-юзер, нажимая «Пробный период 14 дней» → 404 от Edge Functions.
- Заявка на активацию Lifetime (Yookassa off, оплата вручную) → INSERT в `activation_requests` уходит, но Database Webhook, если бы он был настроен, звал бы отсутствующую функцию.

## Root cause (единая для всех sync + entitlements)

Supabase Dashboard при создании таблицы через UI автоматически добавляет `ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES TO authenticated`. Все миграции dev.1–dev.6 применялись через SQL Editor + Management API — этот default НЕ срабатывает. Без явных `GRANT` PostgREST возвращает 42501 до RLS.

Правило теперь фиксируем в `docs/migrations.md` и защищаем pgTAP-тестами в dev.6.5.

## Fix (миграции 0012, 0013 + deploy)

### Migration 0012 — GRANT'ы

```sql
GRANT SELECT, UPDATE                        ON TABLE public.profiles           TO authenticated;
GRANT ALL                                   ON TABLE public.profiles           TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_tasks          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_settings       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_statuses       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_tags           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_task_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_devices        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_overdue_events TO authenticated;

GRANT ALL ON TABLE public.sync_tasks           TO service_role;
GRANT ALL ON TABLE public.sync_settings        TO service_role;
GRANT ALL ON TABLE public.sync_statuses        TO service_role;
GRANT ALL ON TABLE public.sync_tags            TO service_role;
GRANT ALL ON TABLE public.sync_task_templates  TO service_role;
GRANT ALL ON TABLE public.sync_devices         TO service_role;
GRANT ALL ON TABLE public.sync_overdue_events  TO service_role;
```

`profiles`: даём только SELECT/UPDATE, потому что INSERT туда делает trigger `handle_new_user` от имени владельца (не через клиента), а DELETE вообще запрещён — RLS не разрешает.

### Migration 0013 — REVOKE

```sql
REVOKE EXECUTE ON FUNCTION public.set_updated_at()                    FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_user_entitlements_updated_at()  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_bump_updated_at()              FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_bump_version()                 FROM anon, authenticated, PUBLIC;
```

Триггеры продолжают работать: они выполняются от имени владельца таблицы, а не от вызывающей роли, поэтому `GRANT EXECUTE` для них не нужен.

### Deploy

- `start-trial` v1 → ACTIVE, `verify_jwt=true` (клиент шлёт JWT)
- `activation-notify` v1 → ACTIVE, `verify_jwt=false` (Database Webhook шлёт `x-webhook-secret`)

Обе функции идемпотентны и fail-safe: `activation-notify` без `WEBHOOK_SECRET` возвращает 500 (не открытая ручка), `start-trial` без валидного JWT возвращает 401.

## Testing Matrix (verified после миграций)

Через `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims TO '{"sub":"<test1_uuid>","role":"authenticated"}';`:

| Роль | Таблица / Функция | Действие | До 6.4.4 | После 6.4.4 |
|---|---|---|---|---|
| authenticated (test1) | sync_tasks | SELECT | ❌ 42501 | ✅ 0 rows (RLS ок) |
| authenticated (test1) | sync_settings | SELECT | ❌ 42501 | ✅ 0 rows |
| authenticated (test1) | sync_statuses | SELECT | ❌ 42501 | ✅ 0 rows |
| authenticated (test1) | sync_tags | SELECT | ❌ 42501 | ✅ 0 rows |
| authenticated (test1) | sync_task_templates | SELECT | ❌ 42501 | ✅ 0 rows |
| authenticated (test1) | sync_devices | SELECT | ❌ 42501 | ✅ 0 rows |
| authenticated (test1) | sync_overdue_events | SELECT | ❌ 42501 | ✅ 0 rows |
| authenticated (test1) | profiles WHERE id=auth.uid() | SELECT | ❌ 42501 | ✅ 1 row |
| authenticated | user_entitlements (own) | SELECT | ✅ (с dev.6.4.3) | ✅ 1 row |
| anon | set_updated_at() | EXECUTE | ✅ (небезопасно) | ❌ 42501 |
| anon | set_user_entitlements_updated_at() | EXECUTE | ✅ (небезопасно) | ❌ 42501 |
| anon | sync_bump_updated_at() | EXECUTE | ✅ (небезопасно) | ❌ 42501 |
| anon | sync_bump_version() | EXECUTE | ✅ (небезопасно) | ❌ 42501 |
| authenticated (не-владелец) | sync_tasks | SELECT | ❌ 42501 | ✅ 0 rows (RLS фильтрует) |
| service_role | все sync_* | INSERT/UPDATE/SELECT/DELETE | ❌ | ✅ |
| Edge Function `start-trial` | user_entitlements | UPSERT own | 404 | ✅ ACTIVE v1 |
| Edge Function `activation-notify` | activation_requests | UPDATE notified_at | 404 | ✅ ACTIVE v1 |

Итог Security Advisor до / после: 3 warn → 1 warn (остался только Leaked password protection — ручная настройка Dashboard).

## Что делать пользователю после установки dev.6.4.4

1. **Перезайти в аккаунт** (Settings → Sign out → Sign in) — заставит клиента получить свежий JWT и подтянуть sync/profile.
2. **Включить Leaked password protection** (ручной шаг, кодом не сделать): Supabase Dashboard → Authentication → Providers → Email → Enable HaveIBeenPwned integration.
3. Если планируется использовать `activation-notify` — задать секреты в Dashboard → Edge Functions → activation-notify → Secrets:
   - `WEBHOOK_SECRET` — общий секрет для Database Webhook
   - `RESEND_API_KEY` — API-ключ Resend
   - `ADMIN_EMAIL` — куда слать уведомления
   - `RESEND_FROM` — verified From-адрес
4. После задания секретов — настроить Database Webhook: Dashboard → Database → Webhooks → New → INSERT on `activation_requests` → URL функции + header `x-webhook-secret`.

## Регрессионная защита (dev.6.5)

Продолжаем план из dev.6.4.3:

- `supabase/tests/grants.sql` — pgTAP: для каждой RLS-таблицы проверить `has_table_privilege('authenticated', ..., 'SELECT') = true`.
- CI-шаг: прогон теста на preview-branch после каждой миграции.
- `docs/migrations.md` — правило: любая миграция с `ENABLE ROW LEVEL SECURITY` должна включать эксплицитные GRANT'ы в том же файле.

## 24 unused индекса — отложено

Performance Advisor показывает 24 неиспользуемых индекса на sync_* таблицах. **Не удаляем их сейчас** — причина, по которой они «неиспользуемые», — тот же баг с GRANT'ами: за всё время dev.1–dev.6.4.3 через них не прошло ни одного запроса. После нескольких дней реальной нагрузки в 6.4.4 нужно повторно прогнать Performance Advisor и только тогда решать, какие индексы реально не нужны. Правило: не удалять «неиспользуемые» индексы, пока фича, которую они обслуживают, не проработала в проде.

## Что дальше

- **dev.6.5** — recurring subscription, refund UI, cancel flow, pgTAP grants tests.
- **dev.6.6** — админ-страница `/admin`.
- **dev.7** — Telegram bot.
- **v1.0.0** — merge develop → main.
