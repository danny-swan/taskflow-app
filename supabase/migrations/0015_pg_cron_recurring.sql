-- ============================================================================
-- 0015_pg_cron_recurring.sql
--
-- v0.9.35-dev.6.5.1 — pg_cron schedule for auto-renewal.
--
-- Установка расписания, которое каждый час дёргает Edge Function
-- renew-subscription. Функция сама фильтрует user_entitlements по
-- next_renewal_at <= now() и обрабатывает только «созревших» кандидатов
-- (не более 100 за раз). ATTEMPT_WINDOW_HOURS в функции гарантирует что
-- одного и того же юзера мы не попробуем чаще чем раз в 20ч, поэтому
-- 3 попытки суммарно занимают ≈ 60ч grace.
--
-- Расписание:
--   • CRON `0 * * * *` — каждый час в 0 минут (UTC).
--
-- Почему pg_cron + pg_net, а не Supabase-scheduled functions:
--   pg_cron даёт кастомный retry-контроль (одна попытка в час, deduplication
--   по last_renewal_attempt_at), а не «наивный» hourly-invoke без state.
--
-- Требования:
--   1. Расширение pg_cron (устанавливается в schema `cron`, только Supabase Pro).
--   2. Расширение pg_net (для net.http_post из cron-job).
--   3. Vault-секреты:
--        cron.supabase_url             — URL проекта (напр. https://<ref>.supabase.co)
--        cron.supabase_service_role    — service_role key для авторизации
--        cron.renew_subscriptions_bearer — Bearer-токен для функции (может совпадать с service_role)
--
-- ЗАМЕЧАНИЕ (dev.6.5.1): pg_cron доступен только на Supabase Pro. На free-плане
-- этот файл ПРОВАЛИТСЯ с "extension not available". В таком случае вызов
-- renew-subscription делаем внешним cron'ом (см. release notes §Deployment).
-- Держим миграцию как no-op fallback: оборачиваем в DO-блок с обработкой
-- ошибок, чтобы миграция прошла даже без pg_cron. Реальную планировку
-- делаем интерактивно ПОСЛЕ переезда на Pro.
-- ============================================================================

-- 1) Пытаемся включить расширения. Если pg_cron/pg_net недоступны — миграция
--    успешно завершается без ошибки (fallback на внешний cron).
do $mig$
declare
  has_pg_cron boolean;
  has_pg_net  boolean;
begin
  -- Проверяем доступность расширений в текущем инстансе
  select exists(select 1 from pg_available_extensions where name = 'pg_cron') into has_pg_cron;
  select exists(select 1 from pg_available_extensions where name = 'pg_net')  into has_pg_net;

  if not has_pg_cron then
    raise notice '[migration 0015] pg_cron extension NOT available on this instance — skipping schedule creation. Use external cron until Pro plan.';
    return;
  end if;
  if not has_pg_net then
    raise notice '[migration 0015] pg_net extension NOT available on this instance — skipping schedule creation.';
    return;
  end if;

  -- 2) Устанавливаем расширения (idempotent: create extension if not exists)
  execute 'create extension if not exists pg_cron with schema cron';
  execute 'create extension if not exists pg_net with schema extensions';

  raise notice '[migration 0015] pg_cron + pg_net available — proceeding with schedule.';
end
$mig$;

-- 3) Отдельный SQL-блок для создания расписания. Работает только если
--    расширения установлены (проверяем ещё раз, чтобы не упасть при
--    отсутствии cron.schedule).
do $sched$
declare
  cron_installed boolean;
  existing_jobid bigint;
begin
  select exists(
    select 1 from pg_extension where extname = 'pg_cron'
  ) into cron_installed;

  if not cron_installed then
    raise notice '[migration 0015] pg_cron not installed — skipping schedule.';
    return;
  end if;

  -- Удаляем предыдущее расписание (если уже было) — идемпотентно
  select jobid from cron.job where jobname = 'taskflow-renew-subscriptions' into existing_jobid;
  if existing_jobid is not null then
    perform cron.unschedule(existing_jobid);
    raise notice '[migration 0015] removed previous schedule jobid=%', existing_jobid;
  end if;

  -- Создаём расписание: каждый час в 0 минут.
  --
  -- Тело задания — HTTP POST на Edge Function renew-subscription. URL и
  -- авторизация берутся из vault (по умолчанию задаются `alter database
  -- set` вручную; в этом файле их не хардкодим).
  --
  -- Если vault-настройки не заданы, cron просто вернёт ошибку в
  -- cron.job_run_details — это лучше чем падение миграции.
  perform cron.schedule(
    'taskflow-renew-subscriptions',
    '0 * * * *',                 -- каждый час в 0 минут UTC
    $job$
    select net.http_post(
      url := coalesce(current_setting('app.settings.supabase_url', true), '')
             || '/functions/v1/renew-subscription',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || coalesce(current_setting('app.settings.service_role_key', true), '')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
    $job$
  );

  raise notice '[migration 0015] scheduled taskflow-renew-subscriptions cron (hourly UTC).';
end
$sched$;

-- 4) Документация: как настроить vault-секреты вручную (комментарий, не
--    выполняется). Секреты хранятся на уровне БД через
--    `alter database … set` (Supabase Pro поддерживает это через дашборд).
--
--    ALTER DATABASE postgres SET app.settings.supabase_url = 'https://sejpmzrmtgcvevukggkx.supabase.co';
--    ALTER DATABASE postgres SET app.settings.service_role_key = 'sb_secret_...';
--
--    После этого нужен reconnect (или один pg_reload_conf), чтобы cron
--    увидел новые значения current_setting(...).

-- 5) Пример проверки статуса cron-job после деплоя:
--    select * from cron.job where jobname = 'taskflow-renew-subscriptions';
--    select * from cron.job_run_details
--     where jobname = 'taskflow-renew-subscriptions'
--     order by start_time desc limit 10;

-- ============================================================================
-- End of 0015_pg_cron_recurring.sql
-- ============================================================================
