-- TaskFlow Wave 4 PR-B — pgTAP: table-based rate limiter (миграция 0024, N13)
--
-- Покрывает:
--   • структура: таблица public.rate_limits + индекс по expires_at;
--   • безопасность: RLS включён; anon/authenticated не имеют доступа к таблице;
--     EXECUTE на check_rate_limit есть только у service_role;
--   • функциональность: N-й запрос в окне проходит, (N+1)-й — 429 c retry_after>0;
--     после истечения окна счётчик сбрасывается.
--
-- Гоняется на vanilla Postgres 15 (00_auth_shim создаёт роли anon/authenticated/
-- service_role). pg_cron в CI нет — cleanup-джоба из 0024 туда не попадает и здесь
-- не тестируется (это ops-часть, проверяется main-агентом на проде).

BEGIN;
SELECT plan(15);

-- ─── Структура ───────────────────────────────────────────────────────────────
SELECT has_table('public', 'rate_limits', 'N13: таблица public.rate_limits существует');

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'rate_limits'
       AND indexname = 'idx_rate_limits_expires_at'
  ),
  'N13: индекс idx_rate_limits_expires_at существует');

-- ─── RLS включён ──────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.rate_limits'::regclass),
  'N13: RLS включён на public.rate_limits');

-- ─── Таблица недоступна клиентским ролям ──────────────────────────────────────
SELECT ok(NOT has_table_privilege('anon', 'public.rate_limits', 'SELECT'),
          'N13: anon НЕ может SELECT rate_limits');
SELECT ok(NOT has_table_privilege('authenticated', 'public.rate_limits', 'SELECT'),
          'N13: authenticated НЕ может SELECT rate_limits');
SELECT ok(NOT has_table_privilege('anon', 'public.rate_limits', 'INSERT'),
          'N13: anon НЕ может INSERT rate_limits');
SELECT ok(has_table_privilege('service_role', 'public.rate_limits', 'INSERT'),
          'N13: service_role может INSERT rate_limits');

-- ─── Функция и её привилегии ──────────────────────────────────────────────────
SELECT has_function('public', 'check_rate_limit',
  ARRAY['text', 'integer', 'integer'],
  'N13: функция public.check_rate_limit(text,integer,integer) существует');

SELECT ok(
  has_function_privilege('service_role', 'public.check_rate_limit(text,integer,integer)', 'EXECUTE'),
  'N13: service_role имеет EXECUTE на check_rate_limit');
SELECT ok(
  NOT has_function_privilege('anon', 'public.check_rate_limit(text,integer,integer)', 'EXECUTE'),
  'N13: anon НЕ имеет EXECUTE на check_rate_limit');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.check_rate_limit(text,integer,integer)', 'EXECUTE'),
  'N13: authenticated НЕ имеет EXECUTE на check_rate_limit');

-- ─── Функциональный тест: лимит 2 запроса в окне 60с ──────────────────────────
SELECT is(
  (SELECT allowed FROM public.check_rate_limit('pgtap:rl', 2, 60)),
  true, 'N13: запрос 1 из 2 — allowed');
SELECT is(
  (SELECT allowed FROM public.check_rate_limit('pgtap:rl', 2, 60)),
  true, 'N13: запрос 2 из 2 — allowed');

-- 3-й запрос превышает лимит: allowed=false И retry_after>0 (одна и та же строка).
SELECT ok(
  (SELECT NOT allowed AND retry_after > 0 FROM public.check_rate_limit('pgtap:rl', 2, 60)),
  'N13: запрос 3 — denied с retry_after>0');

-- ─── Сброс окна: искусственно истёкшее окно → счётчик обнуляется ──────────────
-- Двигаем expires_at в прошлое; следующий вызов должен сбросить count=1 и пустить.
UPDATE public.rate_limits SET expires_at = now() - interval '1 second' WHERE key = 'pgtap:rl';
SELECT is(
  (SELECT allowed FROM public.check_rate_limit('pgtap:rl', 2, 60)),
  true, 'N13: после истечения окна запрос снова allowed (счётчик сброшен)');

SELECT * FROM finish();
ROLLBACK;
