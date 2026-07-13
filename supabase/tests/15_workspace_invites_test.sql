-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- pgTAP: API приглашений в shared-пространства (миграция 0032, Wave B, PR-b-03).
--
-- Проверяет схему таблицы sync_workspace_invites, четыре SECURITY DEFINER RPC
-- (invite_to_workspace / accept_invite / reject_invite / cancel_invite), RLS и
-- каскады. Группы:
--   A. Схема (6)        — таблица/RLS/FK-CASCADE/CHECK role,status/unique pending.
--   B. invite (13)      — owner приглашает; отказы (free/notfound/self/member/
--                          роль/не-owner); идемпотентность; already member после accept.
--   C. accept (10)      — успех+членство; лимит; чужой; повторно; expired; cancelled; unauth.
--   D. reject (4)       — target-only, pending→rejected, без членства.
--   E. cancel (4)       — owner-only, pending→cancelled, editor/viewer denied.
--   F. RLS (9)          — видимость target/owner, editor/viewer/outsider слепы, прямой DML denied.
--   G. FK+CASCADE (2)   — удаление workspace и inviter каскадит инвайты.
--
-- Стиль — как 14 (SET LOCAL ROLE authenticated + request.jwt.claim.sub).
-- Пред-инсерты инвайтов для accept/reject/cancel делаются суперюзером с явными
-- id (accept берёт id параметром — так тест знает id, не полагаясь на RLS-чтение).
-- Выполняется на vanilla Postgres 15 (CI).

BEGIN;
SELECT plan(48);

-- ============================================================================
-- SETUP (superuser: auth.uid() IS NULL → guards/limits/RLS не мешают наливу)
-- ============================================================================
DO $$
DECLARE
  u_own  uuid := 'a0000015-0000-0000-0000-000000000001'::uuid; -- owner ws15 (pro)
  u_pro  uuid := 'a0000015-0000-0000-0000-000000000002'::uuid; -- pro target (B)
  u_free uuid := 'a0000015-0000-0000-0000-000000000003'::uuid; -- free target
  u_edit uuid := 'a0000015-0000-0000-0000-000000000004'::uuid; -- editor member
  u_view uuid := 'a0000015-0000-0000-0000-000000000005'::uuid; -- viewer member
  u_out  uuid := 'a0000015-0000-0000-0000-000000000006'::uuid; -- outsider (pro)
  u_pro2 uuid := 'a0000015-0000-0000-0000-000000000007'::uuid; -- pro (accept→member)
  u_lim  uuid := 'a0000015-0000-0000-0000-000000000008'::uuid; -- pro на лимите (7 ws)
  u_rej  uuid := 'a0000015-0000-0000-0000-000000000009'::uuid; -- reject target
  u_can  uuid := 'a0000015-0000-0000-0000-000000000010'::uuid; -- cancel target
  u_acc  uuid := 'a0000015-0000-0000-0000-000000000011'::uuid; -- accept success (0 ws)
  u_exp  uuid := 'a0000015-0000-0000-0000-000000000012'::uuid; -- expired invite target
  u_cxl  uuid := 'a0000015-0000-0000-0000-000000000013'::uuid; -- cancelled invite target
  u_ei   uuid := 'a0000015-0000-0000-0000-000000000014'::uuid; -- cancel-by-nonowner target
  u_gown uuid := 'a0000015-0000-0000-0000-000000000015'::uuid; -- G: ws owner (delete ws)
  u_gow2 uuid := 'a0000015-0000-0000-0000-000000000016'::uuid; -- G: ws owner (delete inviter)
  u_ginv uuid := 'a0000015-0000-0000-0000-000000000017'::uuid; -- G: отдельный inviter
  i int;
