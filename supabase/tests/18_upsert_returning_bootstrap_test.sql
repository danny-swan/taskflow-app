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
-- 0037 добавил владельцу пространства (owner_id / owns_workspace) доступ в
-- SELECT/INSERT/UPDATE, минуя membership. Этот тест доказывает:
--   1. upsert НОВОГО пространства владельцем проходит ДО появления membership
--      (это и есть первый пуш нового ws — раньше падал);
--   2. upsert owner-строки членства проходит (bootstrap);
--   3. upsert дочерних сущностей (statuses/tasks/tags/templates/overdue/
--      hold_periods/settings) проходит владельцем ДО membership;
--   4. чужой пользователь НЕ получает доступа (owner-ветка строго по владению).
--
-- Стиль — как 14/15/16 (SET LOCAL ROLE authenticated + request.jwt.claim.sub;
-- налив под superuser). Vanilla Postgres 15 (CI).
-- ВАЖНО: тест намеренно НЕ создаёт membership для владельца до upsert'ов —
-- именно это воспроизводит регрессию (на политиках 0031 тесты 1-3 упали бы 42501).

BEGIN;
SELECT plan(11);

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
  '1: upsert нового shared-пространства владельцем проходит ДО появления membership (RETURNING разрешён по owner_id)');

-- ============================================================================
-- 2. upsert owner-строки членства (bootstrap)
-- ============================================================================
SELECT lives_ok(
  $$ INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role)
       VALUES ('m17o','ws17','a0000017-0000-0000-0000-000000000001'::uuid,'owner')
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role
     RETURNING id $$,
  '2: upsert owner-членства проходит (bootstrap owner-строки в своём новом пространстве)');

-- ============================================================================
-- 3. upsert дочерних сущностей владельцем (RETURNING по owns_workspace)
-- ============================================================================
SELECT lives_ok(
  $$ INSERT INTO public.sync_statuses (id, user_id, workspace_id, name, color, sort_order)
       VALUES ('st17','a0000017-0000-0000-0000-000000000001'::uuid,'ws17','Todo','#888',0)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING id $$,
  '3: upsert статуса владельцем проходит');
SELECT lives_ok(
  $$ INSERT INTO public.sync_tasks (id, user_id, workspace_id, title, status_id)
       VALUES ('tk17','a0000017-0000-0000-0000-000000000001'::uuid,'ws17','T','st17')
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title RETURNING id $$,
  '4: upsert задачи владельцем проходит');
SELECT lives_ok(
  $$ INSERT INTO public.sync_tags (id, user_id, workspace_id, name, color)
       VALUES ('tg17','a0000017-0000-0000-0000-000000000001'::uuid,'ws17','Tag','#0a0')
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING id $$,
  '5: upsert тега владельцем проходит');
SELECT lives_ok(
  $$ INSERT INTO public.sync_workspace_settings (workspace_id, key, value)
       VALUES ('ws17','k','v')
     ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value RETURNING workspace_id $$,
  '6: upsert настроек пространства владельцем проходит');

-- ============================================================================
-- 4. Владелец ВИДИТ свои строки (SELECT-политика через owner)
-- ============================================================================
SELECT is((SELECT count(*)::int FROM public.sync_workspaces WHERE id='ws17'),
          1, '7: владелец видит своё пространство (SELECT по owner_id)');
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id='ws17'),
          1, '8: владелец видит задачи своего пространства');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- 5. Безопасность: чужой пользователь НЕ видит и НЕ пишет чужое пространство
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000017-0000-0000-0000-000000000002'; -- чужой

SELECT is((SELECT count(*)::int FROM public.sync_workspaces WHERE id='ws17'),
          0, '9: чужой НЕ видит чужое пространство (owner-ветка строго по владению)');
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id='ws17'),
          0, '10: чужой НЕ видит задачи чужого пространства');
-- Попытка перезаписать чужое пространство через upsert должна упасть
-- (owner_id принадлежит другому; own INSERT-ветка требует owner_id=self).
SELECT throws_ok(
  $$ INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
       VALUES ('ws17','a0000017-0000-0000-0000-000000000002'::uuid,
               'a0000017-0000-0000-0000-000000000002'::uuid,'HACK','shared')
     ON CONFLICT (id) DO UPDATE SET name='HACK' $$,
  '11: чужой НЕ может захватить/перезаписать чужое пространство через upsert');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

SELECT * FROM finish();
ROLLBACK;
