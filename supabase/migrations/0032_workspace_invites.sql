-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0032_workspace_invites.sql — API приглашений в shared-пространства
-- (Wave B, PR-b-03 «feat/ws-b-03-invites»).
--
-- Техплан: docs/architecture/wave-b-plan.md §4 п.3; роль-модель и приглашение по
-- публичному TF-ID — ADR 0005 п.1/п.3; тарифный слот shared — ADR 0005 п.4.
-- Реализует пункт 3 raodmap §7.6.
--
-- ─── ЧТО ЭТО ДАЁТ ───────────────────────────────────────────────────────────
-- Фундамент 0027-0031 уже открыл kind='shared' на уровне схемы (0030 снял guard),
-- завёл ролевую RLS (0031) и тарифный лимит (0029). Не хватало «как второй
-- участник попадает в чужое пространство». Эта миграция вводит:
--   1. lookup_user_by_public_id(text) — обратный лукап public_user_id → uuid
--      (в 0026 был только forward: profiles.public_user_id, без обратной функции).
--   2. Таблицу sync_workspace_invites (НЕ sync-таблица клиента: живёт только на
--      сервере, читается/меняется через RPC, не участвует в outbox/pull).
--   3. Четыре SECURITY DEFINER RPC: invite_to_workspace / accept_invite /
--      reject_invite / cancel_invite. Вся мутация инвайтов и вступление в
--      членство идут ТОЛЬКО через них (прямой DML в таблицу закрыт).
--   4. Вспомогательный expire_invites() (cron-friendly, без scheduling).
--
-- ─── ТАРИФНЫЙ ЛИМИТ ПРИ ACCEPT ──────────────────────────────────────────────
-- Слот shared-пространства занимает КАЖДЫЙ участник (не только owner): при
-- accept'е считаем активные членства принимающего и сверяем с
-- get_workspace_limit(uid,'shared') (0029). Для free это 0 → free физически не
-- может принять инвайт (двойная защита: pre-check на invite + re-check на accept).
--
-- Совместимо с vanilla Postgres 15 (CI). Идемпотентна: CREATE ... IF NOT EXISTS /
-- CREATE OR REPLACE / DROP POLICY IF EXISTS / DO-блоки для констрейнтов и индексов.
-- На прод НЕ применяется до решения релизить эпик «Пространства».
-- ============================================================================
SET LOCAL client_min_messages = warning;

-- ============================================================================
-- 1. lookup_user_by_public_id — обратный лукап public_user_id → auth.uid()
-- ============================================================================
-- В 0026 public_user_id (TF-XXXXXX) живёт в public.profiles (UNIQUE), forward-
-- сторона (свой id читает клиент через profile.ts). Обратной функции не было.
-- Заводим МИНИМАЛЬНУЮ: по TF-ID возвращает internal uuid (profiles.id ==
-- auth.users.id) или NULL, ничего лишнего не раскрывая. SECURITY DEFINER —
-- читает profiles минуя RLS; вызывается только внутри invite_to_workspace,
-- поэтому EXECUTE для anon/authenticated закрыт (не отдельный REST-RPC).
create or replace function public.lookup_user_by_public_id(p_public_id text)
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p.id
  from public.profiles p
  where p.public_user_id = p_public_id
  limit 1;
$$;

comment on function public.lookup_user_by_public_id(text) is
  'Обратный лукап публичного ID (TF-XXXXXX) → internal auth.uid(). NULL если нет. SECURITY DEFINER (читает profiles минуя RLS). Только для invite_to_workspace.';

revoke execute on function public.lookup_user_by_public_id(text) from anon, authenticated, public;

