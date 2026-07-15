-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0037_owner_bootstrap_rls_upsert.sql — фикс регрессии: upsert новых сущностей
-- пространства падал с 403 (RLS) при первой облачной синхронизации.
--
-- ─── КОРЕНЬ (доказан на проде SQL-пробами) ──────────────────────────────────
-- Клиент пушит изменения через PostgREST `upsert` = `INSERT ... ON CONFLICT DO
-- UPDATE ... RETURNING *`. Для INSERT ... RETURNING Postgres обязан вернуть
-- вставленную строку, а значит применяет к ней и SELECT-политику. У всех
-- workspace-таблиц SELECT-политика выражена через has_workspace_role(...,'viewer'),
-- которая ищет строку в sync_workspace_members. Но при СОЗДАНИИ нового
-- пространства членство-owner ещё не существует на сервере (оно в том же пуш-
-- батче и/или ещё не долетело). Итог: SELECT-политика = false → RETURNING
-- запрещён → ВЕСЬ upsert отклоняется с 42501 / HTTP 403. Push никогда не
-- проходит, sync_outbox накапливается (pending sync растёт), созданные
-- пространства «не долетают» и теряются при переключении аккаунта.
--
-- Чистый INSERT (без RETURNING) проходил — поэтому баг не ловился ранее; ломает
-- именно upsert-путь клиента. Проверено: plain INSERT = OK, upsert = 42501.
--
-- То же самое касается INSERT-строки owner-членства (bootstrap уже частично
-- закрыт в 0027/0031 через owns_workspace, но SELECT-ветка RETURNING — нет) и
-- всех дочерних таблиц (statuses/tasks/tags/templates/overdue/hold_periods/
-- settings/activity_log): при создании их первых строк в новом пространстве
-- membership ещё не материализовалось.
--
-- ─── ФИКС ───────────────────────────────────────────────────────────────────
-- Разрешить ВЛАДЕЛЬЦУ пространства доступ к строкам своего пространства напрямую
-- по владению, минуя membership:
--   • sync_workspaces:  ветки SELECT/UPDATE получают `OR owner_id = auth.uid()`.
--   • дочерние таблицы: ветки SELECT/UPDATE(/INSERT где запись доступна) получают
--     `OR public.owns_workspace(workspace_id, auth.uid())`.
-- owns_workspace(ws,uid) = EXISTS(sync_workspaces WHERE id=ws AND owner_id=uid AND
-- deleted_at IS NULL) — STABLE SECURITY DEFINER (0027). Это ЖЁСТКО ограничивает
-- доступ владельцем конкретного пространства: чужой пользователь не проходит
-- (проверено пробой — foreign SELECT=0, foreign upsert=BLOCKED). Семантика ролей
-- (editor/viewer) НЕ меняется — только добавляется всегда-истинная для владельца
-- альтернатива, устраняющая курицу-яйцо bootstrap.
--
-- activity_log: INSERT/UPDATE/DELETE остаются denied (серверный лог), трогаем
-- только SELECT (владелец видит лог своего пространства до появления membership).
--
-- Идемпотентна: DROP POLICY IF EXISTS перед каждым CREATE. Совместима с vanilla
-- Postgres 15 (CI). Не меняет has_workspace_role / owns_workspace.
-- ============================================================================
SET LOCAL client_min_messages = warning;

-- ============================================================================
-- 1. sync_workspaces — владелец по owner_id (нет workspace_id; ws = id)
-- ============================================================================
DROP POLICY IF EXISTS "sync_workspaces_ws_select" ON public.sync_workspaces;
CREATE POLICY "sync_workspaces_ws_select" ON public.sync_workspaces
  FOR SELECT USING (
    public.has_workspace_role(id, (select auth.uid()), 'viewer')
    OR owner_id = (select auth.uid())
  );

DROP POLICY IF EXISTS "sync_workspaces_ws_update" ON public.sync_workspaces;
CREATE POLICY "sync_workspaces_ws_update" ON public.sync_workspaces
  FOR UPDATE USING (
    public.has_workspace_role(id, (select auth.uid()), 'owner')
    OR owner_id = (select auth.uid())
  )
  WITH CHECK (
    public.has_workspace_role(id, (select auth.uid()), 'owner')
    OR owner_id = (select auth.uid())
  );

COMMENT ON POLICY "sync_workspaces_ws_select" ON public.sync_workspaces IS
  'SELECT: участник (viewer+) ИЛИ владелец по owner_id (нужно для RETURNING при upsert нового пространства до появления membership).';
