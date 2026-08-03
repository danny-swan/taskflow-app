-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- pgTAP: управление пространствами (миграция 0028, Wave A, PR-4).
--
-- Проверяет:
--   1) RPC find_user_by_public_id: существует, возвращает публичный минимум
--      (id/nickname/avatar_variant, БЕЗ email), находит по TF-ID, NULL при
--      отсутствии, требует аутентификацию (auth.uid() IS NULL → пусто);
--   2) триггер assert_at_least_one_owner: нельзя удалить/понизить последнего
--      owner'a, но можно, если есть второй owner;
--   3) RLS sync_workspace_members: owner может add/update/delete, editor/viewer
--      не могут; не-owner может выйти сам (self-leave);
--   4) soft-delete ws: личное нельзя, shared owner может, editor не может.
--
-- Стиль — как 09_workspaces_test.sql. Выполняется на vanilla Postgres 15 (CI).

BEGIN;
SELECT plan(24);

-- ─── 1. RPC find_user_by_public_id: структура ───────────────────────────────
SELECT has_function(
  'public', 'find_user_by_public_id', ARRAY['text'],
  'find_user_by_public_id(text) существует'
);
-- Возвращает НЕ email: набор записей (RETURNS TABLE → setof record):
-- колонки id/nickname/avatar_variant.
SELECT function_returns(
  'public', 'find_user_by_public_id', ARRAY['text'], 'setof record',
  'find_user_by_public_id возвращает набор записей'
);

-- ─── Данные для RPC-тестов ──────────────────────────────────────────────────
-- Триггер on_auth_user_created (0001) при INSERT в auth.users сам заводит profile
-- со СЛУЧАЙНЫМ public_user_id, а guard-триггер (0026) запрещает его переписать.
-- Отключаем на время налива, чтобы задать известные TF-ID явно.
DO $$
DECLARE
  u_caller uuid := 'a1111111-1111-1111-1111-111111111111'::uuid;
  u_target uuid := 'a2222222-2222-2222-2222-222222222222'::uuid;
BEGIN
  ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
  INSERT INTO auth.users (id, email) VALUES
    (u_caller, 'caller@test'), (u_target, 'target@test')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id, email, public_user_id, nickname, avatar_variant)
    VALUES
      (u_caller, 'caller@test', 'TF-CALL1', 'Caller', 3),
      (u_target, 'target@test', 'TF-TGT10', 'Target', 5)
    ON CONFLICT (id) DO NOTHING;
  ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
END$$;

-- Как аутентифицированный вызывающий — находит цель по TF-ID.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a1111111-1111-1111-1111-111111111111';

SELECT is(
  (SELECT id FROM public.find_user_by_public_id('TF-TGT10')),
  'a2222222-2222-2222-2222-222222222222'::uuid,
  'RPC находит пользователя по TF-ID'
);
SELECT is(
  (SELECT nickname FROM public.find_user_by_public_id('TF-TGT10')),
  'Target',
  'RPC возвращает nickname'
);
SELECT is(
  (SELECT avatar_variant FROM public.find_user_by_public_id('TF-TGT10')),
  5,
  'RPC возвращает avatar_variant'
);
-- trim + upper: ввод с пробелами/в нижнем регистре нормализуется.
SELECT is(
  (SELECT id FROM public.find_user_by_public_id('  tf-tgt10 ')),
  'a2222222-2222-2222-2222-222222222222'::uuid,
  'RPC нормализует ввод (trim + upper)'
);
-- Несуществующий TF-ID → пусто.
SELECT is(
  (SELECT count(*)::int FROM public.find_user_by_public_id('TF-NOPE9')),
  0,
  'RPC возвращает пусто для несуществующего TF-ID'
);
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- Без аутентификации (auth.uid() IS NULL) → пусто, даже для валидного TF-ID.
SET LOCAL ROLE authenticated;
-- claim.sub НЕ выставлен → auth.uid() = NULL
SELECT is(
  (SELECT count(*)::int FROM public.find_user_by_public_id('TF-TGT10')),
  0,
  'RPC требует аутентификацию: без auth.uid() пусто'
);
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ─── 2. Триггер assert_at_least_one_owner ───────────────────────────────────
DO $$
DECLARE
  u_o1 uuid := 'b1111111-1111-1111-1111-111111111111'::uuid;
  u_o2 uuid := 'b2222222-2222-2222-2222-222222222222'::uuid;
  u_ed uuid := 'b3333333-3333-3333-3333-333333333333'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (u_o1, 'own1@test'), (u_o2, 'own2@test'), (u_ed, 'edit@test')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
    VALUES ('ws-own-10', u_o1, u_o1, 'OwnerTest', 'personal')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('mo1-10', 'ws-own-10', u_o1, 'owner'),
    ('med-10', 'ws-own-10', u_ed, 'editor')
    ON CONFLICT DO NOTHING;
