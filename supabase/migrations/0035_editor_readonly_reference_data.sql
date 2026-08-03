-- 0035_editor_readonly_reference_data.sql
-- Bug #5 (Wave B): роль editor не должна менять справочники пространства.
--
-- ЧТО ДЕЛАЕМ И ЗАЧЕМ:
-- До этой миграции (0031) INSERT/UPDATE/DELETE на sync_statuses / sync_tags /
-- sync_task_templates были разрешены роли 'editor'. Согласованное правило
-- (ADR 0005: owner=admin, editor=редактор задач) требует, чтобы editor мог
-- менять только сами задачи (в т.ч. status_id/tag_id конкретной задачи —
-- это UPDATE на sync_tasks, остаётся 'editor'), но НЕ мог редактировать
-- справочник статусов/тегов/шаблонов и настройки пространства.
--
-- Меняем write-политики (INSERT/UPDATE/DELETE) на sync_statuses, sync_tags,
-- sync_task_templates с 'editor' -> 'owner'. SELECT остаётся 'viewer'.
-- sync_tasks и sync_task_hold_periods НЕ трогаем (editor сохраняет CRUD).
-- sync_workspace_settings уже owner-only (0031) — не трогаем.
-- sync_overdue_events НЕ трогаем: это производные события задач (editor их пишет).
--
-- Идемпотентно: DROP POLICY IF EXISTS + CREATE POLICY.

BEGIN;

-- ============ sync_statuses (write -> owner) ============
DROP POLICY IF EXISTS "sync_statuses_insert_ws_role" ON public.sync_statuses;
CREATE POLICY "sync_statuses_insert_ws_role" ON public.sync_statuses
  FOR INSERT
  WITH CHECK (public.has_workspace_role(workspace_id, (SELECT auth.uid()), 'owner'));

DROP POLICY IF EXISTS "sync_statuses_update_ws_role" ON public.sync_statuses;
CREATE POLICY "sync_statuses_update_ws_role" ON public.sync_statuses
  FOR UPDATE
  USING (public.has_workspace_role(workspace_id, (SELECT auth.uid()), 'owner'))
  WITH CHECK (public.has_workspace_role(workspace_id, (SELECT auth.uid()), 'owner'));

DROP POLICY IF EXISTS "sync_statuses_delete_ws_role" ON public.sync_statuses;
CREATE POLICY "sync_statuses_delete_ws_role" ON public.sync_statuses
  FOR DELETE
  USING (public.has_workspace_role(workspace_id, (SELECT auth.uid()), 'owner'));

-- ============ sync_tags (write -> owner) ============
DROP POLICY IF EXISTS "sync_tags_insert_ws_role" ON public.sync_tags;
CREATE POLICY "sync_tags_insert_ws_role" ON public.sync_tags
  FOR INSERT
  WITH CHECK (public.has_workspace_role(workspace_id, (SELECT auth.uid()), 'owner'));

DROP POLICY IF EXISTS "sync_tags_update_ws_role" ON public.sync_tags;
CREATE POLICY "sync_tags_update_ws_role" ON public.sync_tags
  FOR UPDATE
  USING (public.has_workspace_role(workspace_id, (SELECT auth.uid()), 'owner'))
  WITH CHECK (public.has_workspace_role(workspace_id, (SELECT auth.uid()), 'owner'));

DROP POLICY IF EXISTS "sync_tags_delete_ws_role" ON public.sync_tags;
CREATE POLICY "sync_tags_delete_ws_role" ON public.sync_tags
  FOR DELETE
  USING (public.has_workspace_role(workspace_id, (SELECT auth.uid()), 'owner'));

-- ============ sync_task_templates (write -> owner) ============
DROP POLICY IF EXISTS "sync_task_templates_insert_ws_role" ON public.sync_task_templates;
CREATE POLICY "sync_task_templates_insert_ws_role" ON public.sync_task_templates
  FOR INSERT
  WITH CHECK (public.has_workspace_role(workspace_id, (SELECT auth.uid()), 'owner'));

DROP POLICY IF EXISTS "sync_task_templates_update_ws_role" ON public.sync_task_templates;
CREATE POLICY "sync_task_templates_update_ws_role" ON public.sync_task_templates
  FOR UPDATE
  USING (public.has_workspace_role(workspace_id, (SELECT auth.uid()), 'owner'))
  WITH CHECK (public.has_workspace_role(workspace_id, (SELECT auth.uid()), 'owner'));

DROP POLICY IF EXISTS "sync_task_templates_delete_ws_role" ON public.sync_task_templates;
CREATE POLICY "sync_task_templates_delete_ws_role" ON public.sync_task_templates
  FOR DELETE
  USING (public.has_workspace_role(workspace_id, (SELECT auth.uid()), 'owner'));

COMMIT;

-- ПРОВЕРКА (выполнить вручную после apply, не в миграции):
-- SET LOCAL ROLE authenticated;
-- SET LOCAL request.jwt.claims TO '{"sub":"<editor-uid>","role":"authenticated"}';
-- INSERT INTO public.sync_statuses(...) VALUES (...);  -- должно упасть RLS (42501)
-- UPDATE public.sync_tasks SET status_id = '<existing>' WHERE id = '<task>';  -- должно пройти

-- ROLLBACK (вручную если нужно вернуть editor-права на справочники):
-- BEGIN;
--   -- вернуть 'owner' -> 'editor' в шести write-политиках выше
--   -- (симметрично, с min_role='editor')
-- COMMIT;
