-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- pgTAP: расширенные RLS-политики ролей (миграция 0031, Wave B, PR-b-02).
--
-- Проверяет фактическое поведение политик <table>_<op>_ws_role в реальном
-- shared-пространстве с тремя ролями (owner/editor/viewer) + outsider:
--   • базовая матрица 3 роли × 6 sync-таблиц × операции (SELECT/INSERT/
--     UPDATE/DELETE) = 69 тестов. Исключение: sync_overdue_events —
--     append-only (триггер trg_set_updated_at из 0005 обращается к NEW.updated_at,
--     а колонки нет — миграция 0002; любой UPDATE падает независимо от RLS),
--     поэтому UPDATE для него не проверяется (3 роли × 5 UPDATE + прочие);
--   • sync_workspace_members: SELECT всем, INSERT/UPDATE/DELETE — owner,
--     editor/viewer denied; self-leave (не-owner удаляет свою строку);
--   • sync_workspace_settings: SELECT всем, запись — только owner;
--   • защита последнего owner'a (триггер assert_at_least_one_owner, 0028):
--     owner не может удалить/понизить/soft-delete сам себя, будучи единственным;
--   • outsider (не член) — ничего не видит и не может писать.
--
-- НЕ дублирует 09/12: 09 проверяет семантику самой has_workspace_role и
-- одно-/двухпользовательскую SELECT-изоляцию; 12 — двустороннюю изоляцию между
-- пространствами и каскады. Здесь — трёхролевой доступ ВНУТРИ одного shared-ws.
--
-- Матрица viewer-denial для UPDATE/DELETE: RLS USING молча отсекает строки
-- (0 строк, БЕЗ ошибки), поэтому denial проверяется поведенчески (строка не
-- изменилась / не удалена), а не throws_ok. Для INSERT (WITH CHECK) — throws 42501.
--
-- Стиль — как 09/12/13. Выполняется на vanilla Postgres 15 (CI).

BEGIN;
SELECT plan(103);

