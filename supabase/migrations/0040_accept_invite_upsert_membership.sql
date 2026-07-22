-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0040_accept_invite_upsert_membership.sql — переопределение public.accept_invite:
-- реактивация soft-deleted строки членства при повторном приёме инвайта.
--
-- ─── ПРОБЛЕМА (в 0032/0038) ─────────────────────────────────────────────────
-- accept_invite делала голый INSERT в sync_workspace_members:
--     insert into sync_workspace_members (id, workspace_id, user_id, role, invited_by)
--     values ('wsm_' || …, v_invite.workspace_id, v_uid, v_invite.role, …)
-- Уникальный индекс `sync_workspace_members_workspace_id_user_id_key` НЕ различает
-- soft-deleted и живые строки: он бьёт по (workspace_id, user_id) независимо от
-- deleted_at. После F14 (feat/workspaces, ADR 0008) выход из пространства работает
-- корректно — оставляет строку членства с deleted_at IS NOT NULL. При повторном
-- приёме инвайта в тот же ws INSERT падал с sqlstate 23505 (`duplicate key value
-- violates unique constraint`) → клиент видел HTTP 409 Conflict и сообщение
-- «Не удалось выполнить действие. Попробуйте позже.».
--
-- Баг существовал изначально (0032), но проявился ТОЛЬКО после F14: пока leave не
-- работал, пользователь физически не мог выйти → повторных инвайтов в тот же ws
-- никто не отправлял. F14 не создал этот баг — он раскрыл существующий.
--
-- Прод-подтверждение (2026-07-22): у fc592c97 в ws_019f85c8… soft-deleted строка
-- wsm_13afdb1b… (deleted_at=2026-07-22 11:53:28, version=2). Попытка принять
-- pending-инвайт inv_6b84eb6b… падала с 23505 (postgres-логи + скриншот клиента).
--
-- ─── РЕШЕНИЕ ────────────────────────────────────────────────────────────────
-- INSERT ... ON CONFLICT (workspace_id, user_id) DO UPDATE: реактивируем
-- существующую строку. Что делаем при конфликте:
--   • deleted_at → NULL (реактивация);
--   • role → EXCLUDED.role (роль из НОВОГО инвайта; она могла отличаться от
--     прошлой — например, была editor, стала viewer);
--   • invited_by → EXCLUDED.invited_by (новый пригласитель);
--   • joined_at → now() (новая точка вступления; логично для UI/аналитики);
--   • updated_at → now();
--   • version → COALESCE(version, 0) + 1 (LWW: клиент увидит апдейт).
-- id (uuid membership-строки) НЕ переписываем: сохраняем существующий, чтобы
-- outbox / клиентский pull matcher (по uuid, см. applyCloudRowMembers в pull.ts)
-- продолжил распознавать строку как ту же самую и корректно её обновил.
--
-- Все остальные проверки accept_invite сохранены: target-only, pending, не истёк,
-- тарифный гейт по плану (get_workspace_limit>0). SECURITY DEFINER, search_path,
-- GRANT/REVOKE — не меняются.
--
-- ─── ВЕРИФИКАЦИЯ ────────────────────────────────────────────────────────────
-- Прод-проба (ROLLBACK, 2026-07-22): подменена функция → выполнен вызов
--   public.accept_invite('inv_6b84eb6b2e834e32bed5eb7dc0b22f78')
-- под JWT fc592c97 → вернула ТУ ЖЕ строку wsm_13afdb1b…, deleted_at=null,
-- role='editor', version=2→3. Изменения откачены.
--
-- pgTAP-тест 20_accept_invite_reactivation_test.sql проверяет два сценария:
-- (F15-1) первый приём инвайта — INSERT-путь: строка создана, deleted_at=null;
-- (F15-2) leave → повторный invite → повторный accept — UPDATE-путь: та же
--         uuid membership-строки, deleted_at=null, роль/version обновлены.
--
-- Идемпотентна: CREATE OR REPLACE FUNCTION сохраняет существующие GRANT/REVOKE.
-- Совместимо с vanilla Postgres 15 (CI).
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

  -- Гейт по ПЛАНУ (не по числу членств) — сохранено из 0038.
  v_limit := public.get_workspace_limit(v_uid, 'shared');
  if v_limit <= 0 then
    raise exception 'shared workspaces require a paid plan' using errcode = '22023';
  end if;

  -- Атомарно: пометить инвайт accepted + завести/реактивировать членство.
  update public.sync_workspace_invites
    set status = 'accepted', accepted_at = now()
    where id = v_invite.id;

  -- F15: upsert по (workspace_id, user_id). Если строка живая (нет конфликта) —
  -- обычный INSERT (первый приём). Если строка есть (в т.ч. soft-deleted после
  -- leave, F14) — DO UPDATE реактивирует её. id уникальной строки НЕ переписываем,
  -- чтобы клиентский pull-matcher (по uuid) корректно её распознал.
  insert into public.sync_workspace_members
    (id, workspace_id, user_id, role, invited_by, joined_at, deleted_at, version, updated_at)
  values
    ('wsm_' || replace(gen_random_uuid()::text, '-', ''),
     v_invite.workspace_id, v_uid, v_invite.role, v_invite.inviter_user_id,
     now(), null, 1, now())
  on conflict (workspace_id, user_id) do update
     set role       = excluded.role,
         invited_by = excluded.invited_by,
         joined_at  = excluded.joined_at,
         deleted_at = null,
         updated_at = now(),
         version    = coalesce(public.sync_workspace_members.version, 0) + 1
  returning * into v_member;

  return v_member;
end;
$$;

comment on function public.accept_invite(text) is
  'RPC: приглашённый принимает pending-инвайт. Проверки: target-only, pending, не истёк, тарифный гейт по ПЛАНУ (shared доступен → get_workspace_limit(uid,''shared'')>0; free → 22023). Атомарно: invite→accepted + upsert в sync_workspace_members по (workspace_id,user_id) с реактивацией soft-deleted строки (F15). Число собственных/принятых членств лимит НЕ ограничивает. SECURITY DEFINER.';

-- GRANT/REVOKE сохранены из 0032/0038 (CREATE OR REPLACE их не сбрасывает);
-- повторяем для явности и идемпотентности.
revoke execute on function public.accept_invite(text) from anon, public;
grant  execute on function public.accept_invite(text) to authenticated;