BEGIN
  -- Триггер on_auth_user_created (0001) при INSERT в auth.users сам заводит profile
  -- со СЛУЧАЙНЫМ public_user_id, а guard-триггер (0026) запрещает его переписать.
  -- Отключаем на время налива, чтобы задать известные TF-ID явно.
  ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

  INSERT INTO auth.users (id, email) VALUES
    (u_own,'i15-own@t'),(u_pro,'i15-pro@t'),(u_free,'i15-free@t'),(u_edit,'i15-edit@t'),
    (u_view,'i15-view@t'),(u_out,'i15-out@t'),(u_pro2,'i15-pro2@t'),(u_lim,'i15-lim@t'),
    (u_rej,'i15-rej@t'),(u_can,'i15-can@t'),(u_acc,'i15-acc@t'),(u_exp,'i15-exp@t'),
    (u_cxl,'i15-cxl@t'),(u_ei,'i15-ei@t'),(u_gown,'i15-gown@t'),(u_gow2,'i15-gow2@t'),
    (u_ginv,'i15-ginv@t')
    ON CONFLICT (id) DO NOTHING;

  -- Профили с известными публичными TF-ID (для invite по public_id).
  INSERT INTO public.profiles (id, email, public_user_id) VALUES
    (u_own,'i15-own@t','TF-OWN001'),(u_pro,'i15-pro@t','TF-PRO002'),
    (u_free,'i15-free@t','TF-FREE03'),(u_edit,'i15-edit@t','TF-EDT004'),
    (u_view,'i15-view@t','TF-VIW005'),(u_out,'i15-out@t','TF-OUT006'),
    (u_pro2,'i15-pro2@t','TF-PRO007'),(u_lim,'i15-lim@t','TF-LIM008'),
    (u_rej,'i15-rej@t','TF-REJ009'),(u_can,'i15-can@t','TF-CAN010'),
    (u_acc,'i15-acc@t','TF-ACC011'),(u_exp,'i15-exp@t','TF-EXP012'),
    (u_cxl,'i15-cxl@t','TF-CXL013'),(u_ei,'i15-ei@t','TF-EIN014')
    ON CONFLICT (id) DO NOTHING;

  ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

  -- Платный тариф всем, кроме u_free.
  INSERT INTO public.user_entitlements (user_id, plan, valid_until) VALUES
    (u_own,'pro',now()+interval '30 days'),(u_pro,'pro',now()+interval '30 days'),
    (u_edit,'pro',now()+interval '30 days'),(u_view,'pro',now()+interval '30 days'),
    (u_out,'pro',now()+interval '30 days'),(u_pro2,'pro',now()+interval '30 days'),
    (u_lim,'pro',now()+interval '30 days'),(u_rej,'pro',now()+interval '30 days'),
    (u_can,'pro',now()+interval '30 days'),(u_acc,'pro',now()+interval '30 days'),
    (u_exp,'pro',now()+interval '30 days'),(u_cxl,'pro',now()+interval '30 days'),
    (u_ei,'pro',now()+interval '30 days')
    ON CONFLICT (user_id) DO UPDATE SET plan=excluded.plan, valid_until=excluded.valid_until;

  -- Shared-пространство ws15 + три роли.
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('ws15', u_own, u_own, 'Invites WS', 'shared') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('im_o','ws15',u_own,'owner'),('im_e','ws15',u_edit,'editor'),
    ('im_v','ws15',u_view,'viewer') ON CONFLICT DO NOTHING;

  -- u_lim: 7 активных членств (в отдельных пространствах) → на лимите.
  FOR i IN 1..7 LOOP
    INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
      VALUES ('wslim'||i, u_lim, u_lim, 'Lim '||i, 'personal') ON CONFLICT DO NOTHING;
    INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role)
      VALUES ('mlim'||i, 'wslim'||i, u_lim, 'owner') ON CONFLICT DO NOTHING;
  END LOOP;

  -- Пред-инсерт инвайтов с явными id для accept/reject/cancel.
  INSERT INTO public.sync_workspace_invites
    (id, workspace_id, inviter_user_id, target_public_user_id, target_user_id, role, status, expires_at) VALUES
    ('inv_acc','ws15',u_own,'TF-ACC011',u_acc,'editor','pending', now()+interval '7 days'),
    ('inv_lim','ws15',u_own,'TF-LIM008',u_lim,'viewer','pending', now()+interval '7 days'),
    ('inv_exp','ws15',u_own,'TF-EXP012',u_exp,'editor','pending', now()-interval '1 day'),
    ('inv_cxl','ws15',u_own,'TF-CXL013',u_cxl,'editor','cancelled', now()+interval '7 days'),
    ('inv_rej','ws15',u_own,'TF-REJ009',u_rej,'viewer','pending', now()+interval '7 days'),
    ('inv_can','ws15',u_own,'TF-CAN010',u_can,'viewer','pending', now()+interval '7 days'),
    ('inv_ei', 'ws15',u_own,'TF-EIN014',u_ei, 'viewer','pending', now()+interval '7 days')
    ON CONFLICT (id) DO NOTHING;

  -- G: отдельные пространства + инвайты для каскадов.
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('wsG',  u_gown, u_gown, 'G del ws',      'shared'),
    ('wsG2', u_gow2, u_gow2, 'G del inviter', 'shared') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('img1','wsG', u_gown,'owner'),('img2','wsG2',u_gow2,'owner') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_invites
    (id, workspace_id, inviter_user_id, target_public_user_id, target_user_id, role, status) VALUES
    ('inv_g1','wsG', u_gown, 'TF-GOW016', u_gow2, 'editor','pending'),
    ('inv_g2','wsG2',u_ginv, 'TF-GOW015', u_gown, 'editor','pending')
    ON CONFLICT (id) DO NOTHING;