-- ============================================================================
-- SETUP (superuser: auth.uid() IS NULL → guards/limits/RLS не мешают наливу)
-- ============================================================================
DO $$
DECLARE
  u_o   uuid := 'a0000014-0000-0000-0000-000000000001'::uuid; -- owner
  u_e   uuid := 'a0000014-0000-0000-0000-000000000002'::uuid; -- editor
  u_v   uuid := 'a0000014-0000-0000-0000-000000000003'::uuid; -- viewer
  u_x   uuid := 'a0000014-0000-0000-0000-000000000004'::uuid; -- outsider
  u_add uuid := 'a0000014-0000-0000-0000-000000000005'::uuid; -- добавляемый owner'ом
  u_lo  uuid := 'a0000014-0000-0000-0000-000000000006'::uuid; -- одинокий owner (last-owner ws)
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (u_o,'r14-o@test'),(u_e,'r14-e@test'),(u_v,'r14-v@test'),
    (u_x,'r14-x@test'),(u_add,'r14-add@test'),(u_lo,'r14-lo@test')
    ON CONFLICT (id) DO NOTHING;

  -- Shared-пространство ws14 + три роли.
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('ws14', u_o, u_o, 'Roles WS', 'shared') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('m_o', 'ws14', u_o, 'owner'),
    ('m_e', 'ws14', u_e, 'editor'),
    ('m_v', 'ws14', u_v, 'viewer') ON CONFLICT DO NOTHING;

  -- Базовые строки для FK (task_id в overdue/hold).
  INSERT INTO public.sync_tasks (id, user_id, workspace_id, title) VALUES
    ('tk14base', u_o, 'ws14', 'base task') ON CONFLICT DO NOTHING;

  -- ── sync_tasks ──────────────────────────────────────────────────────────
  INSERT INTO public.sync_tasks (id, user_id, workspace_id, title) VALUES
    ('t_sel', u_o,'ws14','selrow'), ('t_upd', u_o,'ws14','orig'),
    ('t_updv',u_o,'ws14','keepv'),  ('t_delo',u_o,'ws14','d'),
    ('t_dele',u_o,'ws14','d'),      ('t_delv',u_o,'ws14','d') ON CONFLICT DO NOTHING;
  -- ── sync_statuses ───────────────────────────────────────────────────────
  INSERT INTO public.sync_statuses (id, user_id, workspace_id, name, color) VALUES
    ('s_sel', u_o,'ws14','selrow','#111'), ('s_upd', u_o,'ws14','orig','#111'),
    ('s_updv',u_o,'ws14','keepv','#111'),  ('s_delo',u_o,'ws14','d','#111'),
    ('s_dele',u_o,'ws14','d','#111'),      ('s_delv',u_o,'ws14','d','#111') ON CONFLICT DO NOTHING;
  -- ── sync_tags ───────────────────────────────────────────────────────────
  INSERT INTO public.sync_tags (id, user_id, workspace_id, name, color) VALUES
    ('g_sel', u_o,'ws14','selrow','#111'), ('g_upd', u_o,'ws14','orig','#111'),
    ('g_updv',u_o,'ws14','keepv','#111'),  ('g_delo',u_o,'ws14','d','#111'),
    ('g_dele',u_o,'ws14','d','#111'),      ('g_delv',u_o,'ws14','d','#111') ON CONFLICT DO NOTHING;
  -- ── sync_task_templates ─────────────────────────────────────────────────
  INSERT INTO public.sync_task_templates (id, user_id, workspace_id, name) VALUES
    ('p_sel', u_o,'ws14','selrow'), ('p_upd', u_o,'ws14','orig'),
    ('p_updv',u_o,'ws14','keepv'),  ('p_delo',u_o,'ws14','d'),
    ('p_dele',u_o,'ws14','d'),      ('p_delv',u_o,'ws14','d') ON CONFLICT DO NOTHING;
  -- ── sync_overdue_events ─────────────────────────────────────────────────
  INSERT INTO public.sync_overdue_events (id, user_id, workspace_id, task_id, deadline_snapshot, event_date) VALUES
    ('o_sel', u_o,'ws14','tk14base','2026-01-01','2026-01-02'),
    ('o_upd', u_o,'ws14','tk14base','2026-01-01','2026-01-02'),
    ('o_updv',u_o,'ws14','tk14base','2026-01-01','2026-05-05'),
    ('o_delo',u_o,'ws14','tk14base','2026-01-01','2026-01-02'),
    ('o_dele',u_o,'ws14','tk14base','2026-01-01','2026-01-02'),
    ('o_delv',u_o,'ws14','tk14base','2026-01-01','2026-01-02') ON CONFLICT DO NOTHING;
  -- ── sync_task_hold_periods ──────────────────────────────────────────────
  INSERT INTO public.sync_task_hold_periods (id, user_id, workspace_id, task_id, started_at) VALUES
    ('h_sel', u_o,'ws14','tk14base', now()), ('h_upd', u_o,'ws14','tk14base', now()),
    ('h_updv',u_o,'ws14','tk14base', now()), ('h_delo',u_o,'ws14','tk14base', now()),
    ('h_dele',u_o,'ws14','tk14base', now()), ('h_delv',u_o,'ws14','tk14base', now()) ON CONFLICT DO NOTHING;

  -- ── sync_workspace_settings ─────────────────────────────────────────────
  INSERT INTO public.sync_workspace_settings (workspace_id, key, value) VALUES
    ('ws14','k_sel','v'), ('ws14','k_upd','orig'), ('ws14','k_updv','keepv'),
    ('ws14','k_delo','x'), ('ws14','k_dele','x'), ('ws14','k_delv','x') ON CONFLICT DO NOTHING;

  -- ── Отдельное пространство для проверки last-owner ──────────────────────
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('ws14lo', u_lo, u_lo, 'Lone owner', 'shared') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('m_lo', 'ws14lo', u_lo, 'owner') ON CONFLICT DO NOTHING;
END$$;

