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
-- ─── ФИКС (bootstrap-scoped, НЕ по owner_id навсегда) ───────────────────────
-- ВАЖНО: нельзя давать доступ «всем, кто в owner_id» — это создаёт утечку:
-- если владелец делает self-leave (при наличии второго owner'а), колонка
-- sync_workspaces.owner_id остаётся указывать на ушедшего, и он бы продолжал
-- видеть данные. Источник истины для доступа — ЧЛЕНСТВО, а owner_id — лишь штамп
-- создателя. Поэтому вводим УЗКОЕ bootstrap-окно:
--
--   is_workspace_bootstrap(ws, uid) := uid = owner_id пространства
--        И в пространстве ещё НЕТ ни одной активной строки членства.
--
-- Как только появляется хотя бы одно членство — bootstrap выключается, и доступ
-- определяется строго через has_workspace_role (членство). Это:
--   • чинит 403: при создании нового ws членства ещё нет → bootstrap=true →
--     RETURNING для upsert проходит;
--   • не создаёт утечку: у существующего ws членство есть → bootstrap=false →
--     ушедший владелец (stale owner_id) доступа НЕ получает.
--
-- Ветки политик:
--   • sync_workspaces:  SELECT/UPDATE += OR is_workspace_bootstrap(id, uid).
--   • дочерние + settings + activity_log(SELECT): += OR is_workspace_bootstrap(
--     workspace_id, uid).
--   • sync_workspace_members: SELECT += is_workspace_bootstrap ИЛИ own-row
--     (user_id=self покрывает RETURNING собственной bootstrap-строки владельца).
--     INSERT членства владельцем оставляем как в 0027/0031 (owns_workspace) —
--     это штатный bootstrap owner-строки, он не даёт SELECT-утечки.
--
-- Семантика ролей (editor/viewer/owner) НЕ меняется — добавляется только
-- bootstrap-альтернатива, живущая до появления первого членства.
--
-- activity_log: INSERT/UPDATE/DELETE остаются denied (серверный лог), трогаем
-- только SELECT.
--
-- Идемпотентна: CREATE OR REPLACE FUNCTION + DROP POLICY IF EXISTS. Совместима с
-- vanilla Postgres 15 (CI). has_workspace_role / owns_workspace не меняются.
-- ============================================================================
SET LOCAL client_min_messages = warning;

-- ============================================================================
-- 0. Bootstrap-хелпер: владелец + ещё нет ни одного членства в пространстве
-- ============================================================================
-- STABLE SECURITY DEFINER — читает sync_workspaces и sync_workspace_members
-- минуя их RLS (иначе при отсутствии членства мы бы не увидели строки).
-- deleted_at IS NULL: soft-deleted членства не считаются активными.
CREATE OR REPLACE FUNCTION public.is_workspace_bootstrap(ws text, uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
  select exists (
           select 1 from public.sync_workspaces w
           where w.id = ws and w.owner_id = uid and w.deleted_at is null
         )
     and not exists (
           select 1 from public.sync_workspace_members m
           where m.workspace_id = ws and m.deleted_at is null
         );
$$;

COMMENT ON FUNCTION public.is_workspace_bootstrap(text, uuid) IS
  'RLS-хелпер bootstrap-окна: uid — owner_id пространства ws И в ws ещё нет ни одной активной строки членства. Как только появляется членство — false (доступ далее строго через has_workspace_role). Нужен для RETURNING при первом upsert нового пространства без утечки доступа ушедшему владельцу.';

REVOKE EXECUTE ON FUNCTION public.is_workspace_bootstrap(text, uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.is_workspace_bootstrap(text, uuid) TO authenticated;

-- Есть ли в пространстве хотя бы одна активная строка членства (минуя RLS).
-- Нужна для инлайн-политики sync_workspaces: проверку owner_id держим ИНЛАЙН
-- (иначе ломается RETURNING, см. ниже), а «нет ещё членства» ОБЯЗАНА идти через
-- SECURITY DEFINER — иначе подзапрос по sync_workspace_members выполняется под
-- RLS вызывающего и НЕ видит ЧУЖИЕ строки членства, из-за чего ушедший владелец
-- (stale owner_id) ошибочно проходит NOT EXISTS и видит чужое пространство.
CREATE OR REPLACE FUNCTION public.workspace_has_active_members(ws text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_catalog AS $$
  select exists (
    select 1 from public.sync_workspace_members m
    where m.workspace_id = ws and m.deleted_at is null
  );
$$;

COMMENT ON FUNCTION public.workspace_has_active_members(text) IS
  'RLS-хелпер: есть ли в пространстве ws хотя бы одна активная (deleted_at IS NULL) строка членства. SECURITY DEFINER: читает членство минуя RLS, чтобы инлайн-bootstrap sync_workspaces видел ЧУЖОЕ членство и не давал доступ ушедшему владельцу.';

REVOKE EXECUTE ON FUNCTION public.workspace_has_active_members(text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION public.workspace_has_active_members(text) TO authenticated;

-- ============================================================================
-- 1. sync_workspaces — bootstrap ИНЛАЙН по собственной колонке owner_id
-- ============================================================================
-- ВАЖНО (тонкость INSERT ... RETURNING): для этой таблицы bootstrap-условие
-- НЕЛЬЗЯ выражать через is_workspace_bootstrap(id, uid), потому что эта
-- SECURITY DEFINER функция ПЕРЕЧИТЫВАЕТ сам sync_workspaces, а во время
-- INSERT ... RETURNING только что вставленная строка ещё НЕ видна собственному
-- снапшоту функции → SELECT-политика для RETURNING падает (42501). Поэтому
-- проверяем владение по КОЛОНКЕ строки (owner_id = auth.uid()), которая доступна
-- напрямую, а «нет ещё членства» — по ДРУГОЙ таблице (sync_workspace_members),
-- что для SECURITY-DEFINER-подзапроса безопасно. Анти-утечка сохраняется:
-- при живом членстве NOT EXISTS=false → ушедший владелец доступа не получает.
-- (Проверено локально: инлайн-owner проходит RETURNING, is_workspace_bootstrap — нет.)
DROP POLICY IF EXISTS "sync_workspaces_ws_select" ON public.sync_workspaces;
CREATE POLICY "sync_workspaces_ws_select" ON public.sync_workspaces
  FOR SELECT USING (
    public.has_workspace_role(id, (select auth.uid()), 'viewer')
    OR (
      owner_id = (select auth.uid())
      AND deleted_at IS NULL
      AND NOT public.workspace_has_active_members(id)
    )
  );

DROP POLICY IF EXISTS "sync_workspaces_ws_update" ON public.sync_workspaces;
CREATE POLICY "sync_workspaces_ws_update" ON public.sync_workspaces
  FOR UPDATE USING (
    public.has_workspace_role(id, (select auth.uid()), 'owner')
    OR (
      owner_id = (select auth.uid())
      AND deleted_at IS NULL
      AND NOT public.workspace_has_active_members(id)
    )
  )
  WITH CHECK (
    public.has_workspace_role(id, (select auth.uid()), 'owner')
    OR (
      owner_id = (select auth.uid())
      AND deleted_at IS NULL
      AND NOT public.workspace_has_active_members(id)
    )
  );

COMMENT ON POLICY "sync_workspaces_ws_select" ON public.sync_workspaces IS
  'SELECT: участник (viewer+) ИЛИ bootstrap-владелец (нужно для RETURNING при upsert нового пространства до появления первого членства).';
COMMENT ON POLICY "sync_workspaces_ws_update" ON public.sync_workspaces IS
  'UPDATE: owner по membership ИЛИ bootstrap-владелец (upsert нового ws). WITH CHECK держит согласованность.';

-- ============================================================================
-- 2. sync_workspace_members — SELECT: bootstrap ИЛИ своя строка
-- ============================================================================
-- SELECT: участник, ИЛИ своя строка (user_id=self — покрывает RETURNING
-- собственной owner-строки при bootstrap), ИЛИ bootstrap-окно.
-- INSERT/UPDATE членства владельцем ОСТАВЛЯЕМ как в 0027/0031 (owns_workspace):
-- штатный bootstrap owner-строки и приглашение участников. НЕ переоткрываем их
-- здесь — 0037 их не трогает, чтобы не пересобирать проверенную логику.
DROP POLICY IF EXISTS "sync_workspace_members_select_ws_role" ON public.sync_workspace_members;
CREATE POLICY "sync_workspace_members_select_ws_role" ON public.sync_workspace_members
  FOR SELECT USING (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'viewer')
    OR user_id = (select auth.uid())
    OR public.is_workspace_bootstrap(workspace_id, (select auth.uid()))
  );

COMMENT ON POLICY "sync_workspace_members_select_ws_role" ON public.sync_workspace_members IS
  'SELECT: участник (viewer+), ИЛИ своя строка (user_id=self, покрывает RETURNING собственной owner-строки), ИЛИ bootstrap-окно. INSERT/UPDATE членства — прежние политики (0027/0031, owns_workspace).';

-- ============================================================================
-- 3. Дочерние таблицы с workspace_id — bootstrap по (workspace_id, uid)
-- ============================================================================
-- SELECT: viewer ИЛИ bootstrap (для RETURNING при upsert новых строк).
-- UPDATE/INSERT: прежняя ролевая ветка ИЛИ bootstrap (до появления membership).
-- Роли (editor/owner) сохраняются как есть (0031 + 0035): statuses/tags/
-- templates — owner-write, tasks/overdue/hold_periods — editor-write. 0037
-- только добавляет bootstrap-альтернативу, не понижает роль.
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
    IF t IN ('sync_statuses', 'sync_tags', 'sync_task_templates') THEN
      write_role := 'owner';
    ELSE
      write_role := 'editor';
    END IF;

    -- SELECT: viewer ИЛИ bootstrap-владелец.
    EXECUTE format('drop policy if exists %I on public.%I', t || '_select_ws_role', t);
    EXECUTE format(
      'create policy %I on public.%I for select using ' ||
      '(public.has_workspace_role(workspace_id, (select auth.uid()), %L) ' ||
      'or public.is_workspace_bootstrap(workspace_id, (select auth.uid())))',
      t || '_select_ws_role', t, 'viewer'
    );

    -- INSERT: ролевая ветка ИЛИ bootstrap-владелец.
    EXECUTE format('drop policy if exists %I on public.%I', t || '_insert_ws_role', t);
    EXECUTE format(
      'create policy %I on public.%I for insert with check ' ||
      '(public.has_workspace_role(workspace_id, (select auth.uid()), %L) ' ||
      'or public.is_workspace_bootstrap(workspace_id, (select auth.uid())))',
      t || '_insert_ws_role', t, write_role
    );

    -- UPDATE: ролевая ветка ИЛИ bootstrap-владелец (USING и WITH CHECK).
    EXECUTE format('drop policy if exists %I on public.%I', t || '_update_ws_role', t);
    EXECUTE format(
      'create policy %I on public.%I for update using ' ||
      '(public.has_workspace_role(workspace_id, (select auth.uid()), %L) ' ||
      'or public.is_workspace_bootstrap(workspace_id, (select auth.uid()))) ' ||
      'with check (public.has_workspace_role(workspace_id, (select auth.uid()), %L) ' ||
      'or public.is_workspace_bootstrap(workspace_id, (select auth.uid())))',
      t || '_update_ws_role', t, write_role, write_role
    );

    -- DELETE не меняем (жёсткий delete редок, штатно идёт через soft-delete=UPDATE).

    EXECUTE format('comment on policy %I on public.%I is %L',
      t || '_select_ws_role', t,
      'SELECT: участник (viewer+) ИЛИ bootstrap-владелец — для RETURNING при upsert новых строк до появления membership.');
    EXECUTE format('comment on policy %I on public.%I is %L',
      t || '_insert_ws_role', t,
      'INSERT: ролевая ветка ИЛИ bootstrap-владелец (upsert нового пространства).');
    EXECUTE format('comment on policy %I on public.%I is %L',
      t || '_update_ws_role', t,
      'UPDATE: ролевая ветка ИЛИ bootstrap-владелец; WITH CHECK держит workspace_id.');
  END LOOP;
END $$;

-- ============================================================================
-- 4. sync_workspace_settings — bootstrap по (workspace_id, uid)
-- ============================================================================
DROP POLICY IF EXISTS "sync_workspace_settings_select_ws_role" ON public.sync_workspace_settings;
CREATE POLICY "sync_workspace_settings_select_ws_role" ON public.sync_workspace_settings
  FOR SELECT USING (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'viewer')
    OR public.is_workspace_bootstrap(workspace_id, (select auth.uid()))
  );

DROP POLICY IF EXISTS "sync_workspace_settings_insert_ws_role" ON public.sync_workspace_settings;
CREATE POLICY "sync_workspace_settings_insert_ws_role" ON public.sync_workspace_settings
  FOR INSERT WITH CHECK (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'owner')
    OR public.is_workspace_bootstrap(workspace_id, (select auth.uid()))
  );

DROP POLICY IF EXISTS "sync_workspace_settings_update_ws_role" ON public.sync_workspace_settings;
CREATE POLICY "sync_workspace_settings_update_ws_role" ON public.sync_workspace_settings
  FOR UPDATE USING (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'owner')
    OR public.is_workspace_bootstrap(workspace_id, (select auth.uid()))
  )
  WITH CHECK (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'owner')
    OR public.is_workspace_bootstrap(workspace_id, (select auth.uid()))
  );

