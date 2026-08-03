# 0006. Админ-список пользователей — SECURITY DEFINER RPC вместо GRANT на view

- Статус: accepted
- Дата: 2026-07-22
- Связано: находка F12 (P4), миграция `0039_admin_users_summary_rpc.sql`, ветка `feat/workspaces`, паттерн [ADR 0002](0002-get-users-emails-internal-admin-gate.md)

## Контекст

Симптом (баг P4): администратор в `src/pages/AdminPage.tsx` не видит недавно
зарегистрированных пользователей и их email.

Корень: `loadUsers()` строил список ОТ таблицы `user_entitlements`
(`from('user_entitlements')...` → `userIds` → `rpc('get_users_emails', {user_ids})`).
Но триггер `handle_new_user` при регистрации создаёт строку только в
`public.profiles` (с email); строку в `user_entitlements` НЕ создаёт (free-план =
отсутствие строки). Поэтому free-пользователи без entitlement вообще не попадали
в `userIds` → были невидимы в админке, и их email не показывался.

Подтверждено на проде (2026-07-22): 6 юзеров в `auth.users`, 6 в `profiles`,
только 3 в `user_entitlements`; три невидимых free-юзера.

`profiles` — надёжный полный источник всех пользователей + email. Существующий
view `admin_users_summary` уже строится от `profiles LEFT JOIN auth.users` и
содержит email + телеметрию, НО:

- у него `security_invoker=on` (из `0020`, N4/N5) и НЕТ `GRANT SELECT` для
  `authenticated` → клиент под authenticated-JWT админа НЕ может читать его
  напрямую (и это правильно: данные, производные от `auth.users`, — admin-only);
- в нём нет `public_user_id` (публичный TF-ID, `profiles.public_user_id`).

## Решение

Прямое чтение view с клиента под authenticated не заработает (security_invoker +
нет GRANT) и не должно. Поэтому — по паттерну [ADR 0002](0002-get-users-emails-internal-admin-gate.md)
(`get_users_emails`) — вводим **SECURITY DEFINER RPC с admin-гейтом внутри тела**,
а НЕ GRANT на view:

- Новая `public.get_admin_users_summary()` → `RETURNS TABLE(...)`, `LANGUAGE plpgsql`,
  `SECURITY DEFINER`, `SET search_path TO 'public','auth','pg_temp'`.
- База — `profiles p`, `LEFT JOIN auth.users u`, `LEFT JOIN user_entitlements e`.
  Возвращает ВСЕХ пользователей: `id`, `public_user_id`, `email`
  (`COALESCE(u.email, p.email)` — auth свежее, profiles fallback), `registered_at`,
  `last_sign_in_at`, entitlement-поля (nullable для free), телеметрию
  (`sessions_count`/`tasks_created_count`/`latest_app_version`/`latest_os`).
- Гейт в теле: `auth.uid() IS NULL` → `Not authenticated`;
  `NOT public.is_admin_user()` → `Forbidden: admin only` (единый источник истины
  admin-определения — `source='seed' AND plan='lifetime'`).
- Права: `REVOKE ALL ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated`
  (тот же контракт, что `get_users_emails`).
- View `admin_users_summary` дополнен колонкой `public_user_id`, но `security_invoker=on`
  и отсутствие GRANT для anon/authenticated СОХРАНЕНЫ — view остаётся для
  service_role/дашборда, не для клиента. Колонка добавлена В КОНЕЦ списка:
  `CREATE OR REPLACE VIEW` не умеет вставлять колонку в середину или переименовывать
  существующие (Postgres ERROR 42P16); rollback view — через DROP (зависимых
  объектов нет). На RPC и клиент порядок колонок view не влияет.

Клиент (`AdminPage.tsx`) переписан на один вызов `supabase.rpc('get_admin_users_summary')`
вместо двух запросов, отображает TF-ID и ищет по нему.

Альтернатива (GRANT SELECT на view для authenticated) отклонена: открыла бы
прямой доступ к производным от `auth.users` данным всем залогиненным ролям и
противоречит фиксу N4 (`0020`).

## Последствия

Плюсы: баг закрыт (free-юзеры и их email видны); один вызов вместо двух;
admin-определение консолидировано в `is_admin_user()`; view не открыт клиенту.

Минусы: `EXECUTE` формально остаётся у `authenticated` — защита держится на теле
функции, а не на GRANT (осознанный компромисс, тот же что в [ADR 0002](0002-get-users-emails-internal-admin-gate.md)).
Покрыто pgTAP-тестом `tests/19_admin_users_summary_test.sql` (anon без EXECUTE,
обычный юзер → Forbidden, admin → успех и видит free-юзера без entitlement) и
vitest `AdminPage.mapUsers.test.ts` (маппинг nullable entitlement).

Применение на прод: требуется применение миграции `0039` через `apply_migration`
(на момент записи — не применена; прогнана прод-проба под ROLLBACK).
