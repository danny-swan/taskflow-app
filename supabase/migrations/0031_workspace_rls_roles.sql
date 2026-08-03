-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0031_workspace_rls_roles.sql — расширенные RLS-политики ролей (Wave B, PR-b-02).
--
-- Техплан: docs/architecture/wave-b-plan.md §4 п.2 («editor пишет задачи/статусы/
-- теги, viewer — SELECT-only, owner — всё, включая настройки/участников»);
-- роль-модель — ADR 0005 п.1 (owner/editor/viewer). Функция has_workspace_role
-- (0027, min_role: viewer<editor<owner) НЕ меняется — расширяем только политики.
--
-- ─── ЧТО ЭТО ДЕЛАЕТ ОТНОСИТЕЛЬНО Wave A (0027/0028) ─────────────────────────
-- Фундамент 0027 уже выразил доступ к 8 workspace-таблицам через
-- has_workspace_role, а 0028 добавил self-leave для не-owner и триггер
-- assert_at_least_one_owner (защита последнего owner'a). Эта миграция:
--   1. ПЕРЕИМЕНОВЫВАЕТ политики в единую предсказуемую схему <table>_<op>_ws_role
--      (было <table>_ws_<op>), делая 0031 единственным источником правды по
--      ролевым RLS 8 таблиц, и снабжает каждую COMMENT ON POLICY.
--   2. РАСШИРЯЕТ права editor на sync_statuses: в 0027 запись статусов была
--      owner-only («критичная настройка»), план §4.2 явно разрешает editor'у
--      писать статусы наравне с задачами/тегами → INSERT/UPDATE/DELETE → editor.
--      Это ЕДИНСТВЕННОЕ изменение поведения; остальные 5 sync-таблиц уже были
--      editor-write, members/settings — без изменений семантики.
--   3. СОХРАНЯЕТ (пересоздаёт под тем же именем) self-leave политики 0028 и
--      bootstrap-ветку INSERT членства 0027 — чтобы полный ролевой контур
--      members лежал в одном файле.
--
-- Защита последнего owner'a остаётся на триггере assert_at_least_one_owner
-- (0028) — здесь НЕ дублируется (design invariant, единый источник). См.
-- wave-b-plan.md §4.2-факт.
--
-- Модель доступа (min_role в has_workspace_role):
--   • 6 sync-таблиц:  SELECT→viewer, INSERT/UPDATE/DELETE→editor.
--   • members:        SELECT→viewer; INSERT→owner|bootstrap; UPDATE/DELETE→owner;
--                     + self-leave (не-owner soft-delete/DELETE своей строки).
--   • settings:       SELECT→viewer; INSERT/UPDATE/DELETE→owner.
--
-- Идемпотентна: DROP POLICY IF EXISTS перед каждым CREATE (и старых 0027/0028
-- имён, и новых). Совместима с vanilla Postgres 15 (CI). На прод НЕ применяется
-- до решения релизить эпик «Пространства».
-- ============================================================================
SET LOCAL client_min_messages = warning;

-- ============================================================================
-- 1. Шесть sync-таблиц: SELECT→viewer, запись→editor
-- ============================================================================
-- Все шесть теперь единообразны (sync_statuses приведён к editor-write, см. шапку).
DO $$
DECLARE
  t text;
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
    -- Старые имена (0027) и новые (идемпотентность повторного применения).
    EXECUTE format('drop policy if exists %I on public.%I', t || '_ws_select', t);
    EXECUTE format('drop policy if exists %I on public.%I', t || '_ws_insert', t);
    EXECUTE format('drop policy if exists %I on public.%I', t || '_ws_update', t);
    EXECUTE format('drop policy if exists %I on public.%I', t || '_ws_delete', t);
    EXECUTE format('drop policy if exists %I on public.%I', t || '_select_ws_role', t);
    EXECUTE format('drop policy if exists %I on public.%I', t || '_insert_ws_role', t);
    EXECUTE format('drop policy if exists %I on public.%I', t || '_update_ws_role', t);
    EXECUTE format('drop policy if exists %I on public.%I', t || '_delete_ws_role', t);

    -- SELECT: любой участник (viewer<=editor<=owner).
    EXECUTE format(
      'create policy %I on public.%I for select ' ||
      'using (public.has_workspace_role(workspace_id, (select auth.uid()), %L))',
      t || '_select_ws_role', t, 'viewer'
    );
    -- INSERT: editor и выше (viewer не может).
    EXECUTE format(
      'create policy %I on public.%I for insert ' ||
      'with check (public.has_workspace_role(workspace_id, (select auth.uid()), %L))',
      t || '_insert_ws_role', t, 'editor'
    );
    -- UPDATE: editor и выше; WITH CHECK не даёт увести строку в чужой ws.
    EXECUTE format(
      'create policy %I on public.%I for update ' ||
      'using (public.has_workspace_role(workspace_id, (select auth.uid()), %L)) ' ||
      'with check (public.has_workspace_role(workspace_id, (select auth.uid()), %L))',
      t || '_update_ws_role', t, 'editor', 'editor'
    );
    -- DELETE (hard): editor и выше. Штатный soft-delete идёт через UPDATE.
    EXECUTE format(
      'create policy %I on public.%I for delete ' ||
      'using (public.has_workspace_role(workspace_id, (select auth.uid()), %L))',
      t || '_delete_ws_role', t, 'editor'
    );

    EXECUTE format('comment on policy %I on public.%I is %L',
      t || '_select_ws_role', t, 'SELECT: любой участник пространства (viewer/editor/owner).');
    EXECUTE format('comment on policy %I on public.%I is %L',
      t || '_insert_ws_role', t, 'INSERT: editor и owner (viewer — read-only).');
    EXECUTE format('comment on policy %I on public.%I is %L',
      t || '_update_ws_role', t, 'UPDATE: editor и owner; WITH CHECK держит строку в своём workspace_id.');
    EXECUTE format('comment on policy %I on public.%I is %L',
      t || '_delete_ws_role', t, 'DELETE (hard): editor и owner (viewer — read-only).');
  END LOOP;
END $$;

-- ============================================================================
-- 2. sync_workspace_members
-- ============================================================================
-- SELECT — все участники; INSERT — owner (или bootstrap своей owner-строки в
-- только что созданном своём пространстве, ветка через owns_workspace минуя RLS);
-- UPDATE/DELETE — owner. Плюс self-leave для не-owner (soft-delete/DELETE своей
-- строки). Последний owner защищён триггером assert_at_least_one_owner (0028).
DROP POLICY IF EXISTS "sync_workspace_members_ws_select"         ON public.sync_workspace_members;
DROP POLICY IF EXISTS "sync_workspace_members_ws_insert"         ON public.sync_workspace_members;
DROP POLICY IF EXISTS "sync_workspace_members_ws_update"         ON public.sync_workspace_members;
DROP POLICY IF EXISTS "sync_workspace_members_ws_delete"         ON public.sync_workspace_members;
DROP POLICY IF EXISTS "sync_workspace_members_select_ws_role"    ON public.sync_workspace_members;
DROP POLICY IF EXISTS "sync_workspace_members_insert_ws_role"    ON public.sync_workspace_members;
DROP POLICY IF EXISTS "sync_workspace_members_update_ws_role"    ON public.sync_workspace_members;
DROP POLICY IF EXISTS "sync_workspace_members_delete_ws_role"    ON public.sync_workspace_members;
DROP POLICY IF EXISTS "sync_workspace_members_self_leave_update" ON public.sync_workspace_members;
DROP POLICY IF EXISTS "sync_workspace_members_self_leave_delete" ON public.sync_workspace_members;

CREATE POLICY "sync_workspace_members_select_ws_role" ON public.sync_workspace_members
  FOR SELECT USING (public.has_workspace_role(workspace_id, (select auth.uid()), 'viewer'));

CREATE POLICY "sync_workspace_members_insert_ws_role" ON public.sync_workspace_members
  FOR INSERT WITH CHECK (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'owner')
    OR (
      user_id = (select auth.uid())
      AND role = 'owner'
      AND public.owns_workspace(workspace_id, (select auth.uid()))
    )
  );

