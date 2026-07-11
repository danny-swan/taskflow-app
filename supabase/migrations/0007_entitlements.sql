-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- v0.9.35-dev.6: Freemium + Trial + Subscription + Lifetime.
--
-- Три таблицы:
--
--   1. user_entitlements — «какой план у пользователя».
--      Одна строка на юзера (UNIQUE user_id). При отсутствии строки —
--      считаем free.
--
--   2. activation_requests — «пользователь просит активировать оплату».
--      Пользователь заплатил напрямую (крипта, ручной перевод) и хочет
--      чтобы его перевели в Pro. Админ проверяет платёж и проставляет
--      status='approved' + пишет строку в user_entitlements.
--
--   3. payment_events — история webhook'ов от платёжного провайдера
--      (ЮKassa / CloudPayments). Идемпотентная запись через UNIQUE
--      (provider, external_id).
--
-- RLS: все три таблицы читаемы только владельцем (user_id = auth.uid()).
-- INSERT в activation_requests разрешён самому пользователю.
-- INSERT в user_entitlements и payment_events — только service_role
-- (через Edge Function / админа).
-- UPDATE где угодно — только service_role.
--
-- Realtime: все три таблицы в publication supabase_realtime, чтобы
-- клиент видел изменение плана мгновенно после аппрува.
--
-- Seed админ/grandfathered-аккаунтов вынесён в отдельную миграцию
-- (см. 0009_admin_seed.sql) — email-а в истории кода не храним.

-- ============================================================================
-- 1. user_entitlements
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'plan_kind') then
    create type public.plan_kind as enum ('free', 'trial', 'pro', 'lifetime');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'entitlement_source') then
    create type public.entitlement_source as enum (
      'admin',        -- ручная активация админом
      'trial',        -- пользователь сам запустил trial
      'manual',       -- админ подтвердил ручную заявку (activation_requests)
      'yookassa',     -- webhook от ЮKassa
      'cloudpayments',-- webhook от CloudPayments
      'crypto',       -- ручной аппрув крипто-платежа
      'seed'          -- изначальный grandfathered seed
    );
  end if;
end $$;

create table if not exists public.user_entitlements (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  plan          public.plan_kind not null default 'free',
  valid_until   timestamptz,             -- NULL = бессрочно (lifetime / free)
  activated_at  timestamptz not null default now(),
  source        public.entitlement_source not null default 'trial',
  trial_used    boolean not null default false,
  notes         text,
  updated_at    timestamptz not null default now()
);

create index if not exists idx_user_entitlements_valid_until
  on public.user_entitlements(valid_until)
  where valid_until is not null;

-- BEFORE UPDATE trigger для updated_at (по образцу sync-таблиц из 0005).
create or replace function public.set_user_entitlements_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists trg_user_entitlements_updated_at on public.user_entitlements;
create trigger trg_user_entitlements_updated_at
  before update on public.user_entitlements
  for each row execute function public.set_user_entitlements_updated_at();

alter table public.user_entitlements enable row level security;

drop policy if exists user_entitlements_select_own on public.user_entitlements;
create policy user_entitlements_select_own
  on public.user_entitlements
  for select
  using ((select auth.uid()) = user_id);

-- INSERT/UPDATE/DELETE — только service_role (webhook / админ).
-- Клиент не может сам сделать себе Pro.

-- ============================================================================
-- 2. activation_requests
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'activation_status') then
    create type public.activation_status as enum ('pending', 'approved', 'rejected');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'plan_requested_kind') then
    create type public.plan_requested_kind as enum ('monthly', 'annual', 'lifetime');
  end if;
end $$;

create table if not exists public.activation_requests (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  email             text not null,             -- email платежа (может отличаться от auth email)
  tx_ref            text not null,             -- hash транзакции / номер платежа / произвольный референс
  plan_requested    public.plan_requested_kind not null,
  provider_hint     text,                       -- 'cloudtips' | 'ton' | 'usdt-trc20' | 'usdt-erc20' | 'other'
  status            public.activation_status not null default 'pending',
  admin_notes       text,
  created_at        timestamptz not null default now(),
  approved_at       timestamptz
);

create index if not exists idx_activation_requests_user
  on public.activation_requests(user_id, created_at desc);

create index if not exists idx_activation_requests_status
  on public.activation_requests(status)
  where status = 'pending';

alter table public.activation_requests enable row level security;

drop policy if exists activation_requests_select_own on public.activation_requests;
create policy activation_requests_select_own
  on public.activation_requests
  for select
  using ((select auth.uid()) = user_id);

drop policy if exists activation_requests_insert_own on public.activation_requests;
create policy activation_requests_insert_own
  on public.activation_requests
  for insert
  with check ((select auth.uid()) = user_id);

-- UPDATE запрещён клиенту (только service_role меняет status на approved/rejected).

-- ============================================================================
-- 3. payment_events (webhook history)
-- ============================================================================

create table if not exists public.payment_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null,             -- 'yookassa' | 'cloudpayments'
  external_id       text not null,             -- id платежа у провайдера
  user_id           uuid references auth.users(id) on delete set null,
  raw_payload       jsonb not null,
  signature_valid   boolean not null default false,
  processed_at      timestamptz,               -- NULL пока не применён к user_entitlements
  error             text,
  created_at        timestamptz not null default now()
);

create unique index if not exists uidx_payment_events_provider_external
  on public.payment_events(provider, external_id);

create index if not exists idx_payment_events_user
  on public.payment_events(user_id, created_at desc)
  where user_id is not null;

alter table public.payment_events enable row level security;

drop policy if exists payment_events_select_own on public.payment_events;
create policy payment_events_select_own
  on public.payment_events
  for select
  using ((select auth.uid()) = user_id);

-- INSERT/UPDATE — только service_role (webhook Edge Function).

-- ============================================================================
-- 4. Realtime publication
-- ============================================================================

do $$
begin
  begin
    alter publication supabase_realtime add table public.user_entitlements;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.activation_requests;
  exception when duplicate_object then null;
  end;
  -- payment_events намеренно НЕ в realtime — клиенту не нужен поток raw webhook'ов.
end $$;

-- ============================================================================
-- 5. Seed вынесён в 0009_admin_seed.sql
-- ============================================================================
-- Здесь был seed grandfathered админа по email. С v0.9.35-dev.6.1 email‘ы
-- больше не хранятся в истории кода; seed теперь выполняется вручную
-- через SQL editor по шаблону в 0009_admin_seed.sql.
