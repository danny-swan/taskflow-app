-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- pgTAP: регрессия upsert-RETURNING bootstrap (миграция 0037).
--
-- ─── ЧТО ЗАКРЫВАЕТ ───────────────────────────────────────────────────────────
-- Клиент облачной синхронизации пишет через PostgREST `upsert` =
--   INSERT ... ON CONFLICT (id) DO UPDATE ... RETURNING *
-- Для INSERT ... RETURNING Postgres применяет к возвращаемой строке ещё и
-- SELECT-политику. У workspace-таблиц SELECT шёл ТОЛЬКО через has_workspace_role
-- (=> нужна строка в sync_workspace_members). При СОЗДАНИИ нового пространства
-- членства ещё нет → SELECT=false → RETURNING запрещён → ВЕСЬ upsert падает с
-- 42501 (HTTP 403). Push не проходит, sync_outbox копится, пространства теряются.
--
-- 0037 ввёл УЗКОЕ bootstrap-окно: is_workspace_bootstrap(ws,uid) = uid — владелец
-- пространства И в нём ещё нет ни одной активной строки членства. В этом окне
-- SELECT/INSERT/UPDATE разрешены владельцу, минуя membership. Как только членство
-- появилось — окно закрывается, доступ строго по has_workspace_role.
--
-- Этот тест доказывает:
--   1. upsert НОВОГО пространства владельцем проходит ДО появления membership;
--   2. upsert дочерней строки ДО membership проходит (bootstrap-окно открыто);
--   3. upsert owner-строки членства проходит (bootstrap owner-row);
--   4. после появления membership владелец продолжает писать (через роль);
--   5. чужой пользователь НЕ получает доступа (bootstrap строго по владению);
--   6. КЛЮЧЕВОЕ: ушедший владелец (stale owner_id, но членства уже нет у него,
--      а у пространства есть другое членство) НЕ получает bootstrap-доступа —
--      т.е. bootstrap-окно НЕ открывается заново при живом чужом членстве.
--
-- Стиль — как 14/15/16. Vanilla Postgres 15 (CI).

BEGIN;
SELECT plan(14);

-- ============================================================================
-- SETUP (superuser: auth.uid() IS NULL → RLS/guards не мешают наливу)
-- ============================================================================
DO $$
DECLARE
  u_own uuid := 'a0000017-0000-0000-0000-000000000001'::uuid; -- владелец (pro)
  u_for uuid := 'a0000017-0000-0000-0000-000000000002'::uuid; -- чужой (pro)
BEGIN
  ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
  INSERT INTO auth.users (id, email) VALUES
    (u_own,'r17-own@t'),(u_for,'r17-for@t') ON CONFLICT (id) DO NOTHING;
  ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

  -- Оба pro (лимит 7), чтобы enforce_workspace_limit не мешал shared.
  INSERT INTO public.user_entitlements (user_id, plan, valid_until) VALUES
    (u_own,'pro',now()+interval '30 days'),
    (u_for,'pro',now()+interval '30 days')
    ON CONFLICT (user_id) DO UPDATE SET plan=excluded.plan, valid_until=excluded.valid_until;
  -- НЕ создаём ни пространств, ни членства заранее — это делает клиент через upsert.
END$$;

-- ============================================================================
-- 1. upsert НОВОГО пространства владельцем ДО membership (ядро регрессии)
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000017-0000-0000-0000-000000000001';

SELECT lives_ok(
  $$ INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
       VALUES ('ws17','a0000017-0000-0000-0000-000000000001'::uuid,
               'a0000017-0000-0000-0000-000000000001'::uuid,'W17','shared')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id $$,
  '1: upsert нового shared-пространства владельцем проходит ДО появления membership (RETURNING разрешён через bootstrap-окно)');

-- ============================================================================
-- 2. upsert дочерней строки ДО membership (bootstrap-окно ещё открыто)
-- ============================================================================
-- Здесь membership ещё НЕ создан → is_workspace_bootstrap=true → RETURNING ok.
-- Это ключевой сценарий: клиент может пушить статусы/задачи новой доски раньше
-- (или без) отдельной owner-строки членства.
SELECT lives_ok(
  $$ INSERT INTO public.sync_statuses (id, user_id, workspace_id, name, color, sort_order)
       VALUES ('st17','a0000017-0000-0000-0000-000000000001'::uuid,'ws17','Todo','#888',0)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING id $$,
  '2: upsert статуса владельцем проходит ДО membership (bootstrap-окно)');
SELECT lives_ok(
  $$ INSERT INTO public.sync_tasks (id, user_id, workspace_id, title, status_id)
       VALUES ('tk17','a0000017-0000-0000-0000-000000000001'::uuid,'ws17','T','st17')
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title RETURNING id $$,
  '3: upsert задачи владельцем проходит ДО membership (bootstrap-окно)');
