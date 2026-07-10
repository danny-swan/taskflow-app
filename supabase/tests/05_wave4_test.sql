-- TaskFlow Wave 4 PR-A — pgTAP: security-хардненинг (миграции 0022, 0023)
--
-- Покрывает находки Wave 4, которые проверяемы на структуре БД:
--   N18 — search_path зафиксирован у public-функций (в первую очередь у
--         trigger-функции tg_payment_methods_touch_updated_at, которая раньше
--         была вовсе без search_path).
--   N17 — расширение pg_net зарегистрировано в схеме extensions, не в public.
--
-- N11 (CORS) и N14 (verify_jwt) здесь НЕ тестируются — это код edge-функций и
-- config.toml, а не миграции (см. Deno-тесты _shared/cors.test.ts).
--
-- ПРИМЕЧАНИЕ про CI: тесты гоняются на vanilla Postgres 15 (00_auth_shim.sql),
-- где pg_net НЕ установлен. Проверка N17 в этом случае помечается как skipped,
-- чтобы CI оставался зелёным; на проде main-агент прогоняет её после деплоя.

BEGIN;
SELECT plan(4);

-- ─── N18. Trigger-функция payment_methods имеет search_path ──────────────────
SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'tg_payment_methods_touch_updated_at'
       AND p.proconfig IS NOT NULL
       AND EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
  ),
  'N18: tg_payment_methods_touch_updated_at имеет зафиксированный search_path');

-- ─── N18. Значение содержит pg_temp (public, pg_temp) ───────────────────────
SELECT ok(
  (SELECT array_to_string(p.proconfig, ',')
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'tg_payment_methods_touch_updated_at')
  LIKE '%pg_temp%',
  'N18: search_path trigger-функции включает pg_temp');

-- ─── N18. Регрессия 0005: set_updated_at снова с pg_temp ────────────────────
SELECT ok(
  (SELECT array_to_string(p.proconfig, ',')
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'set_updated_at')
  LIKE '%search_path=%pg_temp%',
  'N18: set_updated_at имеет search_path = public, pg_temp');

-- ─── N17. pg_net зарегистрирован в extensions (или skip в CI без pg_net) ─────
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net')
  THEN pass('N17: pg_net не установлен (CI/vanilla PG) — проверка пропущена')
  ELSE is(
    (SELECT n.nspname::text
       FROM pg_extension e
       JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'pg_net'),
    'extensions',
    'N17: pg_net зарегистрирован в схеме extensions, не в public')
END;

SELECT * FROM finish();
ROLLBACK;