-- ============================================================================
-- 2. Таблица sync_workspace_invites
-- ============================================================================
create table if not exists public.sync_workspace_invites (
  id                    text primary key default ('inv_' || replace(gen_random_uuid()::text, '-', '')),
  workspace_id          text        not null references public.sync_workspaces(id) on delete cascade,
  inviter_user_id       uuid        not null references auth.users(id) on delete cascade,
  target_public_user_id text        not null,
  target_user_id        uuid                 references auth.users(id) on delete set null,
  role                  text        not null check (role in ('editor', 'viewer')),
  status                text        not null default 'pending'
                          check (status in ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  expires_at            timestamptz not null default (now() + interval '7 days'),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  accepted_at           timestamptz
);

comment on table public.sync_workspace_invites is
  'Приглашения в shared-пространства (Wave B). Серверная таблица: мутация только через SECURITY DEFINER RPC (invite/accept/reject/cancel), прямой DML закрыт RLS+grants.';
comment on column public.sync_workspace_invites.id is
  'PK формата inv_<hex> (default gen_random_uuid без дефисов).';
comment on column public.sync_workspace_invites.workspace_id is
  'Пространство приглашения. FK → sync_workspaces(id) ON DELETE CASCADE.';
comment on column public.sync_workspace_invites.inviter_user_id is
  'Кто пригласил (owner на момент создания). FK → auth.users(id) ON DELETE CASCADE.';
comment on column public.sync_workspace_invites.target_public_user_id is
  'Публичный TF-ID приглашаемого (как ввёл owner). Не FK: public_id может устареть.';
comment on column public.sync_workspace_invites.target_user_id is
  'Разрезолвленный internal uuid приглашаемого. FK → auth.users ON DELETE SET NULL (nullable, если пользователь удалён).';
comment on column public.sync_workspace_invites.role is
  'Роль, которую получит приглашённый: editor или viewer (owner не приглашают).';
comment on column public.sync_workspace_invites.status is
  'Жизненный цикл: pending → accepted/rejected/expired/cancelled.';
comment on column public.sync_workspace_invites.expires_at is
  'Срок действия (default now()+7 дней). accept после истечения запрещён.';
comment on column public.sync_workspace_invites.accepted_at is
  'Момент принятия (NULL до accept).';

-- ─── 2.1 Индексы ────────────────────────────────────────────────────────────
-- Идемпотентность приглашений: не более одного pending на пару (ws, target).
create unique index if not exists sync_workspace_invites_pending_uq
  on public.sync_workspace_invites (workspace_id, target_user_id)
  where status = 'pending';

-- listInvites приглашённого («мои входящие»).
create index if not exists sync_workspace_invites_target_pending_idx
  on public.sync_workspace_invites (target_user_id, status)
  where status = 'pending';

-- listInvites owner'а («по пространству»).
create index if not exists sync_workspace_invites_workspace_status_idx
  on public.sync_workspace_invites (workspace_id, status);

-- ─── 2.2 updated_at trigger (переиспользуем set_updated_at из 0005) ──────────
drop trigger if exists trg_set_updated_at on public.sync_workspace_invites;
create trigger trg_set_updated_at
  before update on public.sync_workspace_invites
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 3. RLS
-- ============================================================================
-- SELECT — приглашённый (свои инвайты) ИЛИ owner пространства (все инвайты ws).
-- INSERT/UPDATE/DELETE — deny для всех: любая мутация только через RPC ниже
-- (SECURITY DEFINER, выполняются под владельцем функции минуя RLS). Плюс
-- authenticated НЕ выдаётся привилегия I/U/D на таблицу (grants §6) — прямой DML
-- падает с 42501 ещё на уровне привилегий.
alter table public.sync_workspace_invites enable row level security;

drop policy if exists "invites_select_ws_role" on public.sync_workspace_invites;
drop policy if exists "invites_insert_deny"    on public.sync_workspace_invites;
drop policy if exists "invites_update_deny"    on public.sync_workspace_invites;
drop policy if exists "invites_delete_deny"    on public.sync_workspace_invites;

create policy "invites_select_ws_role" on public.sync_workspace_invites
  for select using (
    target_user_id = (select auth.uid())
    or public.has_workspace_role(workspace_id, (select auth.uid()), 'owner')
  );

create policy "invites_insert_deny" on public.sync_workspace_invites
  for insert with check (false);

create policy "invites_update_deny" on public.sync_workspace_invites
  for update using (false) with check (false);

create policy "invites_delete_deny" on public.sync_workspace_invites
  for delete using (false);

comment on policy "invites_select_ws_role" on public.sync_workspace_invites is
  'SELECT: приглашённый видит свои инвайты (target_user_id = auth.uid()) ИЛИ owner видит все инвайты своего пространства.';
comment on policy "invites_insert_deny" on public.sync_workspace_invites is
  'INSERT запрещён напрямую: только через RPC invite_to_workspace (SECURITY DEFINER).';
comment on policy "invites_update_deny" on public.sync_workspace_invites is
  'UPDATE запрещён напрямую: только через RPC accept/reject/cancel/expire (SECURITY DEFINER).';
comment on policy "invites_delete_deny" on public.sync_workspace_invites is
  'DELETE запрещён: жизненный цикл — soft через status, физически строки не удаляются (кроме CASCADE по workspace/inviter).';

-- ============================================================================
-- 4. RPC-функции (все SECURITY DEFINER + SET search_path = public)
-- ============================================================================

-- ─── 4.1 invite_to_workspace ────────────────────────────────────────────────
create or replace function public.invite_to_workspace(
  p_workspace_id     text,
  p_target_public_id text,
  p_role             text
)
returns public.sync_workspace_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_target  uuid;
  v_existing public.sync_workspace_invites;
  v_result   public.sync_workspace_invites;
begin
  -- Auth.
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Только owner пространства приглашает.
  if not public.has_workspace_role(p_workspace_id, v_uid, 'owner') then
    raise exception 'only workspace owner can invite' using errcode = '42501';
  end if;

  -- Валидация роли (owner не приглашают).
  if p_role is null or p_role not in ('editor', 'viewer') then
    raise exception 'invalid role: %', p_role using errcode = '22023';
  end if;

  -- Резолв приглашаемого по публичному TF-ID.
  v_target := public.lookup_user_by_public_id(p_target_public_id);
  if v_target is null then
    raise exception 'user not found' using errcode = '22023';
  end if;

  -- Нельзя пригласить самого себя.
  if v_target = v_uid then
    raise exception 'cannot invite yourself' using errcode = '22023';
  end if;

  -- Уже участник?
  if exists (
    select 1 from public.sync_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = v_target
      and m.deleted_at is null
  ) then
    raise exception 'user is already a member' using errcode = '22023';
  end if;

  -- Приглашаемый обязан быть на платном тарифе (pre-check; re-check на accept).
  if not exists (
    select 1 from public.user_entitlements e
    where e.user_id = v_target
      and e.plan in ('pro', 'trial', 'lifetime')
      and (e.plan = 'lifetime' or (e.valid_until is not null and e.valid_until > now()))
  ) then
    raise exception 'target user is on free plan and cannot join shared workspaces'
      using errcode = '22023';
  end if;

  -- Идемпотентность: уже есть pending инвайт этой паре → возвращаем его.
  select * into v_existing
  from public.sync_workspace_invites
  where workspace_id = p_workspace_id
    and target_user_id = v_target
    and status = 'pending'
  limit 1;

  if found then
    return v_existing;
  end if;

  insert into public.sync_workspace_invites
    (workspace_id, inviter_user_id, target_public_user_id, target_user_id, role, status, expires_at)
  values
    (p_workspace_id, v_uid, p_target_public_id, v_target, p_role, 'pending', now() + interval '7 days')
  returning * into v_result;

  return v_result;
end;
$$;

comment on function public.invite_to_workspace(text, text, text) is
  'RPC: owner приглашает пользователя (по TF-ID) в shared-пространство. Проверки: owner-only, роль editor/viewer, target существует/не self/не участник/на платном тарифе. Идемпотентно (возвращает существующий pending). SECURITY DEFINER.';

-- ─── 4.2 accept_invite ───────────────────────────────────────────────────────
create or replace function public.accept_invite(p_invite_id text)
returns public.sync_workspace_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_invite public.sync_workspace_invites;
  v_count  int;
  v_limit  int;
  v_member public.sync_workspace_members;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Инвайт должен существовать, быть адресован вызывающему, pending и не истёкшим.
  select * into v_invite
  from public.sync_workspace_invites
  where id = p_invite_id
    and target_user_id = v_uid
    and status = 'pending'
    and expires_at > now()
  limit 1;

  if not found then
    raise exception 'invite not found or not for you' using errcode = '42501';
  end if;

  -- Тарифный лимит принимающего: слот shared занимает каждый участник.
  -- get_workspace_limit(uid,'shared'): платный = 7, free = 0.
  v_limit := public.get_workspace_limit(v_uid, 'shared');

  select count(*) into v_count
  from public.sync_workspace_members m
  where m.user_id = v_uid
    and m.deleted_at is null;

  if v_count >= v_limit then
    raise exception 'workspace limit exceeded' using errcode = '22023';
  end if;

  -- Атомарно: пометить инвайт accepted + завести членство.
  update public.sync_workspace_invites
    set status = 'accepted', accepted_at = now()
    where id = v_invite.id;

  insert into public.sync_workspace_members
    (id, workspace_id, user_id, role, invited_by)
  values
    ('wsm_' || replace(gen_random_uuid()::text, '-', ''),
     v_invite.workspace_id, v_uid, v_invite.role, v_invite.inviter_user_id)
  returning * into v_member;

  return v_member;
end;
$$;

comment on function public.accept_invite(text) is
  'RPC: приглашённый принимает pending-инвайт. Проверки: target-only, pending, не истёк, тарифный лимит shared принимающего (>=limit → 22023). Атомарно: invite→accepted + INSERT в sync_workspace_members. SECURITY DEFINER.';

-- ─── 4.3 reject_invite ────────────────────────────────────────────────────────
create or replace function public.reject_invite(p_invite_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update public.sync_workspace_invites
    set status = 'rejected'
    where id = p_invite_id
      and target_user_id = v_uid
      and status = 'pending';

  if not found then
    raise exception 'invite not found or not for you' using errcode = '42501';
  end if;
end;
$$;

comment on function public.reject_invite(text) is
  'RPC: приглашённый отклоняет свой pending-инвайт (status→rejected). Только target, только pending, иначе 42501. SECURITY DEFINER.';

-- ─── 4.4 cancel_invite ────────────────────────────────────────────────────────
create or replace function public.cancel_invite(p_invite_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ws  text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Найти пространство инвайта (минуя RLS — мы в DEFINER-контексте).
  select workspace_id into v_ws
  from public.sync_workspace_invites
  where id = p_invite_id and status = 'pending'
  limit 1;

  if v_ws is null or not public.has_workspace_role(v_ws, v_uid, 'owner') then
    raise exception 'invite not found or not permitted' using errcode = '42501';
  end if;

  update public.sync_workspace_invites
    set status = 'cancelled'
    where id = p_invite_id and status = 'pending';
end;
$$;

comment on function public.cancel_invite(text) is
  'RPC: owner отменяет pending-инвайт своего пространства (status→cancelled). Только owner, только pending, иначе 42501. SECURITY DEFINER.';

-- ─── 4.5 expire_invites (cron-friendly, без scheduling) ──────────────────────
create or replace function public.expire_invites()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  update public.sync_workspace_invites
    set status = 'expired'
    where status = 'pending' and expires_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.expire_invites() is
  'RPC (cron-friendly): помечает истёкшие pending-инвайты как expired. Возвращает число обновлённых строк. Без встроенного scheduling. SECURITY DEFINER.';

-- ============================================================================
-- 5. EXECUTE-гранты на RPC
-- ============================================================================
-- Клиентские RPC (invite/accept/reject/cancel) вызываются authenticated через
-- REST. expire_invites — только service_role (cron/сервер). lookup — внутренняя
-- (§1, EXECUTE уже отозван у всех).
revoke execute on function public.invite_to_workspace(text, text, text) from anon, public;
revoke execute on function public.accept_invite(text)                    from anon, public;
revoke execute on function public.reject_invite(text)                    from anon, public;
revoke execute on function public.cancel_invite(text)                    from anon, public;
revoke execute on function public.expire_invites()                       from anon, authenticated, public;

grant execute on function public.invite_to_workspace(text, text, text) to authenticated;
grant execute on function public.accept_invite(text)                    to authenticated;
grant execute on function public.reject_invite(text)                    to authenticated;
grant execute on function public.cancel_invite(text)                    to authenticated;
grant execute on function public.expire_invites()                       to service_role;

-- ============================================================================
-- 6. GRANT'ы на таблицу
-- ============================================================================
-- authenticated: ТОЛЬКО SELECT (чтение своих/owner-инвайтов через RLS §3).
-- I/U/D намеренно НЕ выдаём — прямой DML падает 42501 (мутация только через RPC).
-- service_role — всё (cron/сервисные задачи, expire_invites под service_role).
grant select on table public.sync_workspace_invites to authenticated;
grant all    on table public.sync_workspace_invites to service_role;