-- ============================================================================
-- БЛОК 1: VIEWER (23) — SELECT видит; INSERT 42501; UPDATE/DELETE — молчаливый no-op
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000003';

-- SELECT (видит)
SELECT is((SELECT count(*)::int FROM public.sync_tasks             WHERE id='t_sel'),1,'V: viewer SELECT sync_tasks');
SELECT is((SELECT count(*)::int FROM public.sync_statuses          WHERE id='s_sel'),1,'V: viewer SELECT sync_statuses');
SELECT is((SELECT count(*)::int FROM public.sync_tags              WHERE id='g_sel'),1,'V: viewer SELECT sync_tags');
SELECT is((SELECT count(*)::int FROM public.sync_task_templates    WHERE id='p_sel'),1,'V: viewer SELECT sync_task_templates');
SELECT is((SELECT count(*)::int FROM public.sync_overdue_events    WHERE id='o_sel'),1,'V: viewer SELECT sync_overdue_events');
SELECT is((SELECT count(*)::int FROM public.sync_task_hold_periods WHERE id='h_sel'),1,'V: viewer SELECT sync_task_hold_periods');

-- INSERT (42501)
SELECT throws_ok($$ INSERT INTO public.sync_tasks (id,user_id,workspace_id,title) VALUES ('t_iv','a0000014-0000-0000-0000-000000000003','ws14','x') $$,'42501',NULL,'V: viewer INSERT sync_tasks denied');
SELECT throws_ok($$ INSERT INTO public.sync_statuses (id,user_id,workspace_id,name,color) VALUES ('s_iv','a0000014-0000-0000-0000-000000000003','ws14','x','#000') $$,'42501',NULL,'V: viewer INSERT sync_statuses denied');
SELECT throws_ok($$ INSERT INTO public.sync_tags (id,user_id,workspace_id,name,color) VALUES ('g_iv','a0000014-0000-0000-0000-000000000003','ws14','x','#000') $$,'42501',NULL,'V: viewer INSERT sync_tags denied');
SELECT throws_ok($$ INSERT INTO public.sync_task_templates (id,user_id,workspace_id,name) VALUES ('p_iv','a0000014-0000-0000-0000-000000000003','ws14','x') $$,'42501',NULL,'V: viewer INSERT sync_task_templates denied');
SELECT throws_ok($$ INSERT INTO public.sync_overdue_events (id,user_id,workspace_id,task_id,deadline_snapshot,event_date) VALUES ('o_iv','a0000014-0000-0000-0000-000000000003','ws14','tk14base','2026-01-01','2026-01-02') $$,'42501',NULL,'V: viewer INSERT sync_overdue_events denied');
SELECT throws_ok($$ INSERT INTO public.sync_task_hold_periods (id,user_id,workspace_id,task_id,started_at) VALUES ('h_iv','a0000014-0000-0000-0000-000000000003','ws14','tk14base',now()) $$,'42501',NULL,'V: viewer INSERT sync_task_hold_periods denied');

-- UPDATE (no-op: строка не меняется)
UPDATE public.sync_tasks             SET title='hack'         WHERE id='t_updv';
UPDATE public.sync_statuses          SET name='hack'          WHERE id='s_updv';
UPDATE public.sync_tags              SET name='hack'          WHERE id='g_updv';
UPDATE public.sync_task_templates    SET name='hack'          WHERE id='p_updv';
UPDATE public.sync_task_hold_periods SET ended_at='2030-09-09' WHERE id='h_updv';
SELECT is((SELECT title      FROM public.sync_tasks             WHERE id='t_updv'),'keepv','V: viewer UPDATE sync_tasks no-op');
SELECT is((SELECT name       FROM public.sync_statuses          WHERE id='s_updv'),'keepv','V: viewer UPDATE sync_statuses no-op');
SELECT is((SELECT name       FROM public.sync_tags              WHERE id='g_updv'),'keepv','V: viewer UPDATE sync_tags no-op');
SELECT is((SELECT name       FROM public.sync_task_templates    WHERE id='p_updv'),'keepv','V: viewer UPDATE sync_task_templates no-op');
SELECT is((SELECT ended_at   FROM public.sync_task_hold_periods WHERE id='h_updv'),NULL::timestamptz,'V: viewer UPDATE sync_task_hold_periods no-op');

