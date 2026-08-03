-- ============================================================================
-- 0039_admin_users_summary_rpc.sql
--
-- P4 — админ не видит новых free-пользователей и их email (см. docs/audit/roadmap.md §5 F12, §7.12).
--
-- Корень: src/pages/AdminPage.tsx строил список пользователей ОТ таблицы
-- user_entitlements. Но триггер handle_new_user при регистрации создаёт строку
-- только в public.profiles (с email); строку в user_entitlements НЕ создаёт
-- (free-план = отсутствие строки). Поэтому free-пользователи без entitlement
-- вообще не попадали в список и их email не показывался.
--
-- Решение (см. ADR 0006): источник списка — profiles (полный набор всех
-- пользователей + email), а доступ клиенту-админу даём через SECURITY DEFINER
-- RPC public.get_admin_users_summary() с admin-гейтом public.is_admin_user()
-- (тот же паттерн, что get_users_emails / ADR 0002). Прямой SELECT на view с
-- клиента невозможен и не нужен (view остаётся security_invoker=on без GRANT).
--
-- Изменения идемпотентны (CREATE OR REPLACE VIEW / FUNCTION + повтор GRANT/REVOKE).
-- Схема таблиц НЕ меняется: только тело view (+колонка public_user_id) и новая RPC.
-- ============================================================================

-- ─── 1. View admin_users_summary — добавляем колонку public_user_id ──────────
--
-- Порядок/имена существующих колонок сохранены (из 0001); public_user_id
-- добавлен В КОНЕЦ списка. Это обязательно: CREATE OR REPLACE VIEW не умеет
-- вставлять новую колонку в середину/переименовывать существующие
-- (ERROR 42P16 'cannot change name of view column'). Порядок колонок view для
-- RPC не важен (RPC читает из profiles напрямую), а has_column-тест позиции не проверяет.
-- security_invoker=on СОХРАНЯЕМ (из 0020, N4/N5): view исполняется с правами
-- вызывающего, GRANT для anon/authenticated НЕ выдаём (REVOKE из 0020 в силе).
-- View — для service_role/дашборда, не для клиента.

CREATE OR REPLACE VIEW public.admin_users_summary AS
SELECT
  p.id,
  p.email,
  p.created_at AS registered_at,
  u.last_sign_in_at,
  (SELECT count(*) FROM public.usage_events WHERE user_id = p.id AND event_type = 'app_start')   AS sessions_count,
  (SELECT count(*) FROM public.usage_events WHERE user_id = p.id AND event_type = 'task_created') AS tasks_created_count,
  (SELECT app_version FROM public.usage_events WHERE user_id = p.id ORDER BY created_at DESC LIMIT 1) AS latest_app_version,
  (SELECT os          FROM public.usage_events WHERE user_id = p.id ORDER BY created_at DESC LIMIT 1) AS latest_os,
  p.public_user_id
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
ORDER BY p.created_at DESC;

-- security_invoker + закрытие для anon/authenticated закрепляем идемпотентно
-- (CREATE OR REPLACE VIEW сбрасывает reloptions, поэтому выставляем заново).
ALTER VIEW public.admin_users_summary SET (security_invoker = on);
REVOKE ALL ON public.admin_users_summary FROM anon, authenticated;

COMMENT ON VIEW public.admin_users_summary IS
  'Сводка пользователей для админа (все profiles + email + public_user_id + телеметрия). security_invoker=on, без GRANT для anon/authenticated. Доступ клиенту — только через RPC get_admin_users_summary() (0039). public_user_id добавлен в 0039 (P4).';

-- ─── 2. RPC get_admin_users_summary() — admin-гейт, полный список ────────────
--
-- SECURITY DEFINER + admin-гейт внутри тела (как get_users_emails / ADR 0002):
-- EXECUTE формально у authenticated (вызов из AdminPage под JWT админа), но тело
-- отклоняет любой не-admin вызов. База — profiles p (полный набор пользователей,
-- закрывает баг P4), LEFT JOIN auth.users (свежий email/last_sign_in_at) и
-- LEFT JOIN user_entitlements (entitlement-поля nullable для free-юзеров).

