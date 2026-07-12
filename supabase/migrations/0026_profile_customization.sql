-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0026_profile_customization.sql
--
-- Базовая кастомизация профиля: публичный ID + профильные поля.
--
-- МОДЕЛЬ ИДЕНТИФИКАТОРОВ profiles:
--   • id (uuid, PK = auth.users.id) — ВНУТРЕННИЙ идентификатор. Используется
--     для связности/логики (FK, RLS own-row, join'ы). Пользователю НЕ
--     показывается и в UI не фигурирует.
--   • public_user_id (text UNIQUE, формат TF-XXXXXX) — ПУБЛИЧНЫЙ идентификатор.
--     Именно его юзер сообщает другим (будущий поиск / добавление в друзья).
--     Неизменяем после присвоения (guard-триггер ниже).
--   • nickname / avatar_variant / bio — косметическое ДОПОЛНЕНИЕ профиля, а не
--     замена идентификатора. Ник не уникален и может быть пустым.
--
-- profiles НЕ участвует в клиентском sync-цикле (outbox/push/pull) — эти поля
-- читаются и пишутся отдельным Supabase-запросом. Sync-таблицы (sync_*) не
-- затрагиваются, upsert/conflict-flow не меняется.
--
-- Идемпотентность: add column if not exists / create or replace function /
-- drop trigger if exists — миграцию можно применять повторно безопасно.
-- ============================================================================

-- ─── 1. Новые колонки profiles ──────────────────────────────────────────────
alter table public.profiles
  add column if not exists public_user_id text;

alter table public.profiles
  add column if not exists nickname text;

alter table public.profiles
  add column if not exists avatar_variant smallint not null default 1;

alter table public.profiles
  add column if not exists bio text;

comment on column public.profiles.public_user_id is
  'Публичный ID (TF-XXXXXX), неизменяем. Показывается юзеру, для поиска/друзей.';
comment on column public.profiles.nickname is 'Ник пользователя (≤32 симв., NULL допустим).';
comment on column public.profiles.avatar_variant is 'Индекс встроенного аватара 1..8.';
comment on column public.profiles.bio is 'О себе (≤160 симв., NULL допустим).';

-- Ограничения (навешиваем идемпотентно через DO-блок: нет ADD CONSTRAINT IF NOT EXISTS).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_nickname_len_chk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_nickname_len_chk
      check (nickname is null or char_length(nickname) <= 32);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_bio_len_chk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_bio_len_chk
      check (bio is null or char_length(bio) <= 160);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_avatar_variant_chk'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_avatar_variant_chk
      check (avatar_variant between 1 and 8);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_public_user_id_key'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_public_user_id_key unique (public_user_id);
  end if;
end$$;

-- ─── 2. Генерация публичного ID ─────────────────────────────────────────────
-- Формат: TF- + 6 символов из алфавита без визуально похожих (I L O 0 1).
create or replace function public.gen_public_user_id()
returns text language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- без I L O 0 1, длина 31
  code text; i int;
begin
  code := '';
  for i in 1..6 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return 'TF-' || code;
end; $$;

comment on function public.gen_public_user_id() is
  'Возвращает случайный публичный ID формата TF-XXXXXX (6 символов из безопасного алфавита).';

-- Присвоение уникального ID с retry при коллизии.
create or replace function public.assign_public_user_id()
returns text language plpgsql as $$
declare
  candidate text;
  attempt int := 0;
begin
  loop
    attempt := attempt + 1;
    candidate := public.gen_public_user_id();
    if not exists (select 1 from public.profiles where public_user_id = candidate) then
      return candidate;
    end if;
    if attempt >= 10 then
      raise exception 'assign_public_user_id: не удалось подобрать уникальный ID за % попыток', attempt;
    end if;
  end loop;
end; $$;

comment on function public.assign_public_user_id() is
  'Подбирает уникальный public_user_id (до 10 попыток, иначе RAISE).';

alter function public.gen_public_user_id()      set search_path = public, pg_temp;
alter function public.assign_public_user_id()   set search_path = public, pg_temp;

-- DEFAULT на public_user_id: прямой INSERT без явного значения (в т.ч. pgTAP-
-- тесты, вставляющие в profiles напрямую) автоматически получает уникальный ID.
-- Ставим ПОСЛЕ создания assign_public_user_id() и ПЕРЕД SET NOT NULL.
-- Идемпотентно: ALTER ... SET DEFAULT просто переустанавливает выражение.
alter table public.profiles
  alter column public_user_id set default public.assign_public_user_id();

-- ─── 3. handle_new_user: проставляем public_user_id при регистрации ─────────
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, public_user_id)
  values (new.id, new.email, public.assign_public_user_id())
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

alter function public.handle_new_user() set search_path = public, pg_temp;

-- (Триггер on_auth_user_created уже создан в 0001 и указывает на эту функцию.)

-- ─── 4. Backfill существующих профилей ──────────────────────────────────────
-- Каждому profile без public_user_id присваиваем свой уникальный ID.
do $$
declare
  r record;
begin
  for r in select id from public.profiles where public_user_id is null loop
    update public.profiles
      set public_user_id = public.assign_public_user_id()
      where id = r.id;
  end loop;
end$$;

-- После backfill'а колонка обязана быть заполнена у всех.
alter table public.profiles alter column public_user_id set not null;

-- ─── 5. Guard неизменяемости id и public_user_id ────────────────────────────
-- КРИТИЧНО: у authenticated есть UPDATE ON profiles (RLS own-row), поэтому
-- пользователь технически может попытаться переписать свой публичный ID или
-- внутренний id. BEFORE UPDATE триггер молча возвращает старые значения этих
-- полей (не бросает ошибку, чтобы не ломать легитимные UPDATE nickname/bio/
-- avatar_variant и смену email). Отдельный от set_updated_at триггер.
create or replace function public.profiles_guard_immutable()
returns trigger as $$
begin
  -- id меняться не должен никогда.
  if new.id is distinct from old.id then
    new.id := old.id;
  end if;
  -- public_user_id неизменяем после присвоения.
  if old.public_user_id is not null
     and new.public_user_id is distinct from old.public_user_id then
    new.public_user_id := old.public_user_id;
  end if;
  return new;
end;
$$ language plpgsql;

alter function public.profiles_guard_immutable() set search_path = public, pg_temp;

drop trigger if exists profiles_guard_immutable on public.profiles;
create trigger profiles_guard_immutable
  before update on public.profiles
  for each row execute function public.profiles_guard_immutable();

-- ─── 6. REVOKE EXECUTE (конвенция 0013) ─────────────────────────────────────
-- Ни одна из новых функций не должна вызываться клиентом напрямую через REST:
-- gen/assign нужны только handle_new_user + backfill, guard — только триггеру.
-- Триггеры продолжают работать независимо от GRANT EXECUTE.
revoke execute on function public.gen_public_user_id()      from anon, authenticated, public;
revoke execute on function public.assign_public_user_id()   from anon, authenticated, public;
revoke execute on function public.profiles_guard_immutable() from anon, authenticated, public;
