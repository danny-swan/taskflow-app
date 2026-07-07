-- TaskFlow v0.9.35-dev.6.5 — pgTAP: trigger functions EXECUTE закрыт
--
-- Миграция 0013 делает REVOKE EXECUTE FROM anon, authenticated, PUBLIC.
-- Так как service_role в Postgres унаследовал EXECUTE через PUBLIC, REVOKE FROM
-- PUBLIC отзывает и у него — это ожидаемо: триггеры работают от имени владельца
-- таблицы, не проверяя GRANT EXECUTE на функцию. GRANT EXECUTE нужен только
-- когда функция вызывается напрямую через PostgREST (что для триггерных функций
-- запрещено бизнес-логикой).
--
-- Что проверяем:
--   • anon           — НЕ может EXECUTE
--   • authenticated  — НЕ может EXECUTE
--   • service_role   — НЕ может EXECUTE (через PUBLIC)
--   • владелец (postgres) — по-прежнему может (триггеры продолжают работать)
--
-- Регрессия ловит:
--   • новую trigger-функцию без REVOKE
--   • случайный GRANT EXECUTE обратно anon/authenticated

BEGIN;
SELECT plan(16);

-- ─── set_updated_at ────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon',          'public.set_updated_at()', 'EXECUTE'),
          'anon НЕ EXECUTE set_updated_at');
SELECT ok(NOT has_function_privilege('authenticated', 'public.set_updated_at()', 'EXECUTE'),
          'authenticated НЕ EXECUTE set_updated_at');
SELECT ok(NOT has_function_privilege('service_role',  'public.set_updated_at()', 'EXECUTE'),
          'service_role НЕ EXECUTE set_updated_at (только через триггер как owner)');
SELECT ok(has_function_privilege('postgres',          'public.set_updated_at()', 'EXECUTE'),
          'postgres (owner) может EXECUTE set_updated_at');

-- ─── set_user_entitlements_updated_at ──────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon',          'public.set_user_entitlements_updated_at()', 'EXECUTE'),
          'anon НЕ EXECUTE set_user_entitlements_updated_at');
SELECT ok(NOT has_function_privilege('authenticated', 'public.set_user_entitlements_updated_at()', 'EXECUTE'),
          'authenticated НЕ EXECUTE set_user_entitlements_updated_at');
SELECT ok(NOT has_function_privilege('service_role',  'public.set_user_entitlements_updated_at()', 'EXECUTE'),
          'service_role НЕ EXECUTE set_user_entitlements_updated_at');
SELECT ok(has_function_privilege('postgres',          'public.set_user_entitlements_updated_at()', 'EXECUTE'),
          'postgres (owner) может EXECUTE set_user_entitlements_updated_at');

-- ─── sync_bump_updated_at ──────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon',          'public.sync_bump_updated_at()', 'EXECUTE'),
          'anon НЕ EXECUTE sync_bump_updated_at');
SELECT ok(NOT has_function_privilege('authenticated', 'public.sync_bump_updated_at()', 'EXECUTE'),
          'authenticated НЕ EXECUTE sync_bump_updated_at');
SELECT ok(NOT has_function_privilege('service_role',  'public.sync_bump_updated_at()', 'EXECUTE'),
          'service_role НЕ EXECUTE sync_bump_updated_at');
SELECT ok(has_function_privilege('postgres',          'public.sync_bump_updated_at()', 'EXECUTE'),
          'postgres (owner) может EXECUTE sync_bump_updated_at');

-- ─── sync_bump_version ─────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon',          'public.sync_bump_version()', 'EXECUTE'),
          'anon НЕ EXECUTE sync_bump_version');
SELECT ok(NOT has_function_privilege('authenticated', 'public.sync_bump_version()', 'EXECUTE'),
          'authenticated НЕ EXECUTE sync_bump_version');
SELECT ok(NOT has_function_privilege('service_role',  'public.sync_bump_version()', 'EXECUTE'),
          'service_role НЕ EXECUTE sync_bump_version');
SELECT ok(has_function_privilege('postgres',          'public.sync_bump_version()', 'EXECUTE'),
          'postgres (owner) может EXECUTE sync_bump_version');

-- ─── tg_payment_methods_touch_updated_at (NEW in 0014) ──────────────────────
SELECT ok(NOT has_function_privilege('anon',          'public.tg_payment_methods_touch_updated_at()', 'EXECUTE'),
          'anon НЕ EXECUTE tg_payment_methods_touch_updated_at');
SELECT ok(NOT has_function_privilege('authenticated', 'public.tg_payment_methods_touch_updated_at()', 'EXECUTE'),
          'authenticated НЕ EXECUTE tg_payment_methods_touch_updated_at');
SELECT ok(NOT has_function_privilege('service_role',  'public.tg_payment_methods_touch_updated_at()', 'EXECUTE'),
          'service_role НЕ EXECUTE tg_payment_methods_touch_updated_at (через REVOKE FROM PUBLIC)');
SELECT ok(has_function_privilege('postgres',          'public.tg_payment_methods_touch_updated_at()', 'EXECUTE'),
          'postgres (owner) может EXECUTE tg_payment_methods_touch_updated_at');

SELECT * FROM finish();
ROLLBACK;
