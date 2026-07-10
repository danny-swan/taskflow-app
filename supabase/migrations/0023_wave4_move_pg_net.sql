-- ============================================================================
-- 0023_wave4_move_pg_net.sql
--
-- Wave 4 PR-A — N17: расширение pg_net не должно жить в схеме public.
--
-- Проблема: если pg_net зарегистрирован в public (extnamespace = public), его
-- объекты попадают в общий public namespace, который доступен на USAGE всем
-- ролям. Хорошая практика Supabase — держать расширения в отдельной схеме
-- `extensions`. Миграция 0015 уже пыталась поставить pg_net `with schema
-- extensions`, но `CREATE EXTENSION IF NOT EXISTS` не переносит уже
-- установленное расширение — если Supabase предустановил pg_net в public
-- раньше, оно там и осталось. Эта миграция чинит состояние идемпотентно.
--
-- ВАЖНО: pg_net публикует свой API в отдельной схеме `net` (net.http_post и
-- т.п.) — её мы НЕ трогаем, cron-джобы продолжают звать `net.http_post(...)`.
-- Правим только регистрацию самого расширения (extnamespace).
--
-- Безопасно для CI/vanilla Postgres: если pg_net не установлен (а в CI его нет,
-- см. 00_auth_shim.sql), весь блок — no-op с NOTICE. Перенос обёрнут в
-- под-BEGIN/EXCEPTION на случай, если версия pg_net не relocatable.
-- ============================================================================

DO $$
DECLARE
  ext_schema text;
BEGIN
  SELECT n.nspname
    INTO ext_schema
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'pg_net';

  IF ext_schema IS NULL THEN
    RAISE NOTICE '[0023] pg_net not installed — skipping (CI/vanilla Postgres).';
    RETURN;
  END IF;

  -- Целевая схема для расширений.
  CREATE SCHEMA IF NOT EXISTS extensions;
  GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;

  IF ext_schema = 'extensions' THEN
    RAISE NOTICE '[0023] pg_net already registered in extensions — no-op.';
  ELSE
    BEGIN
      ALTER EXTENSION pg_net SET SCHEMA extensions;
      RAISE NOTICE '[0023] pg_net relocated from % to extensions.', ext_schema;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '[0023] Could not relocate pg_net (%). Needs manual review.', SQLERRM;
    END;
  END IF;

  -- pg_net держит вызываемый API в схеме net — сохраняем USAGE для вызывающих
  -- (cron-джобы под postgres/service_role дёргают net.http_post).
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'net') THEN
    GRANT USAGE ON SCHEMA net TO postgres, service_role;
  END IF;
END$$;