-- DELETE (no-op: строка на месте)
DELETE FROM public.sync_tasks             WHERE id='t_delv';
DELETE FROM public.sync_statuses          WHERE id='s_delv';
DELETE FROM public.sync_tags              WHERE id='g_delv';
DELETE FROM public.sync_task_templates    WHERE id='p_delv';
DELETE FROM public.sync_overdue_events    WHERE id='o_delv';
DELETE FROM public.sync_task_hold_periods WHERE id='h_delv';
SELECT is((SELECT count(*)::int FROM public.sync_tasks             WHERE id='t_delv'),1,'V: viewer DELETE sync_tasks no-op');
SELECT is((SELECT count(*)::int FROM public.sync_statuses          WHERE id='s_delv'),1,'V: viewer DELETE sync_statuses no-op');
SELECT is((SELECT count(*)::int FROM public.sync_tags              WHERE id='g_delv'),1,'V: viewer DELETE sync_tags no-op');
SELECT is((SELECT count(*)::int FROM public.sync_task_templates    WHERE id='p_delv'),1,'V: viewer DELETE sync_task_templates no-op');
SELECT is((SELECT count(*)::int FROM public.sync_overdue_events    WHERE id='o_delv'),1,'V: viewer DELETE sync_overdue_events no-op');
SELECT is((SELECT count(*)::int FROM public.sync_task_hold_periods WHERE id='h_delv'),1,'V: viewer DELETE sync_task_hold_periods no-op');

RESET ROLE;
SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- БЛОК 2: EDITOR (23) — SELECT видит; INSERT/UPDATE/DELETE проходят
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000002';

SELECT is((SELECT count(*)::int FROM public.sync_tasks             WHERE id='t_sel'),1,'E: editor SELECT sync_tasks');
SELECT is((SELECT count(*)::int FROM public.sync_statuses          WHERE id='s_sel'),1,'E: editor SELECT sync_statuses');
SELECT is((SELECT count(*)::int FROM public.sync_tags              WHERE id='g_sel'),1,'E: editor SELECT sync_tags');
SELECT is((SELECT count(*)::int FROM public.sync_task_templates    WHERE id='p_sel'),1,'E: editor SELECT sync_task_templates');
SELECT is((SELECT count(*)::int FROM public.sync_overdue_events    WHERE id='o_sel'),1,'E: editor SELECT sync_overdue_events');
SELECT is((SELECT count(*)::int FROM public.sync_task_hold_periods WHERE id='h_sel'),1,'E: editor SELECT sync_task_hold_periods');

SELECT lives_ok($$ INSERT INTO public.sync_tasks (id,user_id,workspace_id,title) VALUES ('t_ie','a0000014-0000-0000-0000-000000000002','ws14','x') $$,'E: editor INSERT sync_tasks');
SELECT lives_ok($$ INSERT INTO public.sync_statuses (id,user_id,workspace_id,name,color) VALUES ('s_ie','a0000014-0000-0000-0000-000000000002','ws14','x','#000') $$,'E: editor INSERT sync_statuses');
SELECT lives_ok($$ INSERT INTO public.sync_tags (id,user_id,workspace_id,name,color) VALUES ('g_ie','a0000014-0000-0000-0000-000000000002','ws14','x','#000') $$,'E: editor INSERT sync_tags');
SELECT lives_ok($$ INSERT INTO public.sync_task_templates (id,user_id,workspace_id,name) VALUES ('p_ie','a0000014-0000-0000-0000-000000000002','ws14','x') $$,'E: editor INSERT sync_task_templates');
SELECT lives_ok($$ INSERT INTO public.sync_overdue_events (id,user_id,workspace_id,task_id,deadline_snapshot,event_date) VALUES ('o_ie','a0000014-0000-0000-0000-000000000002','ws14','tk14base','2026-01-01','2026-01-02') $$,'E: editor INSERT sync_overdue_events');
SELECT lives_ok($$ INSERT INTO public.sync_task_hold_periods (id,user_id,workspace_id,task_id,started_at) VALUES ('h_ie','a0000014-0000-0000-0000-000000000002','ws14','tk14base',now()) $$,'E: editor INSERT sync_task_hold_periods');

