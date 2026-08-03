-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- pgTAP: ссылочная целостность workspace_id (миграция 0030, Wave B, PR-b-01).
--
-- Фиксирует новые инварианты, введённые 0030 (реализация ADR 0005 п.5):
--   A) FK workspace_id → sync_workspaces(id) существует для всех 8 таблиц
--      (6 sync + members + settings);
--   B) все эти FK — ON DELETE CASCADE и DEFERRABLE;
--   C) тип колонки workspace_id — text (НЕ uuid! см. ниже);
--   D) поведение: orphan INSERT падает 23503; hard DELETE каскадит; soft
--      DELETE (deleted_at) НЕ каскадит; guard block_shared_workspaces снят;
--      kind='shared' теперь вставляется; free+shared лимит по-прежнему 0.
--
-- ─── ПОЧЕМУ text, А НЕ uuid ─────────────────────────────────────────────────
-- План (wave-b-plan §3, ADR 0005 п.5) предполагал перевод workspace_id в uuid.
-- Это невозможно: sync_workspaces.id — text PK формата 'ws_<hex>' (0027), id
-- генерируется идентично на клиенте и сервере для склейки personal-ws по PK;
-- 'ws_...'::uuid → ошибка. FK+CASCADE навешены на text (text→text FK валиден),
-- суть ADR достигнута без смены типа. Поэтому здесь ассертим text, а НЕ uuid —
-- это зафиксированное расхождение (см. 0030 шапку и wave-b-plan §3-факт).
--
-- Инварианты 0027-0029 (обратная совместимость) НЕ дублируем — за них отвечают
-- 09/11/12. Данные наливаем как superuser (auth.uid() IS NULL → RLS/limit/guard
-- не мешают), поведение FK проверяем на «сырой» схеме.
--
-- Стиль — как 09/11/12. Выполняется на vanilla Postgres 15 (CI).

BEGIN;
SELECT plan(31);

-- ============================================================================
-- ГРУППА A: FK workspace_id → sync_workspaces(id) существует (8 тестов)
-- ============================================================================
SELECT fk_ok('public', 'sync_tasks',             'workspace_id', 'public', 'sync_workspaces', 'id',
             'A1: sync_tasks.workspace_id → sync_workspaces(id) FK');
SELECT fk_ok('public', 'sync_statuses',          'workspace_id', 'public', 'sync_workspaces', 'id',
             'A2: sync_statuses.workspace_id → sync_workspaces(id) FK');
SELECT fk_ok('public', 'sync_tags',              'workspace_id', 'public', 'sync_workspaces', 'id',
             'A3: sync_tags.workspace_id → sync_workspaces(id) FK');
SELECT fk_ok('public', 'sync_task_templates',    'workspace_id', 'public', 'sync_workspaces', 'id',
             'A4: sync_task_templates.workspace_id → sync_workspaces(id) FK');
SELECT fk_ok('public', 'sync_overdue_events',    'workspace_id', 'public', 'sync_workspaces', 'id',
             'A5: sync_overdue_events.workspace_id → sync_workspaces(id) FK');
SELECT fk_ok('public', 'sync_task_hold_periods', 'workspace_id', 'public', 'sync_workspaces', 'id',
             'A6: sync_task_hold_periods.workspace_id → sync_workspaces(id) FK');
SELECT fk_ok('public', 'sync_workspace_members', 'workspace_id', 'public', 'sync_workspaces', 'id',
             'A7: sync_workspace_members.workspace_id → sync_workspaces(id) FK');
SELECT fk_ok('public', 'sync_workspace_settings','workspace_id', 'public', 'sync_workspaces', 'id',
             'A8: sync_workspace_settings.workspace_id → sync_workspaces(id) FK');

