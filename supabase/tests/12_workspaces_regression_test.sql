-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- pgTAP: regression hardening фундамента «Пространств» (Wave A, PR-6).
--
-- Цель — жёстко зафиксировать инварианты фундамента (миграции 0027-0029),
-- чтобы Wave B (открытие shared) стартовал с уверенной базой. Продуктовых
-- изменений НЕТ, только regression-покрытие. Дополняет 09/10/11, НЕ дублируя их:
--   • 09 покрыл существование таблиц/колонок, NOT NULL, has_workspace_role,
--     backfill, базовую SELECT-изоляцию одного юзера;
--   • 10 — CRUD/членство/soft-delete (не в CI, см. отчёт PR-6);
--   • 11 — тарифные лимиты.
-- Здесь добиваем пробелы:
--   A) двусторонняя RLS-изоляция между пространствами ДВУХ юзеров (SELECT/
--      UPDATE/DELETE/INSERT чужого workspace_id; members; workspaces);
--   B) фактическое поведение при удалении пространства (soft/hard, каскад);
--   C) integrity колонки workspace_id (индексы, FK-факты, owner_id, backfill).
--
-- ─── ЗАФИКСИРОВАННЫЕ ФАКТЫ СХЕМЫ (обновлено под 0030, Wave B PR-b-01) ─────────
--   • workspace_id в шести sync-таблицах И в members/settings — text С FK на
--     sync_workspaces(id) ON DELETE CASCADE (введён 0030; тип остаётся text —
--     id имеют формат 'ws_<hex>', не uuid, см. 0030/13). Следствия:
--       – INSERT с несуществующим workspace_id падает FK-violation 23503 (даже
--         у superuser: FK проверяется всегда, вне RLS) — тест C8;
--       – hard DELETE пространства каскадит на дочерние строки/members/settings
--         (тесты B9-B11); soft DELETE (deleted_at) НЕ каскадит.
--     До 0030 (Wave A) FK не было — целостность держалась на клиенте + RLS.
--   • sync_workspaces.owner_id / user_id — NOT NULL + FK на auth.users
--     ON DELETE CASCADE (удаление аккаунта сносит его personal-ws).
--   • RLS UPDATE-политика через WITH CHECK НЕ даёт перенести строку в чужой
--     workspace_id (положительный инвариант, тест C15).
--
-- Все тесты идут на vanilla Postgres 15 (CI). Никаких PG18-only фич
-- (pg_stat_io, MERGE ... RETURNING, SQL/JSON-конструкторы вне PG15 subset).
-- Механику RLS через `SET LOCAL request.jwt.claim.sub` подтверждает 09.
--
-- Стиль — как 09/11.

BEGIN;
SELECT plan(45);

-- ============================================================================
-- ГРУППА A: RLS-изоляция между пространствами двух юзеров (18 тестов)
-- ============================================================================
-- Данные наливаем как superuser (auth.uid() IS NULL → RLS/триггеры-лимиты не
-- мешают), затем переключаемся в role authenticated с JWT конкретного юзера.
DO $$
DECLARE
  u_a uuid := '6aaa0000-0000-0000-0000-000000000001'::uuid;
  u_b uuid := '6bbb0000-0000-0000-0000-000000000002'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u_a, 'reg-a@test'), (u_b, 'reg-b@test')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('wsA-12', u_a, u_a, 'A ws', 'personal'),
    ('wsB-12', u_b, u_b, 'B ws', 'personal') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('mA-12', 'wsA-12', u_a, 'owner'),
    ('mB-12', 'wsB-12', u_b, 'owner') ON CONFLICT DO NOTHING;

  -- По одной строке в каждой из шести sync-таблиц под каждый ws.
  INSERT INTO public.sync_statuses (id, user_id, workspace_id, name, color) VALUES
    ('stA-12', u_a, 'wsA-12', 'todo', '#111'),
    ('stB-12', u_b, 'wsB-12', 'todo', '#222') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_tags (id, user_id, workspace_id, name, color) VALUES
    ('tgA-12', u_a, 'wsA-12', 'tagA', '#111'),
    ('tgB-12', u_b, 'wsB-12', 'tagB', '#222') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_tasks (id, user_id, workspace_id, title, status_id) VALUES
    ('tkA-12', u_a, 'wsA-12', 'A task', 'stA-12'),
    ('tkB-12', u_b, 'wsB-12', 'B task', 'stB-12') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_task_templates (id, user_id, workspace_id, name) VALUES
    ('tplA-12', u_a, 'wsA-12', 'A tpl'),
    ('tplB-12', u_b, 'wsB-12', 'B tpl') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_overdue_events (id, user_id, workspace_id, task_id, deadline_snapshot, event_date) VALUES
    ('ovA-12', u_a, 'wsA-12', 'tkA-12', '2026-01-01', '2026-01-02'),
    ('ovB-12', u_b, 'wsB-12', 'tkB-12', '2026-01-01', '2026-01-02') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_task_hold_periods (id, user_id, workspace_id, task_id, started_at) VALUES
    ('hpA-12', u_a, 'wsA-12', 'tkA-12', now()),
    ('hpB-12', u_b, 'wsB-12', 'tkB-12', now()) ON CONFLICT DO NOTHING;