UPDATE public.sync_tasks             SET title='byE'         WHERE id='t_upd';
UPDATE public.sync_statuses          SET name='byE'          WHERE id='s_upd';
UPDATE public.sync_tags              SET name='byE'          WHERE id='g_upd';
UPDATE public.sync_task_templates    SET name='byE'          WHERE id='p_upd';
UPDATE public.sync_task_hold_periods SET ended_at='2030-02-02 00:00:00+00' WHERE id='h_upd';
SELECT is((SELECT title      FROM public.sync_tasks             WHERE id='t_upd'),'byE','E: editor UPDATE sync_tasks');
SELECT is((SELECT name       FROM public.sync_statuses          WHERE id='s_upd'),'byE','E: editor UPDATE sync_statuses');
SELECT is((SELECT name       FROM public.sync_tags              WHERE id='g_upd'),'byE','E: editor UPDATE sync_tags');
SELECT is((SELECT name       FROM public.sync_task_templates    WHERE id='p_upd'),'byE','E: editor UPDATE sync_task_templates');
SELECT is((SELECT ended_at   FROM public.sync_task_hold_periods WHERE id='h_upd'),'2030-02-02 00:00:00+00'::timestamptz,'E: editor UPDATE sync_task_hold_periods');

DELETE FROM public.sync_tasks             WHERE id='t_dele';
DELETE FROM public.sync_statuses          WHERE id='s_dele';
DELETE FROM public.sync_tags              WHERE id='g_dele';
DELETE FROM public.sync_task_templates    WHERE id='p_dele';
DELETE FROM public.sync_overdue_events    WHERE id='o_dele';
DELETE FROM public.sync_task_hold_periods WHERE id='h_dele';
SELECT is((SELECT count(*)::int FROM public.sync_tasks             WHERE id='t_dele'),0,'E: editor DELETE sync_tasks');
SELECT is((SELECT count(*)::int FROM public.sync_statuses          WHERE id='s_dele'),0,'E: editor DELETE sync_statuses');
SELECT is((SELECT count(*)::int FROM public.sync_tags              WHERE id='g_dele'),0,'E: editor DELETE sync_tags');
SELECT is((SELECT count(*)::int FROM public.sync_task_templates    WHERE id='p_dele'),0,'E: editor DELETE sync_task_templates');
SELECT is((SELECT count(*)::int FROM public.sync_overdue_events    WHERE id='o_dele'),0,'E: editor DELETE sync_overdue_events');
SELECT is((SELECT count(*)::int FROM public.sync_task_hold_periods WHERE id='h_dele'),0,'E: editor DELETE sync_task_hold_periods');

RESET ROLE;
SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- БЛОК 3: OWNER (23) — SELECT видит; INSERT/UPDATE/DELETE проходят
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000001';

