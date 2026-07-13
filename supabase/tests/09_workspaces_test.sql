-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- pgTAP: фундамент «Пространств» (миграция 0027, Wave A).
--
-- Проверяет:
--   1) три новые таблицы + ключевые колонки / PK;
--   2) workspace_id NOT NULL во всех шести sync-таблицах;
--   3) дефолты kind='personal' / role='owner' + RLS включён на новых таблицах;
--   4) has_workspace_role: семантика viewer < editor < owner + не-член;
--   5) kind='shared' допустим на уровне схемы (INSERT и UPDATE) после 0030;
--   6) backfill: personal-пространство + owner-членство + workspace_id, с
--      детерминированным id ws_<uid> и идемпотентностью;
--   7) RLS-изоляция: юзер видит только строки своего пространства (эквивалент
--      старого own-row поведения).
--
-- Стиль — как 08_profile_test.sql. Выполняется на vanilla Postgres 15 (CI).

BEGIN;
SELECT plan(47);

-- ─── 1. Таблицы существуют ──────────────────────────────────────────────────
SELECT has_table('public', 'sync_workspaces',         'sync_workspaces существует');
SELECT has_table('public', 'sync_workspace_members',  'sync_workspace_members существует');
SELECT has_table('public', 'sync_workspace_settings', 'sync_workspace_settings существует');

-- ─── 2. Ключевые колонки новых таблиц ───────────────────────────────────────
SELECT has_column('public', 'sync_workspaces', 'kind',       'sync_workspaces.kind');
SELECT has_column('public', 'sync_workspaces', 'owner_id',   'sync_workspaces.owner_id');
SELECT has_column('public', 'sync_workspaces', 'sort_order', 'sync_workspaces.sort_order');

SELECT has_column('public', 'sync_workspace_members', 'role',         'sync_workspace_members.role');
SELECT has_column('public', 'sync_workspace_members', 'workspace_id', 'sync_workspace_members.workspace_id');
SELECT has_column('public', 'sync_workspace_members', 'user_id',      'sync_workspace_members.user_id');

SELECT has_column('public', 'sync_workspace_settings', 'key',          'sync_workspace_settings.key');
SELECT has_column('public', 'sync_workspace_settings', 'value',        'sync_workspace_settings.value');
SELECT has_column('public', 'sync_workspace_settings', 'workspace_id', 'sync_workspace_settings.workspace_id');

-- ─── 3. PK ──────────────────────────────────────────────────────────────────
SELECT col_is_pk('public', 'sync_workspaces', 'id', 'sync_workspaces PK — id');
SELECT col_is_pk(
  'public', 'sync_workspace_settings', ARRAY['workspace_id', 'key'],
  'sync_workspace_settings PK — (workspace_id, key)'
);

-- ─── 4. workspace_id NOT NULL во всех шести sync-таблицах ────────────────────
SELECT col_not_null('public', 'sync_tasks',             'workspace_id', 'sync_tasks.workspace_id NOT NULL');
SELECT col_not_null('public', 'sync_statuses',          'workspace_id', 'sync_statuses.workspace_id NOT NULL');
SELECT col_not_null('public', 'sync_tags',              'workspace_id', 'sync_tags.workspace_id NOT NULL');
SELECT col_not_null('public', 'sync_task_templates',    'workspace_id', 'sync_task_templates.workspace_id NOT NULL');
SELECT col_not_null('public', 'sync_overdue_events',    'workspace_id', 'sync_overdue_events.workspace_id NOT NULL');
SELECT col_not_null('public', 'sync_task_hold_periods', 'workspace_id', 'sync_task_hold_periods.workspace_id NOT NULL');

-- ─── 5. Дефолты ─────────────────────────────────────────────────────────────
SELECT col_default_is('public', 'sync_workspaces',        'kind', 'personal', 'kind DEFAULT personal');
SELECT col_default_is('public', 'sync_workspace_members', 'role', 'owner',    'role DEFAULT owner');

-- ─── 6. RLS включён на трёх новых таблицах ──────────────────────────────────
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sync_workspaces'::regclass),
          'RLS enabled on sync_workspaces');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sync_workspace_members'::regclass),
          'RLS enabled on sync_workspace_members');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sync_workspace_settings'::regclass),
          'RLS enabled on sync_workspace_settings');

