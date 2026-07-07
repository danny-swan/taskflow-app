-- TaskFlow v0.9.35-dev.6.5 — CI shim для auth-схемы
--
-- Supabase проект имеет встроенные:
--   • роли: anon, authenticated, service_role, supabase_admin (созданы GoTrue)
--   • схема auth с таблицами users, sessions... и функциями auth.uid(), auth.jwt(), ...
--
-- В vanilla Postgres их нет. Этот файл создаёт минимально необходимое подмножество
-- для того, чтобы миграции 0001-0013 применились и pgTAP-тесты работали.
--
-- Применяется ПЕРЕД миграциями в CI (см. .github/workflows/db-tests.yml).
-- В prod НЕ применяется — там всё это уже есть.

-- ─── 1. Роли ──────────────────────────────────────────────────────────────
-- NOLOGIN: эти роли не логинятся напрямую, PostgREST переключается в них
-- через SET LOCAL ROLE после проверки JWT.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END$$;

-- ─── 2. Схема auth и её owner ─────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

-- ─── 3. auth.users — минимальная копия ────────────────────────────────────
-- В Supabase это большая таблица с email, encrypted_password, etc. Нам достаточно
-- только id (uuid) — миграции ссылаются на неё через FK.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  created_at timestamptz DEFAULT now()
);

-- ─── 4. auth.uid() — читает sub из JWT claims ─────────────────────────────
-- Ровно та же семантика, что в Supabase: возвращает NULL если claim не задан.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')
  )::uuid
$$;

-- ─── 5. auth.role() — тоже нужна кое-где ──────────────────────────────────
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true)::json->>'role', '')
  )::text
$$;

-- ─── 6. GRANT на схему auth ───────────────────────────────────────────────
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO anon, authenticated, service_role;

-- ─── 7. pgcrypto (для gen_random_uuid() в миграциях) ──────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── 8. pgtap ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgtap;
