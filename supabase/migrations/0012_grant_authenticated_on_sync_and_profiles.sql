-- TaskFlow v0.9.35-dev.6.4.4 — миграция 0012
-- GRANT'ы для authenticated и service_role на sync_* и profiles
--
-- Проблема:
--   Миграции 0001_init и 0002_sync_schema создали таблицы + RLS policies,
--   но НЕ выдали table-level GRANT'ы роли `authenticated`.
--   PostgREST проверяет GRANT ДО применения RLS — без GRANT запрос отклоняется
--   с ошибкой `42501: permission denied for table ...` даже если RLS policy
--   разрешает доступ.
--
-- Что чиним:
--   - profiles                 — SELECT/UPDATE для authenticated (собственный профиль)
--   - sync_tasks               — SELECT/INSERT/UPDATE/DELETE для authenticated (own rows via RLS)
--   - sync_settings            — то же
--   - sync_statuses            — то же
--   - sync_tags                — то же
--   - sync_task_templates      — то же
--   - sync_devices             — то же
--   - sync_overdue_events      — SELECT/INSERT/DELETE для authenticated
--                                (обычно только INSERT из клиента + realtime SELECT,
--                                 но UPDATE не запрещаем — RLS всё равно ограничит own row)
--                                → на всякий случай даём полный набор, RLS страхует.
--   - service_role — полный доступ (ALL) на все sync_* и profiles (RLS bypass у него по определению,
--                    но explicit GRANT нужен для PostgREST/pgrst)
--
-- Проверка после миграции:
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims TO '{"sub":"<uuid>","role":"authenticated"}';
--   SELECT * FROM public.sync_tasks LIMIT 1;   -- должно вернуть 0 rows без ошибки
--   SELECT * FROM public.profiles WHERE user_id = auth.uid();  -- 1 row (own profile)
--   ROLLBACK;
--
-- Идемпотентность: GRANT ... ON TABLE безопасно повторять. REVOKE не делаем —
-- если кто-то раньше выдал больше прав в Dashboard, эта миграция их не сузит.

BEGIN;

-- ============================================================================
-- profiles
-- ============================================================================
GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL           ON TABLE public.profiles TO service_role;

-- ============================================================================
-- sync_* (все таблицы синхронизации)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_tasks           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_settings        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_statuses        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_tags            TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_task_templates  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_devices         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_overdue_events  TO authenticated;

GRANT ALL ON TABLE public.sync_tasks           TO service_role;
GRANT ALL ON TABLE public.sync_settings        TO service_role;
GRANT ALL ON TABLE public.sync_statuses        TO service_role;
GRANT ALL ON TABLE public.sync_tags            TO service_role;
GRANT ALL ON TABLE public.sync_task_templates  TO service_role;
GRANT ALL ON TABLE public.sync_devices         TO service_role;
GRANT ALL ON TABLE public.sync_overdue_events  TO service_role;

-- ============================================================================
-- Sequences (если есть auto-increment id) — на всякий случай USAGE
-- ============================================================================
-- В нашей схеме id-ы это uuid (gen_random_uuid()), sequence'ов нет.
-- Оставляем закомментировано на будущее:
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

COMMIT;
