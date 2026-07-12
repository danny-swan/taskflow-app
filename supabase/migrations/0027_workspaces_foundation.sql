-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0027_workspaces_foundation.sql — фундамент направления «Пространства» (Wave A).
--
-- Техплан: docs/architecture/workspaces-plan.md (§2, §3.1). Здесь — только слой
-- данных: новые таблицы, колонка workspace_id в шести существующих sync-таблицах,
-- backfill personal-пространств, функция доступа has_workspace_role и RLS,
-- выраженная через членство. Клиентский sync-код (мапперы/pull/push/realtime-
-- фильтр) и UI — следующие PR (feat/ws-a-02..06). На прод НЕ применяется до
-- решения релизить Wave A — до этого гоняется только на локальном pgTAP.
--
-- ─── ДЕТЕРМИНИРОВАННЫЙ ID PERSONAL-ПРОСТРАНСТВА (КРИТИЧНО) ───────────────────
-- id = 'ws_' || replace(user_id::text, '-', '')
--   • пример: user_id 41111111-1111-1111-1111-111111111111
--             → ws_41111111111111111111111111111111
--   • schema без uuidv5 (в vanilla PG нет uuid_generate_v5 без расширения),
--     зато тривиально воспроизводима на клиенте (migrations.ts v11):
--         'ws_' + userId.toLowerCase().replace(/-/g, '')
--   • это позволяет серверному backfill'у и клиентской v11 сгенерировать
--     ИДЕНТИЧНЫЙ id personal-пространства → при первом sync строки склеятся
--     по PK, без дублей (см. риск «Разъезд id personal-ws» в плане §4).
-- Схема зафиксирована также в workspaces-plan.md.
--
-- Wave A: разрешён только kind='personal' (триггер block_shared_workspaces).
-- kind='shared' и тарифные лимиты (Free 2 / Pro 7) — PR feat/ws-a-05-limits.
--
-- Идемпотентна: CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / DO-блоки /
-- DROP POLICY IF EXISTS / ON CONFLICT DO NOTHING / WHERE workspace_id IS NULL.
-- ============================================================================

-- ============================================================================
-- 1. Новые таблицы
-- ============================================================================

-- 1.1 Пространство. В Wave A owner_id == user_id (личное пространство юзера).
create table if not exists public.sync_workspaces (
  id          text primary key,                                            -- uuid/детерминированный ws_<uid>
  user_id     uuid not null references auth.users(id) on delete cascade,   -- владелец в Wave A
  owner_id    uuid not null references auth.users(id) on delete cascade,   -- явный owner (== user_id в Wave A)
  name        text not null,
  kind        text not null default 'personal'
                check (kind in ('personal', 'shared')),                    -- Wave A: только 'personal' (триггер)
  sort_order  int  not null default 0,
  -- sync-метаданные (контракт как у остальных sync_* таблиц)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  version     integer not null default 1,
  client_id   text references public.sync_devices(id) on delete set null
);

comment on table public.sync_workspaces is
  'Пространства (workspaces). Wave A: только personal (kind=shared блокируется триггером).';

-- 1.2 Членство. В Wave A у personal ровно одна строка — сам owner.
create table if not exists public.sync_workspace_members (
  id            text primary key,                                          -- uuid
  workspace_id  text not null,                                             -- ссылка на sync_workspaces.id (без FK, как принято)
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null default 'owner'
                  check (role in ('owner', 'editor', 'viewer')),
  invited_by    uuid,
  joined_at     timestamptz not null default now(),
  -- sync-метаданные
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  version       integer not null default 1,
  client_id     text references public.sync_devices(id) on delete set null,
  unique (workspace_id, user_id)
);

comment on table public.sync_workspace_members is
  'Членство в пространстве. role owner/editor/viewer. Wave A: только owner.';

-- 1.3 Настройки пространства (key/value). Первый ключ — overdue_mode.
create table if not exists public.sync_workspace_settings (
  workspace_id  text not null,
  key           text not null,
  value         text,
  -- sync-метаданные
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  version       integer not null default 1,
  client_id     text references public.sync_devices(id) on delete set null,
  primary key (workspace_id, key)
);

comment on table public.sync_workspace_settings is
  'Настройки пространства (per-workspace key/value). Первый ключ — overdue_mode.';

-- ============================================================================
-- 2. workspace_id в существующих sync-таблицах (сначала NULLABLE)
-- ============================================================================
-- Порядок NULL → backfill (§5) → SET NOT NULL (§6), по образцу 0026 public_user_id.
do $$
declare
  t text;
