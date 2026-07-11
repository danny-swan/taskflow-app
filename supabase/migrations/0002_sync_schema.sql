-- TaskFlow v0.9.35-dev.1 — облачная схема для синхронизации
--
-- Зеркалирует локальные таблицы SQLite (statuses/tags/tasks/settings/
-- task_templates/overdue_events), но с обязательной привязкой к user_id и
-- sync-метаданными: UUIDv7 PK, updated_at, deleted_at (soft delete), version.
--
-- Все таблицы префиксом sync_ — чтобы избежать конфликтов с любыми будущими
-- «плоскими» таблицами и сразу подчеркнуть, что это часть sync-слоя.
--
-- Особенности:
--   * PK — text (UUIDv7), генерируется на клиенте. Это позволяет offline-first
--     клиенту создать сущность без раунд-трипа на сервер.
--   * Все FK внутри одного пользователя (user_id + local id).
--   * Soft delete везде: hard DELETE физически не выполняем через клиент,
--     только сервисный воркер спустя N дней. Иначе другой клиент не поймёт,
--     удалили ли запись или её ещё нет.
--   * `version` инкрементится триггером на каждый UPDATE — для optimistic
--     concurrency и debug.
--   * `client_id` — какой клиент сделал последнее изменение (для трейсинга).
--
-- Идемпотентна: CREATE ... IF NOT EXISTS, ALTER ... IF NOT EXISTS.
-- Не трогает existing profiles / usage_events из 0001_init.sql.

-- ============================================================================
-- 1. Extensions
-- ============================================================================
-- pgcrypto нужен для gen_random_uuid() (UUIDv4) как fallback.
-- UUIDv7 генерирует клиент, но серверные дефолты используют v4 —
-- главное, чтобы был глобально уникален; сортировка по created_at даст
-- ту же семантику, что и UUIDv7-префикс.
create extension if not exists "pgcrypto";