END$$;

-- ============================================================================
-- A. СХЕМА (6)
-- ============================================================================
SELECT has_table('public','sync_workspace_invites','A1: таблица sync_workspace_invites существует');

SELECT is(
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.sync_workspace_invites'::regclass),
  true, 'A2: RLS включён на sync_workspace_invites');

SELECT is(
  (SELECT confdeltype FROM pg_constraint
     WHERE conname='sync_workspace_invites_workspace_id_fkey'
       AND conrelid='public.sync_workspace_invites'::regclass),
  'c', 'A3: FK workspace_id → sync_workspaces ON DELETE CASCADE');

SELECT col_has_check('public','sync_workspace_invites','role','A4: CHECK на role');
SELECT col_has_check('public','sync_workspace_invites','status','A5: CHECK на status');

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
     WHERE schemaname='public' AND tablename='sync_workspace_invites'
       AND indexname='sync_workspace_invites_pending_uq'),
  1, 'A6: unique partial index на pending существует');

-- ============================================================================
-- B. invite_to_workspace (13)
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000001'; -- owner

-- B1/B2/B3: owner приглашает валидного pro-таргета (создаёт pending). Идемпотентно
-- повторные вызовы возвращают ту же строку.
SELECT is((public.invite_to_workspace('ws15','TF-PRO002','editor')).status,'pending',
  'B1: owner+pro → создан invite, status pending');
SELECT is((public.invite_to_workspace('ws15','TF-PRO002','editor')).role,'editor',
  'B2: role корректная (editor)');
SELECT ok(
  (public.invite_to_workspace('ws15','TF-PRO002','editor')).expires_at
    BETWEEN now()+interval '7 days'-interval '1 min' AND now()+interval '7 days'+interval '1 min',
  'B3: expires_at ≈ now()+7 дней');

-- B4: free target.
SELECT throws_ok($$ SELECT public.invite_to_workspace('ws15','TF-FREE03','viewer') $$,
  '22023','target user is on free plan and cannot join shared workspaces','B4: free target → 22023');

-- B5: несуществующий public_id.
SELECT throws_ok($$ SELECT public.invite_to_workspace('ws15','TF-NOPE99','viewer') $$,
  '22023','user not found','B5: несуществующий public_id → 22023');

-- B6: self-invite.
SELECT throws_ok($$ SELECT public.invite_to_workspace('ws15','TF-OWN001','viewer') $$,
  '22023','cannot invite yourself','B6: self-invite → 22023');

-- B7: уже участник (editor).
SELECT throws_ok($$ SELECT public.invite_to_workspace('ws15','TF-EDT004','viewer') $$,
  '22023','user is already a member','B7: already member → 22023');

-- B8: невалидная роль.
SELECT throws_ok($$ SELECT public.invite_to_workspace('ws15','TF-PRO007','manager') $$,
  '22023','invalid role: manager','B8: invalid role → 22023');

RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- B9: editor не может приглашать.
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000004';
SELECT throws_ok($$ SELECT public.invite_to_workspace('ws15','TF-PRO007','viewer') $$,
  '42501',NULL,'B9: editor invite → 42501');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- B10: viewer не может приглашать.
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000005';
SELECT throws_ok($$ SELECT public.invite_to_workspace('ws15','TF-PRO007','viewer') $$,
  '42501',NULL,'B10: viewer invite → 42501');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- B11: outsider не может приглашать.
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000006';
SELECT throws_ok($$ SELECT public.invite_to_workspace('ws15','TF-PRO007','viewer') $$,
  '42501',NULL,'B11: outsider invite → 42501');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- B12: идемпотентность — два invite к тому же target возвращают один id.
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000001';
SELECT is(
  (public.invite_to_workspace('ws15','TF-PRO002','editor')).id,
  (public.invite_to_workspace('ws15','TF-PRO002','editor')).id,
  'B12: идемпотентность — id совпадает');

-- B13: после accept'а — повторный invite к тому же target → already member.
-- Создаём invite к u_pro2 и принимаем его от лица u_pro2.
SELECT public.invite_to_workspace('ws15','TF-PRO007','viewer');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000007';
SELECT public.accept_invite(
  (SELECT id FROM public.sync_workspace_invites
     WHERE workspace_id='ws15' AND target_user_id='a0000015-0000-0000-0000-000000000007'::uuid
       AND status='pending' LIMIT 1));
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000001';
SELECT throws_ok($$ SELECT public.invite_to_workspace('ws15','TF-PRO007','viewer') $$,
  '22023','user is already a member','B13: invite после accept → already member');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- C. accept_invite (10)
-- ============================================================================
-- C1: pro с 0 ws принимает → возвращается членство (workspace_id ws15).
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000011';
SELECT is((public.accept_invite('inv_acc')).workspace_id,'ws15','C1: accept → членство в ws15');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- C2/C3/C4 (superuser читает состояние минуя RLS).
SELECT is((SELECT status FROM public.sync_workspace_invites WHERE id='inv_acc'),
  'accepted','C2: invite.status=accepted');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members
             WHERE workspace_id='ws15' AND user_id='a0000015-0000-0000-0000-000000000011'::uuid
               AND deleted_at IS NULL),
  1, 'C3: членство создано');
SELECT is((SELECT role FROM public.sync_workspace_members
             WHERE workspace_id='ws15' AND user_id='a0000015-0000-0000-0000-000000000011'::uuid),
  'editor','C4: роль членства = роль инвайта (editor)');

-- C5: target на лимите (7 ws) → limit exceeded.
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000008';
SELECT throws_ok($$ SELECT public.accept_invite('inv_lim') $$,
  '22023','workspace limit exceeded','C5: лимит принимающего → 22023');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- C6: чужой инвайт (outsider принимает инвайт u_lim) → 42501.
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000006';
SELECT throws_ok($$ SELECT public.accept_invite('inv_lim') $$,
  '42501','invite not found or not for you','C6: не тот target → 42501');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- C7: повторный accept уже принятого → 42501 (не pending).
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000011';
SELECT throws_ok($$ SELECT public.accept_invite('inv_acc') $$,
  '42501',NULL,'C7: уже accepted → 42501');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- C8: истёкший инвайт → 42501.
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000012';
SELECT throws_ok($$ SELECT public.accept_invite('inv_exp') $$,
  '42501',NULL,'C8: expired → 42501');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- C9: отменённый инвайт → 42501.
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000013';
SELECT throws_ok($$ SELECT public.accept_invite('inv_cxl') $$,
  '42501',NULL,'C9: cancelled → 42501');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- C10: без auth → 42501.
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO '';
SELECT throws_ok($$ SELECT public.accept_invite('inv_acc') $$,
  '42501',NULL,'C10: no auth → 42501');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- D. reject_invite (4)
-- ============================================================================
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000009';
SELECT lives_ok($$ SELECT public.reject_invite('inv_rej') $$,'D1: target отклоняет свой invite');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
SELECT is((SELECT status FROM public.sync_workspace_invites WHERE id='inv_rej'),
  'rejected','D2: status=rejected');
