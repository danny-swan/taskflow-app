-- TaskFlow v0.9.35-dev.6.4.4 — миграция 0013
-- REVOKE EXECUTE с триггерных функций у anon/authenticated
--
-- Проблема:
--   4 триггерные функции (set_updated_at, set_user_entitlements_updated_at,
--   sync_bump_updated_at, sync_bump_version) доступны для EXECUTE через
--   PostgREST для ролей anon/authenticated. Ни одна из них не должна
--   вызываться пользователем напрямую — они предназначены только для BEFORE
--   INSERT/UPDATE триггеров.
--
--   set_updated_at и set_user_entitlements_updated_at — ещё и SECURITY DEFINER,
--   что означает, что при их вызове через REST anon получил бы права владельца.
--   Supabase Security Advisor это ловит.
--
-- Что делаем:
--   REVOKE EXECUTE ... FROM anon, authenticated, PUBLIC.
--   Триггеры продолжат работать: они выполняются от имени владельца таблицы,
--   а не от имени вызывающей роли, и не проверяют GRANT EXECUTE.
--
-- Идемпотентность: REVOKE безопасно повторять.

BEGIN;

-- SECURITY DEFINER функции (высокий приоритет)
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_user_entitlements_updated_at() FROM anon, authenticated, PUBLIC;

-- Обычные триггерные функции (тоже не должны быть доступны через REST)
REVOKE EXECUTE ON FUNCTION public.sync_bump_updated_at() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_bump_version() FROM anon, authenticated, PUBLIC;

-- service_role оставляем — на всякий случай для сервисных задач
-- (Postgres триггеры всё равно работают независимо от EXECUTE grants)

COMMIT;

-- Проверка после миграции:
--   SELECT p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('set_updated_at', 'set_user_entitlements_updated_at',
--                       'sync_bump_updated_at', 'sync_bump_version');
--   Все anon_exec и auth_exec должны стать false.
