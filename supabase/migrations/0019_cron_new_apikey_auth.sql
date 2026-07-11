-- ============================================================================
-- 0019_cron_new_apikey_auth.sql
--
-- v0.9.35-dev.6.9.2 — Перевод cron-job авто-продления на новую auth-модель
-- Supabase (publishable/secret API keys).
--
-- ПОЧЕМУ:
--   Проект мигрировал на новые API-ключи. Legacy service_role JWT больше не
--   принимается gateway'ем — вызов renew-subscription из cron возвращал
--   401 UNAUTHORIZED_LEGACY_JWT. Новые secret-ключи (sb_secret_...) — НЕ JWT,
--   их нельзя слать в Authorization: Bearer (gateway пытается распарсить как
--   JWT и отклоняет).
--
-- КАК ПРАВИЛЬНО (по документации Supabase):
--   • Edge Function renew-subscription задеплоена с verify_jwt=false
--     (см. supabase/config.toml) — платформа не проверяет вызывающего.
--   • cron шлёт secret key в заголовке `apikey` (нужен gateway'у, чтобы
--     принять запрос к /functions/v1/*), а НЕ в Authorization.
--   • cron шлёт общий секрет в заголовке `x-cron-secret`; функция сама
--     сверяет его с Edge-secret CRON_SHARED_SECRET (constant-time). Так
--     открытый URL функции не может быть вызван посторонним.
--
-- ТРЕБОВАНИЯ (должны быть в Vault ДО применения этой миграции):
--   • secret_api_key    — новый Supabase secret key (sb_secret_...), тот же,
--                         что лежит в Edge-secret SUPABASE_SECRET_KEYS.default
--   • cron_shared_secret — та же случайная строка, что в Edge-secret
--                          CRON_SHARED_SECRET
--   • project_url       — https://<ref>.supabase.co (уже есть с 0018)
--
-- Старый секрет service_role_key в Vault больше этим job не используется
-- (оставляем его в Vault на случай отката, но из тела job убираем).
--
-- CI-ЗАМЕЧАНИЕ (dev.6.10.2): на vanilla-Postgres (GitHub Actions) расширения
-- pg_cron/pg_net недоступны. Чтобы миграция проходила и там, весь cron-блок
-- обёрнут в тот же guard по pg_available_extensions, что и в 0015/0018.
-- На реальном Supabase Pro расширения есть → расписание пересоздаётся с новой
-- auth-моделью как раньше (поведение не изменилось, это no-op для прода).
-- ============================================================================

-- Пересоздаём расписание с новой авторизацией. Идемпотентно: сначала снимаем
-- существующее задание, затем создаём заново.
DO $mig$
DECLARE
  has_pg_cron boolean;
  has_pg_net  boolean;
BEGIN
  SELECT exists(SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') INTO has_pg_cron;
  SELECT exists(SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net')  INTO has_pg_net;

  IF NOT has_pg_cron OR NOT has_pg_net THEN
    RAISE NOTICE '[migration 0019] pg_cron/pg_net NOT available — skipping cron reschedule (CI/vanilla Postgres).';
    RETURN;
  END IF;

  -- Идемпотентно снимаем предыдущее задание (если было).
  BEGIN
    PERFORM cron.unschedule('taskflow-renew-subscriptions');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Создаём расписание заново с новой auth-моделью (apikey + x-cron-secret).
  PERFORM cron.schedule(
    'taskflow-renew-subscriptions',
    '0 * * * *',
    $CRON$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
             || '/functions/v1/renew-subscription',
      headers := jsonb_build_object(
        'Content-Type',   'application/json',
        'apikey',         (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'secret_api_key' LIMIT 1),
        'x-cron-secret',  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 25000
    );
    $CRON$
  );

  RAISE NOTICE '[migration 0019] pg_cron schedule updated (new apikey auth).';
END
$mig$;

-- ============================================================================
-- Проверка после применения:
--   SELECT jobid, jobname, schedule, active, command FROM cron.job
--    WHERE jobname = 'taskflow-renew-subscriptions';
--   -- в command должны быть 'apikey' и 'x-cron-secret', НЕ 'Authorization'.
--
-- Ручной тест вызова (вернёт request_id; ответ смотреть в net._http_response):
--   SELECT net.http_post(
--     url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='project_url')
--            || '/functions/v1/renew-subscription',
--     headers := jsonb_build_object(
--       'Content-Type','application/json',
--       'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='secret_api_key'),
--       'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='cron_shared_secret')
--     ),
--     body := '{}'::jsonb
--   );
--   -- затем: SELECT status_code, content FROM net._http_response ORDER BY id DESC LIMIT 1;
--   -- ожидаем 200 (или JSON с processed:0), НЕ 401.
-- ============================================================================
-- End of 0019_cron_new_apikey_auth.sql
-- ============================================================================