-- ─── 7. has_workspace_role: viewer < editor < owner ─────────────────────────
DO $$
DECLARE
  u_o uuid := '91111111-1111-1111-1111-111111111111'::uuid; -- owner
  u_e uuid := '92222222-2222-2222-2222-222222222222'::uuid; -- editor
  u_v uuid := '93333333-3333-3333-3333-333333333333'::uuid; -- viewer
  u_n uuid := '94444444-4444-4444-4444-444444444444'::uuid; -- не член
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (u_o, 'ws-o@test'), (u_e, 'ws-e@test'), (u_v, 'ws-v@test'), (u_n, 'ws-n@test')
    ON CONFLICT (id) DO NOTHING;
  -- Пространство владеет u_o (в реальности shared — но тут вставляем как superuser
  -- для чистой проверки функции; kind оставляем personal, чтобы не триггерить guard).
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name)
    VALUES ('ws-role-09', u_o, u_o, 'RoleTest') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('m-o-09', 'ws-role-09', u_o, 'owner'),
    ('m-e-09', 'ws-role-09', u_e, 'editor'),
    ('m-v-09', 'ws-role-09', u_v, 'viewer')
    ON CONFLICT DO NOTHING;
END$$;

-- owner: все три уровня
SELECT ok(public.has_workspace_role('ws-role-09', '91111111-1111-1111-1111-111111111111'::uuid, 'viewer'),
          'owner проходит как viewer');
SELECT ok(public.has_workspace_role('ws-role-09', '91111111-1111-1111-1111-111111111111'::uuid, 'editor'),
          'owner проходит как editor');
SELECT ok(public.has_workspace_role('ws-role-09', '91111111-1111-1111-1111-111111111111'::uuid, 'owner'),
          'owner проходит как owner');
-- editor: viewer + editor, но не owner
SELECT ok(public.has_workspace_role('ws-role-09', '92222222-2222-2222-2222-222222222222'::uuid, 'viewer'),
          'editor проходит как viewer');
SELECT ok(public.has_workspace_role('ws-role-09', '92222222-2222-2222-2222-222222222222'::uuid, 'editor'),
          'editor проходит как editor');
SELECT ok(NOT public.has_workspace_role('ws-role-09', '92222222-2222-2222-2222-222222222222'::uuid, 'owner'),
          'editor НЕ проходит как owner');
-- viewer: только viewer
SELECT ok(public.has_workspace_role('ws-role-09', '93333333-3333-3333-3333-333333333333'::uuid, 'viewer'),
          'viewer проходит как viewer');
SELECT ok(NOT public.has_workspace_role('ws-role-09', '93333333-3333-3333-3333-333333333333'::uuid, 'editor'),
          'viewer НЕ проходит как editor');
SELECT ok(NOT public.has_workspace_role('ws-role-09', '93333333-3333-3333-3333-333333333333'::uuid, 'owner'),
          'viewer НЕ проходит как owner');
-- не член: ничего
SELECT ok(NOT public.has_workspace_role('ws-role-09', '94444444-4444-4444-4444-444444444444'::uuid, 'viewer'),
          'не-член не проходит даже как viewer');

-- ─── 8. kind='shared' теперь допустим на уровне схемы (0030 снял guard) ───────
-- Wave A блокировал shared триггером block_shared_workspaces (23514). Миграция
-- 0030 (Wave B, PR-b-01) сняла триггер: kind='shared' проходит на уровне схемы
-- (продуктово shared всё ещё закрыт — нет UI/invitations, для free упирается в
-- тарифный лимит 0). Здесь superuser (auth.uid() NULL) → лимит/RLS не мешают.
SELECT lives_ok(
  $$ INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
       VALUES ('ws-shared-09', '91111111-1111-1111-1111-111111111111'::uuid,
               '91111111-1111-1111-1111-111111111111'::uuid, 'Shared', 'shared') $$,
  'INSERT kind=shared теперь проходит (guard block_shared_workspaces снят 0030)'
);
SELECT lives_ok(
  $$ UPDATE public.sync_workspaces SET kind = 'shared' WHERE id = 'ws-role-09' $$,
  'UPDATE personal→shared теперь проходит (guard снят 0030)'
);