SELECT is((SELECT count(*)::int FROM public.sync_workspace_members
             WHERE workspace_id='ws15' AND user_id='a0000015-0000-0000-0000-000000000009'::uuid),
  0, 'D3: членство НЕ создано');
-- D4: не-target отклоняет чужой pending (inv_can) → 42501 (inv_can остаётся pending для E1).
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000006';
SELECT throws_ok($$ SELECT public.reject_invite('inv_can') $$,
  '42501',NULL,'D4: не-target reject → 42501');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- E. cancel_invite (4)
-- ============================================================================
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000001';
SELECT lives_ok($$ SELECT public.cancel_invite('inv_can') $$,'E1: owner отменяет invite');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
SELECT is((SELECT status FROM public.sync_workspace_invites WHERE id='inv_can'),
  'cancelled','E2: status=cancelled');
-- E3: editor не может отменить (inv_ei остаётся pending).
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000004';
SELECT throws_ok($$ SELECT public.cancel_invite('inv_ei') $$,
  '42501',NULL,'E3: editor cancel → 42501');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
-- E4: viewer не может отменить.
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000005';
SELECT throws_ok($$ SELECT public.cancel_invite('inv_ei') $$,
  '42501',NULL,'E4: viewer cancel → 42501');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- F. RLS (9)
-- ============================================================================
-- F1: target видит свой pending invite (созданный в B1 для u_pro).
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000002';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_invites
             WHERE target_user_id='a0000015-0000-0000-0000-000000000002'::uuid AND status='pending'),
  1, 'F1: target видит свой pending invite');
-- F2: target не видит чужой invite (inv_acc принадлежит u_acc).
SELECT is((SELECT count(*)::int FROM public.sync_workspace_invites WHERE id='inv_acc'),
  0, 'F2: target не видит чужой invite');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- F3: owner видит все инвайты своего ws.
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000001';
SELECT ok((SELECT count(*) FROM public.sync_workspace_invites WHERE workspace_id='ws15') >= 1,
  'F3: owner видит инвайты своего ws');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- F4/F5: editor/viewer не видят инвайты своего ws.
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000004';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_invites WHERE workspace_id='ws15'),
  0, 'F4: editor не видит инвайты ws');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000005';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_invites WHERE workspace_id='ws15'),
  0, 'F5: viewer не видит инвайты ws');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- F6: outsider не видит ничего.
SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub TO 'a0000015-0000-0000-0000-000000000006';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_invites),
  0, 'F6: outsider не видит инвайтов');

-- F7/F8/F9: прямой DML без RPC → 42501 (нет привилегий I/U/D у authenticated).
SELECT throws_ok($$ INSERT INTO public.sync_workspace_invites
  (id,workspace_id,inviter_user_id,target_public_user_id,role)
  VALUES ('inv_hack','ws15','a0000015-0000-0000-0000-000000000006','TF-PRO002','viewer') $$,
  '42501',NULL,'F7: прямой INSERT → 42501');
SELECT throws_ok($$ UPDATE public.sync_workspace_invites SET status='accepted' WHERE id='inv_acc' $$,
  '42501',NULL,'F8: прямой UPDATE → 42501');
SELECT throws_ok($$ DELETE FROM public.sync_workspace_invites WHERE id='inv_acc' $$,
  '42501',NULL,'F9: прямой DELETE → 42501');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ============================================================================
-- G. FK + CASCADE (2) — superuser
-- ============================================================================
-- G1: удаление workspace каскадит инвайты.
DELETE FROM public.sync_workspaces WHERE id='wsG';
SELECT is((SELECT count(*)::int FROM public.sync_workspace_invites WHERE id='inv_g1'),
  0, 'G1: удаление workspace каскадит invites');

-- G2: удаление inviter (auth.users) каскадит инвайты (inviter FK ON DELETE CASCADE).
DELETE FROM auth.users WHERE id='a0000015-0000-0000-0000-000000000017'::uuid;
SELECT is((SELECT count(*)::int FROM public.sync_workspace_invites WHERE id='inv_g2'),
  0, 'G2: удаление inviter каскадит invites');

SELECT * FROM finish();
ROLLBACK;
