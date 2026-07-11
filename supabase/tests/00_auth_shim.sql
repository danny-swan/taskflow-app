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
-- Полный набор колонок, на которые ссылаются наши миграции:
--   • id                — FK-цель во всех протектед-таблицах
--   • email             — 0001_init.sql: триггер NEW.email в handle_new_user()
--   • last_sign_in_at   — 0001_init.sql: admin_users_summary view
--   • created_at        — на всякий случай
CREATE TABLE IF NOT EXISTS auth.users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text,
  last_sign_in_at   timestamptz,
  created_at        timestamptz DEFAULT now()
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

-- ─── 9. supabase_realtime publication ─────────────────────────────────────
-- Миграции 0002/0006/0007 выполняют ALTER PUBLICATION supabase_realtime
-- ADD TABLE ... В Supabase эта публикация создаётся Realtime сервисом.
-- Создаём пустую публикацию чтобы ALTER в миграциях сработал.
-- CREATE PUBLICATION не поддерживает IF NOT EXISTS в PG15 — через DO-блок.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END$$;
