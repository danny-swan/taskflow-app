-- TaskFlow — pgTAP: публичные профили участников пространства + avatar_color
-- (миграции 0042/0043, находки F40/F41, ADR 0031/0032).
--
-- Покрывает:
--   • profiles.avatar_color: колонка есть, CHECK принимает #rrggbb и NULL,
--     отклоняет мусор (F41);
--   • get_workspace_member_profiles: EXECUTE у authenticated, нет у anon (F40);
--   • участник пространства видит публичные профили ВСЕХ живых участников
--     (ник/TF-id/аватар/цвет/bio) — корень F40;
--   • чужой пользователь (не участник) получает пустой результат;
--   • вышедший участник (deleted_at) в выдаче отсутствует;
--   • email и другие приватные поля функция не возвращает (проверка сигнатуры).

BEGIN;
SELECT plan(13);

-- ─── F41: колонка avatar_color и её CHECK ───────────────────────────────────
SELECT has_column('public', 'profiles', 'avatar_color',
                  'F41: profiles.avatar_color существует');
SELECT col_is_null('public', 'profiles', 'avatar_color',
                   'F41: avatar_color nullable (NULL = цвет из темы)');

-- ─── F40: гранты на RPC ─────────────────────────────────────────────────────
SELECT ok(has_function_privilege('authenticated',
            'public.get_workspace_member_profiles(text)', 'EXECUTE'),
          'F40: authenticated имеет EXECUTE на get_workspace_member_profiles');
SELECT ok(NOT has_function_privilege('anon',
            'public.get_workspace_member_profiles(text)', 'EXECUTE'),
          'F40: anon НЕ имеет EXECUTE на get_workspace_member_profiles');

-- ─── F40: функция отдаёт только публичный минимум (нет email) ───────────────
SELECT ok(
  (SELECT pg_get_function_result(p.oid) NOT ILIKE '%email%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_workspace_member_profiles'),
  'F40: сигнатура RPC не содержит email (только публичный минимум)');
SELECT ok(
  (SELECT p.prosecdef
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_workspace_member_profiles'),
  'F40: RPC объявлена SECURITY DEFINER');

-- ─── Фикстуры: shared-ws с owner + editor + вышедшим участником + аутсайдер ─
DO $$
DECLARE
  u_own uuid := 'a0000021-0000-0000-0000-000000000001'::uuid;
  u_edt uuid := 'a0000021-0000-0000-0000-000000000002'::uuid;
  u_out uuid := 'a0000021-0000-0000-0000-000000000003'::uuid;
  u_lft uuid := 'a0000021-0000-0000-0000-000000000004'::uuid;
BEGIN
  -- Как в тестах 19/20: триггер on_auth_user_created генерирует свой TF-ID,
  -- а guard-триггер потом молча запретит его переписать → вставляем profiles сами.
  ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
  INSERT INTO auth.users (id, email) VALUES
    (u_own, 'mp-own@test'), (u_edt, 'mp-edt@test'),
    (u_out, 'mp-out@test'), (u_lft, 'mp-lft@test')
    ON CONFLICT (id) DO NOTHING;
  ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;

  INSERT INTO public.profiles (id, email, public_user_id, nickname, avatar_variant, avatar_color, bio) VALUES
    (u_own, 'mp-own@test', 'TF-MPOWN', 'Owner Nick', 6, '#ff8800', 'про меня'),
    (u_edt, 'mp-edt@test', 'TF-MPEDT', NULL,          3, NULL,      NULL),
    (u_out, 'mp-out@test', 'TF-MPOUT', 'Outsider',    2, '#123456', NULL),
    (u_lft, 'mp-lft@test', 'TF-MPLFT', 'Left',        4, '#00aa55', NULL)
    ON CONFLICT (id) DO UPDATE SET
      nickname = EXCLUDED.nickname,
      avatar_variant = EXCLUDED.avatar_variant,
      avatar_color = EXCLUDED.avatar_color,
      bio = EXCLUDED.bio;

  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('ws21', u_own, u_own, 'Members WS', 'shared') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role, deleted_at) VALUES
    ('m21_own', 'ws21', u_own, 'owner',  NULL),
    ('m21_edt', 'ws21', u_edt, 'editor', NULL),
    ('m21_lft', 'ws21', u_lft, 'viewer', now())
    ON CONFLICT DO NOTHING;
END$$;

-- ─── F41: CHECK отклоняет не-hex значение цвета ─────────────────────────────
SELECT throws_ok(
  $q$ UPDATE public.profiles SET avatar_color = 'red' WHERE public_user_id = 'TF-MPOUT' $q$,
  '23514',
  NULL,
  'F41: CHECK profiles_avatar_color_format отклоняет не-hex цвет');

-- ─── Участник видит публичные профили обоих живых участников ────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000021-0000-0000-0000-000000000002';

SELECT is(
  (SELECT count(*)::int FROM public.get_workspace_member_profiles('ws21')),
  2,
  'F40: участник получает ровно 2 живых профиля (вышедший исключён)');

SELECT is(
  (SELECT public_user_id FROM public.get_workspace_member_profiles('ws21')
    WHERE user_id = 'a0000021-0000-0000-0000-000000000001'::uuid),
  'TF-MPOWN',
  'F40: TF-id другого участника доступен (раньше был кусок uuid)');

SELECT is(
  (SELECT nickname FROM public.get_workspace_member_profiles('ws21')
    WHERE user_id = 'a0000021-0000-0000-0000-000000000001'::uuid),
  'Owner Nick',
  'F40: ник другого участника доступен');

SELECT is(
  (SELECT avatar_variant || '/' || coalesce(avatar_color, 'null')
     FROM public.get_workspace_member_profiles('ws21')
    WHERE user_id = 'a0000021-0000-0000-0000-000000000001'::uuid),
  '6/#ff8800',
  'F40/F41: форма и явный цвет аватара другого участника доступны');

SELECT is(
  (SELECT count(*)::int FROM public.get_workspace_member_profiles('ws21')
    WHERE user_id = 'a0000021-0000-0000-0000-000000000004'::uuid),
  0,
  'F40: вышедший участник (deleted_at) не возвращается');

RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

-- ─── Аутсайдер (не участник) не получает ничего ─────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000021-0000-0000-0000-000000000003';
SELECT is(
  (SELECT count(*)::int FROM public.get_workspace_member_profiles('ws21')),
  0,
  'F40: не-участник пространства получает пустой результат');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

SELECT * FROM finish();
ROLLBACK;