COMMENT ON POLICY "sync_workspaces_ws_update" ON public.sync_workspaces IS
  'UPDATE: owner по membership ИЛИ владелец по owner_id (bootstrap upsert). WITH CHECK держит владение.';

-- ============================================================================
-- 2. sync_workspace_members — владелец пространства (owns_workspace) + self
-- ============================================================================
DROP POLICY IF EXISTS "sync_workspace_members_select_ws_role" ON public.sync_workspace_members;
CREATE POLICY "sync_workspace_members_select_ws_role" ON public.sync_workspace_members
  FOR SELECT USING (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'viewer')
    OR public.owns_workspace(workspace_id, (select auth.uid()))
    OR user_id = (select auth.uid())
  );

-- INSERT/UPDATE членства владельцем: owner по membership, ИЛИ владелец
-- пространства (owns_workspace) — покрывает bootstrap owner-строки и upsert
-- участников в только что созданном пространстве. self-leave политики (0031) не
-- трогаем.
DROP POLICY IF EXISTS "sync_workspace_members_insert_ws_role" ON public.sync_workspace_members;
CREATE POLICY "sync_workspace_members_insert_ws_role" ON public.sync_workspace_members
  FOR INSERT WITH CHECK (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'owner')
    OR public.owns_workspace(workspace_id, (select auth.uid()))
    OR (
      user_id = (select auth.uid())
      AND role = 'owner'
      AND public.owns_workspace(workspace_id, (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS "sync_workspace_members_update_ws_role" ON public.sync_workspace_members;
CREATE POLICY "sync_workspace_members_update_ws_role" ON public.sync_workspace_members
  FOR UPDATE USING (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'owner')
    OR public.owns_workspace(workspace_id, (select auth.uid()))
  )
  WITH CHECK (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'owner')
    OR public.owns_workspace(workspace_id, (select auth.uid()))
  );

COMMENT ON POLICY "sync_workspace_members_select_ws_role" ON public.sync_workspace_members IS
  'SELECT: участник (viewer+), ИЛИ владелец пространства (owns_workspace), ИЛИ своя строка. Владелец нужен для RETURNING при bootstrap членства.';
COMMENT ON POLICY "sync_workspace_members_insert_ws_role" ON public.sync_workspace_members IS
  'INSERT: owner по membership ИЛИ владелец пространства (owns_workspace) — приглашение участников и bootstrap owner-строки в новом пространстве.';
COMMENT ON POLICY "sync_workspace_members_update_ws_role" ON public.sync_workspace_members IS
  'UPDATE: owner по membership ИЛИ владелец пространства. Последний owner защищён триггером assert_at_least_one_owner (0028).';

-- ============================================================================
-- 3. Дочерние таблицы с workspace_id — владелец по owns_workspace
-- ============================================================================
-- SELECT: viewer ИЛИ владелец (для RETURNING при upsert новых строк).
-- UPDATE: прежняя ролевая ветка ИЛИ владелец (bootstrap upsert до membership).
-- INSERT WITH CHECK: прежняя ролевая ветка ИЛИ владелец.
-- Роли (editor/owner) сохраняются как were; добавляется только owner-альтернатива.
DO $$
DECLARE
  t text;
  write_role text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sync_tasks',
    'sync_statuses',
    'sync_tags',
    'sync_task_templates',
    'sync_overdue_events',
    'sync_task_hold_periods'
  ]
  LOOP
    -- Роль записи ТОЧНО как на проде (0031 + 0035): statuses/tags/templates —
    -- owner-write (критичные/справочные данные, 0035 поднял statuses до owner),
    -- tasks/overdue/hold_periods — editor-write. Сохраняем существующую роль
    -- БЕЗ изменения — 0037 только добавляет owner-альтернативу, не понижает.
    IF t IN ('sync_statuses', 'sync_tags', 'sync_task_templates') THEN
      write_role := 'owner';
    ELSE
      write_role := 'editor';
    END IF;

    -- SELECT: viewer ИЛИ владелец пространства.
    EXECUTE format('drop policy if exists %I on public.%I', t || '_select_ws_role', t);
    EXECUTE format(
      'create policy %I on public.%I for select using ' ||
      '(public.has_workspace_role(workspace_id, (select auth.uid()), %L) ' ||
      'or public.owns_workspace(workspace_id, (select auth.uid())))',
      t || '_select_ws_role', t, 'viewer'
    );

    -- INSERT: ролевая ветка ИЛИ владелец.
    EXECUTE format('drop policy if exists %I on public.%I', t || '_insert_ws_role', t);
    EXECUTE format(
      'create policy %I on public.%I for insert with check ' ||
      '(public.has_workspace_role(workspace_id, (select auth.uid()), %L) ' ||
      'or public.owns_workspace(workspace_id, (select auth.uid())))',
      t || '_insert_ws_role', t, write_role
    );

    -- UPDATE: ролевая ветка ИЛИ владелец (USING и WITH CHECK).
    EXECUTE format('drop policy if exists %I on public.%I', t || '_update_ws_role', t);
    EXECUTE format(
      'create policy %I on public.%I for update using ' ||
      '(public.has_workspace_role(workspace_id, (select auth.uid()), %L) ' ||
      'or public.owns_workspace(workspace_id, (select auth.uid()))) ' ||
      'with check (public.has_workspace_role(workspace_id, (select auth.uid()), %L) ' ||
      'or public.owns_workspace(workspace_id, (select auth.uid())))',
      t || '_update_ws_role', t, write_role, write_role
    );

    -- DELETE не меняем (жёсткий delete редок, идёт через soft-delete=UPDATE).

    EXECUTE format('comment on policy %I on public.%I is %L',
      t || '_select_ws_role', t,
      'SELECT: участник (viewer+) ИЛИ владелец пространства (owns_workspace) — для RETURNING при upsert новых строк до появления membership.');
    EXECUTE format('comment on policy %I on public.%I is %L',
      t || '_insert_ws_role', t,
      'INSERT: ролевая ветка ИЛИ владелец пространства (bootstrap upsert).');
    EXECUTE format('comment on policy %I on public.%I is %L',
      t || '_update_ws_role', t,
      'UPDATE: ролевая ветка ИЛИ владелец пространства; WITH CHECK держит workspace_id.');
  END LOOP;
