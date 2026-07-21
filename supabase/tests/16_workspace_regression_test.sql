-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- pgTAP: финальный regression-hardening «Пространств» (Wave B, PR-b-06).
--
-- Закрывает пересечения инвариантов, которые по отдельности покрыты 11-15, но НЕ
-- проверялись в комбинации. Продуктовых изменений нет — только regression. Каждая
-- группа сознательно НЕ дублирует существующее покрытие (ссылки — в комментариях):
--
--   A. Hard-delete shared-пространства каскадит ВЕСЬ граф разом (12 покрыл каскад
--      для personal-ws поштучно; 15/G1 — только инвайты у ws с одним инвайтом).
--      Здесь: shared-ws с 3 членами + 2 pending-инвайтами + детьми в двух sync-
--      таблицах + settings удаляется одним DELETE → всё уходит в 0, соседний ws
--      другого владельца не тронут.
--   B. Membership-removal ≠ invite-cascade + RLS следует за членством. Owner при
--      наличии второго owner'а делает self-leave; созданный им pending-инвайт
--      выживает (inviter FK → auth.users, аккаунт жив), а сам ex-owner мгновенно
--      теряет SELECT-видимость данных ws (has_workspace_role → false).
--   C. target_user_id ON DELETE SET NULL (0032) НЕ ломает инвайт: удаление аккаунта
--      приглашённого обнуляет target_user_id, но строка инвайта выживает (не
--      CASCADE), и owner всё ещё может её cancel'нуть.
--   D. Free-регрессия side-by-side: free нельзя ни пригласить (invite-path,
--      зеркалит 15/B4), ни принять инвайт (accept-path — тарифный лимит shared=0).
--   E. Лимит: shared-пространство занимает слот в ОБЩЕМ пуле владельца (11 грузил
--      только personal; здесь микс 3 personal + 4 shared = 7 → 8-е любого kind
--      отклонено P0001), подтверждая суммарный счётчик enforce_workspace_limit.
--
-- Стиль — как 14/15 (SET LOCAL ROLE authenticated + request.jwt.claim.sub;
-- налив под superuser). Выполняется на vanilla Postgres 15 (CI).

BEGIN;
SELECT plan(19);

-- ============================================================================
-- SETUP (superuser: auth.uid() IS NULL → guards/limits/RLS не мешают наливу)
-- ============================================================================
DO $$
DECLARE
  -- Группа A
  u_ao  uuid := 'a0000016-0000-0000-0000-0000000000a1'::uuid; -- A owner
  u_ae  uuid := 'a0000016-0000-0000-0000-0000000000a2'::uuid; -- A editor
  u_av  uuid := 'a0000016-0000-0000-0000-0000000000a3'::uuid; -- A viewer
  u_at1 uuid := 'a0000016-0000-0000-0000-0000000000a4'::uuid; -- A invite target 1
  u_at2 uuid := 'a0000016-0000-0000-0000-0000000000a5'::uuid; -- A invite target 2
  u_bo  uuid := 'a0000016-0000-0000-0000-0000000000a6'::uuid; -- sibling ws owner
  -- Группа B
  u_bo1 uuid := 'a0000016-0000-0000-0000-0000000000b1'::uuid; -- B owner 1 (self-leaves)
  u_bo2 uuid := 'a0000016-0000-0000-0000-0000000000b2'::uuid; -- B owner 2 (stays)
  u_bt  uuid := 'a0000016-0000-0000-0000-0000000000b3'::uuid; -- B invite target
  -- Группа C
  u_co  uuid := 'a0000016-0000-0000-0000-0000000000c1'::uuid; -- C owner
  u_ct  uuid := 'a0000016-0000-0000-0000-0000000000c2'::uuid; -- C invite target (deleted)
  -- Группа D
  u_do  uuid := 'a0000016-0000-0000-0000-0000000000d1'::uuid; -- D owner (pro)
  u_df  uuid := 'a0000016-0000-0000-0000-0000000000d2'::uuid; -- D free target
  -- Группа E
  u_eo  uuid := 'a0000016-0000-0000-0000-0000000000e1'::uuid; -- E owner (pro)
  i int;