-- ============================================================================
-- ГРУППА B: все 8 FK — ON DELETE CASCADE и DEFERRABLE (2 теста)
-- ============================================================================
-- pgTAP этой версии не имеет col_has_fk_delete_action → проверяем каталог.
-- confdeltype='c' = CASCADE; condeferrable=true = DEFERRABLE. Имя FK
-- предсказуемое <table>_workspace_id_fkey (задано 0030).
-- ПРИМ.: sync_workspace_invites (0032) добавила 9-й workspace_id→sync_workspaces
-- FK (тоже CASCADE, но НЕ deferrable — серверная таблица, не участвует в sync-
-- батчах). Инвариант 0030 — про 8 клиентских workspace-таблиц, поэтому явно
-- исключаем invites из счётчика, чтобы ассерт оставался точным «ровно 8».
SELECT is(
  (SELECT count(*)::int FROM pg_constraint
     WHERE contype = 'f'
       AND conname LIKE '%\_workspace\_id\_fkey'
       AND confrelid = 'public.sync_workspaces'::regclass
       AND conrelid <> 'public.sync_workspace_invites'::regclass
       AND confdeltype = 'c'),
  8, 'B1: все 8 workspace_id FK имеют ON DELETE CASCADE (confdeltype=c)'
);
SELECT is(
  (SELECT count(*)::int FROM pg_constraint
     WHERE contype = 'f'
       AND conname LIKE '%\_workspace\_id\_fkey'
       AND confrelid = 'public.sync_workspaces'::regclass
       AND conrelid <> 'public.sync_workspace_invites'::regclass
       AND condeferrable IS TRUE),
  8, 'B2: все 8 workspace_id FK — DEFERRABLE (INITIALLY IMMEDIATE)'
);

-- ============================================================================
-- ГРУППА C: тип колонки workspace_id — text, НЕ uuid (8 тестов)
-- ============================================================================
-- Зафиксированное расхождение с планом: остаётся text (см. шапку файла).
SELECT col_type_is('public', 'sync_tasks',             'workspace_id', 'text', 'C1: sync_tasks.workspace_id — text (не uuid)');
SELECT col_type_is('public', 'sync_statuses',          'workspace_id', 'text', 'C2: sync_statuses.workspace_id — text');
SELECT col_type_is('public', 'sync_tags',              'workspace_id', 'text', 'C3: sync_tags.workspace_id — text');
SELECT col_type_is('public', 'sync_task_templates',    'workspace_id', 'text', 'C4: sync_task_templates.workspace_id — text');
SELECT col_type_is('public', 'sync_overdue_events',    'workspace_id', 'text', 'C5: sync_overdue_events.workspace_id — text');
SELECT col_type_is('public', 'sync_task_hold_periods', 'workspace_id', 'text', 'C6: sync_task_hold_periods.workspace_id — text');
SELECT col_type_is('public', 'sync_workspace_members', 'workspace_id', 'text', 'C7: sync_workspace_members.workspace_id — text');
SELECT col_type_is('public', 'sync_workspace_settings','workspace_id', 'text', 'C8: sync_workspace_settings.workspace_id — text');