COMMENT ON POLICY "sync_workspace_settings_select_ws_role" ON public.sync_workspace_settings IS
  'SELECT: участник (viewer+) ИЛИ bootstrap-владелец (для RETURNING при upsert настроек нового пространства).';
COMMENT ON POLICY "sync_workspace_settings_insert_ws_role" ON public.sync_workspace_settings IS
  'INSERT: owner по membership ИЛИ bootstrap-владелец.';
COMMENT ON POLICY "sync_workspace_settings_update_ws_role" ON public.sync_workspace_settings IS
  'UPDATE: owner по membership ИЛИ bootstrap-владелец; WITH CHECK держит workspace_id.';

-- ============================================================================
-- 5. sync_task_activity_log — только SELECT (запись denied, серверный лог)
-- ============================================================================
DROP POLICY IF EXISTS "sync_task_activity_log_select" ON public.sync_task_activity_log;
CREATE POLICY "sync_task_activity_log_select" ON public.sync_task_activity_log
  FOR SELECT USING (
    public.has_workspace_role(workspace_id, (select auth.uid()), 'viewer')
    OR public.is_workspace_bootstrap(workspace_id, (select auth.uid()))
  );

COMMENT ON POLICY "sync_task_activity_log_select" ON public.sync_task_activity_log IS
  'SELECT: участник (viewer+) ИЛИ bootstrap-владелец. INSERT/UPDATE/DELETE остаются denied (серверный лог).';
