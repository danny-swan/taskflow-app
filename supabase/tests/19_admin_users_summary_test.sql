-- TaskFlow P4 — pgTAP: admin-список всех пользователей (миграция 0039)
--
-- Покрывает находку F12 (docs/audit/roadmap.md §5, §7.12):
--   • get_admin_users_summary: EXECUTE у authenticated, нет у anon;
--   • admin-гейт — обычный юзер → 'Forbidden: admin only', admin → успех;
--   • РЕГРЕССИЯ P4 — функция возвращает пользователей БЕЗ строки entitlement
--     (free-юзеры), которые раньше были невидимы в админке;
--   • view admin_users_summary имеет колонку public_user_id, security_invoker=on
--     сохранён, authenticated НЕ имеет SELECT на view (регрессия N4).

BEGIN;
SELECT plan(14);

-- ─── Права EXECUTE на get_admin_users_summary ───────────────────────────────
SELECT ok(has_function_privilege('authenticated', 'public.get_admin_users_summary()', 'EXECUTE'),
          'F12: authenticated имеет EXECUTE (вызов из AdminPage под JWT админа)');
SELECT ok(NOT has_function_privilege('anon', 'public.get_admin_users_summary()', 'EXECUTE'),
          'F12: anon НЕ имеет EXECUTE на get_admin_users_summary');

-- ─── view admin_users_summary: public_user_id + security_invoker + закрыт ────
SELECT has_column('public', 'admin_users_summary', 'public_user_id',
                  'F12: admin_users_summary содержит public_user_id');
SELECT ok(
  (SELECT array_to_string(c.reloptions, ',') LIKE '%security_invoker=on%'
     FROM pg_class c WHERE c.oid = 'public.admin_users_summary'::regclass),
  'N4: admin_users_summary сохраняет security_invoker=on');
SELECT ok(NOT has_table_privilege('authenticated', 'public.admin_users_summary', 'SELECT'),
          'N4: authenticated НЕ SELECT admin_users_summary (доступ только через RPC)');
SELECT ok(NOT has_table_privilege('anon', 'public.admin_users_summary', 'SELECT'),
          'N4: anon НЕ SELECT admin_users_summary');

-- ─── Данные: admin (seed+lifetime), обычный юзер (pro), free (без entitlement) ─
DO $$
DECLARE
  admin_id uuid := 'ad000000-0000-0000-0000-0000000000f4'::uuid;
  norm_id  uuid := 'b0000000-0000-0000-0000-0000000000f4'::uuid;
  free_id  uuid := 'f0000000-0000-0000-0000-0000000000f4'::uuid;
BEGIN
  -- ВАЖНО (F34): триггер on_auth_user_created отключаем, как в тесте 20.
  -- Иначе он создаёт profiles-строку раньше нас со СГЕНЕРИРОВАННЫМ TF-ID, а
  -- переписать его потом невозможно: BEFORE UPDATE триггер
  -- profiles_guard_immutable (0026, §5) МОЛЧА возвращает старое значение
  -- public_user_id. Поэтому фикстура должна вставлять profiles сама.
  ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
  INSERT INTO auth.users (id, email) VALUES
    (admin_id, 'p4-admin@test'),
    (norm_id,  'p4-norm@test'),
    (free_id,  'p4-free@test')
    ON CONFLICT (id) DO NOTHING;
  ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
  INSERT INTO public.profiles (id, email, public_user_id) VALUES
    (admin_id, 'p4-admin@test', 'TF-ADMIN0'),
    (norm_id,  'p4-norm@test',  'TF-NORM00'),
    (free_id,  'p4-free@test',  'TF-FREE00')
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  -- Entitlement ТОЛЬКО для admin и обычного юзера; free-юзер — БЕЗ строки.
  INSERT INTO public.user_entitlements (user_id, plan, source) VALUES
    (admin_id, 'lifetime', 'seed'),
    (norm_id,  'pro',      'yookassa')
    ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, source = EXCLUDED.source;
END$$;

-- ─── admin-гейт: обычный authenticated → Forbidden ──────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'b0000000-0000-0000-0000-0000000000f4';
SELECT throws_ok(
  $q$ SELECT * FROM public.get_admin_users_summary() $q$,
  'P0001',
  'Forbidden: admin only',
  'F12: обычный authenticated получает Forbidden');
RESET ROLE;

-- ─── admin: получает список, включая free-юзера без entitlement ─────────────
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'ad000000-0000-0000-0000-0000000000f4';

-- Регрессия P4: free-юзер БЕЗ entitlement присутствует в выдаче.
SELECT is(
  (SELECT count(*)::int FROM public.get_admin_users_summary()
     WHERE id = 'f0000000-0000-0000-0000-0000000000f4'::uuid),
  1,
  'F12 (регрессия P4): free-юзер без entitlement виден в выдаче админу');

-- У free-юзера entitlement-поля NULL (нет строки user_entitlements).
SELECT is(
  (SELECT plan FROM public.get_admin_users_summary()
     WHERE id = 'f0000000-0000-0000-0000-0000000000f4'::uuid),
  NULL,
  'F12: у free-юзера plan IS NULL (нет entitlement)');

-- Email free-юзера доступен (из profiles/auth) — раньше не показывался.
SELECT is(
  (SELECT email FROM public.get_admin_users_summary()
     WHERE id = 'f0000000-0000-0000-0000-0000000000f4'::uuid),
  'p4-free@test',
  'F12: email free-юзера виден админу');

-- public_user_id (TF-ID) прокидывается.
SELECT is(
  (SELECT public_user_id FROM public.get_admin_users_summary()
     WHERE id = 'f0000000-0000-0000-0000-0000000000f4'::uuid),
  'TF-FREE00',
  'F12: public_user_id (TF-ID) возвращается');

-- F34: инвариант 0026 §5 — public_user_id неизменяем, UPDATE молча откатывается
-- (именно поэтому фикстура выше отключает триггер, а не правит строку UPDATE'ом).
RESET ROLE;
SELECT lives_ok(
  $q$ UPDATE public.profiles SET public_user_id = 'TF-HACKED'
        WHERE id = 'f0000000-0000-0000-0000-0000000000f4'::uuid $q$,
  'F34: UPDATE public_user_id не бросает ошибку (guard молчаливый)');
SELECT is(
  (SELECT public_user_id FROM public.profiles
     WHERE id = 'f0000000-0000-0000-0000-0000000000f4'::uuid),
  'TF-FREE00',
  'F34: profiles_guard_immutable вернул прежний public_user_id');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'ad000000-0000-0000-0000-0000000000f4';

-- Платный юзер: entitlement собран (plan=pro).
SELECT is(
  (SELECT plan FROM public.get_admin_users_summary()
     WHERE id = 'b0000000-0000-0000-0000-0000000000f4'::uuid),
  'pro',
  'F12: платный юзер отдаёт plan=pro');

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