-- ============================================================================
-- 2. sync_devices — устройства пользователя
-- ============================================================================
-- Каждая установка приложения регистрирует себя как «устройство».
-- client_id генерируется на клиенте один раз (при первом запуске)
-- и хранится в локальном settings. Используется:
--   * для отслеживания last_seen ("на этом ПК был онлайн вчера")
--   * для трейсинга: какое устройство сделало UPDATE
--   * для «выйти на всех устройствах» (в будущем)
create table if not exists public.sync_devices (
  id           text primary key,                              -- UUIDv7 с клиента
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text,                                          -- 'DESKTOP-XYZ', 'MacBook Pro'
  platform     text,                                          -- 'windows', 'macos', 'linux', 'telegram-bot', 'web'
  app_version  text,                                          -- '0.9.35'
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

comment on table public.sync_devices is
  'Устройства пользователя (десктоп/бот/веб). client_id генерируется на клиенте.';

create index if not exists sync_devices_user_id_idx on public.sync_devices(user_id);

-- ============================================================================
-- 3. sync_statuses — статусы задач
-- ============================================================================
create table if not exists public.sync_statuses (
  id                 text primary key,                       -- UUIDv7 с клиента
  user_id            uuid not null references auth.users(id) on delete cascade,
  name               text not null,
  color              text not null,
  behavior           text not null default 'middle',         -- 'top' | 'middle' | 'bottom' | 'archive'
  sort_order         integer not null default 0,
  is_seed            boolean not null default false,         -- создан ли системным сидом
  is_technical       boolean not null default false,         -- 'Удалено'
  hidden             boolean not null default false,
  default_collapsed  boolean not null default false,
  -- sync-метаданные
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,                            -- NULL = живой; !NULL = soft-deleted
  version            integer not null default 1,
  client_id          text references public.sync_devices(id) on delete set null
);

comment on table public.sync_statuses is
  'Статусы задач пользователя. Синхронизируются между устройствами.';

create index if not exists sync_statuses_user_id_idx on public.sync_statuses(user_id) where deleted_at is null;
create index if not exists sync_statuses_updated_at_idx on public.sync_statuses(user_id, updated_at desc);

-- ============================================================================
-- 4. sync_tags — теги
-- ============================================================================
create table if not exists public.sync_tags (
  id          text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  color       text not null,
  sort_order  integer not null default 0,
  -- sync-метаданные
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  version     integer not null default 1,
  client_id   text references public.sync_devices(id) on delete set null
);

comment on table public.sync_tags is 'Теги пользователя.';

create index if not exists sync_tags_user_id_idx on public.sync_tags(user_id) where deleted_at is null;
create index if not exists sync_tags_updated_at_idx on public.sync_tags(user_id, updated_at desc);

-- ============================================================================
-- 5. sync_tasks — задачи
-- ============================================================================
-- FK на sync_statuses / sync_tags не ставим жёстко: если статус
-- удалён (soft) на одном клиенте, а задача уже пересинхронизирована
-- на другом — не хотим ловить FK violation. Валидация ссылок — на клиенте.
create table if not exists public.sync_tasks (
  id            text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  comment       text not null default '',
  status_id     text,                                        -- ссылка на sync_statuses.id (без FK)
  tag_id        text,                                        -- ссылка на sync_tags.id (без FK)
  start_date    date,                                        -- YYYY-MM-DD
  deadline      date,
  finish_date   date,
  sort_order    integer not null default 0,
  archived      boolean not null default false,
  -- sync-метаданные
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  version       integer not null default 1,
  client_id     text references public.sync_devices(id) on delete set null
);

comment on table public.sync_tasks is 'Задачи пользователя.';

create index if not exists sync_tasks_user_id_idx on public.sync_tasks(user_id) where deleted_at is null;
create index if not exists sync_tasks_updated_at_idx on public.sync_tasks(user_id, updated_at desc);
create index if not exists sync_tasks_status_idx on public.sync_tasks(user_id, status_id) where deleted_at is null;
create index if not exists sync_tasks_deadline_idx on public.sync_tasks(user_id, deadline) where deleted_at is null and deadline is not null;

-- ============================================================================
-- 6. sync_task_templates — шаблоны задач
-- ============================================================================
create table if not exists public.sync_task_templates (
  id           text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  title        text not null default '',
  comment      text not null default '',
  status_id    text,                                         -- ссылка на sync_statuses.id (без FK)
  tag_id       text,                                         -- ссылка на sync_tags.id (без FK)
  sort_order   integer not null default 0,
  -- sync-метаданные
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  version      integer not null default 1,
  client_id    text references public.sync_devices(id) on delete set null
);

comment on table public.sync_task_templates is 'Шаблоны задач пользователя.';

create index if not exists sync_task_templates_user_id_idx on public.sync_task_templates(user_id) where deleted_at is null;
create index if not exists sync_task_templates_updated_at_idx on public.sync_task_templates(user_id, updated_at desc);

-- ============================================================================
-- 7. sync_settings — пользовательские настройки (key/value)
-- ============================================================================
-- Не все settings синхронизируются: например, autocleanup_*, ui-preferences —
-- локальные для устройства. Клиент решает, что синхронизировать, отправляя
-- только «cloud-settings» в эту таблицу.
create table if not exists public.sync_settings (
  user_id     uuid not null references auth.users(id) on delete cascade,
  key         text not null,
  value       text not null,
  -- sync-метаданные
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  version     integer not null default 1,
  client_id   text references public.sync_devices(id) on delete set null,
  primary key (user_id, key)
);

comment on table public.sync_settings is
  'Пользовательские настройки (только те, что должны синхронизироваться между устройствами).';

create index if not exists sync_settings_updated_at_idx on public.sync_settings(user_id, updated_at desc);

-- ============================================================================
-- 8. sync_overdue_events — история пересечений дедлайна
-- ============================================================================
-- Append-only. Используется в графике «просрочки» на дашборде.
-- Разрешаем soft delete на случай, если пользователь удалит задачу
-- и связанные события тоже (для GDPR-подобного «удалить всё моё»).
create table if not exists public.sync_overdue_events (
  id                 text primary key,
  user_id            uuid not null references auth.users(id) on delete cascade,
  task_id            text not null,                          -- ссылка на sync_tasks.id (без FK)
  deadline_snapshot  date not null,
  event_date         date not null,
  -- sync-метаданные
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  client_id          text references public.sync_devices(id) on delete set null
);

comment on table public.sync_overdue_events is
  'Append-only история пересечений дедлайна для графика на дашборде.';

create index if not exists sync_overdue_events_user_task_idx on public.sync_overdue_events(user_id, task_id, id desc);
create index if not exists sync_overdue_events_user_date_idx on public.sync_overdue_events(user_id, event_date desc) where deleted_at is null;

-- ============================================================================
-- 9. Триггеры updated_at + version bump
-- ============================================================================
-- Универсальная функция: устанавливает updated_at=now() и version=version+1
-- на каждый UPDATE. Использует set_updated_at() из 0001_init.sql? Нет —
-- та обновляет только updated_at, нам нужен ещё и version bump.
create or replace function public.sync_bump_version()
returns trigger as $$
begin
  new.updated_at = now();
  -- Инкрементим только если version не был явно установлен извне
  -- (это позволит клиенту при conflict-resolution выставить нужную версию).
  if new.version = old.version then
    new.version = old.version + 1;
  end if;
  return new;
end;
$$ language plpgsql;

comment on function public.sync_bump_version() is
  'Триггерная функция для всех sync_* таблиц: обновляет updated_at и инкрементит version на каждом UPDATE.';

-- Функция для таблиц без колонки version (только updated_at bump).
create or replace function public.sync_bump_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Применяем триггеры ко всем sync_* таблицам с version.
do $$
declare
  t text;
begin
  foreach t in array array[
    'sync_statuses',
    'sync_tags',
    'sync_tasks',
    'sync_task_templates',
    'sync_settings'
  ]
  loop
    execute format('drop trigger if exists %I_bump_version on public.%I', t, t);
    execute format(
      'create trigger %I_bump_version before update on public.%I ' ||
      'for each row execute function public.sync_bump_version()',
      t, t
    );
  end loop;
end $$;

-- ============================================================================
-- 10. Row Level Security — каждый пользователь видит только своё
-- ============================================================================
alter table public.sync_devices           enable row level security;
alter table public.sync_statuses          enable row level security;
alter table public.sync_tags              enable row level security;
alter table public.sync_tasks             enable row level security;
alter table public.sync_task_templates    enable row level security;
alter table public.sync_settings          enable row level security;
alter table public.sync_overdue_events    enable row level security;

-- Универсальные RLS-политики для user-scoped таблиц.
-- Пользователь может делать всё со своими строками (SELECT/INSERT/UPDATE/DELETE),
-- и ничего с чужими.
do $$
declare
  t text;
begin
  foreach t in array array[
    'sync_devices',
    'sync_statuses',
    'sync_tags',
    'sync_tasks',
    'sync_task_templates',
    'sync_settings',
    'sync_overdue_events'
  ]
  loop
    -- SELECT
    execute format('drop policy if exists "%s_select_own" on public.%I', t, t);
    execute format(
      'create policy "%s_select_own" on public.%I ' ||
      'for select using (auth.uid() = user_id)',
      t, t
    );
    -- INSERT (with_check, а не using)
    execute format('drop policy if exists "%s_insert_own" on public.%I', t, t);
    execute format(
      'create policy "%s_insert_own" on public.%I ' ||
      'for insert with check (auth.uid() = user_id)',
      t, t
    );
    -- UPDATE
    execute format('drop policy if exists "%s_update_own" on public.%I', t, t);
    execute format(
      'create policy "%s_update_own" on public.%I ' ||
      'for update using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t, t
    );
    -- DELETE (hard delete — только для service_role / cleanup job)
    -- Клиент должен делать soft-delete через UPDATE deleted_at.
    -- Оставляем DELETE-политику для будущих кейсов (например, «удалить аккаунт»).
    execute format('drop policy if exists "%s_delete_own" on public.%I', t, t);
    execute format(
      'create policy "%s_delete_own" on public.%I ' ||
      'for delete using (auth.uid() = user_id)',
      t, t
    );
  end loop;
end $$;

-- ============================================================================
-- 11. Realtime — включаем публикацию изменений через WebSocket
-- ============================================================================
-- Клиент подписывается на изменения своих строк (RLS автоматически фильтрует).
-- Пока не добавляем sync_overdue_events (там мало интересного для realtime).
alter publication supabase_realtime add table public.sync_statuses;
alter publication supabase_realtime add table public.sync_tags;
alter publication supabase_realtime add table public.sync_tasks;
alter publication supabase_realtime add table public.sync_task_templates;
alter publication supabase_realtime add table public.sync_settings;

-- ============================================================================
-- 12. Helper view: pull-запросы по last_sync_at
-- ============================================================================
-- Клиент периодически спрашивает: «что изменилось после X?»
-- Этот view не обязателен — клиент может join'ить сам — но упрощает debug
-- и позволяет добавить агрегированные счётчики.
create or replace view public.sync_status_summary as
select
  u.id as user_id,
  (select count(*) from public.sync_tasks    where user_id = u.id and deleted_at is null) as active_tasks,
  (select count(*) from public.sync_tasks    where user_id = u.id and deleted_at is not null) as deleted_tasks,
  (select count(*) from public.sync_statuses where user_id = u.id and deleted_at is null) as active_statuses,
  (select count(*) from public.sync_tags     where user_id = u.id and deleted_at is null) as active_tags,
  (select count(*) from public.sync_devices  where user_id = u.id) as devices_count,
  (select max(last_seen_at) from public.sync_devices where user_id = u.id) as last_device_seen_at,
  (select max(updated_at)
     from (
       select updated_at from public.sync_tasks    where user_id = u.id
       union all
       select updated_at from public.sync_statuses where user_id = u.id
       union all
       select updated_at from public.sync_tags     where user_id = u.id
     ) t
  ) as last_change_at
from auth.users u;

comment on view public.sync_status_summary is
  'Сводка sync-состояния пользователя (кол-во задач, устройств, время последнего изменения).';
