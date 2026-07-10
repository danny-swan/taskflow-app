-- ============================================================================
-- 0022_pin_search_path_trigger_functions.sql
--
-- Wave 4 — N18: закрепить search_path у функций, где он не зафиксирован.
--
-- Проблема (advisor 0011_function_search_path_mutable):
--   Функция без явного `SET search_path` резолвит неквалифицированные имена по
--   search_path вызывающей сессии. Для SECURITY DEFINER / триггерных функций это
--   класс уязвимости: подставив свой объект в search_path, злоумышленник может
--   заставить функцию выполнить не тот код/таблицу, что задумано.
--
-- Аудит всех CREATE FUNCTION в public показал, что search_path зафиксирован
-- везде, КРОМЕ public.tg_payment_methods_touch_updated_at() (0014):
--     0005 public.set_updated_at()              → SET search_path = public          ✓
--     0017 public.is_admin_user()               → SET search_path = public          ✓
--     0017/0020 public.get_users_emails(uuid[]) → SET search_path = public, auth    ✓
--     0014 public.tg_payment_methods_touch_updated_at() → отсутствует               ✗
--
-- Чиним весь класс: пиним search_path на единственной незакреплённой функции.
-- `public, pg_temp` — минимальный безопасный набор для триггера в public
-- (pg_temp в конце — рекомендация PG, чтобы временные объекты не подменяли
-- реальные при резолве).
--
-- Идемпотентность: ALTER FUNCTION ... SET search_path безопасно повторять.
-- ============================================================================

ALTER FUNCTION public.tg_payment_methods_touch_updated_at()
  SET search_path = public, pg_temp;