CREATE POLICY "sync_workspace_members_update_ws_role" ON public.sync_workspace_members
  FOR UPDATE USING (public.has_workspace_role(workspace_id, (select auth.uid()), 'owner'))
  WITH CHECK (public.has_workspace_role(workspace_id, (select auth.uid()), 'owner'));

CREATE POLICY "sync_workspace_members_delete_ws_role" ON public.sync_workspace_members
  FOR DELETE USING (public.has_workspace_role(workspace_id, (select auth.uid()), 'owner'));

-- Self-leave (перенесено из 0028): не-owner сам покидает пространство.
--   • soft-delete (UPDATE deleted_at своей строки) — основной путь sync;
--   • hard DELETE своей строки — на всякий. role='owner' исключён (owner уходит
--     только через передачу/понижение под защитой assert_at_least_one_owner).
CREATE POLICY "sync_workspace_members_self_leave_update" ON public.sync_workspace_members
  FOR UPDATE
  USING (user_id = (select auth.uid()) AND role <> 'owner')
  WITH CHECK (user_id = (select auth.uid()) AND role <> 'owner' AND deleted_at IS NOT NULL);

CREATE POLICY "sync_workspace_members_self_leave_delete" ON public.sync_workspace_members
  FOR DELETE
  USING (user_id = (select auth.uid()) AND role <> 'owner');

