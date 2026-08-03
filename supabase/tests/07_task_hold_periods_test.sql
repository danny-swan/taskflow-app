-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- pgTAP: sync_task_hold_periods (миграция 0025) — структура, триггеры,
-- realtime и cascade.
--
-- Проверяет что:
--   1) таблица существует с ожидаемыми колонками;
--   2) version bump + updated_at триггеры срабатывают на UPDATE;
--   3) таблица в publication supabase_realtime;
--   4) удаление auth.users каскадит в hold-периоды (on delete cascade).
--
-- Серверного триггера на sync_tasks НЕТ (клиент — единственный автор строк).

BEGIN;
SELECT plan(10);

-- ─── 1. Таблица и ключевые колонки ─────────────────────────────────────────
SELECT has_table('public', 'sync_task_hold_periods', 'sync_task_hold_periods существует');
SELECT has_column('public', 'sync_task_hold_periods', 'task_id', 'есть task_id');
SELECT has_column('public', 'sync_task_hold_periods', 'started_at', 'есть started_at');
SELECT has_column('public', 'sync_task_hold_periods', 'ended_at', 'есть ended_at (NULL = открытый)');
SELECT col_is_pk('public', 'sync_task_hold_periods', 'id', 'PK — id');

-- ─── 2. Подготовка: юзер + задача + интервал ───────────────────────────────
DO $$
DECLARE
  u1 uuid := '31111111-1111-1111-1111-111111111111'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u1, 'hold-user1@test')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id, email) VALUES (u1, 'hold-user1@test')
    ON CONFLICT (id) DO NOTHING;
  -- Workspace + owner-членство (0027): workspace_id стал NOT NULL в sync-таблицах.
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
    VALUES ('hold-ws-u1', u1, u1, 'Мои задачи', 'personal') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role)
    VALUES ('hold-wsm-u1', 'hold-ws-u1', u1, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_statuses (id, user_id, workspace_id, name, color)
    VALUES ('hold-st-u1', u1, 'hold-ws-u1', 'Приостановлено', '#888') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_tasks (user_id, workspace_id, id, title, status_id)
    VALUES (u1, 'hold-ws-u1', 'hold-task-u1', 'Held task', 'hold-st-u1') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_task_hold_periods (id, user_id, workspace_id, task_id, started_at, version)
    VALUES ('hold-p1', u1, 'hold-ws-u1', 'hold-task-u1', now() - interval '3 days', 1)
    ON CONFLICT DO NOTHING;
END$$;

-- ─── 3. Триггеры version bump + updated_at на UPDATE ───────────────────────
UPDATE public.sync_task_hold_periods
  SET ended_at = now(), version = version  -- version не меняем явно → триггер bump'нёт
  WHERE id = 'hold-p1';

SELECT is(
  (SELECT version FROM public.sync_task_hold_periods WHERE id = 'hold-p1'),
  2,
  'version инкрементнут триггером sync_bump_version (1 → 2)'
);
SELECT ok(
  (SELECT ended_at IS NOT NULL FROM public.sync_task_hold_periods WHERE id = 'hold-p1'),
  'ended_at закрыт (интервал завершён)'
);
SELECT ok(
  (SELECT updated_at >= created_at FROM public.sync_task_hold_periods WHERE id = 'hold-p1'),
  'updated_at обновлён триггером (>= created_at)'
);

-- ─── 4. Realtime publication membership ────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'sync_task_hold_periods'
  ),
  'sync_task_hold_periods в publication supabase_realtime'
);

-- ─── 5. Cascade: удаление юзера убирает его hold-периоды ────────────────────
DELETE FROM auth.users WHERE id = '31111111-1111-1111-1111-111111111111'::uuid;
SELECT is(
  (SELECT count(*)::int FROM public.sync_task_hold_periods WHERE id = 'hold-p1'),
  0,
  'hold-периоды каскадно удалены вместе с auth.users'
);

SELECT * FROM finish();
ROLLBACK;