END$$;

-- Сами проверки гейта — только когда auth.uid() задан (явные пользовательские операции).
-- Системные каскады (auth.uid() IS NULL) триггер пропускает — см. тест 5 ниже.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'b1111111-1111-1111-1111-111111111111';

-- Нельзя удалить единственного owner'a (hard DELETE).
SELECT throws_ok(
  $$ DELETE FROM public.sync_workspace_members WHERE id = 'mo1-10' $$,
  '23514', NULL, 'нельзя удалить последнего owner (DELETE)'
);
-- Нельзя soft-удалить единственного owner'a (UPDATE deleted_at).
SELECT throws_ok(
  $$ UPDATE public.sync_workspace_members SET deleted_at = now() WHERE id = 'mo1-10' $$,
  '23514', NULL, 'нельзя soft-удалить последнего owner (UPDATE deleted_at)'
);
-- Нельзя понизить единственного owner'a.
SELECT throws_ok(
  $$ UPDATE public.sync_workspace_members SET role = 'editor' WHERE id = 'mo1-10' $$,
  '23514', NULL, 'нельзя понизить последнего owner'
);
-- Понижение editor'a — не задевает триггер (owner остаётся).
SELECT lives_ok(
  $$ UPDATE public.sync_workspace_members SET role = 'viewer' WHERE id = 'med-10' $$,
  'понижение editor→viewer разрешено (owner остаётся)'
);
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- При наличии ВТОРОГО owner'a — можно удалить первого.
DO $$
DECLARE
  u_o2 uuid := 'b2222222-2222-2222-2222-222222222222'::uuid;
BEGIN
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role)
    VALUES ('mo2-10', 'ws-own-10', u_o2, 'owner')
    ON CONFLICT DO NOTHING;
END$$;
SELECT lives_ok(
  $$ UPDATE public.sync_workspace_members SET deleted_at = now() WHERE id = 'mo1-10' $$,
  'можно soft-удалить owner, если есть второй owner'
);

-- ─── 3. RLS sync_workspace_members: owner vs editor/viewer ──────────────────
DO $$
DECLARE
  u_own uuid := 'c1111111-1111-1111-1111-111111111111'::uuid;
  u_edt uuid := 'c2222222-2222-2222-2222-222222222222'::uuid;
  u_new uuid := 'c3333333-3333-3333-3333-333333333333'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (u_own, 'mown@test'), (u_edt, 'medt@test'), (u_new, 'mnew@test')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
    VALUES ('ws-mem-10', u_own, u_own, 'MembersTest', 'personal')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('mm-own-10', 'ws-mem-10', u_own, 'owner'),
    ('mm-edt-10', 'ws-mem-10', u_edt, 'editor')
    ON CONFLICT DO NOTHING;
END$$;

-- editor НЕ может добавить участника (RLS WITH CHECK → 42501).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'c2222222-2222-2222-2222-222222222222';
SELECT throws_ok(
  $$ INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role)
       VALUES ('mm-new-e', 'ws-mem-10', 'c3333333-3333-3333-3333-333333333333'::uuid, 'viewer') $$,
  '42501', NULL, 'editor НЕ может добавить участника'
);
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- owner МОЖЕТ добавить участника.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'c1111111-1111-1111-1111-111111111111';
SELECT lives_ok(
  $$ INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role)
       VALUES ('mm-new-o', 'ws-mem-10', 'c3333333-3333-3333-3333-333333333333'::uuid, 'viewer') $$,
  'owner может добавить участника'
);
-- owner МОЖЕТ сменить роль участника.
SELECT lives_ok(
  $$ UPDATE public.sync_workspace_members SET role = 'editor' WHERE id = 'mm-new-o' $$,
  'owner может сменить роль участника'
);
-- owner МОЖЕТ удалить участника.
SELECT lives_ok(
  $$ DELETE FROM public.sync_workspace_members WHERE id = 'mm-new-o' $$,
  'owner может удалить участника'
);
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- self-leave: не-owner (editor) может soft-удалить свою строку.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'c2222222-2222-2222-2222-222222222222';
SELECT lives_ok(
  $$ UPDATE public.sync_workspace_members SET deleted_at = now() WHERE id = 'mm-edt-10' $$,
  'не-owner может выйти сам (self-leave soft-delete)'
);
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ─── 4. Soft-delete пространства: СИСТЕМНОЕ личное нельзя, shared owner может ─
-- ПОСЛЕ 0036 block_personal_workspace_delete защищает ТОЛЬКО системное личное
-- пространство с детерминированным id = 'ws_' || replace(owner_id,'-','').
-- Дополнительные personal-пространства (произвольный id) теперь удаляемы.
-- Создаём СИСТЕМНОЕ личное пространство для u_own и проверяем гейт.
DO $$
DECLARE
  u_own uuid := 'c1111111-1111-1111-1111-111111111111'::uuid;
  v_sys text := 'ws_' || replace('c1111111-1111-1111-1111-111111111111', '-', '');