begin
  foreach t in array array[
    'sync_tasks',
    'sync_statuses',
    'sync_tags',
    'sync_task_templates',
    'sync_overdue_events',
    'sync_task_hold_periods'
  ]
  loop
    execute format('alter table public.%I add column if not exists workspace_id text', t);
  end loop;
end $$;

-- ============================================================================
-- 3. Функции доступа (SECURITY DEFINER — обходят RLS при чтении членства)
-- ============================================================================

-- 3.1 has_workspace_role — есть ли у uid в пространстве ws роль >= min_role.
create or replace function public.has_workspace_role(ws text, uid uuid, min_role text)
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.sync_workspace_members m
    where m.workspace_id = ws and m.user_id = uid and m.deleted_at is null
      and case min_role
            when 'viewer' then true
            when 'editor' then m.role in ('owner', 'editor')
            when 'owner'  then m.role = 'owner'
          end
  );
$$;

comment on function public.has_workspace_role(text, uuid, text) is
  'RLS-хелпер: есть ли у uid роль >= min_role (viewer<editor<owner) в пространстве ws. SECURITY DEFINER: читает членство минуя RLS.';

-- 3.2 owns_workspace — является ли uid owner'ом самого пространства.
-- Нужна ТОЛЬКО для bootstrap-INSERT первой строки членства: has_workspace_role
-- в этот момент ещё вернёт false (членства нет), а проверить владение мы обязаны
-- минуя RLS на sync_workspaces (иначе не увидим строку без членства). Порядок
-- push'а (workspaces → members) гарантирует, что ws-строка уже существует.
create or replace function public.owns_workspace(ws text, uid uuid)
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.sync_workspaces w
    where w.id = ws and w.owner_id = uid and w.deleted_at is null
  );
$$;

comment on function public.owns_workspace(text, uuid) is
  'RLS-хелпер для bootstrap: является ли uid owner_id пространства ws (минуя RLS).';

-- EXECUTE закрыт для anon/public (нет прямого REST-RPC). authenticated ОБЯЗАН
-- иметь EXECUTE: функции вызываются внутри RLS-политик под ролью вызывающего,
-- иначе оценка политики упадёт с permission denied. Прямое RPC-разоблачение
-- некритично: обе функции лишь возвращают boolean по членству/владению.
revoke execute on function public.has_workspace_role(text, uuid, text) from anon, public;
revoke execute on function public.owns_workspace(text, uuid)           from anon, public;
grant  execute on function public.has_workspace_role(text, uuid, text) to authenticated;
grant  execute on function public.owns_workspace(text, uuid)           to authenticated;

-- ============================================================================
-- 4. Wave A: запрет kind='shared' (триггер-заглушка до PR feat/ws-a-05-limits)
-- ============================================================================
-- Shared-пространства и тарифные лимиты (Free 2 личных / Pro 7 суммарно) — Wave A
-- PR-5. Пока жёстко запрещаем создавать/переводить пространство в shared.
create or replace function public.block_shared_workspaces()
returns trigger language plpgsql
set search_path = public, pg_catalog as $$
begin
  if new.kind = 'shared' then
    raise exception 'Общие пространства (kind=shared) появятся в Pro (Wave A PR-5). Сейчас доступны только личные.'
      using errcode = 'check_violation';
  end if;
  -- TODO(feat/ws-a-05-limits): здесь же проверять тарифный лимит на кол-во
  -- активных пространств (Free: 2 personal, Pro/trial: 7 суммарно).
  return new;
end;
$$;

comment on function public.block_shared_workspaces() is
  'Wave A guard: запрещает kind=shared. Заглушка для будущих тарифных лимитов (PR-5).';

drop trigger if exists block_shared_workspaces on public.sync_workspaces;
create trigger block_shared_workspaces
  before insert or update on public.sync_workspaces
  for each row execute function public.block_shared_workspaces();

revoke execute on function public.block_shared_workspaces() from anon, authenticated, public;

-- ============================================================================
-- 5. BACKFILL — по одному personal-пространству каждому существующему юзеру
-- ============================================================================
-- Оформлен как идемпотентная функция (а не голый DO-блок), чтобы:
--   • миграцию можно было безопасно применить повторно;
--   • pgTAP (09) мог вызвать backfill на «легаси»-юзере и проверить результат.
-- Юзер = у кого есть строки в любой sync-таблице ИЛИ профиль. Идемпотентность:
-- ON CONFLICT DO NOTHING (по PK / UNIQUE), UPDATE ... WHERE workspace_id IS NULL.
create or replace function public.backfill_personal_workspaces()
returns void language plpgsql
security definer
set search_path = public, pg_catalog as $$
declare
  u  uuid;
  ws text;
  t  text;
