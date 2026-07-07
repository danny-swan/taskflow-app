# TaskFlow v0.9.35-dev.6.4.2 — Payment webhook hotfix (service_role GRANTs + sb_secret raw fetch)

## TL;DR

Успешный E2E платёж прошёл в prod: 299 ₽ через ЮKassa → `payment.succeeded` → `user_entitlements.plan=pro`, `refund.succeeded` → `plan=free`. Оба сценария verified в БД.

Фикс двухслойный:

1. **Миграция `0010_grant_service_role_on_payment_tables.sql`** — раздал `SELECT/INSERT/UPDATE/DELETE` роли `service_role` на 4 таблицы платёжного контура. Это была реальная root cause 500-ок.
2. **`payment-webhook/index.ts` переписан на raw `fetch` без `supabase-js`** — работа с новыми `sb_secret_*` ключами через прямой PostgREST + `apikey` header (без `Authorization`).

## Что было сломано

После рефакторинга secrets на новые `sb_secret_*` ключи (`SUPABASE_SECRET_KEYS.default`) `payment-webhook` в prod отвечал 200 ЮKassa (мы всегда возвращаем 200 после записи в `payment_events` — иначе провайдер ретраит 24 часа), но `user_entitlements` не апдейтились. В логах:

```
permission denied for table payment_events
```

## Диагностика (что помогло, что нет)

- **v5 фикс** — попытка передать `sb_secret_*` через `global.headers` в `supabase-js`. Не помог: библиотека всё равно отправляет `Authorization` header, которое платформа отвергает для не-JWT токенов.
- **v6 фикс** — переписал на raw `fetch` к PostgREST, только `apikey` header. Локально код чистый, но при smoke-тесте — то же `permission denied`.
- **Diag функция `diag-postgrest`** — три параллельных теста в один вызов. PostgREST вернул hint:
  ```
  Grant the required privileges to the current role with:
  GRANT SELECT ON public.payment_events TO service_role
  ```
- Проверка прав через `information_schema.role_table_grants`:
  ```
  service_role → payment_events, user_entitlements, activation_requests, usage_events:
    только TRUNCATE, TRIGGER, REFERENCES (нет SELECT/INSERT/UPDATE/DELETE)
  ```
  RLS policies действуют **поверх** table-level privileges — без `GRANT` PostgREST отвергает запрос ещё до применения policy.

## Root cause

В `0007_entitlements.sql` создали таблицы и настроили RLS, но **не выдали GRANT'ы** роли `service_role`. Это была скрытая регрессия относительно supabase-defaults — обычно `service_role` получает права из `ALTER DEFAULT PRIVILEGES`, но у нас этот default не был установлен для схемы `public`.

## Fix (миграция 0010)

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_events        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_entitlements     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activation_requests   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.usage_events          TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
```

Миграция уже применена в prod через Supabase Management API (`apply_migration`).

## v6 webhook (raw fetch)

Ключевое изменение — новый `AdminClient` без `supabase-js`:

```typescript
class AdminClient {
  constructor(private baseUrl: string, private apiKey: string) {}
  private headers(extra = {}) {
    return { apikey: this.apiKey, 'Content-Type': 'application/json', ...extra }
  }
  async insert(table, rows) { /* POST /rest/v1/${table} */ }
  async update(table, filters, patch) { /* PATCH /rest/v1/${table}?... */ }
  async select(table, filters, opts) { /* GET /rest/v1/${table}?... */ }
}
```

Никаких `Authorization` header — только `apikey`. Работает и с legacy JWT service_role, и с новыми `sb_secret_*` ключами.

## E2E результаты (verified in DB)

| user | plan | valid_until | source |
|---|---|---|---|
| lebedevdo.one@gmail.com | lifetime | ∞ | seed |
| lebedevdo.one+test1@gmail.com | **pro** | **2026-08-06 10:58:08+00** | yookassa (payment 31dee2ff…) |
| lebedevdo.one+test@gmail.com | free (после refund) | null | yookassa (payment 31decafb…) |

`payment_events` строка: `signature_valid=true`, `processed_at=2026-07-07 10:58:09+00`, `error=null`.

## Осталось на юзере

- Удалить `YOOKASSA_SKIP_IP_CHECK` из Supabase Secrets — использовался при диагностике, чтобы forced curl не резался на IP-check.
- Удалить временные диагностические функции в Supabase Dashboard: `diag-env`, `diag-postgrest`, `list-payments`.

## Дальше

- **dev.6.5** — recurring subscription, refund UI, cancel flow, тесты.
- **dev.6.6** — админ-страница `/admin` для просмотра платежей и активаций.
- **dev.7** — Telegram bot для отслеживания активаций.
- **v1.0.0** — merge develop → main.