SELECT is((SELECT count(*)::int FROM public.sync_tasks             WHERE id='t_sel'),1,'O: owner SELECT sync_tasks');
SELECT is((SELECT count(*)::int FROM public.sync_statuses          WHERE id='s_sel'),1,'O: owner SELECT sync_statuses');
SELECT is((SELECT count(*)::int FROM public.sync_tags              WHERE id='g_sel'),1,'O: owner SELECT sync_tags');
SELECT is((SELECT count(*)::int FROM public.sync_task_templates    WHERE id='p_sel'),1,'O: owner SELECT sync_task_templates');
SELECT is((SELECT count(*)::int FROM public.sync_overdue_events    WHERE id='o_sel'),1,'O: owner SELECT sync_overdue_events');
SELECT is((SELECT count(*)::int FROM public.sync_task_hold_periods WHERE id='h_sel'),1,'O: owner SELECT sync_task_hold_periods');

SELECT lives_ok($$ INSERT INTO public.sync_tasks (id,user_id,workspace_id,title) VALUES ('t_io','a0000014-0000-0000-0000-000000000001','ws14','x') $$,'O: owner INSERT sync_tasks');
SELECT lives_ok($$ INSERT INTO public.sync_statuses (id,user_id,workspace_id,name,color) VALUES ('s_io','a0000014-0000-0000-0000-000000000001','ws14','x','#000') $$,'O: owner INSERT sync_statuses');
SELECT lives_ok($$ INSERT INTO public.sync_tags (id,user_id,workspace_id,name,color) VALUES ('g_io','a0000014-0000-0000-0000-000000000001','ws14','x','#000') $$,'O: owner INSERT sync_tags');
SELECT lives_ok($$ INSERT INTO public.sync_task_templates (id,user_id,workspace_id,name) VALUES ('p_io','a0000014-0000-0000-0000-000000000001','ws14','x') $$,'O: owner INSERT sync_task_templates');
SELECT lives_ok($$ INSERT INTO public.sync_overdue_events (id,user_id,workspace_id,task_id,deadline_snapshot,event_date) VALUES ('o_io','a0000014-0000-0000-0000-000000000001','ws14','tk14base','2026-01-01','2026-01-02') $$,'O: owner INSERT sync_overdue_events');
SELECT lives_ok($$ INSERT INTO public.sync_task_hold_periods (id,user_id,workspace_id,task_id,started_at) VALUES ('h_io','a0000014-0000-0000-0000-000000000001','ws14','tk14base',now()) $$,'O: owner INSERT sync_task_hold_periods');

UPDATE public.sync_tasks             SET title='byO'         WHERE id='t_upd';
UPDATE public.sync_statuses          SET name='byO'          WHERE id='s_upd';
UPDATE public.sync_tags              SET name='byO'          WHERE id='g_upd';
UPDATE public.sync_task_templates    SET name='byO'          WHERE id='p_upd';
UPDATE public.sync_task_hold_periods SET ended_at='2030-03-03 00:00:00+00' WHERE id='h_upd';
SELECT is((SELECT title      FROM public.sync_tasks             WHERE id='t_upd'),'byO','O: owner UPDATE sync_tasks');
SELECT is((SELECT name       FROM public.sync_statuses          WHERE id='s_upd'),'byO','O: owner UPDATE sync_statuses');
SELECT is((SELECT name       FROM public.sync_tags              WHERE id='g_upd'),'byO','O: owner UPDATE sync_tags');
SELECT is((SELECT name       FROM public.sync_task_templates    WHERE id='p_upd'),'byO','O: owner UPDATE sync_task_templates');
SELECT is((SELECT ended_at   FROM public.sync_task_hold_periods WHERE id='h_upd'),'2030-03-03 00:00:00+00'::timestamptz,'O: owner UPDATE sync_task_hold_periods');

