-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- pgTAP: F42 — RLS-контракт «покинуть пространство» для не-владельца.
--
-- Корень F42 (доказан прод-пробой под ROLLBACK 03.08.2026): клиентский push
-- отправлял ЛЮБУЮ операцию, включая op='delete', как PostgREST-upsert, то есть
-- как `INSERT ... ON CONFLICT DO UPDATE`. Postgres требует прохождения
-- INSERT-политики RLS даже когда фактически выполняется ветка DO UPDATE, а
-- политика sync_workspace_members_insert_ws_role разрешает INSERT только
-- владельцу пространства. Поэтому у editor'а «покинуть пространство» падало с
-- 42501, ошибка классифицировалась как permanent и строка молча оседала в
-- outbox: на сервере членство оставалось живым, у владельца участник висел в
-- списке, а на следующем полном pull'е членство возвращалось и самому вышедшему.
-- Отдельная политика sync_workspace_members_self_leave_update такое гашение
-- разрешает — этим и пользуется исправленный push (см. ADR 0033).
--
-- Этот файл фиксирует контракт на уровне БД, чтобы фикс нельзя было откатить
-- незаметно:
--   F42-1 upsert-путь (INSERT ON CONFLICT) от editor'а — ОТКАЗ 42501;
--   F42-2 UPDATE-путь (гашение своей строки) от editor'а — ПРОХОДИТ;
--   F42-3 после UPDATE строка действительно погашена;
--   F42-4 UPDATE без гашения (попытка поднять себе роль) — ОТКАЗ (WITH CHECK);
--   F42-5 owner не может выйти сам собой (self-leave только для role <> owner);
--   F42-6 editor не может погасить ЧУЖУЮ строку членства.
--
-- Стиль (SET LOCAL ROLE authenticated + request.jwt.claim.sub) — как 20.
-- Совместимо с vanilla Postgres 15 (CI).

BEGIN;
SELECT plan(6);

-- ============================================================================
-- SETUP
-- ============================================================================
DO $$
DECLARE
  u_own uuid := 'a0000022-0000-0000-0000-000000000001'::uuid; -- владелец ws22
  u_edt uuid := 'a0000022-0000-0000-0000-000000000002'::uuid; -- editor (выходит)
  u_oth uuid := 'a0000022-0000-0000-0000-000000000003'::uuid; -- ещё один editor
BEGIN
  ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

  INSERT INTO auth.users (id, email) VALUES
    (u_own,'i22-own@t'),(u_edt,'i22-edt@t'),(u_oth,'i22-oth@t')
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, email, public_user_id) VALUES
    (u_own,'i22-own@t','TF-OWN221'),
    (u_edt,'i22-edt@t','TF-EDT222'),
    (u_oth,'i22-oth@t','TF-OTH223')
    ON CONFLICT (id) DO NOTHING;

  ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

  INSERT INTO public.user_entitlements (user_id, plan, valid_until) VALUES
    (u_own,'pro',now()+interval '30 days'),
    (u_edt,'pro',now()+interval '30 days'),
    (u_oth,'pro',now()+interval '30 days')
    ON CONFLICT (user_id) DO UPDATE SET plan=excluded.plan, valid_until=excluded.valid_until;

  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('ws22', u_own, u_own, 'Self-leave WS', 'shared') ON CONFLICT DO NOTHING;

  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('im22o','ws22',u_own,'owner'),
    ('im22e','ws22',u_edt,'editor'),
    ('im22x','ws22',u_oth,'editor')
    ON CONFLICT DO NOTHING;
END$$;

-- ============================================================================
-- F42-1 / F42-2 / F42-3: editor гасит СВОЮ строку членства.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000022-0000-0000-0000-000000000002'; -- u_edt

-- Ровно то, что делал старый push: upsert полной строки с проставленным
-- deleted_at. Ветка DO UPDATE не спасает — INSERT-политика проверяется всегда.
SELECT throws_ok($$
  INSERT INTO public.sync_workspace_members
    (id, workspace_id, user_id, role, deleted_at, updated_at)
  VALUES ('im22e','ws22','a0000022-0000-0000-0000-000000000002'::uuid,'editor', now(), now())
  ON CONFLICT (id) DO UPDATE
    SET deleted_at = excluded.deleted_at, updated_at = excluded.updated_at
$$,
  '42501',
  'new row violates row-level security policy for table "sync_workspace_members"',
  'F42-1: upsert-путь (INSERT ON CONFLICT) от editor''а отбивается RLS 42501');

-- А так делает исправленный push: точечный UPDATE по ключу строки.
SELECT lives_ok($$
  UPDATE public.sync_workspace_members
     SET deleted_at = now(), updated_at = now(), version = version + 1
   WHERE id = 'im22e'
$$,
  'F42-2: UPDATE-путь (гашение своей строки) проходит по self-leave политике');

SELECT isnt(
  (SELECT deleted_at FROM public.sync_workspace_members WHERE id='im22e'),
  NULL::timestamptz,
  'F42-3: строка членства действительно погашена (deleted_at NOT NULL)');

-- ============================================================================
-- F42-4: self-leave политика разрешает ТОЛЬКО гашение. Поднять себе роль
-- (deleted_at остаётся NULL) нельзя — WITH CHECK требует deleted_at IS NOT NULL,
-- а UPDATE-политика по роли требует owner.
-- ============================================================================
SELECT throws_ok($$
  UPDATE public.sync_workspace_members
     SET role = 'owner', deleted_at = NULL, updated_at = now()
   WHERE id = 'im22e'
$$,
  '42501',
  NULL,
  'F42-4: не-владелец не может UPDATE''ом поднять себе роль');

-- ============================================================================
-- F42-6: чужую строку членства editor погасить не может.
-- ============================================================================
SELECT is(
  (WITH upd AS (
     UPDATE public.sync_workspace_members
        SET deleted_at = now(), updated_at = now()
      WHERE id = 'im22x'
      RETURNING 1
   ) SELECT count(*)::int FROM upd),
  0,
  'F42-6: editor не гасит чужое членство (USING отсекает строку)');

-- ============================================================================
-- F42-5: владелец не уходит через self-leave (политика исключает role='owner').
-- Владелец проходит по общей UPDATE-политике «owner может всё», поэтому
-- проверяем именно предикат self-leave: для owner-строки он не выполняется.
-- ============================================================================
RESET ROLE;
SELECT is(
  (SELECT count(*)::int
     FROM pg_policy p
    WHERE p.polrelid = 'public.sync_workspace_members'::regclass
      AND p.polname = 'sync_workspace_members_self_leave_update'
      AND pg_get_expr(p.polqual, p.polrelid) LIKE '%role <> ''owner''%'),
  1,
  'F42-5: self-leave политика существует и исключает role=owner');

SELECT * FROM finish();
ROLLBACK;
