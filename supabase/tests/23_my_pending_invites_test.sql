-- TaskFlow — pgTAP: входящие приглашения с названием пространства и профилем
-- пригласившего (миграция 0044, находка F56, ADR 0036).
--
-- Покрывает:
--   • гранты: EXECUTE есть у authenticated, нет у anon;
--   • функция SECURITY DEFINER и STABLE (только чтение);
--   • сигнатура не содержит email и других приватных полей profiles;
--   • КОРЕНЬ F56: приглашённый (ещё не участник ws) прямым SELECT'ом не видит
--     ни строку sync_workspaces, ни профиль пригласившего — а саму строку
--     приглашения видит;
--   • RPC отдаёт приглашённому его pending с workspace_name + публичным
--     минимумом профиля пригласившего;
--   • чужие приглашения не возвращаются (гейт target_user_id = auth.uid());
--   • не-pending (accepted/rejected) приглашения не возвращаются;
--   • приглашение в мягко удалённое (deleted_at) пространство остаётся в
--     выдаче вместе с именем — строка ws физически на месте.

BEGIN;
SELECT plan(14);

-- ─── Гранты и свойства функции ──────────────────────────────────────────────
SELECT ok(has_function_privilege('authenticated',
            'public.get_my_pending_invites()', 'EXECUTE'),
          'F56: authenticated имеет EXECUTE на get_my_pending_invites');
SELECT ok(NOT has_function_privilege('anon',
            'public.get_my_pending_invites()', 'EXECUTE'),
          'F56: anon НЕ имеет EXECUTE на get_my_pending_invites');
SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_my_pending_invites'),
  'F56: RPC объявлена SECURITY DEFINER');
SELECT is(
  (SELECT p.provolatile::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_my_pending_invites'),
  's',
  'F56: RPC STABLE (только чтение, без побочных эффектов)');
SELECT ok(
  (SELECT pg_get_function_result(p.oid) NOT ILIKE '%email%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_my_pending_invites'),
  'F56: сигнатура RPC не содержит email (только публичный минимум)');
SELECT is(
  (SELECT p.pronargs::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_my_pending_invites'),
  0,
  'F56: у RPC нет параметров — чужой инвайт подобрать нечем');

-- ─── Фикстуры: owner + приглашённый + посторонний, два пространства ─────────
DO $$
DECLARE
  u_own uuid := 'a0000023-0000-0000-0000-000000000001'::uuid;  -- владелец, он же пригласивший
  u_tgt uuid := 'a0000023-0000-0000-0000-000000000002'::uuid;  -- приглашённый
  u_oth uuid := 'a0000023-0000-0000-0000-000000000003'::uuid;  -- посторонний
BEGIN
  -- Как в тестах 19/20/21: триггер on_auth_user_created сгенерировал бы свой
  -- TF-ID, а guard-триггер потом молча запретил бы его переписать.
  ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
  INSERT INTO auth.users (id, email) VALUES
    (u_own, 'mi-own@test'), (u_tgt, 'mi-tgt@test'), (u_oth, 'mi-oth@test')
    ON CONFLICT (id) DO NOTHING;
  ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

  INSERT INTO public.profiles (id, email, public_user_id, nickname, avatar_variant, avatar_color, bio) VALUES
    (u_own, 'mi-own@test', 'TF-MIOWN', 'Пригласивший', 7, '#aa3311', 'о себе'),
    (u_tgt, 'mi-tgt@test', 'TF-MITGT', NULL,           2, NULL,      NULL),
    (u_oth, 'mi-oth@test', 'TF-MIOTH', 'Посторонний',  3, NULL,      NULL)
    ON CONFLICT (id) DO UPDATE SET
      nickname       = EXCLUDED.nickname,
      avatar_variant = EXCLUDED.avatar_variant,
      avatar_color   = EXCLUDED.avatar_color,
      bio            = EXCLUDED.bio;

  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('ws23',      u_own, u_own, 'Проектная кухня', 'shared'),
    ('ws23_soft', u_own, u_own, 'Мягко удалённое', 'shared')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('m23_own', 'ws23', u_own, 'owner')
    ON CONFLICT DO NOTHING;

  INSERT INTO public.sync_workspace_invites
    (id, workspace_id, inviter_user_id, target_public_user_id, target_user_id, role, status, expires_at) VALUES
    -- моё pending
    ('i23_mine',     'ws23',      u_own, 'TF-MITGT', u_tgt, 'editor', 'pending',  now() + interval '5 days'),
    -- моё, но уже принятое → в выдаче быть не должно
    ('i23_accepted', 'ws23',      u_own, 'TF-MITGT', u_tgt, 'viewer', 'accepted', now() + interval '5 days'),
    -- чужое pending → в моей выдаче быть не должно
    ('i23_foreign',  'ws23',      u_own, 'TF-MIOTH', u_oth, 'viewer', 'pending',  now() + interval '5 days'),
    -- моё pending в мягко удалённое пространство
    ('i23_soft',     'ws23_soft', u_own, 'TF-MITGT', u_tgt, 'editor', 'pending',  now() + interval '5 days')
    ON CONFLICT DO NOTHING;

  -- Мягкое удаление: строка ws остаётся (жёсткое удаление невозможно — FK
  -- sync_workspace_invites.workspace_id ON DELETE CASCADE снёс бы и инвайт).
  UPDATE public.sync_workspaces SET deleted_at = now() WHERE id = 'ws23_soft';
END$$;

-- ─── КОРЕНЬ F56: что приглашённый видит прямым SELECT'ом ────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000023-0000-0000-0000-000000000002';

SELECT is(
  (SELECT count(*)::int FROM public.sync_workspaces WHERE id = 'ws23'),
  0,
  'F56 (корень): приглашённый НЕ видит строку пространства — имя брать неоткуда');
SELECT is(
  (SELECT count(*)::int FROM public.profiles
    WHERE id = 'a0000023-0000-0000-0000-000000000001'::uuid),
  0,
  'F56 (корень): приглашённый НЕ видит профиль пригласившего (own-row RLS)');
SELECT is(
  (SELECT count(*)::int FROM public.sync_workspace_invites WHERE id = 'i23_mine'),
  1,
  'F56 (корень): саму строку приглашения приглашённый видит — в ней только id');

-- ─── RPC отдаёт отображаемые поля ───────────────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.get_my_pending_invites()),
  2,
  'F56: RPC отдаёт ровно мои pending (accepted и чужое исключены)');
SELECT is(
  (SELECT workspace_name || ' | ' || inviter_public_user_id || ' | ' || inviter_nickname
        || ' | v' || inviter_avatar_variant || ' | ' || inviter_avatar_color
     FROM public.get_my_pending_invites() WHERE id = 'i23_mine'),
  'Проектная кухня | TF-MIOWN | Пригласивший | v7 | #aa3311',
  'F56: имя пространства и публичный профиль пригласившего доступны');
SELECT is(
  (SELECT count(*)::int FROM public.get_my_pending_invites() WHERE id = 'i23_foreign'),
  0,
  'F56: чужое приглашение не возвращается (гейт target_user_id = auth.uid())');
SELECT is(
  (SELECT count(*)::int FROM public.get_my_pending_invites() WHERE id = 'i23_accepted'),
  0,
  'F56: не-pending приглашение не возвращается');
SELECT is(
  (SELECT coalesce(workspace_name, '<null>') FROM public.get_my_pending_invites()
    WHERE id = 'i23_soft'),
  'Мягко удалённое',
  'F56: приглашение в мягко удалённое пространство остаётся в выдаче с именем');

RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

SELECT * FROM finish();
ROLLBACK;