END$$;

-- ─── has_workspace_role: не-член vs owner (SECURITY DEFINER, прямой SELECT) ──
SELECT ok(
  NOT public.has_workspace_role('wsB-12', '6aaa0000-0000-0000-0000-000000000001'::uuid, 'viewer'),
  'A1: has_workspace_role=false для A в чужом ws-B (не член)'
);
SELECT ok(
  public.has_workspace_role('wsA-12', '6aaa0000-0000-0000-0000-000000000001'::uuid, 'owner'),
  'A2: has_workspace_role=true для A-owner в своём ws-A'
);

-- ─── Юзер A: видит только своё пространство ──────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO '6aaa0000-0000-0000-0000-000000000001';

SELECT is((SELECT count(*)::int FROM public.sync_workspaces WHERE id = 'wsA-12'),
          1, 'A3: A видит своё пространство');
SELECT is((SELECT count(*)::int FROM public.sync_workspaces WHERE id = 'wsB-12'),
          0, 'A4: A НЕ видит чужое пространство B');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members WHERE workspace_id = 'wsB-12'),
          0, 'A5: A НЕ видит членство чужого пространства B');

-- ─── Юзер A: SELECT чужих строк во всех шести sync-таблицах → 0 ──────────────
SELECT is((SELECT count(*)::int FROM public.sync_tasks             WHERE id = 'tkB-12'), 0, 'A6: A не видит чужую sync_tasks');
SELECT is((SELECT count(*)::int FROM public.sync_statuses          WHERE id = 'stB-12'), 0, 'A7: A не видит чужую sync_statuses');
SELECT is((SELECT count(*)::int FROM public.sync_tags              WHERE id = 'tgB-12'), 0, 'A8: A не видит чужую sync_tags');
SELECT is((SELECT count(*)::int FROM public.sync_task_templates    WHERE id = 'tplB-12'),0, 'A9: A не видит чужую sync_task_templates');
SELECT is((SELECT count(*)::int FROM public.sync_overdue_events    WHERE id = 'ovB-12'), 0, 'A10: A не видит чужую sync_overdue_events');
SELECT is((SELECT count(*)::int FROM public.sync_task_hold_periods WHERE id = 'hpB-12'), 0, 'A11: A не видит чужую sync_task_hold_periods');

