-- TaskFlow v0.9.35-dev.1 — hardening: фиксируем search_path у SECURITY DEFINER/SECURITY INVOKER функций
--
-- Проблема (Supabase advisor 0011_function_search_path_mutable):
--   Если функция не задаёт search_path явно, злоумышленник с правом CREATE в
--   любой схеме может подменить, например, `now()` своей версией и повлиять
--   на выполнение триггера. Фиксация search_path закрывает этот вектор.
--
-- Также revoke EXECUTE у handle_new_user() для anon/authenticated —
-- эта функция вызывается только триггером `on_auth_user_created`,
-- прямой вызов через REST /rpc не нужен.

-- ============================================================================
-- 1. Фиксация search_path
-- ============================================================================

-- Существующие из 0001_init.sql
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.handle_new_user() set search_path = public, pg_temp;

-- Новые из 0002_sync_schema.sql
alter function public.sync_bump_version() set search_path = public, pg_temp;
alter function public.sync_bump_updated_at() set search_path = public, pg_temp;

-- ============================================================================
-- 2. Revoke EXECUTE у handle_new_user() для публичных ролей
-- ============================================================================
-- Функция вызывается только триггером on_auth_user_created (owner = postgres),
-- поэтому anon/authenticated не должны иметь возможность вызвать её через
-- /rest/v1/rpc/handle_new_user. Триггер работает как postgres — ему EXECUTE
-- не нужен через GRANT.
revoke execute on function public.handle_new_user() from anon, authenticated, public;