DELETE FROM public.sync_tasks             WHERE id='t_delo';
DELETE FROM public.sync_statuses          WHERE id='s_delo';
DELETE FROM public.sync_tags              WHERE id='g_delo';
DELETE FROM public.sync_task_templates    WHERE id='p_delo';
DELETE FROM public.sync_overdue_events    WHERE id='o_delo';
DELETE FROM public.sync_task_hold_periods WHERE id='h_delo';
SELECT is((SELECT count(*)::int FROM public.sync_tasks             WHERE id='t_delo'),0,'O: owner DELETE sync_tasks');
SELECT is((SELECT count(*)::int FROM public.sync_statuses          WHERE id='s_delo'),0,'O: owner DELETE sync_statuses');
SELECT is((SELECT count(*)::int FROM public.sync_tags              WHERE id='g_delo'),0,'O: owner DELETE sync_tags');
SELECT is((SELECT count(*)::int FROM public.sync_task_templates    WHERE id='p_delo'),0,'O: owner DELETE sync_task_templates');
SELECT is((SELECT count(*)::int FROM public.sync_overdue_events    WHERE id='o_delo'),0,'O: owner DELETE sync_overdue_events');
SELECT is((SELECT count(*)::int FROM public.sync_task_hold_periods WHERE id='h_delo'),0,'O: owner DELETE sync_task_hold_periods');

RESET ROLE;
SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- БЛОК 4: sync_workspace_settings (10)
-- ============================================================================
-- SELECT — все три роли
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000001';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_settings WHERE workspace_id='ws14' AND key='k_sel'),1,'SET: owner SELECT settings');
SELECT lives_ok($$ INSERT INTO public.sync_workspace_settings (workspace_id,key,value) VALUES ('ws14','k_ins_o','v') $$,'SET: owner INSERT settings');
UPDATE public.sync_workspace_settings SET value='byO' WHERE workspace_id='ws14' AND key='k_upd';
SELECT is((SELECT value FROM public.sync_workspace_settings WHERE workspace_id='ws14' AND key='k_upd'),'byO','SET: owner UPDATE settings');
DELETE FROM public.sync_workspace_settings WHERE workspace_id='ws14' AND key='k_delo';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_settings WHERE workspace_id='ws14' AND key='k_delo'),0,'SET: owner DELETE settings');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000002';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_settings WHERE workspace_id='ws14' AND key='k_sel'),1,'SET: editor SELECT settings');
SELECT throws_ok($$ INSERT INTO public.sync_workspace_settings (workspace_id,key,value) VALUES ('ws14','k_ins_e','v') $$,'42501',NULL,'SET: editor INSERT settings denied');
UPDATE public.sync_workspace_settings SET value='hackE' WHERE workspace_id='ws14' AND key='k_updv';
SELECT is((SELECT value FROM public.sync_workspace_settings WHERE workspace_id='ws14' AND key='k_updv'),'keepv','SET: editor UPDATE settings no-op');
DELETE FROM public.sync_workspace_settings WHERE workspace_id='ws14' AND key='k_dele';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_settings WHERE workspace_id='ws14' AND key='k_dele'),1,'SET: editor DELETE settings no-op');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000003';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_settings WHERE workspace_id='ws14' AND key='k_sel'),1,'SET: viewer SELECT settings');
SELECT throws_ok($$ INSERT INTO public.sync_workspace_settings (workspace_id,key,value) VALUES ('ws14','k_ins_v','v') $$,'42501',NULL,'SET: viewer INSERT settings denied');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- БЛОК 5: sync_workspace_members (9)
-- ============================================================================
-- SELECT — все три роли видят полный список членства (3 участника).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000001';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members WHERE workspace_id='ws14'),3,'MEM: owner SELECT members');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000002';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members WHERE workspace_id='ws14'),3,'MEM: editor SELECT members');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000003';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members WHERE workspace_id='ws14'),3,'MEM: viewer SELECT members');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- INSERT: owner добавляет участника; editor/viewer — denied.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000001';
SELECT lives_ok($$ INSERT INTO public.sync_workspace_members (id,workspace_id,user_id,role) VALUES ('m_add','ws14','a0000014-0000-0000-0000-000000000005','viewer') $$,'MEM: owner INSERT member');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000002';
SELECT throws_ok($$ INSERT INTO public.sync_workspace_members (id,workspace_id,user_id,role) VALUES ('m_fail','ws14','a0000014-0000-0000-0000-000000000005','viewer') $$,'42501',NULL,'MEM: editor INSERT member denied');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000003';
SELECT throws_ok($$ INSERT INTO public.sync_workspace_members (id,workspace_id,user_id,role) VALUES ('m_fail','ws14','a0000014-0000-0000-0000-000000000005','viewer') $$,'42501',NULL,'MEM: viewer INSERT member denied');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- UPDATE (смена роли): owner ok; editor — no-op на чужой строке.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000001';
UPDATE public.sync_workspace_members SET role='editor' WHERE id='m_add';
SELECT is((SELECT role FROM public.sync_workspace_members WHERE id='m_add'),'editor','MEM: owner UPDATE member role');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000002';
UPDATE public.sync_workspace_members SET role='owner' WHERE id='m_v';
SELECT is((SELECT role FROM public.sync_workspace_members WHERE id='m_v'),'viewer','MEM: editor UPDATE other role no-op');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- DELETE (убрать участника): owner убирает m_add.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000001';
DELETE FROM public.sync_workspace_members WHERE id='m_add';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members WHERE id='m_add'),0,'MEM: owner DELETE member');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- БЛОК 6: self-leave (4) — не-owner удаляет СВОЮ строку членства
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000002';
SELECT lives_ok($$ DELETE FROM public.sync_workspace_members WHERE id='m_e' $$,'LEAVE: editor удаляет свою строку');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000003';
SELECT lives_ok($$ DELETE FROM public.sync_workspace_members WHERE id='m_v' $$,'LEAVE: viewer удаляет свою строку');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members WHERE id='m_e'),0,'LEAVE: editor-строка удалена');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members WHERE id='m_v'),0,'LEAVE: viewer-строка удалена');