BEGIN
  -- on_auth_user_created (0001) заводит profile со СЛУЧАЙНЫМ public_user_id, а
  -- guard 0026 запрещает переписать. Отключаем, чтобы задать известный TF-ID (D).
  ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

  INSERT INTO auth.users (id, email) VALUES
    (u_ao,'r16-ao@t'),(u_ae,'r16-ae@t'),(u_av,'r16-av@t'),(u_at1,'r16-at1@t'),
    (u_at2,'r16-at2@t'),(u_bo,'r16-bo@t'),(u_bo1,'r16-bo1@t'),(u_bo2,'r16-bo2@t'),
    (u_bt,'r16-bt@t'),(u_co,'r16-co@t'),(u_ct,'r16-ct@t'),(u_do,'r16-do@t'),
    (u_df,'r16-df@t'),(u_eo,'r16-eo@t')
    ON CONFLICT (id) DO NOTHING;

  -- Профиль с известным TF-ID нужен только free-таргету D (invite-path лукап).
  INSERT INTO public.profiles (id, email, public_user_id) VALUES
    (u_df,'r16-df@t','TF-FREE16') ON CONFLICT (id) DO NOTHING;

  ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

  -- Платный тариф — владельцам shared-ws и D (owner). u_df остаётся free (нет строки).
  INSERT INTO public.user_entitlements (user_id, plan, valid_until) VALUES
    (u_do,'pro',now()+interval '30 days'),
    (u_eo,'pro',now()+interval '30 days')
    ON CONFLICT (user_id) DO UPDATE SET plan=excluded.plan, valid_until=excluded.valid_until;

  -- ── Группа A: shared-ws ws16A (3 члена, 2 инвайта, дети) + соседний ws16A2 ──
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('ws16A',  u_ao, u_ao, 'A del',  'shared'),
    ('ws16A2', u_bo, u_bo, 'A sib',  'shared') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('m16Ao','ws16A', u_ao,'owner'),('m16Ae','ws16A', u_ae,'editor'),
    ('m16Av','ws16A', u_av,'viewer'),('m16A2','ws16A2',u_bo,'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_tasks (id, user_id, workspace_id, title) VALUES
    ('tk16Aa', u_ao,'ws16A', 'a1'),('tk16Ab', u_ao,'ws16A', 'a2'),
    ('tk16A2', u_bo,'ws16A2','sib task') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_statuses (id, user_id, workspace_id, name, color) VALUES
    ('st16A', u_ao,'ws16A','s','#111') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_settings (workspace_id, key, value) VALUES
    ('ws16A','k','v') ON CONFLICT DO NOTHING;
  -- Инвайты заводим прямым INSERT'ом (superuser обходит RLS/grants — как в 15).
  INSERT INTO public.sync_workspace_invites
    (id, workspace_id, inviter_user_id, target_public_user_id, target_user_id, role, status) VALUES
    ('inv16Aa','ws16A',u_ao,'TF-A16TG1',u_at1,'editor','pending'),
    ('inv16Ab','ws16A',u_ao,'TF-A16TG2',u_at2,'viewer','pending') ON CONFLICT DO NOTHING;

  -- ── Группа B: shared-ws ws16B, ДВА owner'а + viewer, инвайт от u_bo1 ────────
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('ws16B', u_bo1, u_bo1, 'B leave', 'shared') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('m16Bo1','ws16B',u_bo1,'owner'),('m16Bo2','ws16B',u_bo2,'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_tasks (id, user_id, workspace_id, title) VALUES
    ('tk16B', u_bo1,'ws16B','b task') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_invites
    (id, workspace_id, inviter_user_id, target_public_user_id, target_user_id, role, status) VALUES
    ('inv16B','ws16B',u_bo1,'TF-B16TGT',u_bt,'editor','pending') ON CONFLICT DO NOTHING;

  -- ── Группа C: shared-ws ws16C, инвайт таргету u_ct (аккаунт удалим) ─────────
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('ws16C', u_co, u_co, 'C null', 'shared') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('m16Co','ws16C',u_co,'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_invites
    (id, workspace_id, inviter_user_id, target_public_user_id, target_user_id, role, status) VALUES
    ('inv16C','ws16C',u_co,'TF-C16TGT',u_ct,'editor','pending') ON CONFLICT DO NOTHING;

  -- ── Группа D: shared-ws ws16D (pro owner), pending-инвайт free-таргету ──────
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('ws16D', u_do, u_do, 'D free', 'shared') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('m16Do','ws16D',u_do,'owner') ON CONFLICT DO NOTHING;
  -- Прямой INSERT минуя invite RPC (у RPC есть free pre-check) — эмулируем инвайт,
  -- таргет которого стал free к моменту accept'а.
  INSERT INTO public.sync_workspace_invites
    (id, workspace_id, inviter_user_id, target_public_user_id, target_user_id, role, status) VALUES
    ('inv16D','ws16D',u_do,'TF-FREE16',u_df,'viewer','pending') ON CONFLICT DO NOTHING;

  -- ── Группа E: pro-владелец с 7 пространствами (3 personal + 4 shared) ───────
  FOR i IN 1..3 LOOP
    INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
      VALUES ('ws16Ep'||i, u_eo, u_eo, 'E p'||i, 'personal') ON CONFLICT DO NOTHING;
  END LOOP;
  FOR i IN 1..4 LOOP
    INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
      VALUES ('ws16Es'||i, u_eo, u_eo, 'E s'||i, 'shared') ON CONFLICT DO NOTHING;
  END LOOP;
END$$;

-- ============================================================================
-- ГРУППА A: hard-delete shared-ws каскадит весь граф + сосед не тронут (8)
-- ============================================================================
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id='ws16A'),
          2, 'A1: предзагрузка — 2 задачи в ws16A');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_invites WHERE workspace_id='ws16A'),
          2, 'A2: предзагрузка — 2 pending-инвайта в ws16A');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members WHERE workspace_id='ws16A'),
          3, 'A3: предзагрузка — 3 члена в ws16A');