begin
  for u in
    select distinct uid from (
      select user_id as uid from public.sync_tasks
      union select user_id from public.sync_statuses
      union select user_id from public.sync_tags
      union select user_id from public.sync_task_templates
      union select user_id from public.sync_overdue_events
      union select user_id from public.sync_task_hold_periods
      union select user_id from public.sync_devices
      union select id      from public.profiles
    ) s
    where uid is not null
  loop
    -- Детерминированный id personal-пространства (см. шапку файла).
    ws := 'ws_' || replace(u::text, '-', '');

    insert into public.sync_workspaces (id, user_id, owner_id, name, kind, sort_order)
      values (ws, u, u, 'Мои задачи', 'personal', 0)
      on conflict (id) do nothing;

    -- Членство owner (id — детерминированный, чтобы повторный backfill не дублировал).
    insert into public.sync_workspace_members (id, workspace_id, user_id, role)
      values ('wsm_' || replace(u::text, '-', ''), ws, u, 'owner')
      on conflict (workspace_id, user_id) do nothing;

    -- Проставляем workspace_id всем строкам юзера в шести таблицах.
    foreach t in array array[
      'sync_tasks',
      'sync_statuses',
      'sync_tags',
      'sync_task_templates',
      'sync_overdue_events',
      'sync_task_hold_periods'
    ]
    loop
      execute format(
        'update public.%I set workspace_id = %L where user_id = %L and workspace_id is null',
        t, ws, u
      );
    end loop;
  end loop;
end;
$$;

comment on function public.backfill_personal_workspaces() is
  'Идемпотентный backfill: каждому существующему юзеру — personal-пространство ws_<uid>, owner-членство и workspace_id во всех sync-строках.';

revoke execute on function public.backfill_personal_workspaces() from anon, authenticated, public;

-- Применяем однократно в рамках миграции.
select public.backfill_personal_workspaces();

-- overdue_mode на сервере не заполняем: значение живёт на клиенте, его перенесёт
-- клиентская миграция v11 в sync_workspace_settings(personal, 'overdue_mode', …).

-- ============================================================================
-- 6. SET NOT NULL на workspace_id — только ПОСЛЕ backfill'а
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'sync_tasks',
    'sync_statuses',
    'sync_tags',
    'sync_task_templates',
    'sync_overdue_events',
    'sync_task_hold_periods'
  ]
  loop
    execute format('alter table public.%I alter column workspace_id set not null', t);
  end loop;
end $$;

-- ============================================================================
-- 7. RLS
-- ============================================================================
-- Включаем на трёх новых таблицах.
alter table public.sync_workspaces          enable row level security;
alter table public.sync_workspace_members   enable row level security;
alter table public.sync_workspace_settings  enable row level security;

-- ─── 7.1 Шесть существующих таблиц: доступ через членство ───────────────────
-- Роняем старые own-row политики (0002/0004) и выражаем доступ через
-- has_workspace_role. В Wave A каждый юзер — owner своего personal, поэтому
-- поведение эквивалентно старому user_id = auth.uid() (изоляция не ослаблена).
--   • tasks/tags/task_templates/overdue_events/task_hold_periods:
--         SELECT → viewer, INSERT/UPDATE/DELETE → editor
--   • statuses: SELECT → viewer, INSERT/UPDATE/DELETE → owner (критичная настройка)
do $$
declare
  t text;
  write_role text;
