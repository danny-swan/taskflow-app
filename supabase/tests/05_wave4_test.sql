-- TaskFlow Wave 4 — pgTAP: security-хардненинг (миграции 0022, 0023, 0024)
--
-- Покрывает находки Wave 4 (docs/audit/roadmap.md):
--   N13 — rate_limits таблица + rate_limit_hit RPC: структура, PK, индекс, RLS,
--         SECURITY DEFINER, pinned search_path, гранты, функциональный allow→block.
--   N18 — search_path закреплён у tg_payment_methods_touch_updated_at (0022).
--   N17 — pg_net НЕ в схеме public (0023). На vanilla-Postgres pg_net нет —
--         тест проходит через «расширение отсутствует» (guard как в миграции).

BEGIN;
SELECT plan(19);

-- ─── N13. Структура таблицы rate_limits ─────────────────────────────────────
SELECT has_table('public', 'rate_limits', 'N13: таблица public.rate_limits существует');
SELECT has_column('public', 'rate_limits', 'key',          'N13: rate_limits.key есть');
SELECT has_column('public', 'rate_limits', 'window_start', 'N13: rate_limits.window_start есть');
SELECT has_column('public', 'rate_limits', 'count',        'N13: rate_limits.count есть');
SELECT has_column('public', 'rate_limits', 'expires_at',   'N13: rate_limits.expires_at есть');
SELECT col_is_pk('public', 'rate_limits', 'key',           'N13: PK на rate_limits.key');

SELECT ok(
  EXISTS(SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'rate_limits'
            AND indexname = 'idx_rate_limits_expires_at'),
  'N13: индекс idx_rate_limits_expires_at существует');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.rate_limits'::regclass),
  'N13: RLS включён на rate_limits');

-- ─── N13. Функция rate_limit_hit ────────────────────────────────────────────
SELECT has_function('public', 'rate_limit_hit', ARRAY['text','integer','integer'],
  'N13: функция rate_limit_hit(text,integer,integer) существует');

SELECT ok(
  (SELECT prosecdef FROM pg_proc
     WHERE oid = 'public.rate_limit_hit(text,integer,integer)'::regprocedure),
  'N13: rate_limit_hit — SECURITY DEFINER');

SELECT ok(
  EXISTS(
    SELECT 1 FROM unnest(
      (SELECT proconfig FROM pg_proc
         WHERE oid = 'public.rate_limit_hit(text,integer,integer)'::regprocedure)
    ) AS c WHERE c LIKE 'search_path=%'),
  'N13: rate_limit_hit имеет закреплённый search_path');

SELECT ok(
  has_function_privilege('service_role', 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE'),
  'N13: service_role имеет EXECUTE на rate_limit_hit');
SELECT ok(
  NOT has_function_privilege('anon', 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE'),
  'N13: anon НЕ имеет EXECUTE на rate_limit_hit');

-- ─── N13. Функциональная проверка: allow до лимита, block после ──────────────
-- max=2: два хита разрешены, третий блокируется с retry_after > 0.
SELECT is(
  (SELECT allowed FROM public.rate_limit_hit('pgtap:w4:k1', 2, 60)),
  true, 'N13: 1-й хит в окне разрешён');
SELECT is(
  (SELECT allowed FROM public.rate_limit_hit('pgtap:w4:k1', 2, 60)),
  true, 'N13: 2-й хит (=max) разрешён');
SELECT is(
  (SELECT allowed FROM public.rate_limit_hit('pgtap:w4:k1', 2, 60)),
  false, 'N13: 3-й хит (>max) заблокирован');
SELECT ok(
  (SELECT retry_after FROM public.rate_limit_hit('pgtap:w4:k1', 2, 60)) > 0,
  'N13: заблокированный хит возвращает retry_after > 0');

-- ─── N18. search_path у триггерной функции ──────────────────────────────────
SELECT ok(
  EXISTS(
    SELECT 1 FROM unnest(
      (SELECT proconfig FROM pg_proc
         WHERE oid = 'public.tg_payment_methods_touch_updated_at()'::regprocedure)
    ) AS c WHERE c LIKE 'search_path=%'),
  'N18: tg_payment_methods_touch_updated_at имеет закреплённый search_path');

-- ─── N17. pg_net НЕ в схеме public ──────────────────────────────────────────
-- На vanilla-Postgres (CI) pg_net отсутствует → условие проходит через левую
-- ветку OR. На проде, где pg_net установлен, проверяем что схема не public.
SELECT ok(
  NOT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
  OR (SELECT n.nspname
        FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
       WHERE e.extname = 'pg_net') <> 'public',
  'N17: pg_net не в схеме public (или pg_net отсутствует в CI)');

SELECT * FROM finish();
ROLLBACK;
