-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0038_accept_invite_limit_by_plan.sql — переопределение public.accept_invite:
-- лимит на приём инвайта считается ПО ПЛАНУ пользователя, а не по числу членств.
--
-- ─── ПРОБЛЕМА (в 0032) ───────────────────────────────────────────────────────
-- Исходная accept_invite (0032, §4.2) блокировала приём чужого инвайта так:
--     v_limit := get_workspace_limit(uid,'shared');           -- paid=7, free=0
--     select count(*) into v_count
--       from sync_workspace_members where user_id = uid and deleted_at is null;
--     if v_count >= v_limit then raise 'workspace limit exceeded'; end if;
-- Счётчик v_count включает ВСЕ членства пользователя (owner + editor + viewer).
-- Владелец каждого своего пространства имеет строку членства role='owner' (0027),
-- поэтому СВОИ (владеемые) пространства расходовали бюджет на ПРИЁМ чужих инвайтов
-- и наоборот. Платный пользователь с 7 своими ws не мог принять ни одного
-- приглашения, хотя лимит на СОЗДАНИЕ (enforce_workspace_limit, 0029) и лимит на
-- участие в чужих — это разные вещи.
--
-- ─── РЕШЕНИЕ (продуктовое) ───────────────────────────────────────────────────
-- Приём чужого инвайта разрешён, ТОЛЬКО если тариф пользователя поддерживает
-- shared-пространства (pro/trial/lifetime). Признак — get_workspace_limit(uid,
-- 'shared') > 0 (у free = 0, у платных = 7). Зависимость от числа собственных или
-- принятых членств УБРАНА: платные принимают любое число чужих инвайтов, свои
-- владеемые ws бюджет на приём не расходуют. Free по-прежнему не может принимать
-- (shared недоступен) — единственный кейс блокировки.
--
-- Меняется ТОЛЬКО лимит-гейт. Остальное поведение accept_invite (проверки
-- target-only/pending/не истёк, атомарные invite→accepted + INSERT членства,
-- идемпотентность, SECURITY DEFINER, search_path) сохранено без изменений.
--
-- Идемпотентна: CREATE OR REPLACE FUNCTION сохраняет существующие GRANT/REVOKE
-- (см. 0032 §6). Совместимо с vanilla Postgres 15 (CI). На прод НЕ применяется до
-- решения релизить эпик «Пространства».
-- ============================================================================
SET LOCAL client_min_messages = warning;

create or replace function public.accept_invite(p_invite_id text)
returns public.sync_workspace_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_invite public.sync_workspace_invites;
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

  -- Гейт по ПЛАНУ (не по числу членств): shared доступен только на платном тарифе.
  -- get_workspace_limit(uid,'shared'): платный = 7 (>0), free = 0. Платные
  -- принимают любое число чужих инвайтов; свои владеемые ws бюджет не расходуют.
  v_limit := public.get_workspace_limit(v_uid, 'shared');

  if v_limit <= 0 then
    raise exception 'shared workspaces require a paid plan' using errcode = '22023';
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
  'RPC: приглашённый принимает pending-инвайт. Проверки: target-only, pending, не истёк, тарифный гейт по ПЛАНУ (shared доступен → get_workspace_limit(uid,''shared'')>0; free → 22023). Число собственных/принятых членств лимит НЕ ограничивает. Атомарно: invite→accepted + INSERT в sync_workspace_members. SECURITY DEFINER.';

-- GRANT/REVOKE сохранены из 0032 (CREATE OR REPLACE их не сбрасывает); повторяем
-- для явности и идемпотентности.
revoke execute on function public.accept_invite(text) from anon, public;
grant  execute on function public.accept_invite(text) to authenticated;
