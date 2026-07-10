-- ============================================================================
-- 0024_rate_limits.sql
--
-- Wave 4 — N13: rate limiting на публичных/платёжных эндпоинтах.
--
-- Храним счётчики в таблице public.rate_limits (фиксированное окно на ключ).
-- Инкремент делает SECURITY DEFINER функция public.rate_limit_hit() одним
-- атомарным `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, чтобы параллельные
-- запросы не гонялись за счётчиком. Edge-функции зовут её через RPC под
-- service_role (см. _shared/rate-limit.ts). См. ADR 0004.
--
-- Почему таблица, а не in-memory / Redis: edge-функции ЮKassa stateless и
-- масштабируются горизонтально — общий счётчик нужен в общем хранилище, а
-- Postgres у нас уже есть. Нагрузка тривиальная (один upsert на запрос).
--
-- Очистка протухших строк — pg_cron каждые 5 минут (guard по доступности
-- расширения, как в 0015/0018/0019 — на vanilla-Postgres в CI пропускается).
-- ============================================================================

-- ─── Таблица счётчиков ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key          text        PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count        integer     NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL
);

-- Индекс под запрос очистки (DELETE ... WHERE expires_at < now()).
CREATE INDEX IF NOT EXISTS idx_rate_limits_expires_at
  ON public.rate_limits (expires_at);

-- Запираем таблицу: доступ только через SECURITY DEFINER функцию (owner=postgres)
-- и service_role (BYPASSRLS). Прямого доступа anon/authenticated нет.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rate_limits FROM PUBLIC;

COMMENT ON TABLE public.rate_limits IS
  'N13 rate limiting: фиксированное окно на ключ (${fn}:user:${id} / ${fn}:ip:${ip}). Пишется только через public.rate_limit_hit().';

-- ─── Атомарный инкремент счётчика ────────────────────────────────────────────
-- Возвращает (allowed, retry_after_seconds). allowed=false когда после
-- инкремента count в текущем окне превысил p_max.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  p_key            text,
  p_max            integer,
  p_window_seconds integer
)
RETURNS TABLE (allowed boolean, retry_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count   integer;
  v_expires timestamptz;
BEGIN
  IF p_key IS NULL OR p_max IS NULL OR p_window_seconds IS NULL THEN
    RAISE EXCEPTION 'rate_limit_hit: arguments must not be null';
  END IF;

  INSERT INTO public.rate_limits AS rl (key, window_start, count, expires_at)
  VALUES (p_key, now(), 1, now() + make_interval(secs => p_window_seconds))
  ON CONFLICT (key) DO UPDATE
    SET count = CASE WHEN rl.expires_at <= now() THEN 1 ELSE rl.count + 1 END,
        window_start = CASE WHEN rl.expires_at <= now() THEN now() ELSE rl.window_start END,
        expires_at = CASE
                       WHEN rl.expires_at <= now()
                       THEN now() + make_interval(secs => p_window_seconds)
                       ELSE rl.expires_at
                     END
  RETURNING rl.count, rl.expires_at INTO v_count, v_expires;

  IF v_count > p_max THEN
    allowed := false;
    retry_after := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_expires - now())))::integer);
  ELSE
    allowed := true;
    retry_after := 0;
  END IF;
  RETURN NEXT;
END;
$$;

-- Доступ к функции: только service_role (edge-функции ходят под ним).
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) TO service_role;

COMMENT ON FUNCTION public.rate_limit_hit IS
  'N13: атомарный инкремент rate-limit счётчика (INSERT ... ON CONFLICT ... RETURNING). Возвращает (allowed, retry_after).';

-- ─── Очистка протухших строк (pg_cron каждые 5 минут) ────────────────────────
DO $mig$
DECLARE
  has_pg_cron boolean;
BEGIN
  SELECT exists(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') INTO has_pg_cron;

  IF NOT has_pg_cron THEN
    RAISE NOTICE '[migration 0024] pg_cron NOT installed — skipping cleanup schedule (CI/vanilla Postgres).';
    RETURN;
  END IF;

  -- Идемпотентно снимаем прежнее задание (если было).
  BEGIN
    PERFORM cron.unschedule('taskflow-rate-limits-cleanup');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM cron.schedule(
    'taskflow-rate-limits-cleanup',
    '*/5 * * * *',
    $CRON$ DELETE FROM public.rate_limits WHERE expires_at < now() $CRON$
  );

  RAISE NOTICE '[migration 0024] scheduled taskflow-rate-limits-cleanup (every 5 min).';
END
$mig$;

-- ============================================================================
-- End of 0024_rate_limits.sql
-- ============================================================================
