-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- v0.9.35 — sync_task_hold_periods: интервалы статуса «Приостановлено»
-- для столбца «Холд» в Статистике.
--
-- Каждый интервал, в течение которого задача находилась в статусе
-- «Приостановлено», — отдельная строка: started_at (поставили на холд),
-- ended_at (сняли; NULL = задача на холде прямо сейчас). «Холд» задачи =
-- сумма длительностей всех её интервалов в днях.
--
-- ВАЖНО (архитектурное решение): серверного триггера на sync_tasks НЕТ.
-- Автор строк — исключительно клиент (holdPeriods.recordHoldTransition),
-- ровно как для sync_overdue_events. Причины:
--   1. Клиент уже пишет интервалы локально и пушит их через sync_outbox —
--      серверный триггер создавал бы ДУБЛИКАТЫ.
--   2. Local-only режим (пользователь без облачного аккаунта) должен
--      считать холд без сервера — вся логика обязана жить на клиенте.
-- Эта таблица — лишь облачное зеркало для кросс-девайс синхронизации.
--
-- Строка МУТАБЕЛЬНА (ended_at закрывается при выходе из холда), поэтому есть
-- updated_at + version, а pull идёт по LWW (курсор updated_at), как у
-- sync_tasks. Мягкое удаление через deleted_at.
--
-- Идемпотентна: CREATE ... IF NOT EXISTS, безопасные DO-блоки.

-- ============================================================================
-- 1. Таблица
-- ============================================================================
create table if not exists public.sync_task_hold_periods (
  id          text primary key,                              -- UUIDv7 с клиента
  user_id     uuid not null references auth.users(id) on delete cascade,
  task_id     text not null,                                 -- ссылка на sync_tasks.id (без FK)
  started_at  timestamptz not null,
  ended_at    timestamptz,                                   -- NULL = открытый интервал
  -- sync-метаданные
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  version     integer not null default 1,
  client_id   text references public.sync_devices(id) on delete set null
);

comment on table public.sync_task_hold_periods is
  'Интервалы статуса «Приостановлено» для столбца «Холд». Автор — клиент (без серверного триггера), синхронизируется LWW по updated_at.';

create index if not exists sync_task_hold_periods_user_task_idx
  on public.sync_task_hold_periods(user_id, task_id);
create index if not exists sync_task_hold_periods_user_updated_idx
  on public.sync_task_hold_periods(user_id, updated_at desc);
create index if not exists sync_task_hold_periods_open_idx
  on public.sync_task_hold_periods(user_id, task_id) where ended_at is null and deleted_at is null;
create index if not exists sync_task_hold_periods_client_id_idx
  on public.sync_task_hold_periods(client_id);

-- ============================================================================
-- 2. Триггеры: version bump + server updated_at (LWW через серверные часы)
-- ============================================================================
drop trigger if exists sync_task_hold_periods_bump_version on public.sync_task_hold_periods;
create trigger sync_task_hold_periods_bump_version
  before update on public.sync_task_hold_periods
  for each row execute function public.sync_bump_version();

drop trigger if exists trg_set_updated_at on public.sync_task_hold_periods;
create trigger trg_set_updated_at
  before update on public.sync_task_hold_periods
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 3. Row Level Security — каждый пользователь видит только своё
-- ============================================================================
alter table public.sync_task_hold_periods enable row level security;

drop policy if exists "sync_task_hold_periods_select_own" on public.sync_task_hold_periods;
create policy "sync_task_hold_periods_select_own" on public.sync_task_hold_periods
  for select using (auth.uid() = user_id);

drop policy if exists "sync_task_hold_periods_insert_own" on public.sync_task_hold_periods;
create policy "sync_task_hold_periods_insert_own" on public.sync_task_hold_periods
  for insert with check (auth.uid() = user_id);

drop policy if exists "sync_task_hold_periods_update_own" on public.sync_task_hold_periods;
create policy "sync_task_hold_periods_update_own" on public.sync_task_hold_periods
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "sync_task_hold_periods_delete_own" on public.sync_task_hold_periods;
create policy "sync_task_hold_periods_delete_own" on public.sync_task_hold_periods
  for delete using (auth.uid() = user_id);

-- ============================================================================
-- 4. GRANTs — authenticated (per-row via RLS) + service_role (cleanup jobs)
-- ============================================================================
grant select, insert, update, delete on table public.sync_task_hold_periods to authenticated;
grant all on table public.sync_task_hold_periods to service_role;

-- ============================================================================
-- 5. Realtime — кросс-девайс обновления через WebSocket
-- ============================================================================
-- Идемпотентно: если таблица уже в publication — проглатываем ошибку.
do $$
begin
  begin
    alter publication supabase_realtime add table public.sync_task_hold_periods;
  exception
    when duplicate_object then null; -- уже добавлена
    when others then raise;
  end;
end $$;