COMMENT ON POLICY "sync_workspace_members_select_ws_role" ON public.sync_workspace_members IS
  'SELECT: любой участник пространства видит список членства.';
COMMENT ON POLICY "sync_workspace_members_insert_ws_role" ON public.sync_workspace_members IS
  'INSERT: только owner (приглашение) или bootstrap собственной owner-строки в своём новом пространстве.';
COMMENT ON POLICY "sync_workspace_members_update_ws_role" ON public.sync_workspace_members IS
  'UPDATE (смена роли/членства): только owner. Последний owner защищён триггером assert_at_least_one_owner (0028).';
COMMENT ON POLICY "sync_workspace_members_delete_ws_role" ON public.sync_workspace_members IS
  'DELETE (убрать участника): только owner. Последний owner защищён триггером assert_at_least_one_owner (0028).';
COMMENT ON POLICY "sync_workspace_members_self_leave_update" ON public.sync_workspace_members IS
  'Self-leave: не-owner может soft-delete (deleted_at) только СВОЮ строку членства; роль менять нельзя.';
COMMENT ON POLICY "sync_workspace_members_self_leave_delete" ON public.sync_workspace_members IS
  'Self-leave: не-owner может hard-DELETE только СВОЮ строку членства.';

-- ============================================================================
-- 3. sync_workspace_settings — SELECT всем участникам, запись только owner
-- ============================================================================
DROP POLICY IF EXISTS "sync_workspace_settings_ws_select"      ON public.sync_workspace_settings;
DROP POLICY IF EXISTS "sync_workspace_settings_ws_insert"      ON public.sync_workspace_settings;
DROP POLICY IF EXISTS "sync_workspace_settings_ws_update"      ON public.sync_workspace_settings;
DROP POLICY IF EXISTS "sync_workspace_settings_ws_delete"      ON public.sync_workspace_settings;
DROP POLICY IF EXISTS "sync_workspace_settings_select_ws_role" ON public.sync_workspace_settings;
DROP POLICY IF EXISTS "sync_workspace_settings_insert_ws_role" ON public.sync_workspace_settings;
DROP POLICY IF EXISTS "sync_workspace_settings_update_ws_role" ON public.sync_workspace_settings;
DROP POLICY IF EXISTS "sync_workspace_settings_delete_ws_role" ON public.sync_workspace_settings;

CREATE POLICY "sync_workspace_settings_select_ws_role" ON public.sync_workspace_settings
  FOR SELECT USING (public.has_workspace_role(workspace_id, (select auth.uid()), 'viewer'));

CREATE POLICY "sync_workspace_settings_insert_ws_role" ON public.sync_workspace_settings
  FOR INSERT WITH CHECK (public.has_workspace_role(workspace_id, (select auth.uid()), 'owner'));

CREATE POLICY "sync_workspace_settings_update_ws_role" ON public.sync_workspace_settings
  FOR UPDATE USING (public.has_workspace_role(workspace_id, (select auth.uid()), 'owner'))
  WITH CHECK (public.has_workspace_role(workspace_id, (select auth.uid()), 'owner'));

CREATE POLICY "sync_workspace_settings_delete_ws_role" ON public.sync_workspace_settings
  FOR DELETE USING (public.has_workspace_role(workspace_id, (select auth.uid()), 'owner'));

COMMENT ON POLICY "sync_workspace_settings_select_ws_role" ON public.sync_workspace_settings IS
  'SELECT: любой участник пространства (viewer/editor/owner) читает настройки.';
COMMENT ON POLICY "sync_workspace_settings_insert_ws_role" ON public.sync_workspace_settings IS
  'INSERT: только owner (настройки пространства — привилегия владельца).';
COMMENT ON POLICY "sync_workspace_settings_update_ws_role" ON public.sync_workspace_settings IS
  'UPDATE: только owner; WITH CHECK держит строку в своём workspace_id.';
COMMENT ON POLICY "sync_workspace_settings_delete_ws_role" ON public.sync_workspace_settings IS
  'DELETE: только owner.';