CREATE OR REPLACE FUNCTION public.get_admin_users_summary()
RETURNS TABLE(
  id                     uuid,
  public_user_id         text,
  email                  text,
  registered_at          timestamptz,
  last_sign_in_at        timestamptz,
  plan                   text,
  valid_until            timestamptz,
  auto_renew             boolean,
  cancel_at_period_end   boolean,
  source                 text,
  notes                  text,
  ent_updated_at         timestamptz,
  renewal_attempts_count integer,
  last_payment_at        timestamptz,
  sessions_count         bigint,
  tasks_created_count    bigint,
  latest_app_version     text,
  latest_os              text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $$
BEGIN
  -- 1) Требуем аутентификацию.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2) Единый admin-гейт: только source='seed' AND plan='lifetime'.
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;

  -- 3) Все пользователи из profiles (+ email/telemetry + entitlement если есть).
  RETURN QUERY
    SELECT
      p.id,
      p.public_user_id,
      COALESCE(u.email, p.email)::text AS email,
      p.created_at                     AS registered_at,
      u.last_sign_in_at,
      e.plan::text,
      e.valid_until,
      e.auto_renew,
      e.cancel_at_period_end,
      e.source::text,
      e.notes::text,
      e.updated_at                     AS ent_updated_at,
      e.renewal_attempts_count,
      e.last_payment_at,
      (SELECT count(*) FROM public.usage_events WHERE user_id = p.id AND event_type = 'app_start')   AS sessions_count,
      (SELECT count(*) FROM public.usage_events WHERE user_id = p.id AND event_type = 'task_created') AS tasks_created_count,
      (SELECT ue.app_version FROM public.usage_events ue WHERE ue.user_id = p.id ORDER BY ue.created_at DESC LIMIT 1) AS latest_app_version,
      (SELECT ue.os          FROM public.usage_events ue WHERE ue.user_id = p.id ORDER BY ue.created_at DESC LIMIT 1) AS latest_os
    FROM public.profiles p
    LEFT JOIN auth.users u          ON u.id = p.id
    LEFT JOIN public.user_entitlements e ON e.user_id = p.id
    ORDER BY p.created_at DESC
    LIMIT 500;
END;
$$;

-- Права закрепляем идемпотентно: только authenticated (клиент-админ);
-- anon/PUBLIC — нет. service_role доступ сохраняет (выполняет как владелец).
REVOKE ALL ON FUNCTION public.get_admin_users_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_users_summary() TO authenticated;

COMMENT ON FUNCTION public.get_admin_users_summary IS
  'Admin-only RPC (P4/F12): полный список пользователей из profiles (LEFT JOIN auth.users, user_entitlements) с email/public_user_id/телеметрией/entitlement. SECURITY DEFINER, гейт внутри — public.is_admin_user() (source=seed AND plan=lifetime). EXECUTE у authenticated (вызов из AdminPage под JWT админа). Закрывает баг: free-юзеры без entitlement были невидимы в админке.';

-- ============================================================================
-- ROLLBACK (не автоматический — применить вручную если нужно):
-- ПРИМЕЧАНИЕ: убрать колонку из view через CREATE OR REPLACE НЕЛЬЗЯ (42P16),
-- поэтому откат view — через DROP (зависимых объектов нет, проверено).
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.get_admin_users_summary();
--   DROP VIEW IF EXISTS public.admin_users_summary;
--   -- откат view к defу из 0001 (без public_user_id), security_invoker=on из 0020:
--   CREATE VIEW public.admin_users_summary AS
--   SELECT
--     p.id, p.email, p.created_at AS registered_at, u.last_sign_in_at,
--     (SELECT count(*) FROM public.usage_events WHERE user_id = p.id AND event_type = 'app_start')   AS sessions_count,
--     (SELECT count(*) FROM public.usage_events WHERE user_id = p.id AND event_type = 'task_created') AS tasks_created_count,
--     (SELECT app_version FROM public.usage_events WHERE user_id = p.id ORDER BY created_at DESC LIMIT 1) AS latest_app_version,
--     (SELECT os          FROM public.usage_events WHERE user_id = p.id ORDER BY created_at DESC LIMIT 1) AS latest_os
--   FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id
--   ORDER BY p.created_at DESC;
--   ALTER VIEW public.admin_users_summary SET (security_invoker = on);
--   REVOKE ALL ON public.admin_users_summary FROM anon, authenticated;
-- COMMIT;
-- ============================================================================
