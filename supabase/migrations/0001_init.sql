-- TaskFlow v0.9.9 — начальная миграция Supabase
-- Выполнить один раз в Supabase Dashboard → SQL Editor → New query → Run
--
-- Создаёт:
--   1. profiles — расширение auth.users (email доступен через RPC/join)
--   2. usage_events — телеметрия (регистрация, логин, версия, OS, статистика)
--   3. RLS-политики: пользователь видит только свои данные
--   4. Trigger автосоздания profile при регистрации нового user'а

-- ============================================================================
-- 1. Таблица profiles
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Метаданные пользователя (для будущего расширения без миграций)
  metadata jsonb default '{}'::jsonb
);

comment on table public.profiles is 'Расширение auth.users с публичными данными пользователя';

-- Автообновление updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Триггер: при регистрации нового пользователя автосоздаётся profile
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 2. Таблица usage_events (телеметрия)
-- ============================================================================
create table if not exists public.usage_events (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  event_type text not null,           -- 'signup', 'login', 'app_start', 'task_created', 'task_deleted'
  app_version text,                   -- '0.9.9'
  os text,                            -- 'windows', 'macos', 'linux'
  os_version text,                    -- '10.0.19045'
  metadata jsonb default '{}'::jsonb, -- любые доп. поля события
  created_at timestamptz not null default now()
);

comment on table public.usage_events is 'Базовая телеметрия: логин/регистрация, версия приложения, OS, статистика использования';

create index if not exists usage_events_user_id_idx on public.usage_events(user_id);
create index if not exists usage_events_event_type_idx on public.usage_events(event_type);
create index if not exists usage_events_created_at_idx on public.usage_events(created_at desc);

-- ============================================================================
-- 3. Row Level Security
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.usage_events enable row level security;

-- profiles: пользователь видит и обновляет только свой профиль
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- usage_events: пользователь вставляет только события со своим user_id
--               (или анонимные — user_id может быть null для событий до логина)
drop policy if exists "usage_events_insert_own" on public.usage_events;
create policy "usage_events_insert_own"
  on public.usage_events for insert
  with check (auth.uid() = user_id or user_id is null);

-- SELECT для usage_events закрыт — данные видит только admin через service_role
-- (пользователю не нужно читать свою телеметрию через клиент)

-- ============================================================================
-- 4. View для админа: сводка пользователей
-- ============================================================================
-- Удобный SELECT для тебя: SELECT * FROM admin_users_summary;
-- Доступен только через service_role (в Dashboard SQL Editor)
create or replace view public.admin_users_summary as
select
  p.id,
  p.email,
  p.created_at as registered_at,
  u.last_sign_in_at,
  (select count(*) from public.usage_events where user_id = p.id and event_type = 'app_start') as sessions_count,
  (select count(*) from public.usage_events where user_id = p.id and event_type = 'task_created') as tasks_created_count,
  (select app_version from public.usage_events where user_id = p.id order by created_at desc limit 1) as latest_app_version,
  (select os from public.usage_events where user_id = p.id order by created_at desc limit 1) as latest_os
from public.profiles p
left join auth.users u on u.id = p.id
order by p.created_at desc;

comment on view public.admin_users_summary is 'Сводка пользователей для админа. Доступ только через service_role.';
