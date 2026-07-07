-- ============================================================================
-- 0017_admin_rpc.sql
--
-- v0.9.35-dev.6.6 — Admin RPC и RLS для AdminPage.
--
-- 1. RPC get_users_emails(user_ids uuid[]) — SECURITY DEFINER
--    Возвращает [{id, email}] для переданных user_id.
--    Вызов из клиента; функция работает под service_role (SECURITY DEFINER).
--    RLS-доступ проверяется внутри функции: только admin (source='seed'
--    или email в ADMIN_EMAILS — проверяем через auth.email()).
--
-- 2. RLS политики для AdminPage:
--    user_entitlements — admin видит ВСЕ строки (SELECT)
--    renewal_attempts_log — admin видит ВСЕ строки (SELECT)
--    payment_events — admin видит ВСЕ строки (SELECT)
--
-- Idempotence: OR REPLACE / IF NOT EXISTS / IF EXISTS.
-- ============================================================================

-- ─── 1. RPC get_users_emails ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_users_emails(user_ids uuid[])
RETURNS TABLE(id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  caller_id   uuid;
  caller_ent  public.user_entitlements%ROWTYPE;
BEGIN
  -- Получаем caller_id из текущей сессии
  caller_id := auth.uid();
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Проверяем: только admin (source = 'seed') получает все email-ы
  SELECT * INTO caller_ent
    FROM public.user_entitlements
   WHERE user_entitlements.user_id = caller_id;

  IF caller_ent.source IS DISTINCT FROM 'seed' OR caller_ent.plan IS DISTINCT FROM 'lifetime' THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;

  -- Возвращаем email-ы из auth.users
  RETURN QUERY
    SELECT u.id, u.email::text
      FROM auth.users u
     WHERE u.id = ANY(user_ids);
END;
$$;

-- Права: только авторизованные пользователи могут вызывать
REVOKE ALL ON FUNCTION public.get_users_emails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_users_emails(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_users_emails IS
  'Admin-only RPC: returns {id, email} for given user_ids. SECURITY DEFINER — проверяет admin source=seed.';

-- ─── 2. RLS — admin видит все строки ─────────────────────────────────────────

-- Хелпер-функция: является ли текущий пользователь admin?
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_entitlements
     WHERE user_id = auth.uid()
       AND source = 'seed'
       AND plan = 'lifetime'
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;

-- user_entitlements: добавляем политику SELECT для admin
DO $$ BEGIN
  -- Удаляем старую, если есть (для idempotency при re-run)
  DROP POLICY IF EXISTS "admin_select_all_entitlements" ON public.user_entitlements;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "admin_select_all_entitlements"
  ON public.user_entitlements
  FOR SELECT
  USING (public.is_admin_user());

-- renewal_attempts_log: добавляем политику SELECT для admin
DO $$ BEGIN
  DROP POLICY IF EXISTS "admin_select_all_renewal_log" ON public.renewal_attempts_log;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "admin_select_all_renewal_log"
  ON public.renewal_attempts_log
  FOR SELECT
  USING (public.is_admin_user());

-- payment_events: добавляем политику SELECT для admin
DO $$ BEGIN
  DROP POLICY IF EXISTS "admin_select_all_payment_events" ON public.payment_events;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "admin_select_all_payment_events"
  ON public.payment_events
  FOR SELECT
  USING (public.is_admin_user());

-- ─── COMMENT ─────────────────────────────────────────────────────────────────
COMMENT ON FUNCTION public.is_admin_user IS
  'Returns true if current user has source=seed AND plan=lifetime in user_entitlements. Used in admin RLS policies.';
