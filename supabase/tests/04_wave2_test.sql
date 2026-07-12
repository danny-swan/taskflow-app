-- TaskFlow Wave 2 — pgTAP: security-хардненинг (миграция 0020)
--
-- Покрывает находки Wave 2 (docs/audit/roadmap.md, раздел 5):
--   N4/N5 — anon и authenticated НЕ имеют SELECT на admin_users_summary и
--           sync_status_summary; обе view имеют security_invoker=on.
--   N12   — profiles_update_own имеет WITH CHECK (нельзя сменить id на чужой).
--   N15   — get_users_emails: EXECUTE сохранён для authenticated, но функция
--           отклоняет вызов не-admin (утечка чужих email невозможна), а
--           admin получает данные.

BEGIN;
SELECT plan(15);

-- ─── N4/N5. Views закрыты для anon/authenticated ───────────────────────────
SELECT ok(NOT has_table_privilege('anon',          'public.admin_users_summary', 'SELECT'),
          'N4: anon НЕ SELECT admin_users_summary');
SELECT ok(NOT has_table_privilege('authenticated', 'public.admin_users_summary', 'SELECT'),
          'N4: authenticated НЕ SELECT admin_users_summary');
SELECT ok(NOT has_table_privilege('anon',          'public.sync_status_summary', 'SELECT'),
          'N5: anon НЕ SELECT sync_status_summary');
SELECT ok(NOT has_table_privilege('authenticated', 'public.sync_status_summary', 'SELECT'),
          'N5: authenticated НЕ SELECT sync_status_summary');

-- ─── N4/N5. security_invoker=on выставлен на обеих view ─────────────────────
SELECT ok(
  (SELECT array_to_string(c.reloptions, ',') LIKE '%security_invoker=on%'
     FROM pg_class c WHERE c.oid = 'public.admin_users_summary'::regclass),
  'N4: admin_users_summary имеет security_invoker=on');
SELECT ok(
  (SELECT array_to_string(c.reloptions, ',') LIKE '%security_invoker=on%'
     FROM pg_class c WHERE c.oid = 'public.sync_status_summary'::regclass),
  'N5: sync_status_summary имеет security_invoker=on');

-- ─── N12. profiles_update_own имеет WITH CHECK ──────────────────────────────
SELECT isnt(
  (SELECT with_check FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'profiles_update_own'),
  NULL,
  'N12: у profiles_update_own задан WITH CHECK');
-- USING по-прежнему на месте (не потеряли при пересоздании).
SELECT isnt(
  (SELECT qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'profiles_update_own'),
  NULL,
  'N12: у profiles_update_own сохранён USING');

-- ─── N12. Функциональная проверка WITH CHECK ────────────────────────────────
-- Готовим двух юзеров в auth.users, но профиль только у user1.
DO $$
DECLARE
  u1 uuid := 'a1a1a1a1-1111-1111-1111-111111111111'::uuid;
  u2 uuid := 'a2a2a2a2-2222-2222-2222-222222222222'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u1, 'w2-user1@test'), (u2, 'w2-user2@test')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id, email) VALUES (u1, 'w2-user1@test')
    ON CONFLICT (id) DO NOTHING;
END$$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a1a1a1a1-1111-1111-1111-111111111111';

-- Обновление собственного профиля (id не меняется) — проходит.
SELECT lives_ok(
  $q$ UPDATE public.profiles SET email = 'w2-user1-new@test'
       WHERE id = 'a1a1a1a1-1111-1111-1111-111111111111'::uuid $q$,
  'N12: user1 может обновить свой профиль (id не меняется)');

-- Попытка сменить id на чужой (существующий в auth.users). С миграции 0026
-- неизменяемость id обеспечивает guard-триггер profiles_guard_immutable: он
-- BEFORE UPDATE молча возвращает old.id, поэтому UPDATE не бросает 42501, но и
-- id не меняется — строка по-прежнему принадлежит user1.
UPDATE public.profiles SET id = 'a2a2a2a2-2222-2222-2222-222222222222'::uuid
  WHERE id = 'a1a1a1a1-1111-1111-1111-111111111111'::uuid;
SELECT is(
  (SELECT count(*)::int FROM public.profiles
     WHERE id = 'a1a1a1a1-1111-1111-1111-111111111111'::uuid),
  1,
  'N12: user1 НЕ может сменить id — guard возвращает прежний id');

RESET ROLE;

-- ─── N15. Права EXECUTE на get_users_emails ─────────────────────────────────
SELECT ok(has_function_privilege('authenticated', 'public.get_users_emails(uuid[])', 'EXECUTE'),
          'N15: authenticated имеет EXECUTE (вызов из AdminPage под JWT админа)');
SELECT ok(NOT has_function_privilege('anon', 'public.get_users_emails(uuid[])', 'EXECUTE'),
          'N15: anon НЕ имеет EXECUTE на get_users_emails');

-- ─── N15. Функциональная проверка admin-гейта ───────────────────────────────
-- Готовим admin (source=seed, plan=lifetime) и обычного юзера.
DO $$
DECLARE
  admin_id uuid := 'ad000000-0000-0000-0000-00000000ad01'::uuid;
  norm_id  uuid := 'b0000000-0000-0000-0000-0000000000b1'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (admin_id, 'w2-admin@test'), (norm_id, 'w2-norm@test')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id, email) VALUES
    (admin_id, 'w2-admin@test'), (norm_id, 'w2-norm@test')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_entitlements (user_id, plan, source) VALUES
    (admin_id, 'lifetime', 'seed'),
    (norm_id,  'pro',      'yookassa')
    ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, source = EXCLUDED.source;
END$$;

-- Обычный authenticated-юзер: получает Forbidden (не admin) → email не утекают.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'b0000000-0000-0000-0000-0000000000b1';
SELECT throws_ok(
  $q$ SELECT * FROM public.get_users_emails(
        ARRAY['ad000000-0000-0000-0000-00000000ad01']::uuid[]) $q$,
  'P0001',
  'Forbidden: admin only',
  'N15: обычный authenticated получает Forbidden при попытке достать чужой email');
RESET ROLE;

-- Admin (seed+lifetime): получает email обычного юзера.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'ad000000-0000-0000-0000-00000000ad01';
SELECT is(
  (SELECT count(*)::int FROM public.get_users_emails(
     ARRAY['b0000000-0000-0000-0000-0000000000b1']::uuid[])),
  1,
  'N15: admin получает 1 строку с email обычного юзера');
SELECT is(
  (SELECT email FROM public.get_users_emails(
     ARRAY['b0000000-0000-0000-0000-0000000000b1']::uuid[]) LIMIT 1),
  'w2-norm@test',
  'N15: admin видит корректный email обычного юзера');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
