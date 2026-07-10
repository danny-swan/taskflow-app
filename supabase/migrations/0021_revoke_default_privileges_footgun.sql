-- ============================================================================
-- 0021_revoke_default_privileges_footgun.sql
--
-- Wave 3 — N6: убрать общий ALTER DEFAULT PRIVILEGES (footgun авто-выдачи прав).
--
-- Проблема:
--   Миграции 0010 и 0011 добавили ALTER DEFAULT PRIVILEGES IN SCHEMA public,
--   которые АВТОМАТИЧЕСКИ выдают права на ЛЮБУЮ будущую таблицу в public:
--     0010 → service_role: SELECT, INSERT, UPDATE, DELETE
--     0011 → authenticated: SELECT
--   Это тот же класс footgun, что уже вызвал GRANT-инциденты (0010/0011/0012):
--   новая таблица молча получает широкие права до того, как кто-либо настроит
--   RLS/GRANT осознанно → риск незаметной утечки данных.
--
-- Что делаем:
--   Откатываем ТОЛЬКО default privileges (авто-выдачу на будущие таблицы).
--   Явные GRANT'ы на СУЩЕСТВУЮЩИЕ таблицы (0010/0011/0012/0014) НЕ трогаем —
--   ALTER DEFAULT PRIVILEGES ... REVOKE влияет исключительно на объекты,
--   создаваемые ПОСЛЕ этой миграции, и не отзывает уже выданные права.
--   Роль-владелец default-привилегий та же, что запускает миграции (postgres),
--   поэтому REVOKE без FOR ROLE парно снимает то, что выдали 0010/0011.
--
-- Идемпотентность: ALTER DEFAULT PRIVILEGES ... REVOKE безопасно повторять —
-- повторный REVOKE отсутствующей default-привилегии не ошибка.
--
-- После этой миграции каждая новая таблица требует ЯВНОГО GRANT в своей
-- миграции (это и есть желаемое поведение — осознанная выдача прав).
-- ============================================================================

-- ─── Откат default-привилегий из 0010 (service_role на будущие таблицы) ──────
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM service_role;

-- ─── Откат default-привилегий из 0011 (authenticated SELECT на будущие) ──────
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE SELECT ON TABLES FROM authenticated;