-- ─── Юзер A: UPDATE/DELETE чужой строки (RLS USING отсекает → 0 строк) ───────
UPDATE public.sync_tasks SET title = 'HACKED' WHERE id = 'tkB-12';
DELETE FROM public.sync_tasks WHERE id = 'tkB-12';
-- ─── Юзер A: INSERT с чужим workspace_id (RLS WITH CHECK → 42501) ────────────
SELECT throws_ok(
  $$ INSERT INTO public.sync_tasks (id, user_id, workspace_id, title)
       VALUES ('tk-inj-a', '6aaa0000-0000-0000-0000-000000000001'::uuid, 'wsB-12', 'inj') $$,
  '42501', NULL, 'A12: A НЕ может INSERT sync_tasks с чужим workspace_id'
);
SELECT throws_ok(
  $$ INSERT INTO public.sync_statuses (id, user_id, workspace_id, name, color)
       VALUES ('st-inj-a', '6aaa0000-0000-0000-0000-000000000001'::uuid, 'wsB-12', 'x', '#000') $$,
  '42501', NULL, 'A13: A НЕ может INSERT sync_statuses с чужим workspace_id'
);
-- INSERT в members чужого ws, куда A не звали (RLS WITH CHECK → 42501).
SELECT throws_ok(
  $$ INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role)
       VALUES ('m-inj-a', 'wsB-12', '6aaa0000-0000-0000-0000-000000000001'::uuid, 'viewer') $$,
  '42501', NULL, 'A14: A НЕ может INSERT членство в чужое пространство B'
);
-- UPDATE чужого пространства (owner-only на update → 0 строк).
UPDATE public.sync_workspaces SET name = 'HACKED' WHERE id = 'wsB-12';

RESET ROLE;

-- Юзер B видит своё, но не A (зеркальная проверка).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO '6bbb0000-0000-0000-0000-000000000002';
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE id = 'tkA-12'),
          0, 'A15: B НЕ видит задачу пространства A (зеркально)');
UPDATE public.sync_workspaces SET name = 'HACKED' WHERE id = 'wsA-12';
RESET ROLE;
-- Сбрасываем JWT-claim: RESET ROLE его НЕ трогает, а дальше нужны операции с
-- auth.uid() IS NULL (superuser), иначе guard'ы 0028 приняли бы нас за юзера.
SET LOCAL request.jwt.claim.sub TO '';

-- Проверяем, что попытки A/B ничего не изменили (как superuser).
SELECT is((SELECT title FROM public.sync_tasks WHERE id = 'tkB-12'),
          'B task', 'A16: чужая задача B не изменена и не удалена атакой A (UPDATE/DELETE отсечены)');
SELECT is((SELECT name FROM public.sync_workspaces WHERE id = 'wsB-12'),
          'B ws', 'A17: пространство B не переименовано атакой A (owner-only update)');
SELECT is((SELECT name FROM public.sync_workspaces WHERE id = 'wsA-12'),
          'A ws', 'A18: пространство A не переименовано атакой B (зеркально)');

-- ============================================================================
-- ГРУППА B: удаление пространства — фактическое поведение (12 тестов)
-- ============================================================================
-- Наполняем ws-C1 всеми видами дочерних строк + второй ws-C2 для проверки
-- изоляции удаления. Всё под superuser.
DO $$
DECLARE
  u_c uuid := '6ccc0000-0000-0000-0000-000000000003'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u_c, 'reg-c@test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('wsC1-12', u_c, u_c, 'C1', 'personal'),
    ('wsC2-12', u_c, u_c, 'C2', 'personal') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('mC1-12', 'wsC1-12', u_c, 'owner'),
    ('mC2-12', 'wsC2-12', u_c, 'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_statuses (id, user_id, workspace_id, name, color) VALUES
    ('stC1a-12', u_c, 'wsC1-12', 's1', '#111'),
    ('stC1b-12', u_c, 'wsC1-12', 's2', '#111') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_tags (id, user_id, workspace_id, name, color) VALUES
    ('tgC1a-12', u_c, 'wsC1-12', 't1', '#111'),
    ('tgC1b-12', u_c, 'wsC1-12', 't2', '#111') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_tasks (id, user_id, workspace_id, title) VALUES
    ('tkC1a-12', u_c, 'wsC1-12', 'c1 task 1'),
    ('tkC1b-12', u_c, 'wsC1-12', 'c1 task 2'),
    ('tkC2a-12', u_c, 'wsC2-12', 'c2 task 1') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_task_templates (id, user_id, workspace_id, name) VALUES
    ('tplC1-12', u_c, 'wsC1-12', 'c1 tpl') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_overdue_events (id, user_id, workspace_id, task_id, deadline_snapshot, event_date) VALUES
    ('ovC1-12', u_c, 'wsC1-12', 'tkC1a-12', '2026-01-01', '2026-01-02') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_task_hold_periods (id, user_id, workspace_id, task_id, started_at) VALUES
    ('hpC1-12', u_c, 'wsC1-12', 'tkC1a-12', now()) ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_settings (workspace_id, key, value) VALUES
    ('wsC1-12', 'overdue_mode', 'calendar') ON CONFLICT DO NOTHING;
END$$;

-- ─── Предзагрузка ────────────────────────────────────────────────────────────
SELECT results_eq(
  $$ SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id = 'wsC1-12' $$,
  $$ VALUES (2) $$, 'B1: предзагрузка — 2 задачи в ws-C1');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_settings WHERE workspace_id = 'wsC1-12'),
          1, 'B2: предзагрузка — 1 settings-строка в ws-C1');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members WHERE workspace_id = 'wsC1-12'),
          1, 'B3: предзагрузка — 1 owner-членство в ws-C1');