DELETE FROM public.sync_workspaces WHERE id='ws16A';

SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id='ws16A'),
          0, 'A4: задачи ws16A удалены каскадом (FK 0030)');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members WHERE workspace_id='ws16A'),
          0, 'A5: члены ws16A удалены каскадом (FK 0030)');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_invites WHERE workspace_id='ws16A'),
          0, 'A6: инвайты ws16A удалены каскадом (FK 0032)');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_settings WHERE workspace_id='ws16A'),
          0, 'A7: settings ws16A удалены каскадом (FK 0030)');
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id='ws16A2'),
          1, 'A8: соседний ws16A2 другого владельца не тронут');

-- ============================================================================
-- ГРУППА B: self-leave ≠ invite-cascade; RLS следует за членством (4)
-- ============================================================================
-- u_bo1 (owner) делает self-leave — второй owner (u_bo2) остаётся, поэтому
-- assert_at_least_one_owner (0028) пропускает; owner-manage DELETE-политика (0031)
-- разрешает owner'у удалить свою же строку членства.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000016-0000-0000-0000-0000000000b1';
SELECT lives_ok(
  $$ DELETE FROM public.sync_workspace_members WHERE id='m16Bo1' $$,
  'B1: owner делает self-leave при наличии второго owner');
-- ex-owner больше не видит данные ws (has_workspace_role → false).
SELECT is((SELECT count(*)::int FROM public.sync_tasks WHERE workspace_id='ws16B'),
          0, 'B2: ex-owner мгновенно теряет SELECT-видимость задач ws (RLS)');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members WHERE workspace_id='ws16B'),
          0, 'B3: ex-owner больше не видит список членства ws (RLS)');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
-- Инвайт, созданный ушедшим owner'ом, ВЫЖИЛ: снятие членства не каскадит инвайты
-- (inviter_user_id FK → auth.users, аккаунт u_bo1 жив). Читаем как superuser.
SELECT is((SELECT status FROM public.sync_workspace_invites WHERE id='inv16B'),
          'pending', 'B4: pending-инвайт ушедшего owner''а не задет self-leave');

-- ============================================================================
-- ГРУППА C: target_user_id ON DELETE SET NULL не ломает инвайт (3)
-- ============================================================================
DELETE FROM auth.users WHERE id='a0000016-0000-0000-0000-0000000000c2';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_invites WHERE id='inv16C'),
          1, 'C1: инвайт выжил после удаления аккаунта таргета (SET NULL, не CASCADE)');
SELECT is((SELECT target_user_id FROM public.sync_workspace_invites WHERE id='inv16C'),
          NULL, 'C2: target_user_id обнулён (ON DELETE SET NULL)');
-- owner всё ещё может отменить инвайт с null-таргетом (cancel_invite не зависит от target).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000016-0000-0000-0000-0000000000c1';
SELECT lives_ok($$ SELECT public.cancel_invite('inv16C') $$,
  'C3: owner отменяет инвайт с обнулённым target_user_id');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- ГРУППА D: free-регрессия — ни пригласить, ни принять (2, side-by-side)
-- ============================================================================
-- D1 (invite-path): зеркалит 15/B4, приведён рядом с accept-path'ом для полноты.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000016-0000-0000-0000-0000000000d1'; -- owner
SELECT throws_ok(
  $$ SELECT public.invite_to_workspace('ws16D','TF-FREE16','viewer') $$,
  '22023','target user is on free plan and cannot join shared workspaces',
  'D1: free нельзя пригласить (invite-path)');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
-- D2 (accept-path): free принимает предвставленный инвайт → shared недоступен
-- (гейт по плану, get_workspace_limit(free,'shared')=0; см. миграцию 0038).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000016-0000-0000-0000-0000000000d2'; -- free target
SELECT throws_ok(
  $$ SELECT public.accept_invite('inv16D') $$,
  '22023','shared workspaces require a paid plan',
  'D2: free не может принять инвайт (accept-path, shared недоступен на free)');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- ГРУППА E: shared занимает слот в общем пуле владельца (2)
-- ============================================================================
-- u_eo уже владеет 7 пространствами (3 personal + 4 shared). Суммарный счётчик
-- enforce_workspace_limit (limit=7 для pro) → 8-е любого kind отклонено.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000016-0000-0000-0000-0000000000e1';
SELECT throws_ok(
  $$ INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
       VALUES ('ws16Es5','a0000016-0000-0000-0000-0000000000e1'::uuid,
               'a0000016-0000-0000-0000-0000000000e1'::uuid,'E s5','shared') $$,
  'P0001','workspace_limit_exceeded',
  'E1: 8-е shared отклонено (пул 7 занят, shared считается в общем счётчике)');
SELECT throws_ok(
  $$ INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
       VALUES ('ws16Ep4','a0000016-0000-0000-0000-0000000000e1'::uuid,
               'a0000016-0000-0000-0000-0000000000e1'::uuid,'E p4','personal') $$,
  'P0001','workspace_limit_exceeded',
  'E2: 8-е personal тоже отклонено (тот же общий пул из 7)');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

SELECT * FROM finish();
ROLLBACK;