-- ============================================================================
-- БЛОК 7: защита последнего owner'a (3) — триггер assert_at_least_one_owner (0028)
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000006';
SELECT throws_ok($$ DELETE FROM public.sync_workspace_members WHERE id='m_lo' $$,'23514',NULL,'LAST: нельзя удалить единственного owner');
SELECT throws_ok($$ UPDATE public.sync_workspace_members SET role='viewer' WHERE id='m_lo' $$,'23514',NULL,'LAST: нельзя понизить единственного owner');
SELECT throws_ok($$ UPDATE public.sync_workspace_members SET deleted_at=now() WHERE id='m_lo' $$,'23514',NULL,'LAST: нельзя soft-delete единственного owner');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- БЛОК 8: outsider (8) — не член ws14 не видит и не пишет
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000014-0000-0000-0000-000000000004';
SELECT is((SELECT count(*)::int FROM public.sync_tasks             WHERE id='t_sel'),0,'OUT: outsider не видит sync_tasks');
SELECT is((SELECT count(*)::int FROM public.sync_statuses          WHERE id='s_sel'),0,'OUT: outsider не видит sync_statuses');
SELECT is((SELECT count(*)::int FROM public.sync_tags              WHERE id='g_sel'),0,'OUT: outsider не видит sync_tags');
SELECT is((SELECT count(*)::int FROM public.sync_task_templates    WHERE id='p_sel'),0,'OUT: outsider не видит sync_task_templates');
SELECT is((SELECT count(*)::int FROM public.sync_overdue_events    WHERE id='o_sel'),0,'OUT: outsider не видит sync_overdue_events');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members WHERE workspace_id='ws14'),0,'OUT: outsider не видит членство');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_settings WHERE workspace_id='ws14'),0,'OUT: outsider не видит настройки');
SELECT throws_ok($$ INSERT INTO public.sync_tasks (id,user_id,workspace_id,title) VALUES ('t_iout','a0000014-0000-0000-0000-000000000004','ws14','x') $$,'42501',NULL,'OUT: outsider INSERT sync_tasks denied');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

SELECT * FROM finish();
ROLLBACK;
