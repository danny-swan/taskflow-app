-- ============================================================================
-- 0020_wave2_security_hardening.sql
--
-- Wave 2 — security-хардненинг (см. docs/audit/roadmap.md, раздел 5):
--   N4  — public.admin_users_summary без security_invoker
--   N5  — public.sync_status_summary без security_invoker
--   N12 — RLS-политика profiles_update_own без WITH CHECK
--   N15 — RPC public.get_users_emails(uuid[]) доступен любому authenticated
--
-- Все изменения идемпотентны (ALTER ... SET / REVOKE / DROP+CREATE POLICY /
-- CREATE OR REPLACE FUNCTION) — миграцию можно применять повторно.
-- Схема таблиц НЕ меняется: правим только опции view, RLS-политику, права и
-- тело RPC.
-- ============================================================================

-- ─── N4 + N5. Views: security_invoker + закрытие для anon/authenticated ──────
--
-- Проблема: обе view созданы без security_invoker (reloptions IS NULL), то есть
-- выполняются с правами ВЛАДЕЛЬЦА (postgres/суперюзер) и обходят RLS базовых
-- таблиц. Прямой утечки сейчас нет (SELECT для anon/authenticated не выдан), но
-- закрепляем оба уровня защиты:
--   1) security_invoker=on — при чтении применяется RLS вызывающего, а не владельца;
--   2) REVOKE ALL — явно и идемпотентно убираем любые права anon/authenticated
--      (сейчас у них остаются TRUNCATE/REFERENCES/TRIGGER — не нужны).
-- Тело/логику view НЕ трогаем.

ALTER VIEW public.admin_users_summary SET (security_invoker = on);
REVOKE ALL ON public.admin_users_summary FROM anon, authenticated;

ALTER VIEW public.sync_status_summary SET (security_invoker = on);
REVOKE ALL ON public.sync_status_summary FROM anon, authenticated;

-- ─── N12. profiles UPDATE-политика: добавляем WITH CHECK ─────────────────────
--
-- Политика profiles_update_own (создана в 0001, пересоздана в 0004) имела только
-- USING без WITH CHECK. USING проверяет строку ДО изменения, но не результат —
-- значит пользователь мог в UPDATE выставить id на чужой uuid. Добавляем
-- WITH CHECK (auth.uid() = id), чтобы новая версия строки тоже принадлежала
-- вызывающему. Пересоздаём политику (DROP+CREATE) — идемпотентно; USING
-- сохраняем как в 0004, через (select auth.uid()) для кэширования initplan.
-- Политику profiles_select_own НЕ трогаем.

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

-- ─── N15. RPC get_users_emails: admin-гейт внутри функции ─────────────────────
--
-- Функция SECURITY DEFINER с EXECUTE для роли authenticated. Единственный вызов
-- в коде — src/pages/AdminPage.tsx:189 (клиент под authenticated JWT админа,
-- НЕ service_role), поэтому глобальный REVOKE FROM authenticated сломал бы
-- админ-панель. Выбран вариант «внутренняя проверка прав» (см. ADR 0002):
--   • EXECUTE для authenticated СОХРАНЯЕМ (нужен клиенту-админу);
--   • гейт внутри функции — единый источник истины public.is_admin_user()
--     (source='seed' AND plan='lifetime'), а не инлайн-копия admin-логики
--     (устраняем дублирование admin-определения, см. roadmap раздел 3, п.6).
-- Любой не-admin authenticated получает EXCEPTION 'Forbidden: admin only' →
-- утечка чужих email невозможна.
-- search_path (public, auth) СОХРАНЯЕМ без изменений (нужен для auth.users).

CREATE OR REPLACE FUNCTION public.get_users_emails(user_ids uuid[])
RETURNS TABLE(id uuid, email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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

  -- 3) Возвращаем email-ы из auth.users.
  RETURN QUERY
    SELECT u.id, u.email::text
      FROM auth.users u
     WHERE u.id = ANY(user_ids);
END;
$$;

-- Права закрепляем идемпотентно: только authenticated (клиент-админ);
-- anon/PUBLIC — нет. service_role доступ сохраняет (выполняет как владелец/BYPASS).
REVOKE ALL ON FUNCTION public.get_users_emails(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_users_emails(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.get_users_emails IS
  'Admin-only RPC (N15): {id,email} по user_ids. SECURITY DEFINER. Гейт внутри — public.is_admin_user() (source=seed AND plan=lifetime). EXECUTE для authenticated сохранён (вызов из AdminPage под JWT админа).';
