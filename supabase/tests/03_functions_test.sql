-- TaskFlow v0.9.35-dev.6.5 — pgTAP: trigger functions EXECUTE закрыт
--
-- Миграция 0013 отзывает EXECUTE у anon/authenticated/PUBLIC на trigger-функции.
-- Их вызов возможен только через триггер (owner-level), либо service_role.

BEGIN;
SELECT plan(12);

-- ─── set_updated_at ────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon',          'public.set_updated_at()', 'EXECUTE'),
  'anon НЕ может EXECUTE set_updated_at'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.set_updated_at()', 'EXECUTE'),
  'authenticated НЕ может EXECUTE set_updated_at'
);
SELECT ok(
  has_function_privilege('service_role',      'public.set_updated_at()', 'EXECUTE'),
  'service_role может EXECUTE set_updated_at'
);

-- ─── set_user_entitlements_updated_at ──────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon',          'public.set_user_entitlements_updated_at()', 'EXECUTE'),
  'anon НЕ может EXECUTE set_user_entitlements_updated_at'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.set_user_entitlements_updated_at()', 'EXECUTE'),
  'authenticated НЕ может EXECUTE set_user_entitlements_updated_at'
);
SELECT ok(
  has_function_privilege('service_role',      'public.set_user_entitlements_updated_at()', 'EXECUTE'),
  'service_role может EXECUTE set_user_entitlements_updated_at'
);

-- ─── sync_bump_updated_at ──────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon',          'public.sync_bump_updated_at()', 'EXECUTE'),
  'anon НЕ может EXECUTE sync_bump_updated_at'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.sync_bump_updated_at()', 'EXECUTE'),
  'authenticated НЕ может EXECUTE sync_bump_updated_at'
);
SELECT ok(
  has_function_privilege('service_role',      'public.sync_bump_updated_at()', 'EXECUTE'),
  'service_role может EXECUTE sync_bump_updated_at'
);

-- ─── sync_bump_version ─────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon',          'public.sync_bump_version()', 'EXECUTE'),
  'anon НЕ может EXECUTE sync_bump_version'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.sync_bump_version()', 'EXECUTE'),
  'authenticated НЕ может EXECUTE sync_bump_version'
);
SELECT ok(
  has_function_privilege('service_role',      'public.sync_bump_version()', 'EXECUTE'),
  'service_role может EXECUTE sync_bump_version'
);

SELECT * FROM finish();
ROLLBACK;