-- ─── SOFT delete: только помечает ws, дочерние строки остаются физически ─────
-- Как superuser (auth.uid() IS NULL) → block_personal_workspace_delete пропускает.
UPDATE public.sync_workspaces SET deleted_at = now() WHERE id = 'wsC1-12';
SELECT isnt((SELECT deleted_at FROM public.sync_workspaces WHERE id = 'wsC1-12'),
            NULL, 'B4: soft-delete проставил deleted_at на ws-C1');
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id = 'wsC1-12'),
          2, 'B5: soft-delete НЕ трогает дочерние задачи (остаются физически)');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_settings WHERE workspace_id = 'wsC1-12'),
          1, 'B6: soft-delete НЕ трогает settings (остаются физически)');

-- ─── HARD delete: FK+CASCADE (0030) → дочерние строки удаляются каскадом ─────
SELECT lives_ok(
  $$ DELETE FROM public.sync_workspaces WHERE id = 'wsC1-12' $$,
  'B7: hard DELETE ws-C1 проходит');
SELECT is((SELECT count(*)::int FROM public.sync_workspaces WHERE id = 'wsC1-12'),
          0, 'B8: строка ws-C1 физически удалена');
-- Поведение после 0030: FK workspace_id → sync_workspaces(id) ON DELETE CASCADE.
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id = 'wsC1-12'),
          0, 'B9: дочерние задачи удалены каскадом (FK ON DELETE CASCADE, 0030)');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members WHERE workspace_id = 'wsC1-12'),
          0, 'B10: members удалены каскадом (FK ON DELETE CASCADE, 0030)');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_settings WHERE workspace_id = 'wsC1-12'),
          0, 'B11: settings удалены каскадом (FK ON DELETE CASCADE, 0030)');

-- ─── Изоляция удаления: данные второго ws того же юзера не тронуты ───────────
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id = 'wsC2-12'),
          1, 'B12: удаление ws-C1 не задело данные ws-C2 того же юзера');

-- ============================================================================
-- ГРУППА C: integrity колонки workspace_id и owner_id (15 тестов)
-- ============================================================================
-- ─── C1-6: workspace_id проиндексирован во всех шести sync-таблицах ──────────
-- (09 проверял NOT NULL; индексы — здесь, чтобы не дублировать. В этой версии
-- pgTAP col_is_indexed нет, используем has_index по имени индекса из 0027.)
SELECT has_index('public', 'sync_tasks',             'sync_tasks_workspace_idx',             'workspace_id', 'C1: sync_tasks.workspace_id индексирован');
SELECT has_index('public', 'sync_statuses',          'sync_statuses_workspace_idx',          'workspace_id', 'C2: sync_statuses.workspace_id индексирован');
SELECT has_index('public', 'sync_tags',              'sync_tags_workspace_idx',              'workspace_id', 'C3: sync_tags.workspace_id индексирован');
SELECT has_index('public', 'sync_task_templates',    'sync_task_templates_workspace_idx',    'workspace_id', 'C4: sync_task_templates.workspace_id индексирован');
SELECT has_index('public', 'sync_overdue_events',    'sync_overdue_events_workspace_idx',    'workspace_id', 'C5: sync_overdue_events.workspace_id индексирован');
SELECT has_index('public', 'sync_task_hold_periods', 'sync_task_hold_periods_workspace_idx', 'workspace_id', 'C6: sync_task_hold_periods.workspace_id индексирован');

