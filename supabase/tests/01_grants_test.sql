-- TaskFlow v0.9.35-dev.6.5 — pgTAP: GRANTs на public.* таблицы
--
-- Проверяет что миграции 0010-0014 корректно выдали привилегии.
-- Регрессионная защита: любая новая миграция, забывшая GRANT после
-- ENABLE ROW LEVEL SECURITY, упадёт здесь.

BEGIN;

-- Ожидаемое количество тестов: (14 таблиц × 4 CRUD × 2 роли)
-- минус то, что не выдаётся — считаем вручную ниже.
SELECT plan(74);

-- ─── profiles (SELECT, UPDATE для authenticated; ALL для service_role) ─────
SELECT ok(has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
          'authenticated может SELECT profiles');
SELECT ok(has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
          'authenticated может UPDATE profiles');
SELECT ok(NOT has_table_privilege('authenticated', 'public.profiles', 'INSERT'),
          'authenticated НЕ может INSERT profiles (создаёт триггер)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
          'authenticated НЕ может DELETE profiles');

SELECT ok(has_table_privilege('service_role', 'public.profiles', 'SELECT'), 'service_role SELECT profiles');
SELECT ok(has_table_privilege('service_role', 'public.profiles', 'INSERT'), 'service_role INSERT profiles');
SELECT ok(has_table_privilege('service_role', 'public.profiles', 'UPDATE'), 'service_role UPDATE profiles');
SELECT ok(has_table_privilege('service_role', 'public.profiles', 'DELETE'), 'service_role DELETE profiles');

-- ─── sync_* таблицы: full CRUD для authenticated + service_role ────────────
DO $$
DECLARE
  t text;
  sync_tables text[] := ARRAY[
    'sync_tasks', 'sync_settings', 'sync_statuses', 'sync_tags',
    'sync_task_templates', 'sync_devices', 'sync_overdue_events'
  ];
BEGIN
  FOREACH t IN ARRAY sync_tables LOOP
    -- Assertions выносим в SELECT через perform не подходит — используем EXECUTE
    -- для генерации pgTAP-строк на лету.
    NULL;
  END LOOP;
END$$;

-- Явные проверки по каждой sync_* таблице (7 × 4 = 28 тестов для authenticated)
SELECT ok(has_table_privilege('authenticated', 'public.sync_tasks',          'SELECT'), 'auth SELECT sync_tasks');
SELECT ok(has_table_privilege('authenticated', 'public.sync_tasks',          'INSERT'), 'auth INSERT sync_tasks');
SELECT ok(has_table_privilege('authenticated', 'public.sync_tasks',          'UPDATE'), 'auth UPDATE sync_tasks');
SELECT ok(has_table_privilege('authenticated', 'public.sync_tasks',          'DELETE'), 'auth DELETE sync_tasks');

SELECT ok(has_table_privilege('authenticated', 'public.sync_settings',       'SELECT'), 'auth SELECT sync_settings');
SELECT ok(has_table_privilege('authenticated', 'public.sync_settings',       'INSERT'), 'auth INSERT sync_settings');
SELECT ok(has_table_privilege('authenticated', 'public.sync_settings',       'UPDATE'), 'auth UPDATE sync_settings');
SELECT ok(has_table_privilege('authenticated', 'public.sync_settings',       'DELETE'), 'auth DELETE sync_settings');

SELECT ok(has_table_privilege('authenticated', 'public.sync_statuses',       'SELECT'), 'auth SELECT sync_statuses');
SELECT ok(has_table_privilege('authenticated', 'public.sync_statuses',       'INSERT'), 'auth INSERT sync_statuses');
SELECT ok(has_table_privilege('authenticated', 'public.sync_statuses',       'UPDATE'), 'auth UPDATE sync_statuses');
SELECT ok(has_table_privilege('authenticated', 'public.sync_statuses',       'DELETE'), 'auth DELETE sync_statuses');

