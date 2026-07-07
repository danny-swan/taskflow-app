# Правила для миграций Supabase

_Создан в v0.9.35-dev.6.5 после инцидента v0.9.35-dev.6.4.x, когда PostgREST возвращал 401/403 из-за отсутствующих GRANT'ов._

## Общее

- Все миграции лежат в `supabase/migrations/NNNN_<slug>.sql`, номер строго возрастает.
- Каждая миграция **идемпотентна** (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DO $$ ... EXCEPTION WHEN duplicate_object ... $$`).
- Комментарии в шапке файла — что делаем и **зачем** (context для будущего меня).
- Не пишем в миграциях `SELECT` "для проверки" — выносим в комментарий в конце в виде готового запроса.

## Правило GRANT ↔ RLS (ключевое)

**Любая миграция, которая создаёт таблицу в `public.*` и включает `ENABLE ROW LEVEL SECURITY`, обязана эксплицитно выдать GRANT'ы.**

RLS не заменяет `GRANT`. RLS работает поверх GRANT'а: PostgREST сначала проверяет `has_table_privilege(role, table, 'SELECT|INSERT|UPDATE|DELETE')`, и только потом применяет `USING`-условия политик. Без GRANT — 401 / 403 ещё до попадания в RLS.

### Минимальный шаблон

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.my_table (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- ...
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;

-- Политики
CREATE POLICY "my_table_select_own" ON public.my_table
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "my_table_insert_own" ON public.my_table
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "my_table_update_own" ON public.my_table
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "my_table_delete_own" ON public.my_table
  FOR DELETE USING (auth.uid() = user_id);

-- ⚠️ ОБЯЗАТЕЛЬНО: GRANT'ы иначе PostgREST вернёт 401
GRANT SELECT, INSERT, UPDATE, DELETE ON public.my_table TO authenticated;
GRANT ALL ON public.my_table TO service_role;

COMMIT;
```

### Что НЕ выдавать `authenticated`

- **`profiles`** — INSERT/DELETE не выдавать. Строки создаёт триггер на `auth.users`, удаляет каскад.
- **`user_entitlements`** — только SELECT. Пишет `service_role` через Edge Functions.
- **`payment_events`**, **`usage_events`** — только SELECT. Пишет `service_role`.
- **`activation_requests`** — SELECT + INSERT. UPDATE/DELETE делает админ (`service_role`).

### `anon` никогда не получает GRANT на `public.*`

Единственное исключение — публичные таблицы, если такие появятся (feature flags, публичный каталог). Каждый такой случай — явно документируем в миграции.

## Trigger-функции (SECURITY DEFINER или обычные)

Trigger-функции не должны быть вызваны через PostgREST напрямую:

```sql
CREATE OR REPLACE FUNCTION public.my_trigger_fn() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ⚠️ ОБЯЗАТЕЛЬНО после CREATE FUNCTION
REVOKE EXECUTE ON FUNCTION public.my_trigger_fn() FROM anon, authenticated, PUBLIC;
```

`SECURITY DEFINER`-функции — тем более: без REVOKE любой юзер получил бы права владельца схемы.

Триггер продолжит работать после REVOKE, потому что триггеры исполняются от имени владельца таблицы независимо от GRANT EXECUTE.

## Проверка перед применением в prod

1. **Локально** — прогнать `pg_prove supabase/tests/*.sql` через docker-compose с ванильным Postgres (см. `.github/workflows/db-tests.yml`).
2. **CI** — на push в develop workflow `DB tests (pgTAP)` проходит автоматически.
3. **Верификация в prod после apply** — выполнить в SQL-редакторе:

   ```sql
   BEGIN;
   SET LOCAL ROLE authenticated;
   SET LOCAL request.jwt.claims TO '{"sub":"<test-user-uuid>","role":"authenticated"}';
   SELECT count(*) FROM public.<new_table>;  -- должно вернуть N строк юзера
   ROLLBACK;
   ```

4. **Security Advisor** в Dashboard — не должно быть новых `error`/`warn` (кроме принятого `auth_leaked_password_protection` — Pro-only).

## Как применять миграции в prod

- Через Supabase Management API (POST `/v1/projects/{ref}/database/query`) — так делает CI при мерже в main.
- Через Dashboard SQL Editor — если нужен интерактивный контроль.
- **Никогда не через `supabase db push`** локально из Windows — CLI не всегда доступен без Docker Desktop.

## Rollback

Каждая миграция должна иметь описанный rollback в конце файла (даже если не всегда применим):

```sql
-- ROLLBACK (не автоматический — применить вручную если нужно):
-- BEGIN;
--   ALTER TABLE public.my_table DISABLE ROW LEVEL SECURITY;
--   DROP TABLE public.my_table;
-- COMMIT;
```

## Ссылки

- Supabase Auth roles: <https://supabase.com/docs/guides/database/postgres/roles>
- PostgREST role switching: <https://postgrest.org/en/stable/references/auth.html>
- pgTAP docs: <https://pgtap.org/documentation.html>