-- ─── C7: FK на workspace_id теперь ЕСТЬ (введён 0030, Wave B PR-b-01) ────────
-- Инвариант ADR 0005 п.5: workspace_id → sync_workspaces(id). Прямое
-- подтверждение через каталог: ровно 1 FK-констрейнт из sync_tasks.workspace_id.
SELECT is(
  (SELECT count(*)::int
     FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.sync_tasks'::regclass
      AND c.contype = 'f'
      AND a.attname = 'workspace_id'),
  1, 'C7: sync_tasks.workspace_id имеет FK → sync_workspaces(id) (0030)'
);

-- ─── C8: как следствие FK — INSERT с несуществующим ws падает 23503 ──────────
-- До 0030 INSERT проходил (не было FK). Теперь FK отклоняет orphan даже у
-- superuser (FK проверяется всегда, вне зависимости от RLS).
SELECT throws_ok(
  $$ INSERT INTO public.sync_tasks (id, user_id, workspace_id, title)
       VALUES ('tk-nofk-12', '6ccc0000-0000-0000-0000-000000000003'::uuid,
               'ws-does-not-exist-12', 'orphan') $$,
  '23503', NULL,
  'C8: INSERT с несуществующим workspace_id падает FK-violation 23503 (0030)'
);

-- ─── C9-11: owner_id / user_id integrity на sync_workspaces ──────────────────
SELECT col_not_null('public', 'sync_workspaces', 'owner_id', 'C9: sync_workspaces.owner_id NOT NULL');
SELECT col_not_null('public', 'sync_workspaces', 'user_id',  'C10: sync_workspaces.user_id NOT NULL');
SELECT fk_ok('public', 'sync_workspaces', 'owner_id', 'auth', 'users', 'id',
             'C11: sync_workspaces.owner_id → auth.users(id) FK');

-- ─── C12-13: удаление auth.users каскадит на его пространство (ON DELETE CASCADE) ─
DO $$
DECLARE u_del uuid := '6ddd0000-0000-0000-0000-000000000004'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u_del, 'reg-del@test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
    VALUES ('wsDEL-12', u_del, u_del, 'DEL', 'personal') ON CONFLICT DO NOTHING;
END$$;
SELECT lives_ok(
  $$ DELETE FROM auth.users WHERE id = '6ddd0000-0000-0000-0000-000000000004' $$,
  'C12: удаление auth.users проходит (owner_id/user_id FK ON DELETE CASCADE)'
);
SELECT is((SELECT count(*)::int FROM public.sync_workspaces WHERE id = 'wsDEL-12'),
          0, 'C13: personal-ws каскадно удалён вместе с аккаунтом владельца');

-- ─── C14: backfill sanity — ровно одно personal-пространство у нового юзера ──
DO $$
DECLARE u_g uuid := '69990000-0000-0000-0000-000000000007'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u_g, 'reg-g@test') ON CONFLICT (id) DO NOTHING;
  -- profiles-строка → backfill подхватит юзера (union по profiles).
  INSERT INTO public.profiles (id, email, public_user_id)
    VALUES (u_g, 'reg-g@test', public.assign_public_user_id()) ON CONFLICT (id) DO NOTHING;
END$$;
SELECT public.backfill_personal_workspaces();
SELECT is(
  (SELECT count(*)::int FROM public.sync_workspaces
     WHERE owner_id = '69990000-0000-0000-0000-000000000007'::uuid AND kind = 'personal'),
  1, 'C14: backfill дал ровно одно personal-пространство новому юзеру'
);

-- ─── C15: RLS WITH CHECK не даёт перенести строку в чужой workspace_id ───────
-- Положительный инвариант: клиент/атакующий под своей ролью не может «увести»
-- задачу в чужое пространство (USING проходит по своему OLD, WITH CHECK падает
-- на чужом NEW). Готовим владельца wsA-12 (создан в группе A) и чужой wsB-12.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO '6aaa0000-0000-0000-0000-000000000001';
SELECT throws_ok(
  $$ UPDATE public.sync_tasks SET workspace_id = 'wsB-12' WHERE id = 'tkA-12' $$,
  '42501', NULL,
  'C15: RLS WITH CHECK блокирует перенос своей задачи в чужой workspace_id'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
