-- TaskFlow v0.9.35-dev.6.5 — pgTAP: RLS включён + own row visibility
--
-- Проверяет что:
--   1) RLS enabled на всех protected tables
--   2) authenticated видит только свои строки (auth.uid() = user_id / id)
--   3) authenticated не видит чужие строки

BEGIN;
SELECT plan(24);

-- ─── 1. RLS enabled на всех protected tables ───────────────────────────────
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profiles'::regclass),
  'RLS enabled on profiles'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sync_tasks'::regclass),
  'RLS enabled on sync_tasks'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sync_settings'::regclass),
  'RLS enabled on sync_settings'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sync_statuses'::regclass),
  'RLS enabled on sync_statuses'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sync_tags'::regclass),
  'RLS enabled on sync_tags'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sync_task_templates'::regclass),
  'RLS enabled on sync_task_templates'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sync_devices'::regclass),
  'RLS enabled on sync_devices'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sync_overdue_events'::regclass),
  'RLS enabled on sync_overdue_events'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_entitlements'::regclass),
  'RLS enabled on user_entitlements'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.activation_requests'::regclass),
  'RLS enabled on activation_requests'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.payment_events'::regclass),
  'RLS enabled on payment_events'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.usage_events'::regclass),
  'RLS enabled on usage_events'
);

-- ─── 2. Подготовка: два юзера + строки ─────────────────────────────────────
-- Вставляем как superuser (миграции + сиды всегда идут под owner).
DO $$
DECLARE
  u1 uuid := '11111111-1111-1111-1111-111111111111'::uuid;
  u2 uuid := '22222222-2222-2222-2222-222222222222'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (u1, 'user1@test'),
    (u2, 'user2@test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, email) VALUES
    (u1, 'user1@test'),
    (u2, 'user2@test')
  ON CONFLICT (id) DO NOTHING;

  -- sync_devices: один девайс на юзера
  INSERT INTO public.sync_devices (id, user_id, platform)
  VALUES
    ('dev-u1', u1, 'linux'),
    ('dev-u2', u2, 'linux')
  ON CONFLICT DO NOTHING;

  -- sync_statuses: минимум чтобы был FK для sync_tasks
  INSERT INTO public.sync_statuses (id, user_id, name, color)
  VALUES
    ('st-u1', u1, 'todo', '#888'),
    ('st-u2', u2, 'todo', '#888')
  ON CONFLICT DO NOTHING;

  -- sync_tasks: одна задача на юзера
  INSERT INTO public.sync_tasks (user_id, id, title, status_id)
  VALUES
    (u1, 'task-u1', 'Task from user1', 'st-u1'),
    (u2, 'task-u2', 'Task from user2', 'st-u2')
  ON CONFLICT DO NOTHING;
END$$;

-- ─── 3. Тесты видимости — user1 видит свою строку, не видит чужую ──────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO '11111111-1111-1111-1111-111111111111';

SELECT is(
  (SELECT count(*)::int FROM public.sync_tasks WHERE id = 'task-u1'),
  1,
  'user1 видит свою sync_tasks строку'
);
SELECT is(
  (SELECT count(*)::int FROM public.sync_tasks WHERE id = 'task-u2'),
  0,
  'user1 НЕ видит чужую sync_tasks строку'
);
SELECT is(
  (SELECT count(*)::int FROM public.sync_tasks),
  1,
  'user1 видит только 1 строку в sync_tasks (свою)'
);

SELECT is(
  (SELECT count(*)::int FROM public.sync_devices WHERE id = 'dev-u1'),
  1,
  'user1 видит свой sync_devices'
);
SELECT is(
  (SELECT count(*)::int FROM public.sync_devices WHERE id = 'dev-u2'),
  0,
  'user1 НЕ видит чужой sync_devices'
);

SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111'::uuid),
  1,
  'user1 видит свой profile'
);
SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE id = '22222222-2222-2222-2222-222222222222'::uuid),
  0,
  'user1 НЕ видит чужой profile'
);

RESET ROLE;

-- ─── 4. Тесты видимости — user2 симметрично ────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO '22222222-2222-2222-2222-222222222222';

SELECT is(
  (SELECT count(*)::int FROM public.sync_tasks WHERE id = 'task-u2'),
  1,
  'user2 видит свою sync_tasks строку'
);
SELECT is(
  (SELECT count(*)::int FROM public.sync_tasks WHERE id = 'task-u1'),
  0,
  'user2 НЕ видит чужую sync_tasks строку'
);

RESET ROLE;

-- ─── 5. anon вообще ничего не видит (нет GRANT) ────────────────────────────
-- has_table_privilege проверяет столбец таблицы. Здесь мы через RLS +
-- отсутствие SELECT-GRANT'а должны получить permission denied. Но
-- pgTAP throws_ok ловит это чище через прямой SELECT под ролью.
SET LOCAL ROLE anon;
SELECT throws_ok(
  $q$ SELECT count(*) FROM public.sync_tasks $q$,
  '42501',
  NULL,
  'anon получает permission denied на sync_tasks'
);
SELECT throws_ok(
  $q$ SELECT count(*) FROM public.profiles $q$,
  '42501',
  NULL,
  'anon получает permission denied на profiles'
);
RESET ROLE;

-- ─── 6. auth.uid() работает под authenticated ──────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO '11111111-1111-1111-1111-111111111111';

SELECT is(
  auth.uid(),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'auth.uid() возвращает sub из JWT claims'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