BEGIN
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
    VALUES (v_sys, u_own, u_own, 'SystemPersonal', 'personal')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role)
    VALUES ('mm-sys-own-10', v_sys, u_own, 'owner')
    ON CONFLICT DO NOTHING;
END$$;

-- Системное личное: даже owner не может soft-удалить (block_personal_workspace_delete).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'c1111111-1111-1111-1111-111111111111';
SELECT throws_ok(
  $$ UPDATE public.sync_workspaces SET deleted_at = now()
       WHERE id = 'ws_c1111111111111111111111111111111' $$,
  '23514', NULL, 'СИСТЕМНОЕ личное пространство нельзя soft-удалить (0036)'
);
-- Дополнительное personal (произвольный id) — owner МОЖЕТ soft-удалить (0036).
SELECT lives_ok(
  $$ UPDATE public.sync_workspaces SET deleted_at = now() WHERE id = 'ws-mem-10' $$,
  'дополнительное personal-пространство (произвольный id) owner может soft-удалить (0036)'
);
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- Shared-пространство создаём как superuser. Guard block_shared_workspaces (0027)
-- снят миграцией 0030 (FK-каскады) — kind='shared' теперь разрешён в схеме,
-- поэтому отключать триггер больше не нужно.
DO $$
DECLARE
  u_so uuid := 'd1111111-1111-1111-1111-111111111111'::uuid;
  u_se uuid := 'd2222222-2222-2222-2222-222222222222'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u_so, 'sown@test'), (u_se, 'sedt@test')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
    VALUES ('ws-shd-10', u_so, u_so, 'SharedTest', 'shared')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('sm-own-10', 'ws-shd-10', u_so, 'owner'),
    ('sm-edt-10', 'ws-shd-10', u_se, 'editor')
    ON CONFLICT DO NOTHING;
END$$;

-- editor НЕ может soft-удалить shared-ws (RLS update → owner; строк 0).
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'd2222222-2222-2222-2222-222222222222';
UPDATE public.sync_workspaces SET deleted_at = now() WHERE id = 'ws-shd-10';
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
SELECT is(
  (SELECT deleted_at FROM public.sync_workspaces WHERE id = 'ws-shd-10'),
  NULL,
  'editor НЕ может soft-удалить shared-ws (RLS отсекла UPDATE)'
);

-- owner МОЖЕТ soft-удалить shared-ws.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'd1111111-1111-1111-1111-111111111111';
SELECT lives_ok(
  $$ UPDATE public.sync_workspaces SET deleted_at = now() WHERE id = 'ws-shd-10' $$,
  'owner может soft-удалить shared-ws'
);
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';
SELECT isnt(
  (SELECT deleted_at FROM public.sync_workspaces WHERE id = 'ws-shd-10'),
  NULL,
  'shared-ws помечено deleted_at после soft-delete owner''ом'
);

-- ─── 5. Каскад auth.users → personal-ws (гайд не блокирует системные каскады) ──
do $$
declare u_cas uuid := 'e1111111-1111-1111-1111-111111111111'::uuid;
begin
  insert into auth.users (id, email) values (u_cas, 'cascade@test') on conflict do nothing;
  insert into public.sync_workspaces (id, user_id, owner_id, name, kind)
    values ('ws-cas-10', u_cas, u_cas, 'CascadePersonal', 'personal')
    on conflict do nothing;
end$$;
SELECT lives_ok(
  $$ DELETE FROM auth.users WHERE id = 'e1111111-1111-1111-1111-111111111111' $$,
  'удаление auth.users каскадно сносит personal-ws (guard не мешает системным каскадам)'
);

SELECT * FROM finish();
ROLLBACK;
