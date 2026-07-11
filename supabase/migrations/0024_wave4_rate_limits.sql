-- ============================================================================
-- 0024_wave4_rate_limits.sql
--
-- Wave 4 PR-B — N13: rate limiting на публичных edge-эндпоинтах.
--
-- ПОЧЕМУ table-based (а не in-memory / Redis):
--   Edge-функции Deno stateless и живут в нескольких инстансах — счётчик в
--   памяти процесса не разделяется между ними и обнуляется при холодном старте.
--   Redis/Upstash — отдельная инфраструктура, которой в проекте нет. Общий
--   счётчик в Postgres — единый источник истины, доступный всем инстансам, с
--   атомарным инкрементом через INSERT ... ON CONFLICT (см. ADR 0004).
--
-- МОДЕЛЬ ДОСТУПА:
--   Таблица чисто серверная. Edge-функции ходят под service_role key и вызывают
--   ТОЛЬКО RPC public.check_rate_limit (SECURITY DEFINER) — прямого доступа к
--   таблице им не нужно. anon/authenticated не должны иметь доступа вообще.
--   RLS включён без политик (deny-by-default), плюс явный REVOKE для anon/auth.
--
-- CI/vanilla Postgres: таблица и функция создаются везде. Cron-cleanup обёрнут
-- в двухшаговый guard (как 0015): pg_available_extensions → CREATE EXTENSION IF
-- NOT EXISTS → перепроверка pg_extension перед обращением к cron.*. На vanilla
-- PG без pg_cron блок — no-op с NOTICE, миграция проходит в db-tests.yml.
-- ============================================================================

-- ─── 1. Таблица счётчиков ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key          text        PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count        integer     NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL
);

-- Индекс под cleanup (DELETE ... WHERE expires_at < now()).
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at
  ON public.rate_limits (expires_at);

-- ─── 2. RLS + привилегии ─────────────────────────────────────────────────────
-- RLS без политик = deny-by-default для anon/authenticated (service_role
-- обходит RLS через BYPASSRLS). Плюс явный REVOKE — защита от возможной
-- default-выдачи и самодокументирование намерения «таблица не для клиентов».
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rate_limits FROM anon, authenticated;

-- Явно выдаём CRUD service_role (миграция 0021 откатила default-выдачу на
-- будущие таблицы, поэтому без явного GRANT service_role прав бы не получил;
-- сам RPC работает и без этого — он SECURITY DEFINER — но грант делает
-- прямой доступ под service_role предсказуемым и совпадает с моделью «доступ
-- только service_role»).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limits TO service_role;

-- ─── 3. Атомарный инкремент ──────────────────────────────────────────────────
-- Единственная точка входа для edge-функций. Один UPSERT под блокировкой строки
-- (ON CONFLICT берёт row lock) делает всю логику окна атомарно:
--   • нет строки            → создаём окно, count=1;
--   • окно истекло          → сбрасываем: count=1, новое window_start/expires_at;
--   • окно активно          → count+1, окно не двигаем (fixed window).
-- Возвращает allowed + retry_after (секунды до конца окна, если превышено).
--
-- N18: SECURITY DEFINER + SET search_path = public, pg_temp — фиксируем
-- search_path, чтобы функция не резолвила объекты из чужих схем.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key text, p_max_requests integer, p_window_seconds integer
) RETURNS TABLE(allowed boolean, retry_after integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_now timestamptz := now();
  v_count integer;
  v_expires_at timestamptz;
BEGIN
  INSERT INTO public.rate_limits (key, window_start, count, expires_at)
  VALUES (p_key, v_now, 1, v_now + make_interval(secs => p_window_seconds))
  ON CONFLICT (key) DO UPDATE
    SET count = CASE WHEN public.rate_limits.expires_at < v_now THEN 1 ELSE public.rate_limits.count + 1 END,
        window_start = CASE WHEN public.rate_limits.expires_at < v_now THEN v_now ELSE public.rate_limits.window_start END,
        expires_at = CASE WHEN public.rate_limits.expires_at < v_now THEN v_now + make_interval(secs => p_window_seconds) ELSE public.rate_limits.expires_at END
    RETURNING count, expires_at INTO v_count, v_expires_at;

  IF v_count > p_max_requests THEN
    RETURN QUERY SELECT false, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_expires_at - v_now)))::integer);
  ELSE
    RETURN QUERY SELECT true, 0;
  END IF;
END$$;

-- EXECUTE только у service_role — anon/authenticated не должны дёргать лимитер.
REVOKE ALL ON FUNCTION public.check_rate_limit(text,integer,integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text,integer,integer) TO service_role;

-- ─── 4. Cleanup через pg_cron ────────────────────────────────────────────────
-- Каждые 5 минут удаляем истёкшие строки, чтобы таблица не пухла. Идемпотентно:
-- сначала снимаем job с этим именем (если есть), затем создаём заново. Не трогаем
-- существующие cron-джобы (taskflow-renew-subscriptions и т.п.).
-- Guard в два шага, как в 0015: (1) available (есть на диске) ≠ installed;
-- (2) фактическая установка через pg_extension ПЕРЕД обращением к cron.*.
-- Иначе на инстансе, где pg_cron доступен, но CREATE EXTENSION ещё не
-- выполнялся (нет схемы `cron`), голый cron.schedule упал бы
-- «schema "cron" does not exist» и уронил миграцию.
DO $mig$
DECLARE
  has_pg_cron boolean;
  cron_installed boolean;
BEGIN
  SELECT exists(SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') INTO has_pg_cron;

  IF NOT has_pg_cron THEN
    RAISE NOTICE '[migration 0024] pg_cron NOT available — skipping rate-limits cleanup schedule (CI/vanilla Postgres).';
    RETURN;
  END IF;

  -- Идемпотентная установка (в норме уже сделана миграцией 0015; дубль-страховка
  -- на случай, если 0015 вышла раньше своего CREATE EXTENSION — напр. pg_net был
  -- недоступен и 0015 вернулась до установки pg_cron).
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA cron';

  SELECT exists(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO cron_installed;
  IF NOT cron_installed THEN
    RAISE NOTICE '[migration 0024] pg_cron available but not installed — skipping rate-limits cleanup schedule.';
    RETURN;
  END IF;

  -- Снимаем прежний job с этим именем (если был) — идемпотентно, без дублей.
  BEGIN
    PERFORM cron.unschedule('rate-limits-cleanup');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'rate-limits-cleanup',
    '*/5 * * * *',
    $$DELETE FROM public.rate_limits WHERE expires_at < now()$$
  );

  RAISE NOTICE '[migration 0024] pg_cron schedule rate-limits-cleanup created (*/5 * * * *).';
END
$mig$;

-- ============================================================================
-- Проверка после применения (main-агент, на проде):
--   SELECT * FROM public.check_rate_limit('probe', 2, 60);  -- allowed=t
--   SELECT * FROM public.check_rate_limit('probe', 2, 60);  -- allowed=t
--   SELECT * FROM public.check_rate_limit('probe', 2, 60);  -- allowed=f, retry_after>0
--   DELETE FROM public.rate_limits WHERE key='probe';
--   SELECT jobname, schedule FROM cron.job WHERE jobname='rate-limits-cleanup';
-- ============================================================================
-- End of 0024_wave4_rate_limits.sql
-- ============================================================================