-- ─── 9. Backfill: легаси-юзер без пространства ──────────────────────────────
-- Симулируем состояние ДО backfill'а: строки с workspace_id IS NULL. Для этого
-- временно снимаем NOT NULL внутри транзакции теста (откатится ROLLBACK'ом).
ALTER TABLE public.sync_statuses ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE public.sync_tasks    ALTER COLUMN workspace_id DROP NOT NULL;

DO $$
DECLARE
  u_leg uuid := '95555555-5555-5555-5555-555555555555'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u_leg, 'legacy@test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id, email, public_user_id)
    VALUES (u_leg, 'legacy@test', public.assign_public_user_id()) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.sync_statuses (id, user_id, name, color)
    VALUES ('leg-st', u_leg, 'todo', '#888') ON CONFLICT DO NOTHING;      -- workspace_id NULL
  INSERT INTO public.sync_tasks (id, user_id, title, status_id)
    VALUES ('leg-task', u_leg, 'Legacy task', 'leg-st') ON CONFLICT DO NOTHING; -- workspace_id NULL
END$$;

-- Прогоняем backfill.
SELECT public.backfill_personal_workspaces();

SELECT is(
  (SELECT count(*)::int FROM public.sync_workspaces
     WHERE id = 'ws_95555555555555555555555555555555' AND kind = 'personal'),
  1,
  'backfill создал personal-пространство с детерминированным id ws_<uid>'
);
SELECT is(
  (SELECT count(*)::int FROM public.sync_workspace_members
     WHERE workspace_id = 'ws_95555555555555555555555555555555'
       AND user_id = '95555555-5555-5555-5555-555555555555'::uuid
       AND role = 'owner'),
  1,
  'backfill создал owner-членство'
);
SELECT is(
  (SELECT workspace_id FROM public.sync_tasks WHERE id = 'leg-task'),
  'ws_95555555555555555555555555555555',
  'backfill проставил workspace_id задаче'
);
SELECT is(
  (SELECT workspace_id FROM public.sync_statuses WHERE id = 'leg-st'),
  'ws_95555555555555555555555555555555',
  'backfill проставил workspace_id статусу'
);
-- Идемпотентность: повторный вызов не плодит дубли.
SELECT public.backfill_personal_workspaces();
SELECT is(
  (SELECT count(*)::int FROM public.sync_workspaces
     WHERE user_id = '95555555-5555-5555-5555-555555555555'::uuid),
  1,
  'backfill идемпотентен: повторный вызов не создал второе пространство'
);

-- Возвращаем NOT NULL (чистота состояния; ROLLBACK всё равно откатит).
UPDATE public.sync_statuses SET workspace_id = 'ws_95555555555555555555555555555555' WHERE workspace_id IS NULL;
UPDATE public.sync_tasks    SET workspace_id = 'ws_95555555555555555555555555555555' WHERE workspace_id IS NULL;
ALTER TABLE public.sync_statuses ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.sync_tasks    ALTER COLUMN workspace_id SET NOT NULL;

-- ─── 10. RLS-изоляция: каждый видит только своё пространство ─────────────────
DO $$
DECLARE
  u_a uuid := '96666666-6666-6666-6666-666666666666'::uuid;
  u_b uuid := '97777777-7777-7777-7777-777777777777'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u_a, 'iso-a@test'), (u_b, 'iso-b@test')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name) VALUES
    ('ws-a-09', u_a, u_a, 'A'), ('ws-b-09', u_b, u_b, 'B') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('m-a-09', 'ws-a-09', u_a, 'owner'), ('m-b-09', 'ws-b-09', u_b, 'owner')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_statuses (id, user_id, workspace_id, name, color) VALUES
    ('iso-st-a', u_a, 'ws-a-09', 'todo', '#888'),
    ('iso-st-b', u_b, 'ws-b-09', 'todo', '#888') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_tasks (id, user_id, workspace_id, title, status_id) VALUES
    ('iso-task-a', u_a, 'ws-a-09', 'A task', 'iso-st-a'),
    ('iso-task-b', u_b, 'ws-b-09', 'B task', 'iso-st-b') ON CONFLICT DO NOTHING;
END$$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO '96666666-6666-6666-6666-666666666666';

SELECT is(
  (SELECT count(*)::int FROM public.sync_tasks WHERE id = 'iso-task-a'),
  1, 'u_a видит свою задачу (своё пространство)'
);
SELECT is(
  (SELECT count(*)::int FROM public.sync_tasks WHERE id = 'iso-task-b'),
  0, 'u_a НЕ видит задачу чужого пространства'
);
SELECT is(
  (SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id = 'ws-a-09'),
  1, 'u_a видит ровно свои задачи в своём пространстве'
);
SELECT is(
  (SELECT count(*)::int FROM public.sync_workspaces WHERE id = 'ws-a-09'),
  1, 'u_a видит своё пространство'
);
SELECT is(
  (SELECT count(*)::int FROM public.sync_workspaces WHERE id = 'ws-b-09'),
  0, 'u_a НЕ видит чужое пространство'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
