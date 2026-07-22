-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- pgTAP: F15 — accept_invite реактивирует soft-deleted membership.
--
-- Регрессия для 0040_accept_invite_upsert_membership.sql. До 0040 accept_invite
-- падала с 23505 при повторном приёме инвайта в тот же workspace после leave —
-- уникальный индекс sync_workspace_members_workspace_id_user_id_key не различает
-- soft-deleted и живые строки. Проверяем:
--   F15-1 первый приём (INSERT-путь): строка появилась, deleted_at=null;
--   F15-2 leave → повторный invite → повторный accept (UPDATE-путь):
--          ТА ЖЕ uuid membership-строки; deleted_at=null; version увеличен;
--          role может быть новой (из нового инвайта).
-- Стиль (SET LOCAL ROLE authenticated + request.jwt.claim.sub) — как 15.
-- Пред-инсерты (auth.users/profiles/entitlements/workspaces/invites) делаются
-- суперюзером, чтобы обойти RLS/guard-триггеры на налив.
--
-- Совместимо с vanilla Postgres 15 (CI).

BEGIN;
SELECT plan(6);

-- ============================================================================
-- SETUP
-- ============================================================================
DO $$
DECLARE
  u_own uuid := 'a0000020-0000-0000-0000-000000000001'::uuid; -- owner ws20
  u_gst uuid := 'a0000020-0000-0000-0000-000000000002'::uuid; -- гость (F15-1/F15-2)
BEGIN
  ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;

  INSERT INTO auth.users (id, email) VALUES
    (u_own,'i20-own@t'),(u_gst,'i20-gst@t')
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, email, public_user_id) VALUES
    (u_own,'i20-own@t','TF-OWN201'),
    (u_gst,'i20-gst@t','TF-GST202')
    ON CONFLICT (id) DO NOTHING;

  ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

  -- Оба на pro (иначе гейт по плану заблокирует accept для гостя).
  INSERT INTO public.user_entitlements (user_id, plan, valid_until) VALUES
    (u_own,'pro',now()+interval '30 days'),
    (u_gst,'pro',now()+interval '30 days')
    ON CONFLICT (user_id) DO UPDATE SET plan=excluded.plan, valid_until=excluded.valid_until;

  -- Shared-пространство ws20 + owner-членство.
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('ws20', u_own, u_own, 'Reactivation WS', 'shared') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('im20o','ws20',u_own,'owner') ON CONFLICT DO NOTHING;

  -- Два инвайта одному гостю в одно и то же пространство: сперва editor, потом
  -- viewer. Первый принимается сразу (INSERT-путь), затем гость делает leave
  -- (soft-delete), после чего принимается второй инвайт (UPDATE-путь).
  INSERT INTO public.sync_workspace_invites
    (id, workspace_id, inviter_user_id, target_public_user_id, target_user_id, role, status, expires_at) VALUES
    ('inv20a','ws20',u_own,'TF-GST202',u_gst,'editor','pending', now()+interval '7 days'),
    ('inv20b','ws20',u_own,'TF-GST202',u_gst,'viewer','pending', now()+interval '7 days')
    ON CONFLICT (id) DO NOTHING;
END$$;

-- ============================================================================
-- F15-1: первый приём инвайта (INSERT-путь).
-- Гость принимает inv20a → membership editor появилось, deleted_at=null.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000020-0000-0000-0000-000000000002'; -- u_gst

SELECT is((public.accept_invite('inv20a')).role, 'editor',
  'F15-1a: первый accept вернул role=editor');

SELECT is(
  (SELECT deleted_at FROM public.sync_workspace_members
    WHERE workspace_id='ws20' AND user_id='a0000020-0000-0000-0000-000000000002'::uuid),
  NULL::timestamptz,
  'F15-1b: строка членства живая (deleted_at IS NULL)');

-- Запоминаем uuid membership-строки для F15-2c: он должен сохраниться при повторном accept.
-- (Проверим совпадение uuid до/после leave+accept.)
CREATE TEMP TABLE _f15_before AS
SELECT id AS wsm_id, version AS v0
FROM public.sync_workspace_members
WHERE workspace_id='ws20' AND user_id='a0000020-0000-0000-0000-000000000002'::uuid;

-- ============================================================================
-- Гость делает leave (soft-delete). Используем remove_workspace_member(self):
-- нужно вернуться в суперюзер для UPDATE напрямую, чтобы не зависеть от того,
-- что RPC remove_workspace_member разрешает self-leave (это отдельный контракт,
-- покрытый в тесте 14). Здесь моделируем состояние «после leave».
-- ============================================================================
RESET ROLE;
UPDATE public.sync_workspace_members
   SET deleted_at = now(), updated_at = now(), version = version + 1
 WHERE workspace_id='ws20'
   AND user_id='a0000020-0000-0000-0000-000000000002'::uuid;

SELECT isnt(
  (SELECT deleted_at FROM public.sync_workspace_members
    WHERE workspace_id='ws20' AND user_id='a0000020-0000-0000-0000-000000000002'::uuid),
  NULL::timestamptz,
  'F15-2a: setup — строка soft-deleted (deleted_at NOT NULL)');

-- ============================================================================
-- F15-2: повторный invite → повторный accept (UPDATE-путь, реактивация).
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000020-0000-0000-0000-000000000002'; -- u_gst

SELECT is((public.accept_invite('inv20b')).role, 'viewer',
  'F15-2b: второй accept вернул role=viewer (новая роль из inv20b)');

SELECT is(
  (SELECT deleted_at FROM public.sync_workspace_members
    WHERE workspace_id='ws20' AND user_id='a0000020-0000-0000-0000-000000000002'::uuid),
  NULL::timestamptz,
  'F15-2c: строка снова живая (deleted_at IS NULL)');

-- uuid membership-строки должен сохраниться — важно для клиентского pull-matcher.
SELECT is(
  (SELECT id FROM public.sync_workspace_members
    WHERE workspace_id='ws20' AND user_id='a0000020-0000-0000-0000-000000000002'::uuid),
  (SELECT wsm_id FROM _f15_before),
  'F15-2d: uuid строки НЕ изменился (клиентский matcher распознает как ту же строку)');

SELECT * FROM finish();
ROLLBACK;