begin
  foreach t in array array[
    'sync_tasks',
    'sync_statuses',
    'sync_tags',
    'sync_task_templates',
    'sync_overdue_events',
    'sync_task_hold_periods'
  ]
  loop
    write_role := case when t = 'sync_statuses' then 'owner' else 'editor' end;

    -- Старые own-row политики (0002/0004).
    execute format('drop policy if exists "%s_select_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_insert_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_update_own" on public.%I', t, t);
    execute format('drop policy if exists "%s_delete_own" on public.%I', t, t);
    -- Новые ws-политики (для идемпотентности повторного применения).
    execute format('drop policy if exists "%s_ws_select" on public.%I', t, t);
    execute format('drop policy if exists "%s_ws_insert" on public.%I', t, t);
    execute format('drop policy if exists "%s_ws_update" on public.%I', t, t);
    execute format('drop policy if exists "%s_ws_delete" on public.%I', t, t);

    execute format(
      'create policy "%s_ws_select" on public.%I for select ' ||
      'using (public.has_workspace_role(workspace_id, (select auth.uid()), %L))',
      t, t, 'viewer'
    );
    execute format(
      'create policy "%s_ws_insert" on public.%I for insert ' ||
      'with check (public.has_workspace_role(workspace_id, (select auth.uid()), %L))',
      t, t, write_role
    );
    execute format(
      'create policy "%s_ws_update" on public.%I for update ' ||
      'using (public.has_workspace_role(workspace_id, (select auth.uid()), %L)) ' ||
      'with check (public.has_workspace_role(workspace_id, (select auth.uid()), %L))',
      t, t, write_role, write_role
    );
    execute format(
      'create policy "%s_ws_delete" on public.%I for delete ' ||
      'using (public.has_workspace_role(workspace_id, (select auth.uid()), %L))',
      t, t, write_role
    );
  end loop;
end $$;

-- ─── 7.2 sync_workspaces: SELECT членам, изменения — owner'у ────────────────
drop policy if exists "sync_workspaces_ws_select" on public.sync_workspaces;
create policy "sync_workspaces_ws_select" on public.sync_workspaces
  for select using (public.has_workspace_role(id, (select auth.uid()), 'viewer'));

-- INSERT: создать можно только СВОЁ пространство (owner_id == user_id == auth.uid()).
-- Через has_workspace_role нельзя — членства ещё нет (bootstrap).
drop policy if exists "sync_workspaces_ws_insert" on public.sync_workspaces;
create policy "sync_workspaces_ws_insert" on public.sync_workspaces
  for insert with check (
    owner_id = (select auth.uid()) and user_id = (select auth.uid())
  );

drop policy if exists "sync_workspaces_ws_update" on public.sync_workspaces;
create policy "sync_workspaces_ws_update" on public.sync_workspaces
  for update using (public.has_workspace_role(id, (select auth.uid()), 'owner'))
  with check (public.has_workspace_role(id, (select auth.uid()), 'owner'));

drop policy if exists "sync_workspaces_ws_delete" on public.sync_workspaces;
create policy "sync_workspaces_ws_delete" on public.sync_workspaces
  for delete using (public.has_workspace_role(id, (select auth.uid()), 'owner'));

-- ─── 7.3 sync_workspace_members: SELECT членам, изменения — owner'у ─────────
drop policy if exists "sync_workspace_members_ws_select" on public.sync_workspace_members;
create policy "sync_workspace_members_ws_select" on public.sync_workspace_members
  for select using (public.has_workspace_role(workspace_id, (select auth.uid()), 'viewer'));

-- INSERT: либо уже owner (приглашение участников — Wave B), либо bootstrap
-- собственной owner-строки в только что созданном своём пространстве.
drop policy if exists "sync_workspace_members_ws_insert" on public.sync_workspace_members;
create policy "sync_workspace_members_ws_insert" on public.sync_workspace_members
  for insert with check (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'owner')
    or (
      user_id = (select auth.uid())
      and role = 'owner'
      and public.owns_workspace(workspace_id, (select auth.uid()))
    )
  );

drop policy if exists "sync_workspace_members_ws_update" on public.sync_workspace_members;
create policy "sync_workspace_members_ws_update" on public.sync_workspace_members
  for update using (public.has_workspace_role(workspace_id, (select auth.uid()), 'owner'))
  with check (public.has_workspace_role(workspace_id, (select auth.uid()), 'owner'));

drop policy if exists "sync_workspace_members_ws_delete" on public.sync_workspace_members;
create policy "sync_workspace_members_ws_delete" on public.sync_workspace_members
  for delete using (public.has_workspace_role(workspace_id, (select auth.uid()), 'owner'));

-- ─── 7.4 sync_workspace_settings: SELECT членам, изменения — owner'у ────────
drop policy if exists "sync_workspace_settings_ws_select" on public.sync_workspace_settings;
create policy "sync_workspace_settings_ws_select" on public.sync_workspace_settings
  for select using (public.has_workspace_role(workspace_id, (select auth.uid()), 'viewer'));

drop policy if exists "sync_workspace_settings_ws_insert" on public.sync_workspace_settings;
create policy "sync_workspace_settings_ws_insert" on public.sync_workspace_settings
  for insert with check (public.has_workspace_role(workspace_id, (select auth.uid()), 'owner'));

