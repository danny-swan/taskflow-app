# TaskFlow v0.9.35-dev.6.4.3 — Entitlements SELECT для authenticated (клиент видит Pro)

## TL;DR

После dev.6.4.2 webhook писал `plan=pro` в `user_entitlements`, но приложение продолжало показывать Free. Причина: у роли `authenticated` не было `SELECT` на таблицах платёжного контура — та же ошибка что и с `service_role` в dev.6.4.2, но с другой ролью. Миграция `0011` раздаёт `SELECT` роли `authenticated`.

## Что было сломано

Юзер `lebedevdo.one+test1@gmail.com` после оплаты 299 ₽ в приложении видел Free. В БД — `plan=pro` подтверждён. Диагностика через `SET LOCAL ROLE authenticated`:

```
ERROR: 42501: permission denied for table user_entitlements
HINT:  Grant the required privileges to the current role with:
       GRANT SELECT ON public.user_entitlements TO authenticated;
```

`fetchEntitlementRow()` в `src/lib/entitlements.ts` бросает ошибку → хук `useEntitlement` fallback'ит на кэш settings → показывает последний известный план (`free` для только что созданного аккаунта).

## Root cause

В `0007_entitlements.sql` (dev.6) создали таблицы `user_entitlements`, `activation_requests`, `payment_events`, `usage_events`, настроили RLS policies (`auth.uid() = user_id`) — но **забыли GRANT'ы для `authenticated` и `service_role`**.

RLS policies проверяются PostgreSQL/PostgREST **поверх table-level privileges**. Без `GRANT SELECT` PostgREST отклоняет запрос ещё до применения policy → клиент получает `permission denied` независимо от того, есть ли у юзера доступ по RLS.

Ошибка тихая: `supabase-js` возвращает error объект, приложение логирует warn и падает на кэш. Никаких 500-ок, ничего в realtime не появляется.

Стандартный Supabase workflow (создание таблицы через Dashboard) автоматически добавляет `ALTER DEFAULT PRIVILEGES` для `authenticated`/`anon`/`service_role`. При применении миграций через CLI/Management API этот default **не срабатывает**, GRANT'ы нужно указывать явно.

## Fix (миграция 0011)

```sql
GRANT SELECT ON public.user_entitlements     TO authenticated;
GRANT SELECT ON public.activation_requests   TO authenticated;
GRANT SELECT ON public.payment_events        TO authenticated;
GRANT SELECT ON public.usage_events          TO authenticated;

GRANT INSERT ON public.activation_requests   TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO authenticated;
```

Миграция уже применена в prod через Supabase Management API.

## Testing Matrix (verified после миграции)

Проверено через `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims TO '{"sub":"<uuid>","role":"authenticated"}';`:

| Роль | Таблица | Действие | Результат |
|---|---|---|---|
| authenticated (test1) | user_entitlements | SELECT | ✅ 1 row: plan=pro, valid_until=2026-08-06 |
| authenticated | user_entitlements | SELECT (чужие строки) | 0 rows (RLS фильтрует) |
| authenticated | activation_requests | INSERT | ✅ |
| service_role | user_entitlements | INSERT/UPDATE/SELECT/DELETE | ✅ (dev.6.4.2) |
| service_role | payment_events | INSERT/SELECT | ✅ (dev.6.4.2) |
| anon | user_entitlements | SELECT | ❌ (правильно — 42501) |

## Что делать пользователю после установки dev.6.4.3

- Перезайти в аккаунт (Settings → Sign out → Sign in) — заставит `useEntitlement` fetch'нуть свежие данные и обновить кэш.
- Или закрыть/открыть приложение — при mount хук всегда делает fresh fetch.

## Регрессионная защита

В `dev.6.5` добавим:

- **`supabase/tests/grants.sql`** — pgTAP-стиль тест: для каждой RLS-защищённой таблицы проверить `has_table_privilege('authenticated', ..., 'SELECT')` = true.
- **CI-шаг:** прогонять этот тест на CI против preview-branch БД после каждой миграции.
- **Правило миграций:** любая миграция с `CREATE TABLE ... ENABLE ROW LEVEL SECURITY` должна включать эксплицитные `GRANT`'ы для `authenticated`/`service_role` в том же файле. Добавляем в `docs/migrations.md`.

## Что дальше

- **dev.6.5** — recurring subscription, refund UI, cancel flow, pgTAP тесты grants.
- **dev.6.6** — админ-страница `/admin`.
- **dev.7** — Telegram bot.
- **v1.0.0** — merge develop → main.
