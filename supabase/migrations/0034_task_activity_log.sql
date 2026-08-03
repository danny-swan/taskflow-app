-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0034_task_activity_log.sql — исторический журнал изменений задач в shared-
-- пространствах (Wave C, PR-c-03).
--
-- Техплан: docs/architecture/wave-c-plan.md §3. Роль-модель — ADR 0005 п.1
-- (owner/editor/viewer), доступ на чтение через has_workspace_role (0027).
--
-- ─── ЧТО ЭТО ДЕЛАЕТ ─────────────────────────────────────────────────────────
--   1. Таблица public.sync_task_activity_log — append-only иммутабельный лог
--      значимых изменений задач (created/status_changed/tag_added/tag_removed/
--      deadline_changed/title_changed/description_changed/deleted/restored).
--   2. RLS: SELECT — любой участник пространства (viewer<=editor<=owner);
--      INSERT — запрещён клиенту (with check(false)); UPDATE/DELETE — запрещены
--      (лог иммутабелен). Запись делает ТОЛЬКО триггерная SECURITY DEFINER
--      функция log_task_activity(), которая обходит RLS insert-deny.
--   3. Триггер trg_log_task_activity AFTER INSERT OR UPDATE ON sync_tasks —
--      логирует изменения ТОЛЬКО для kind='shared' пространств (personal —
--      пропускаются на уровне триггера).
--
-- ─── РЕШЕНИЯ ПО EDGE CASES ──────────────────────────────────────────────────
--   • FK только на workspace_id (CASCADE), НЕ на task_id: sync_tasks — soft-
--     delete таблица; жёсткий FK на task_id с CASCADE потерял бы историю при
--     удалении задачи. При удалении пространства лог уходит каскадом — это
--     правильно (данные пространства целиком).
--   • Одно событие на один UPDATE (приоритетная цепочка): deleted/restored >
--     status > deadline > title > description(comment) > tag. Массового
--     логирования каждого касания поля нет (см. wave-c-plan §3).
--   • description_changed логирует только длину (old_length/new_length), не сам
--     текст — privacy + компактность лога.
--   • auth.uid() может быть NULL (service_role/фоновые джобы) → coalesce к нулевому
--     UUID. Для клиентских операций auth.uid() всегда присутствует.
--
-- Схема sync_tasks (0002 + 0027): поле описания называется `comment` (не
-- `description`); тег — единичное поле `tag_id text` (не join-таблица), поэтому
-- tag_added/tag_removed вычисляются в основной цепочке по смене tag_id.
--
-- Идемпотентна: CREATE ... IF NOT EXISTS, DROP POLICY/TRIGGER IF EXISTS,
-- CREATE OR REPLACE FUNCTION. Совместима с vanilla Postgres 15 (CI). На прод НЕ
-- применяется до решения релизить эпик «Пространства».
-- ============================================================================
set local client_min_messages = warning;

-- ============================================================================
-- 1. Таблица sync_task_activity_log (append-only)
-- ============================================================================
create table if not exists public.sync_task_activity_log (
  id            uuid primary key default gen_random_uuid(),
  task_id       text not null,                              -- ссылка на sync_tasks.id (без FK, soft-delete совместимость)
  workspace_id  text not null,
  user_id       uuid not null,                              -- кто совершил действие (0-uuid если auth.uid() NULL)
  kind          text not null,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  constraint sync_task_activity_log_workspace_fk foreign key (workspace_id)
    references public.sync_workspaces(id) on delete cascade,
  constraint sync_task_activity_log_kind_check check (kind in (
    'created','status_changed','tag_added','tag_removed','deadline_changed',
    'title_changed','description_changed','deleted','restored'
  ))
);

comment on table public.sync_task_activity_log is
  'Иммутабельный append-only журнал значимых изменений задач в shared-пространствах. Пишется только триггером log_task_activity(); клиент — read-only.';

create index if not exists sync_task_activity_log_task_id_idx
  on public.sync_task_activity_log(task_id, created_at desc);
create index if not exists sync_task_activity_log_workspace_id_idx
  on public.sync_task_activity_log(workspace_id, created_at desc);

-- ============================================================================
-- 2. RLS — SELECT участникам, запись запрещена клиенту
-- ============================================================================
alter table public.sync_task_activity_log enable row level security;

drop policy if exists "sync_task_activity_log_select"        on public.sync_task_activity_log;
drop policy if exists "sync_task_activity_log_insert_denied" on public.sync_task_activity_log;
drop policy if exists "sync_task_activity_log_update_denied" on public.sync_task_activity_log;
drop policy if exists "sync_task_activity_log_delete_denied" on public.sync_task_activity_log;

-- SELECT: любой участник пространства (viewer/editor/owner — read-only лог).
create policy "sync_task_activity_log_select" on public.sync_task_activity_log
  for select using (public.has_workspace_role(workspace_id, (select auth.uid()), 'viewer'));

-- INSERT: напрямую от клиента запрещён. Пишет только SECURITY DEFINER триггер,
-- обходящий RLS (владелец функции — суперпользователь миграций).
create policy "sync_task_activity_log_insert_denied" on public.sync_task_activity_log
  for insert with check (false);

