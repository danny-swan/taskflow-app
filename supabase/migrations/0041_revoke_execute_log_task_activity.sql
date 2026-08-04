-- TaskFlow v1.0.2 — миграция 0041
-- REVOKE EXECUTE с триггерной функции log_task_activity() у anon/authenticated (F35)
--
-- Проблема (доказана Security Advisor'ом прод-проекта sejpmzrmtgcvevukggkx,
-- снят 03.08.2026, см. docs/audit/roadmap.md §7.30):
--   Миграция 0034_task_activity_log.sql создала
--   `public.log_task_activity() ... SECURITY DEFINER`, но не добавила
--   REVOKE EXECUTE — в отличие от прецедента миграции 0013
--   (0013_revoke_execute_on_trigger_functions.sql) и требования
--   docs/migrations.md §«Trigger-функции». Advisor отдаёт два WARN:
--   anon_security_definer_function_executable и
--   authenticated_security_definer_function_executable — функция технически
--   вызываема через /rest/v1/rpc/log_task_activity.
--
--   log_task_activity() — BEFORE-триггер на public.sync_tasks
--   (trg_log_task_activity, AFTER INSERT OR UPDATE), чья единственная задача —
--   обходить RLS-политику `sync_task_activity_log_insert_denied ... with
--   check (false)` на append-only таблице sync_task_activity_log. Прямой
--   вызов через RPC постгрест всё равно отбивается Postgres'ом
--   («trigger functions can only be called as triggers», 0A000) до тела
--   функции — эксплуатируемость низкая, но лишний EXECUTE у anon на
--   прод-объекте — отклонение от контракта прав и постоянный шум в Advisor.
--
--   Проверено на реальных данных перед фиксом (не по гипотезе):
--     • supabase/migrations/0034_task_activity_log.sql — REVOKE отсутствует.
--     • Клиентский код (src/lib/migrations.ts, src/lib/sync/mappers.ts,
--       src/store/useTaskActivityStore.ts) — таблица строго pull-only,
--       мапер явно бросает ошибку при попытке push; нет ни одного
--       supabase.rpc('log_task_activity', ...) в кодовой базе.
--
-- Что делаем:
--   REVOKE EXECUTE ... FROM anon, authenticated, PUBLIC — тот же паттерн,
--   что и в 0013. Триггер продолжит работать: он выполняется от имени
--   владельца таблицы (postgres), а не от имени вызывающей роли, и не
--   проверяет GRANT EXECUTE (это уже доказано историей миграции 0013 —
--   те 4 функции работают без EXECUTE у anon/authenticated с 0013 и по сей
--   день, регрессия покрыта тестом 03_functions_test.sql).
--
-- Идемпотентность: REVOKE безопасно повторять.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.log_task_activity() FROM anon, authenticated, PUBLIC;

-- service_role оставляем не тронутым явным GRANT — REVOKE FROM PUBLIC
-- отзывает и наследуемый через PUBLIC доступ у service_role тоже, ровно как
-- для 4 функций из 0013 (см. комментарий в 03_functions_test.sql); это
-- ожидаемо и не мешает триггеру.

COMMIT;

-- Проверка после миграции (Dashboard SQL Editor):
--   SELECT has_function_privilege('anon', 'public.log_task_activity()', 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', 'public.log_task_activity()', 'EXECUTE') AS auth_exec,
--          has_function_privilege('postgres', 'public.log_task_activity()', 'EXECUTE') AS owner_exec;
--   Ожидается: anon_exec = false, auth_exec = false, owner_exec = true.
--   Плюс Security Advisor (Database → Advisors → Security): WARN'ы
--   anon_security_definer_function_executable /
--   authenticated_security_definer_function_executable для log_task_activity
--   должны исчезнуть.
--   Дымовой тест триггера: INSERT/UPDATE в sync_tasks от authenticated
--   должен по-прежнему создавать строку в sync_task_activity_log
--   (покрыто supabase/tests/17_task_activity_log_test.sql).

-- ROLLBACK (не автоматический — применить вручную если нужно):
-- BEGIN;
--   GRANT EXECUTE ON FUNCTION public.log_task_activity() TO anon, authenticated;
-- COMMIT;
