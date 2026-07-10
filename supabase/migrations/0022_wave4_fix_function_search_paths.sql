-- ============================================================================
-- 0022_wave4_fix_function_search_paths.sql
--
-- Wave 4 PR-A — N18: фиксация search_path у public-функций.
--
-- Проблема (Supabase advisor 0011_function_search_path_mutable):
--   Функция без явного SET search_path резолвит неквалифицированные имена по
--   search_path вызывающего. Роль с CREATE в другой схеме (или pg_temp) может
--   подсунуть свой объект и перехватить выполнение — особенно опасно для
--   SECURITY DEFINER функций (path injection). Фиксация search_path закрывает
--   этот вектор; для SECURITY INVOKER — тоже хорошая практика.
--
-- Находка N18 указывает на public.tg_payment_methods_touch_updated_at()
-- (0014) — она вообще без search_path. Заодно приводим ВСЕ наши public-функции
-- к единому виду `public, pg_temp` (0005/0007/0017 задавали только `public`,
-- потеряв pg_temp относительно конвенции 0003). pg_temp в конце search_path
-- защищает от подмены объектов через временную схему.
--
-- get_users_emails СОХРАНЯЕТ схему auth (нужна для auth.users) — добавляем
-- только pg_temp в хвост.
--
-- Идемпотентно: ALTER FUNCTION ... SET search_path можно повторять.
-- ============================================================================

-- N18 — целевая функция находки: была вовсе без search_path.
ALTER FUNCTION public.tg_payment_methods_touch_updated_at() SET search_path = public, pg_temp;

-- Приведение остальных public-функций к `public, pg_temp` (единая конвенция).
ALTER FUNCTION public.set_updated_at()                     SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user()                    SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_bump_version()                  SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_bump_updated_at()               SET search_path = public, pg_temp;
ALTER FUNCTION public.set_user_entitlements_updated_at()   SET search_path = public, pg_temp;
ALTER FUNCTION public.is_admin_user()                      SET search_path = public, pg_temp;

-- get_users_emails: auth нужна для чтения auth.users — сохраняем, добавляем pg_temp.
ALTER FUNCTION public.get_users_emails(uuid[])             SET search_path = public, auth, pg_temp;