drop policy if exists "sync_workspace_settings_ws_update" on public.sync_workspace_settings;
create policy "sync_workspace_settings_ws_update" on public.sync_workspace_settings
  for update using (public.has_workspace_role(workspace_id, (select auth.uid()), 'owner'))
  with check (public.has_workspace_role(workspace_id, (select auth.uid()), 'owner'));

drop policy if exists "sync_workspace_settings_ws_delete" on public.sync_workspace_settings;
create policy "sync_workspace_settings_ws_delete" on public.sync_workspace_settings
  for delete using (public.has_workspace_role(workspace_id, (select auth.uid()), 'owner'));

-- ============================================================================
-- 8. GRANTs на три новые таблицы (per-row через RLS + service_role для jobs)
-- ============================================================================
grant select, insert, update, delete on table public.sync_workspaces         to authenticated;
grant select, insert, update, delete on table public.sync_workspace_members  to authenticated;
grant select, insert, update, delete on table public.sync_workspace_settings to authenticated;
grant all on table public.sync_workspaces         to service_role;
grant all on table public.sync_workspace_members  to service_role;
grant all on table public.sync_workspace_settings to service_role;

-- ============================================================================
-- 9. Индексы
-- ============================================================================
-- 9.1 workspace_id в шести таблицах (частичный по живым строкам).
create index if not exists sync_tasks_workspace_idx
  on public.sync_tasks(workspace_id) where deleted_at is null;
create index if not exists sync_statuses_workspace_idx
  on public.sync_statuses(workspace_id) where deleted_at is null;
create index if not exists sync_tags_workspace_idx
  on public.sync_tags(workspace_id) where deleted_at is null;
create index if not exists sync_task_templates_workspace_idx
  on public.sync_task_templates(workspace_id) where deleted_at is null;
create index if not exists sync_overdue_events_workspace_idx
  on public.sync_overdue_events(workspace_id) where deleted_at is null;
create index if not exists sync_task_hold_periods_workspace_idx
  on public.sync_task_hold_periods(workspace_id) where deleted_at is null;

-- 9.2 Новые таблицы.
create index if not exists sync_workspaces_user_idx
  on public.sync_workspaces(user_id) where deleted_at is null;
create index if not exists sync_workspaces_owner_idx
  on public.sync_workspaces(owner_id) where deleted_at is null;
create index if not exists sync_workspaces_updated_idx
  on public.sync_workspaces(user_id, updated_at desc);
create index if not exists sync_workspaces_client_id_idx
  on public.sync_workspaces(client_id);

create index if not exists sync_workspace_members_workspace_idx
  on public.sync_workspace_members(workspace_id) where deleted_at is null;
create index if not exists sync_workspace_members_user_idx
  on public.sync_workspace_members(user_id) where deleted_at is null;
create index if not exists sync_workspace_members_client_id_idx
  on public.sync_workspace_members(client_id);

create index if not exists sync_workspace_settings_workspace_idx
  on public.sync_workspace_settings(workspace_id) where deleted_at is null;
create index if not exists sync_workspace_settings_client_id_idx
  on public.sync_workspace_settings(client_id);

-- ============================================================================
-- 10. Триггеры updated_at + version bump на трёх новых таблицах
-- ============================================================================
-- Переиспользуем sync_bump_version() (0002) и set_updated_at() (0005), как в 0025.
do $$
declare
  t text;
begin
  foreach t in array array[
    'sync_workspaces',
    'sync_workspace_members',
    'sync_workspace_settings'
  ]
  loop
    execute format('drop trigger if exists %I_bump_version on public.%I', t, t);
    execute format(
      'create trigger %I_bump_version before update on public.%I ' ||
      'for each row execute function public.sync_bump_version()',
      t, t
    );
    execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
    execute format(
      'create trigger trg_set_updated_at before update on public.%I ' ||
      'for each row execute function public.set_updated_at()',
      t
    );
  end loop;
end $$;

-- ============================================================================
-- 11. Realtime — три новые таблицы в publication supabase_realtime
-- ============================================================================
-- Идемпотентно: проглатываем duplicate_object (как в 0025).
do $$
declare
  t text;
begin
  foreach t in array array[
    'sync_workspaces',
    'sync_workspace_members',
    'sync_workspace_settings'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null; -- уже добавлена
      when others then raise;
    end;
  end loop;
end $$;