END $$;

-- ============================================================================
-- 4. sync_workspace_settings — SELECT/UPDATE/INSERT владельцу пространства
-- ============================================================================
DROP POLICY IF EXISTS "sync_workspace_settings_select_ws_role" ON public.sync_workspace_settings;
CREATE POLICY "sync_workspace_settings_select_ws_role" ON public.sync_workspace_settings
  FOR SELECT USING (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'viewer')
    OR public.owns_workspace(workspace_id, (select auth.uid()))
  );

DROP POLICY IF EXISTS "sync_workspace_settings_insert_ws_role" ON public.sync_workspace_settings;
CREATE POLICY "sync_workspace_settings_insert_ws_role" ON public.sync_workspace_settings
  FOR INSERT WITH CHECK (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'owner')
    OR public.owns_workspace(workspace_id, (select auth.uid()))
  );

DROP POLICY IF EXISTS "sync_workspace_settings_update_ws_role" ON public.sync_workspace_settings;
CREATE POLICY "sync_workspace_settings_update_ws_role" ON public.sync_workspace_settings
  FOR UPDATE USING (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'owner')
    OR public.owns_workspace(workspace_id, (select auth.uid()))
  )
  WITH CHECK (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'owner')
    OR public.owns_workspace(workspace_id, (select auth.uid()))
  );

COMMENT ON POLICY "sync_workspace_settings_select_ws_role" ON public.sync_workspace_settings IS
  'SELECT: участник (viewer+) ИЛИ владелец пространства (для RETURNING при upsert настроек нового пространства).';
COMMENT ON POLICY "sync_workspace_settings_insert_ws_role" ON public.sync_workspace_settings IS
  'INSERT: owner по membership ИЛИ владелец пространства (bootstrap upsert).';
COMMENT ON POLICY "sync_workspace_settings_update_ws_role" ON public.sync_workspace_settings IS
  'UPDATE: owner по membership ИЛИ владелец пространства; WITH CHECK держит workspace_id.';

-- ============================================================================
-- 5. sync_task_activity_log — только SELECT (запись denied, серверный лог)
-- ============================================================================
DROP POLICY IF EXISTS "sync_task_activity_log_select" ON public.sync_task_activity_log;
CREATE POLICY "sync_task_activity_log_select" ON public.sync_task_activity_log
  FOR SELECT USING (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'viewer')
    OR public.owns_workspace(workspace_id, (select auth.uid()))
  );

COMMENT ON POLICY "sync_task_activity_log_select" ON public.sync_task_activity_log IS
  'SELECT: участник (viewer+) ИЛИ владелец пространства. INSERT/UPDATE/DELETE остаются denied (серверный лог).';
