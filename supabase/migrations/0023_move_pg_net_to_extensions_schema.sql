-- ============================================================================
-- 0023_move_pg_net_to_extensions_schema.sql
--
-- Wave 4 — N17: убрать extension pg_net из схемы `public`.
--
-- Проблема (advisor 0014_extension_in_public):
--   Extension pg_net зарегистрирован в схеме `public` (миграция 0018 применила
--   `CREATE EXTENSION IF NOT EXISTS pg_net` без `WITH SCHEMA`). Держать
--   расширения в public — footgun: их объекты попадают в общий неймспейс,
--   который доступен ролям по умолчанию.
--
-- Что делаем:
--   Переносим pg_net в служебную схему `extensions` (стандартная рекомендация
--   Supabase): `ALTER EXTENSION pg_net SET SCHEMA extensions`.
--
-- ⚠️ РИСК (озвучен явно): автопродление подписок использует pg_net из cron-job
--   `taskflow-renew-subscriptions` (0018/0019) — тело job зовёт `net.http_post`.
--   API-функции pg_net живут в схеме `net` (не в extnamespace расширения),
--   поэтому SET SCHEMA обычно НЕ двигает `net.http_post` и cron продолжает
--   работать. Но чтобы не зависеть от внутреннего устройства pg_net на
--   конкретной версии, мы ПОСЛЕ переноса динамически находим фактическую схему
--   функции `http_post` расширения и ПЕРЕСОЗДАЁМ cron-job со схемо-
--   квалифицированным вызовом. Если функция осталась в `net` — пересозданный
--   job идентичен прежнему (поведение не меняется). Если переехала — job
--   чинится автоматически. Так дубль/пропуск списания исключён при любом
--   раскладе.
--
-- CI-ЗАМЕЧАНИЕ: на vanilla-Postgres (GitHub Actions) pg_net/pg_cron нет — весь
--   блок пропускается через guard по pg_extension (как в 0015/0018/0019).
--   Проверять реальный перенос нужно на Supabase Pro (см. PR-описание).
--
-- Идемпотентность: повторный запуск не двигает расширение, если оно уже в
--   `extensions`, и пересоздаёт cron-job идемпотентно (unschedule → schedule).
-- ============================================================================

DO $mig$
DECLARE
  has_pg_net   boolean;
  has_pg_cron  boolean;
  ext_schema   text;
  fn_schema    text;
  cmd          text;
BEGIN
  SELECT exists(SELECT 1 FROM pg_extension WHERE extname = 'pg_net')  INTO has_pg_net;
  SELECT exists(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO has_pg_cron;

  IF NOT has_pg_net THEN
    RAISE NOTICE '[migration 0023] pg_net NOT installed — skipping (CI/vanilla Postgres).';
    RETURN;
  END IF;

  -- Служебная схема для расширений (Supabase создаёт её по умолчанию; на всякий
  -- случай гарантируем наличие).
  EXECUTE 'CREATE SCHEMA IF NOT EXISTS extensions';

  -- Текущая схема регистрации расширения.
  SELECT n.nspname
    INTO ext_schema
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'pg_net';

  IF ext_schema = 'public' THEN
    EXECUTE 'ALTER EXTENSION pg_net SET SCHEMA extensions';
    RAISE NOTICE '[migration 0023] pg_net moved from public -> extensions.';
  ELSE
    RAISE NOTICE '[migration 0023] pg_net already in schema % — no move needed.', ext_schema;
  END IF;

  -- Если pg_cron нет — cron-job не существует, чинить нечего.
  IF NOT has_pg_cron THEN
    RAISE NOTICE '[migration 0023] pg_cron NOT installed — skipping cron-job rebuild.';
    RETURN;
  END IF;

  -- Находим фактическую схему функции http_post, принадлежащей pg_net.
  SELECT n.nspname
    INTO fn_schema
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
    JOIN pg_extension e ON e.oid = d.refobjid AND e.extname = 'pg_net'
   WHERE p.proname = 'http_post'
   LIMIT 1;

  IF fn_schema IS NULL THEN
    RAISE NOTICE '[migration 0023] http_post() of pg_net not found — leaving existing cron-job untouched.';
    RETURN;
  END IF;

  -- Пересоздаём тело cron-job со схемо-квалифицированным вызовом %I.http_post.
  -- Auth-модель та же, что в 0019 (apikey + x-cron-secret из Vault).
  cmd := format(
    $CRON$
    SELECT %I.http_post(
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
    $CRON$, fn_schema);

  -- Идемпотентно снимаем прежнее задание (если было).
  BEGIN
    PERFORM cron.unschedule('taskflow-renew-subscriptions');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule('taskflow-renew-subscriptions', '0 * * * *', cmd);

  RAISE NOTICE '[migration 0023] cron-job rebuilt with %.http_post (schema-qualified).', fn_schema;
END
$mig$;

-- ============================================================================
-- Проверка после применения (на Supabase Pro):
--   -- расширение больше не в public:
--   SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
--    WHERE e.extname='pg_net';                       -- ожидаем 'extensions'
--   -- cron-job на месте и активен:
--   SELECT jobname, schedule, active, command FROM cron.job
--    WHERE jobname='taskflow-renew-subscriptions';    -- command содержит http_post
--   -- ручной прогон (вернёт request_id; ответ в net._http_response):
--   -- см. 0019 (тот же вызов, схема функции — из cron.command).
-- ============================================================================
-- End of 0023_move_pg_net_to_extensions_schema.sql
-- ============================================================================
