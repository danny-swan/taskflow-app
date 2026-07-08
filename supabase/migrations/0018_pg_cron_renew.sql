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
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

-- Идемпотентно снимаем предыдущее расписание (если было), затем создаём заново.
DO $$
BEGIN
  PERFORM cron.unschedule('taskflow-renew-subscriptions');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
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

-- ============================================================================
-- End of 0018_pg_cron_renew.sql
-- ============================================================================