SELECT lives_ok(
  $$ INSERT INTO public.sync_workspace_settings (workspace_id, key, value)
       VALUES ('ws17','k','v')
     ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value RETURNING workspace_id $$,
  '4: upsert настроек владельцем проходит ДО membership (bootstrap-окно)');

-- ============================================================================
-- 3. upsert owner-строки членства (bootstrap owner-row; user_id=self покрывает
--    RETURNING собственной строки)
-- ============================================================================
SELECT lives_ok(
  $$ INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role)
       VALUES ('m17o','ws17','a0000017-0000-0000-0000-000000000001'::uuid,'owner')
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role
     RETURNING id $$,
  '5: upsert owner-членства проходит (bootstrap owner-строки; RETURNING по user_id=self)');

-- ============================================================================
-- 4. После появления membership окно закрыто, но владелец пишет через роль
-- ============================================================================
-- Теперь is_workspace_bootstrap=false (членство есть). Доступ — через
-- has_workspace_role('owner'), owner им обладает → upsert справочника проходит.
SELECT lives_ok(
  $$ INSERT INTO public.sync_tags (id, user_id, workspace_id, name, color)
       VALUES ('tg17','a0000017-0000-0000-0000-000000000001'::uuid,'ws17','Tag','#0a0')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING id $$,
  '6: после появления membership владелец пишет тег через роль owner (окно закрыто, доступ по членству)');
SELECT is((SELECT count(*)::int FROM public.sync_workspaces WHERE id='ws17'),
          1, '7: владелец видит своё пространство');
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id='ws17'),
          1, '8: владелец видит задачи своего пространства');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- 5. Безопасность: чужой пользователь НЕ видит и НЕ пишет чужое пространство
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000017-0000-0000-0000-000000000002'; -- чужой

SELECT is((SELECT count(*)::int FROM public.sync_workspaces WHERE id='ws17'),
          0, '9: чужой НЕ видит чужое пространство');
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id='ws17'),
          0, '10: чужой НЕ видит задачи чужого пространства');
SELECT throws_ok(
  $$ INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
       VALUES ('ws17','a0000017-0000-0000-0000-000000000002'::uuid,
               'a0000017-0000-0000-0000-000000000002'::uuid,'HACK','shared')
     ON CONFLICT (id) DO UPDATE SET name='HACK' $$,
  '42501', NULL,
  '11: чужой НЕ может захватить/перезаписать чужое пространство через upsert');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- 6. КЛЮЧЕВОЕ (антирегрессия к тесту 16): ушедший владелец НЕ получает
--    bootstrap-доступ, пока в пространстве есть чужое членство.
-- ============================================================================
-- Готовим ws17b: владелец u_own, но членство есть ТОЛЬКО у чужого u_for
-- (сценарий «u_own передал/потерял членство, owner_id остался стейл»).
DO $$
BEGIN
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('ws17b','a0000017-0000-0000-0000-000000000001'::uuid,
     'a0000017-0000-0000-0000-000000000001'::uuid,'W17B','shared')
    ON CONFLICT (id) DO NOTHING;
  -- Активное членство у чужого → bootstrap-окно закрыто для всех.
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('m17bf','ws17b','a0000017-0000-0000-0000-000000000002'::uuid,'owner')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.sync_tasks (id, user_id, workspace_id, title) VALUES
    ('tk17b','a0000017-0000-0000-0000-000000000002'::uuid,'ws17b','TB')
    ON CONFLICT (id) DO NOTHING;
END$$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000017-0000-0000-0000-000000000001'; -- stale owner_id, БЕЗ членства

-- owner_id указывает на u_own, НО членства у него нет, а у ws17b есть активное
-- членство (чужое) → is_workspace_bootstrap=false → доступа быть НЕ должно.
SELECT is((SELECT count(*)::int FROM public.sync_workspaces WHERE id='ws17b'),
          0, '12: stale-владелец (owner_id, но без членства) НЕ видит пространство при живом чужом членстве');
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id='ws17b'),
          0, '13: stale-владелец НЕ видит задачи (bootstrap-окно не открывается заново)');
SELECT throws_ok(
  $$ INSERT INTO public.sync_statuses (id, user_id, workspace_id, name, color, sort_order)
       VALUES ('st17b','a0000017-0000-0000-0000-000000000001'::uuid,'ws17b','X','#000',0)
     ON CONFLICT (id) DO UPDATE SET name='X' $$,
  '42501', NULL,
  '14: stale-владелец НЕ может писать в пространство с живым чужим членством');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

SELECT * FROM finish();
ROLLBACK;