SELECT ok(has_table_privilege('authenticated', 'public.sync_tags',           'SELECT'), 'auth SELECT sync_tags');
SELECT ok(has_table_privilege('authenticated', 'public.sync_tags',           'INSERT'), 'auth INSERT sync_tags');
SELECT ok(has_table_privilege('authenticated', 'public.sync_tags',           'UPDATE'), 'auth UPDATE sync_tags');
SELECT ok(has_table_privilege('authenticated', 'public.sync_tags',           'DELETE'), 'auth DELETE sync_tags');

SELECT ok(has_table_privilege('authenticated', 'public.sync_task_templates', 'SELECT'), 'auth SELECT sync_task_templates');
SELECT ok(has_table_privilege('authenticated', 'public.sync_task_templates', 'INSERT'), 'auth INSERT sync_task_templates');
SELECT ok(has_table_privilege('authenticated', 'public.sync_task_templates', 'UPDATE'), 'auth UPDATE sync_task_templates');
SELECT ok(has_table_privilege('authenticated', 'public.sync_task_templates', 'DELETE'), 'auth DELETE sync_task_templates');

SELECT ok(has_table_privilege('authenticated', 'public.sync_devices',        'SELECT'), 'auth SELECT sync_devices');
SELECT ok(has_table_privilege('authenticated', 'public.sync_devices',        'INSERT'), 'auth INSERT sync_devices');
SELECT ok(has_table_privilege('authenticated', 'public.sync_devices',        'UPDATE'), 'auth UPDATE sync_devices');
SELECT ok(has_table_privilege('authenticated', 'public.sync_devices',        'DELETE'), 'auth DELETE sync_devices');

SELECT ok(has_table_privilege('authenticated', 'public.sync_overdue_events', 'SELECT'), 'auth SELECT sync_overdue_events');
SELECT ok(has_table_privilege('authenticated', 'public.sync_overdue_events', 'INSERT'), 'auth INSERT sync_overdue_events');
SELECT ok(has_table_privilege('authenticated', 'public.sync_overdue_events', 'UPDATE'), 'auth UPDATE sync_overdue_events');
SELECT ok(has_table_privilege('authenticated', 'public.sync_overdue_events', 'DELETE'), 'auth DELETE sync_overdue_events');

-- ─── payment/entitlement таблицы: read-only для authenticated ──────────────
SELECT ok(has_table_privilege('authenticated', 'public.user_entitlements',   'SELECT'), 'auth SELECT user_entitlements');
SELECT ok(NOT has_table_privilege('authenticated', 'public.user_entitlements', 'INSERT'), 'auth NOT INSERT user_entitlements');
SELECT ok(NOT has_table_privilege('authenticated', 'public.user_entitlements', 'UPDATE'), 'auth NOT UPDATE user_entitlements');
SELECT ok(NOT has_table_privilege('authenticated', 'public.user_entitlements', 'DELETE'), 'auth NOT DELETE user_entitlements');

SELECT ok(has_table_privilege('authenticated', 'public.activation_requests', 'SELECT'), 'auth SELECT activation_requests');
SELECT ok(has_table_privilege('authenticated', 'public.activation_requests', 'INSERT'), 'auth INSERT activation_requests');
SELECT ok(NOT has_table_privilege('authenticated', 'public.activation_requests', 'UPDATE'), 'auth NOT UPDATE activation_requests');
SELECT ok(NOT has_table_privilege('authenticated', 'public.activation_requests', 'DELETE'), 'auth NOT DELETE activation_requests');

SELECT ok(has_table_privilege('authenticated', 'public.payment_events',      'SELECT'), 'auth SELECT payment_events');
SELECT ok(NOT has_table_privilege('authenticated', 'public.payment_events', 'INSERT'), 'auth NOT INSERT payment_events');
SELECT ok(NOT has_table_privilege('authenticated', 'public.payment_events', 'UPDATE'), 'auth NOT UPDATE payment_events');
SELECT ok(NOT has_table_privilege('authenticated', 'public.payment_events', 'DELETE'), 'auth NOT DELETE payment_events');