-- UPDATE/DELETE: полностью запрещены — лог иммутабелен.
create policy "sync_task_activity_log_update_denied" on public.sync_task_activity_log
  for update using (false);
create policy "sync_task_activity_log_delete_denied" on public.sync_task_activity_log
  for delete using (false);

comment on policy "sync_task_activity_log_select" on public.sync_task_activity_log is
  'SELECT: любой участник пространства (viewer/editor/owner) читает историю.';
comment on policy "sync_task_activity_log_insert_denied" on public.sync_task_activity_log is
  'INSERT напрямую запрещён (with check false); пишет только триггер log_task_activity() через SECURITY DEFINER.';
comment on policy "sync_task_activity_log_update_denied" on public.sync_task_activity_log is
  'UPDATE запрещён — журнал иммутабелен.';
comment on policy "sync_task_activity_log_delete_denied" on public.sync_task_activity_log is
  'DELETE запрещён — журнал иммутабелен (чистка только через CASCADE при удалении пространства).';

-- ============================================================================
-- 3. GRANTs (per-row через RLS; service_role для фоновых джоб/чистки)
-- ============================================================================
grant select, insert, update, delete on table public.sync_task_activity_log to authenticated;
grant all on table public.sync_task_activity_log to service_role;

-- ============================================================================
-- 4. Триггерная функция log_task_activity() + триггер на sync_tasks
-- ============================================================================
-- SECURITY DEFINER: владелец функции (суперпользователь миграций) обходит RLS
-- insert-deny, поэтому запись в лог проходит, а прямой клиентский INSERT — нет.
-- auth.uid() внутри читается из request.jwt.claim.sub (session-level) — это
-- по-прежнему uid вызывающего клиента.
create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  _kind           text;
  _payload        jsonb := '{}'::jsonb;
  _workspace_id   text  := coalesce(new.workspace_id, old.workspace_id);
  _workspace_kind text;
begin
  -- Логируем только для shared-пространств.
  select kind into _workspace_kind
    from public.sync_workspaces
   where id = _workspace_id;
  if _workspace_kind is null or _workspace_kind <> 'shared' then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    -- Задача, созданная уже удалённой (import/sync), не считается «created».
    if new.deleted_at is not null then
      return new;
    end if;
    _kind := 'created';
    _payload := jsonb_build_object('title', new.title);
  elsif tg_op = 'UPDATE' then
    -- Приоритетная цепочка: одно значимое событие на один UPDATE.
    if old.deleted_at is null and new.deleted_at is not null then
      _kind := 'deleted';
    elsif old.deleted_at is not null and new.deleted_at is null then
      _kind := 'restored';
    elsif old.status_id is distinct from new.status_id then
      _kind := 'status_changed';
      _payload := jsonb_build_object('old', old.status_id, 'new', new.status_id);
    elsif old.deadline is distinct from new.deadline then
      _kind := 'deadline_changed';
      _payload := jsonb_build_object('old', old.deadline, 'new', new.deadline);
    elsif old.tag_id is distinct from new.tag_id then
      if new.tag_id is not null then
        _kind := 'tag_added';
        _payload := jsonb_build_object('old', old.tag_id, 'new', new.tag_id);
      else
        _kind := 'tag_removed';
        _payload := jsonb_build_object('old', old.tag_id);
      end if;
    elsif old.title is distinct from new.title then
      _kind := 'title_changed';
      _payload := jsonb_build_object('old', old.title, 'new', new.title);
    elsif old.comment is distinct from new.comment then
      _kind := 'description_changed';
      -- Не логируем сам текст (privacy + компактность) — только длины.
      _payload := jsonb_build_object(
        'old_length', length(coalesce(old.comment, '')),
        'new_length', length(coalesce(new.comment, ''))
      );
    else
      -- Нет значимых изменений (например, только updated_at/version/sort_order).
      return new;
    end if;
  else
    return coalesce(new, old);
  end if;

  insert into public.sync_task_activity_log (task_id, workspace_id, user_id, kind, payload)
  values (
    coalesce(new.id, old.id),
    _workspace_id,
    coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
    _kind,
    _payload
  );

  return coalesce(new, old);
end;
$$;

comment on function public.log_task_activity() is
  'Триггерная SECURITY DEFINER функция: пишет значимые изменения sync_tasks в sync_task_activity_log ТОЛЬКО для shared-пространств. Одно событие на UPDATE (приоритетная цепочка).';

drop trigger if exists trg_log_task_activity on public.sync_tasks;
create trigger trg_log_task_activity
  after insert or update on public.sync_tasks
  for each row execute function public.log_task_activity();

-- ============================================================================
-- 5. Realtime — добавляем в publication supabase_realtime
-- ============================================================================
-- Идемпотентно: проглатываем duplicate_object (как в 0025/0027).
do $$
begin
  begin
    alter publication supabase_realtime add table public.sync_task_activity_log;
  exception
    when duplicate_object then null; -- уже добавлена
    when others then raise;
  end;
end $$;