-- ============================================================================
-- ГРУППА D: поведение FK/CASCADE/guard (13 тестов)
-- ============================================================================
-- Наполняем ws-D1 всеми видами дочерних строк (superuser: guard'ы/лимиты спят).
DO $$
DECLARE
  u_d uuid := '6ddd1300-0000-0000-0000-000000000013'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u_d, 'int-d@test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('wsD1-13', u_d, u_d, 'D1', 'personal'),
    ('wsD2-13', u_d, u_d, 'D2', 'personal') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('mD1-13', 'wsD1-13', u_d, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_settings (workspace_id, key, value) VALUES
    ('wsD1-13', 'overdue_mode', 'calendar') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_statuses (id, user_id, workspace_id, name, color) VALUES
    ('stD1a-13', u_d, 'wsD1-13', 's1', '#111'),
    ('stD1b-13', u_d, 'wsD1-13', 's2', '#222') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_tags (id, user_id, workspace_id, name, color) VALUES
    ('tgD1a-13', u_d, 'wsD1-13', 't1', '#111'),
    ('tgD1b-13', u_d, 'wsD1-13', 't2', '#222') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_tasks (id, user_id, workspace_id, title, status_id) VALUES
    ('tkD1a-13', u_d, 'wsD1-13', 'task 1', 'stD1a-13'),
    ('tkD1b-13', u_d, 'wsD1-13', 'task 2', 'stD1a-13'),
    ('tkD2a-13', u_d, 'wsD2-13', 'other ws task', NULL) ON CONFLICT DO NOTHING;
END$$;

-- ─── D1-2: orphan INSERT (несуществующий workspace_id) падает 23503 ──────────
SELECT throws_ok(
  $$ INSERT INTO public.sync_tasks (id, user_id, workspace_id, title)
       VALUES ('tk-orphan-13', '6ddd1300-0000-0000-0000-000000000013'::uuid,
               'ws-does-not-exist-13', 'orphan') $$,
  '23503', NULL,
  'D1: INSERT sync_tasks с несуществующим workspace_id падает FK-violation (23503)'
);
SELECT throws_ok(
  $$ INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role)
       VALUES ('m-orphan-13', 'ws-does-not-exist-13',
               '6ddd1300-0000-0000-0000-000000000013'::uuid, 'owner') $$,
  '23503', NULL,
  'D2: INSERT sync_workspace_members с несуществующим workspace_id падает 23503'
);

-- ─── D3: hard DELETE workspace КАСКАДИТ на всех детей ────────────────────────
-- Предзагрузка (sanity).
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id = 'wsD1-13'),
          2, 'D3-pre: 2 задачи в ws-D1 до удаления');
-- Hard delete как superuser (block_personal_workspace_delete пропускает при auth.uid() NULL).
DELETE FROM public.sync_workspaces WHERE id = 'wsD1-13';
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id = 'wsD1-13'),
          0, 'D4: CASCADE удалил задачи ws-D1');
SELECT is((SELECT count(*)::int FROM public.sync_statuses WHERE workspace_id = 'wsD1-13'),
          0, 'D5: CASCADE удалил статусы ws-D1');
SELECT is((SELECT count(*)::int FROM public.sync_tags WHERE workspace_id = 'wsD1-13'),
          0, 'D6: CASCADE удалил теги ws-D1');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members WHERE workspace_id = 'wsD1-13'),
          0, 'D7: CASCADE удалил членство ws-D1');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_settings WHERE workspace_id = 'wsD1-13'),
          0, 'D8: CASCADE удалил настройки ws-D1');
-- Изоляция: соседнее пространство того же юзера не тронуто.
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id = 'wsD2-13'),
          1, 'D9: CASCADE ws-D1 не задел ws-D2 того же юзера');

-- ─── D10: soft DELETE (deleted_at) НЕ каскадит — дети остаются ───────────────
UPDATE public.sync_workspaces SET deleted_at = now() WHERE id = 'wsD2-13';
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id = 'wsD2-13'),
          1, 'D10: soft-delete ws-D2 НЕ каскадит (дочерняя задача остаётся физически)');

-- ─── D11: guard block_shared_workspaces снят (триггера больше нет) ───────────
SELECT hasnt_trigger('public', 'sync_workspaces', 'block_shared_workspaces',
                     'D11: триггер block_shared_workspaces снят (0030)');

-- ─── D12: kind='shared' теперь INSERT-ится на уровне схемы (superuser) ───────
SELECT lives_ok(
  $$ INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
       VALUES ('wsSH-13', '6ddd1300-0000-0000-0000-000000000013'::uuid,
               '6ddd1300-0000-0000-0000-000000000013'::uuid, 'Shared', 'shared') $$,
  'D12: kind=shared теперь вставляется (guard снят, схема открыта)'
);

-- ─── Регресс: free+shared тарифный лимит по-прежнему 0 (0029 не тронут) ──────
SELECT is(
  public.get_workspace_limit('6eee1300-0000-0000-0000-000000000099'::uuid, 'shared'),
  0, 'D13-регресс: get_workspace_limit(free, shared) всё ещё 0'
);

SELECT * FROM finish();
ROLLBACK;
