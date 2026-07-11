-- ============================================================================
-- 0018_pg_cron_renew.sql
--
-- v0.9.35-dev.6.9.x — Реальная установка pg_cron/pg_net + расписание
-- авто-продления на Supabase Pro.
--
-- Миграция 0015 была fallback-заглушкой (pg_cron был недоступен на free-плане
-- и брала настройки из app.settings.*, которые не задавались). После переезда
-- на Pro включаем расширения по-настоящему и создаём job, читающий URL и ключ
-- из Vault (vault.decrypted_secrets), а не из app.settings.
--
-- ВНИМАНИЕ: этот job использует Authorization: Bearer service_role_key. На
-- проекте с миграцией на новые API-ключи Supabase (publishable/secret) этот
-- заголовок отклоняется gateway'ем (UNAUTHORIZED_LEGACY_JWT). Поэтому сразу
-- следующая миграция 0019 переписывает тело job на новую auth-модель
-- (apikey + x-cron-secret). Файл 0018 оставлен как есть для истории и чтобы
-- порядок миграций совпадал с тем, что реально применено к проду.
--
-- CI-ЗАМЕЧАНИЕ (dev.6.10.2): на vanilla-Postgres (GitHub Actions) расширения
-- pg_cron/pg_net недоступны. Чтобы миграция проходила и там, весь cron-блок
-- обёрнут в тот же guard по pg_available_extensions, что и в 0015.
-- На реальном Supabase Pro расширения есть → логика job'а выполняется
-- как раньше (поведение не изменилось, это no-op для прода).
-- ============================================================================

DO $mig$
DECLARE
  has_pg_cron boolean;
  has_pg_net  boolean;
BEGIN
  SELECT exists(SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') INTO has_pg_cron;
  SELECT exists(SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net')  INTO has_pg_net;

  IF NOT has_pg_cron OR NOT has_pg_net THEN
    RAISE NOTICE '[migration 0018] pg_cron/pg_net NOT available — skipping cron schedule (CI/vanilla Postgres). Use external cron until Pro.';
    RETURN;
  END IF;

  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog';
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';

  EXECUTE 'GRANT USAGE ON SCHEMA cron TO postgres';
  EXECUTE 'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres';

  -- Идемпотентно снимаем предыдущее расписание (если было).
  BEGIN
    PERFORM cron.unschedule('taskflow-renew-subscriptions');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Создаём расписание заново.
  PERFORM cron.schedule(
    'taskflow-renew-subscriptions',
    '0 * * * *',
    $CRON$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
             || '/functions/v1/renew-subscription',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 25000
    );
    $CRON$
  );

  RAISE NOTICE '[migration 0018] pg_cron schedule created.';
END
$mig$;

-- ============================================================================
-- End of 0018_pg_cron_renew.sql
-- ============================================================================
