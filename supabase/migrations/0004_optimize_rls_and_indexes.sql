-- TaskFlow v0.9.35-dev.1 — оптимизация RLS + covering-индексы
--
-- 1. auth_rls_initplan: заворачиваем auth.uid() в (select auth.uid())
--    во всех RLS-политиках, чтобы PostgreSQL кэшировал результат один раз
--    на запрос, а не пересчитывал для каждой строки.
--    Разница при 1000+ строк — в разы по скорости SELECT.
--
-- 2. unindexed_foreign_keys: добавляем индексы по client_id во всех sync_*
--    таблицах — ускоряет CASCADE-операции при удалении устройства.

-- ============================================================================
-- 1. Пересоздание RLS-политик с (select auth.uid())
-- ============================================================================

-- Старые таблицы из 0001_init.sql
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using ((select auth.uid()) = id);

drop policy if exists "usage_events_insert_own" on public.usage_events;
create policy "usage_events_insert_own" on public.usage_events
  for insert with check ((select auth.uid()) = user_id or user_id is null);

-- Новые sync_* таблицы: пересоздаём все политики через universal DO-блок
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
    execute format('drop policy if exists "%s_select_own" on public.%I', t, t);
    execute format(
      'create policy "%s_select_own" on public.%I ' ||
      'for select using ((select auth.uid()) = user_id)',
      t, t
    );

    execute format('drop policy if exists "%s_insert_own" on public.%I', t, t);
    execute format(
      'create policy "%s_insert_own" on public.%I ' ||
      'for insert with check ((select auth.uid()) = user_id)',
      t, t
    );

    execute format('drop policy if exists "%s_update_own" on public.%I', t, t);
    execute format(
      'create policy "%s_update_own" on public.%I ' ||
      'for update using ((select auth.uid()) = user_id) ' ||
      'with check ((select auth.uid()) = user_id)',
      t, t
    );

    execute format('drop policy if exists "%s_delete_own" on public.%I', t, t);
    execute format(
      'create policy "%s_delete_own" on public.%I ' ||
      'for delete using ((select auth.uid()) = user_id)',
      t, t
    );
  end loop;
end $$;

-- ============================================================================
-- 2. Covering-индексы по client_id
-- ============================================================================
-- Нужны для CASCADE при удалении устройства (sync_devices → on delete set null).
-- Также ускоряют «покажи мне, что делал этот client_id» для debug.
create index if not exists sync_statuses_client_id_idx        on public.sync_statuses(client_id);
create index if not exists sync_tags_client_id_idx            on public.sync_tags(client_id);
create index if not exists sync_tasks_client_id_idx           on public.sync_tasks(client_id);
create index if not exists sync_task_templates_client_id_idx  on public.sync_task_templates(client_id);
create index if not exists sync_settings_client_id_idx        on public.sync_settings(client_id);
create index if not exists sync_overdue_events_client_id_idx  on public.sync_overdue_events(client_id);