SELECT ok(has_table_privilege('authenticated', 'public.usage_events',        'SELECT'), 'auth SELECT usage_events');
SELECT ok(NOT has_table_privilege('authenticated', 'public.usage_events', 'INSERT'), 'auth NOT INSERT usage_events');
SELECT ok(NOT has_table_privilege('authenticated', 'public.usage_events', 'UPDATE'), 'auth NOT UPDATE usage_events');
SELECT ok(NOT has_table_privilege('authenticated', 'public.usage_events', 'DELETE'), 'auth NOT DELETE usage_events');

-- ─── payment_methods (NEW in 0014): SELECT для authenticated, ALL для service_role ──
SELECT ok(has_table_privilege('authenticated', 'public.payment_methods',    'SELECT'), 'auth SELECT payment_methods');
SELECT ok(NOT has_table_privilege('authenticated', 'public.payment_methods', 'INSERT'), 'auth NOT INSERT payment_methods');
SELECT ok(NOT has_table_privilege('authenticated', 'public.payment_methods', 'UPDATE'), 'auth NOT UPDATE payment_methods');
SELECT ok(NOT has_table_privilege('authenticated', 'public.payment_methods', 'DELETE'), 'auth NOT DELETE payment_methods');

SELECT ok(has_table_privilege('service_role', 'public.payment_methods', 'SELECT'), 'service_role SELECT payment_methods');
SELECT ok(has_table_privilege('service_role', 'public.payment_methods', 'INSERT'), 'service_role INSERT payment_methods');
SELECT ok(has_table_privilege('service_role', 'public.payment_methods', 'UPDATE'), 'service_role UPDATE payment_methods');
SELECT ok(has_table_privilege('service_role', 'public.payment_methods', 'DELETE'), 'service_role DELETE payment_methods');

-- ─── renewal_attempts_log (NEW in 0014): SELECT для authenticated, ALL для service_role ──
SELECT ok(has_table_privilege('authenticated', 'public.renewal_attempts_log',    'SELECT'), 'auth SELECT renewal_attempts_log');
SELECT ok(NOT has_table_privilege('authenticated', 'public.renewal_attempts_log', 'INSERT'), 'auth NOT INSERT renewal_attempts_log');
SELECT ok(NOT has_table_privilege('authenticated', 'public.renewal_attempts_log', 'UPDATE'), 'auth NOT UPDATE renewal_attempts_log');
SELECT ok(NOT has_table_privilege('authenticated', 'public.renewal_attempts_log', 'DELETE'), 'auth NOT DELETE renewal_attempts_log');

SELECT ok(has_table_privilege('service_role', 'public.renewal_attempts_log', 'SELECT'), 'service_role SELECT renewal_attempts_log');
SELECT ok(has_table_privilege('service_role', 'public.renewal_attempts_log', 'INSERT'), 'service_role INSERT renewal_attempts_log');
SELECT ok(has_table_privilege('service_role', 'public.renewal_attempts_log', 'UPDATE'), 'service_role UPDATE renewal_attempts_log');
SELECT ok(has_table_privilege('service_role', 'public.renewal_attempts_log', 'DELETE'), 'service_role DELETE renewal_attempts_log');

-- ─── anon НЕ должен иметь доступ ни к чему в public ────────────────────────
SELECT ok(NOT has_table_privilege('anon', 'public.sync_tasks',            'SELECT'), 'anon НЕ SELECT sync_tasks');
SELECT ok(NOT has_table_privilege('anon', 'public.profiles',              'SELECT'), 'anon НЕ SELECT profiles');
SELECT ok(NOT has_table_privilege('anon', 'public.user_entitlements',     'SELECT'), 'anon НЕ SELECT user_entitlements');
SELECT ok(NOT has_table_privilege('anon', 'public.payment_events',        'SELECT'), 'anon НЕ SELECT payment_events');
SELECT ok(NOT has_table_privilege('anon', 'public.payment_methods',       'SELECT'), 'anon НЕ SELECT payment_methods');
SELECT ok(NOT has_table_privilege('anon', 'public.renewal_attempts_log',  'SELECT'), 'anon НЕ SELECT renewal_attempts_log');

SELECT * FROM finish();
ROLLBACK;
