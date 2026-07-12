-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0028_workspace_management.sql — управление пространствами (Wave A, PR-4).
--
-- Дополняет фундамент 0027 серверным слоем для CRUD пространств и участников:
--   1) RPC public.find_user_by_public_id(text) — поиск пользователя по
--      публичному TF-XXXXXX для приглашения в пространство (минимальный
--      публичный профиль, без email/приватных полей).
--   2) Триггер assert_at_least_one_owner — не даёт удалить/понизить последнего
--      owner'a пространства (BEFORE UPDATE OR DELETE на sync_workspace_members).
--   3) RLS: не-owner может «выйти» из пространства (soft-delete/DELETE своей
--      строки членства). Owner-политики добавления/смены роли уже есть в 0027.
--   4) Триггер block_personal_workspace_delete — личное пространство нельзя
--      soft-удалить (UPDATE deleted_at) или удалить (DELETE).
--
-- Идемпотентна: create or replace / drop ... if exists / drop policy if exists.
-- На прод НЕ применяется до решения релизить Wave A (как и 0027).
-- ============================================================================

-- ============================================================================
-- 1. RPC find_user_by_public_id — поиск по публичному TF-XXXXXX
-- ============================================================================
-- SECURITY DEFINER: читает public.profiles минуя RLS (own-row), но возвращает
-- СТРОГО публичный минимум: id / nickname / avatar_variant. Никакого email,
-- bio, created_at. Требует, чтобы вызывающий сам был аутентифицирован
-- (auth.uid() IS NOT NULL) — anon отсекается и грантом, и явной проверкой.
create or replace function public.find_user_by_public_id(p_pid text)
returns table (id uuid, nickname text, avatar_variant int)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p.id, p.nickname, p.avatar_variant::int
  from public.profiles p
  where (select auth.uid()) is not null
    and p.public_user_id = upper(btrim(p_pid))
  limit 1;
$$;

comment on function public.find_user_by_public_id(text) is
  'Поиск пользователя по публичному TF-XXXXXX для приглашения в пространство. '
  'SECURITY DEFINER, возвращает только публичный минимум (id/nickname/avatar_variant), '
  'требует аутентификации вызывающего. EXECUTE только authenticated.';

revoke execute on function public.find_user_by_public_id(text) from anon, public;
grant  execute on function public.find_user_by_public_id(text) to authenticated;

-- ============================================================================
-- 2. Триггер assert_at_least_one_owner
-- ============================================================================
-- Гарантирует, что у пространства всегда остаётся ≥ 1 живой (deleted_at IS NULL)
-- owner. Срабатывает на:
--   • DELETE строки членства owner'a;
--   • UPDATE, который soft-удаляет owner'a (deleted_at) ИЛИ понижает его роль.
-- Логика: считаем, сколько живых owner'ов останется в ws ПОСЛЕ операции
-- (исключая изменяемую строку), и если операция сама оставляет строку owner'ом
-- и живой — прибавляем её. Итог 0 → RAISE.
create or replace function public.assert_at_least_one_owner()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  ws        text := coalesce(old.workspace_id, new.workspace_id);
  remaining int;
begin
  -- Живые owner'ы в этом ws, кроме изменяемой/удаляемой строки.
  select count(*) into remaining
  from public.sync_workspace_members m
  where m.workspace_id = ws
    and m.role = 'owner'
    and m.deleted_at is null
    and m.id <> old.id;

  -- На UPDATE учитываем, остаётся ли сама строка живым owner'ом.
  if tg_op = 'UPDATE'
     and new.role = 'owner'
     and new.deleted_at is null then
    remaining := remaining + 1;
  end if;

  if remaining = 0 then
    raise exception 'Нельзя удалить или понизить последнего owner''a пространства %', ws
      using errcode = 'check_violation';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.assert_at_least_one_owner() is
  'Guard: не даёт удалить/понизить последнего живого owner''a пространства '
  '(BEFORE UPDATE OR DELETE на sync_workspace_members).';

drop trigger if exists assert_at_least_one_owner on public.sync_workspace_members;
create trigger assert_at_least_one_owner
  before update or delete on public.sync_workspace_members
  for each row execute function public.assert_at_least_one_owner();

revoke execute on function public.assert_at_least_one_owner() from anon, authenticated, public;

-- ============================================================================
-- 3. RLS: «выход» участника (leave) — не-owner может удалить свою строку
-- ============================================================================
-- В 0027 членством управляет только owner (insert/update/delete → has role owner).
-- Здесь добавляем возможность НЕ-owner'у покинуть пространство самому:
--   • soft-delete (UPDATE deleted_at своей строки) — основной путь (sync);
--   • hard DELETE своей строки — на всякий.
-- WITH CHECK на self-leave UPDATE запрещает менять что-либо, кроме проставления
-- deleted_at (роль не тронуть — защита от само-эскалации). Owner выйти так не
-- может (role='owner' исключён) — для него работает assert_at_least_one_owner.
drop policy if exists "sync_workspace_members_self_leave_update" on public.sync_workspace_members;
create policy "sync_workspace_members_self_leave_update" on public.sync_workspace_members
  for update
  using (
    user_id = (select auth.uid())
    and role <> 'owner'
  )
  with check (
    user_id = (select auth.uid())
    and role <> 'owner'
    and deleted_at is not null
  );

drop policy if exists "sync_workspace_members_self_leave_delete" on public.sync_workspace_members;
create policy "sync_workspace_members_self_leave_delete" on public.sync_workspace_members
  for delete
  using (
    user_id = (select auth.uid())
    and role <> 'owner'
  );

-- ============================================================================
-- 4. Триггер block_personal_workspace_delete — личное пространство неудаляемо
-- ============================================================================
-- Personal-ws — единственный гарантированный дом задач пользователя, его нельзя
-- ни soft-удалить (UPDATE deleted_at), ни удалить (DELETE). RLS в 0027 уже
-- ограничивает изменение owner'ом; этот триггер добавляет запрет по kind.
create or replace function public.block_personal_workspace_delete()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  -- Пропускаем системные каскады (удаление auth.users тянет за собой ws
  -- через owner_id FK) и вызовы service_role/pgTAP-сетапов, где auth.uid() = NULL.
  -- Гейт предназначен только для явных пользовательских операций с личным ws.
  if (select auth.uid()) is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' and old.kind = 'personal' then
    raise exception 'Личное пространство нельзя удалить.'
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE'
     and old.kind = 'personal'
     and new.deleted_at is not null
     and old.deleted_at is null then
    raise exception 'Личное пространство нельзя удалить.'
      using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

comment on function public.block_personal_workspace_delete() is
  'Guard: запрещает soft-delete (UPDATE deleted_at) и DELETE личного пространства (kind=personal). '
  'Не вмешивается в системные каскады (auth.uid() IS NULL): удаление аккаунта auth.users через owner_id FK → ON DELETE CASCADE сносит personal-ws корректно.';

drop trigger if exists block_personal_workspace_delete on public.sync_workspaces;
create trigger block_personal_workspace_delete
  before update or delete on public.sync_workspaces
  for each row execute function public.block_personal_workspace_delete();

revoke execute on function public.block_personal_workspace_delete() from anon, authenticated, public;
