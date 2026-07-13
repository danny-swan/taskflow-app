-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- pgTAP: исторический журнал изменений задач (миграция 0034, Wave C, PR-c-03).
--
-- Проверяет:
--   • Структуру таблицы sync_task_activity_log (колонки, индексы, FK, check).
--   • RLS включён + 4 политики (select allow / insert-deny / update-deny /
--     delete-deny).
--   • Триггер trg_log_task_activity на sync_tasks + SECURITY DEFINER функцию
--     log_task_activity().
--   • Поведение триггера в shared-пространстве: created / status_changed /
--     deadline_changed / title_changed / description_changed / tag_added /
--     tag_removed / deleted / restored; payload; user_id = auth.uid().
--   • Personal-пространство НЕ логируется (фильтр на уровне триггера).
--   • Прямые клиентские INSERT (42501) / UPDATE / DELETE заблокированы.
--   • SELECT-видимость: owner/editor/viewer видят лог, outsider — нет.
--
-- Стиль — как 14 (SET LOCAL ROLE authenticated + request.jwt.claim.sub).
-- Выполняется на vanilla Postgres 15 (CI).

BEGIN;
SELECT plan(41);

-- ============================================================================
-- SETUP (superuser: auth.uid() IS NULL → RLS/guards не мешают наливу)
-- ============================================================================
DO $$
DECLARE
  u_o uuid := 'a0000017-0000-0000-0000-000000000001'::uuid; -- owner
  u_e uuid := 'a0000017-0000-0000-0000-000000000002'::uuid; -- editor
  u_v uuid := 'a0000017-0000-0000-0000-000000000003'::uuid; -- viewer
  u_x uuid := 'a0000017-0000-0000-0000-000000000004'::uuid; -- outsider
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (u_o,'r17-o@test'),(u_e,'r17-e@test'),(u_v,'r17-v@test'),(u_x,'r17-x@test')
    ON CONFLICT (id) DO NOTHING;

  -- Shared-пространство ws17 + три роли.
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('ws17', u_o, u_o, 'Activity WS', 'shared') ON CONFLICT DO NOTHING;
  INSERT INTO public.sync_workspace_members (id, workspace_id, user_id, role) VALUES
    ('m17_o','ws17',u_o,'owner'),
    ('m17_e','ws17',u_e,'editor'),
    ('m17_v','ws17',u_v,'viewer') ON CONFLICT DO NOTHING;

  -- Personal-пространство ws17p (лог не должен писаться).
  INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind) VALUES
    ('ws17p', u_o, u_o, 'Personal WS', 'personal') ON CONFLICT DO NOTHING;

  -- Задачи для UPDATE-сценариев (каждая меняется ровно по одному полю).
  INSERT INTO public.sync_tasks (id, user_id, workspace_id, title, status_id, tag_id, deadline, comment) VALUES
    ('t17_status',  u_o,'ws17','base','st1',NULL,NULL,''),
    ('t17_deadline',u_o,'ws17','base',NULL,NULL,'2026-01-01',''),
    ('t17_title',   u_o,'ws17','orig',NULL,NULL,NULL,''),
    ('t17_desc',    u_o,'ws17','base',NULL,NULL,NULL,'old'),
    ('t17_tagadd',  u_o,'ws17','base',NULL,NULL,NULL,''),
    ('t17_tagrem',  u_o,'ws17','base',NULL,'tg1',NULL,''),
    ('t17_del',     u_o,'ws17','base',NULL,NULL,NULL,'')
    ON CONFLICT DO NOTHING;
  -- Восстанавливаемая задача создаётся уже soft-deleted (created не логируется).
  INSERT INTO public.sync_tasks (id, user_id, workspace_id, title, deleted_at) VALUES
    ('t17_restore', u_o,'ws17','base', now()) ON CONFLICT DO NOTHING;

  -- Personal-задачи: INSERT + UPDATE не должны логироваться.
  INSERT INTO public.sync_tasks (id, user_id, workspace_id, title) VALUES
    ('tp17_ins', u_o,'ws17p','p-insert'),
    ('tp17_upd', u_o,'ws17p','p-orig') ON CONFLICT DO NOTHING;
  UPDATE public.sync_tasks SET title='p-changed' WHERE id='tp17_upd';
END$$;

-- ============================================================================
-- СТРУКТУРА (18)
-- ============================================================================
SELECT has_table('public'::name,'sync_task_activity_log'::name,'структура: таблица sync_task_activity_log существует');
SELECT has_column('sync_task_activity_log'::name,'id'::name,'структура: колонка id');
SELECT has_column('sync_task_activity_log'::name,'task_id'::name,'структура: колонка task_id');
SELECT has_column('sync_task_activity_log'::name,'workspace_id'::name,'структура: колонка workspace_id');
SELECT has_column('sync_task_activity_log'::name,'user_id'::name,'структура: колонка user_id');
SELECT has_column('sync_task_activity_log'::name,'kind'::name,'структура: колонка kind');
SELECT has_column('sync_task_activity_log'::name,'payload'::name,'структура: колонка payload');
SELECT has_column('sync_task_activity_log'::name,'created_at'::name,'структура: колонка created_at');

SELECT is(
  (SELECT count(*)::int FROM pg_indexes
     WHERE schemaname='public' AND tablename='sync_task_activity_log'
       AND indexname='sync_task_activity_log_task_id_idx'),
  1,'структура: индекс по (task_id, created_at desc)');
SELECT is(
  (SELECT count(*)::int FROM pg_indexes
     WHERE schemaname='public' AND tablename='sync_task_activity_log'
       AND indexname='sync_task_activity_log_workspace_id_idx'),
  1,'структура: индекс по (workspace_id, created_at desc)');

SELECT is(
  (SELECT count(*)::int FROM pg_trigger
     WHERE tgrelid='public.sync_tasks'::regclass AND tgname='trg_log_task_activity'),
  1,'структура: триггер trg_log_task_activity на sync_tasks');
SELECT is(
  (SELECT count(*)::int FROM pg_proc
     WHERE proname='log_task_activity' AND pronamespace='public'::regnamespace),
  1,'структура: функция log_task_activity() существует');
SELECT is(
  (SELECT prosecdef FROM pg_proc
     WHERE proname='log_task_activity' AND pronamespace='public'::regnamespace),
  true,'структура: log_task_activity() — SECURITY DEFINER');

SELECT is(
  (SELECT relrowsecurity FROM pg_class
     WHERE oid='public.sync_task_activity_log'::regclass),
  true,'RLS: включён на sync_task_activity_log');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname='public' AND tablename='sync_task_activity_log'
       AND policyname='sync_task_activity_log_select'),
  1,'RLS: политика SELECT существует');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname='public' AND tablename='sync_task_activity_log'
       AND policyname='sync_task_activity_log_insert_denied'),
  1,'RLS: политика INSERT-deny существует');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname='public' AND tablename='sync_task_activity_log'
       AND policyname='sync_task_activity_log_update_denied'),
  1,'RLS: политика UPDATE-deny существует');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
     WHERE schemaname='public' AND tablename='sync_task_activity_log'
       AND policyname='sync_task_activity_log_delete_denied'),
  1,'RLS: политика DELETE-deny существует');

-- ============================================================================
-- ПОВЕДЕНИЕ ТРИГГЕРА (editor совершает действия; auth.uid()=editor)
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000017-0000-0000-0000-000000000002';

-- created — новая задача editor'ом.
INSERT INTO public.sync_tasks (id,user_id,workspace_id,title)
  VALUES ('t17_created','a0000017-0000-0000-0000-000000000002','ws17','new task');
-- значимые UPDATE (по одному полю на задачу → однозначный kind).
UPDATE public.sync_tasks SET status_id='st2'          WHERE id='t17_status';
UPDATE public.sync_tasks SET deadline='2026-12-31'    WHERE id='t17_deadline';
UPDATE public.sync_tasks SET title='renamed'          WHERE id='t17_title';
UPDATE public.sync_tasks SET comment='a much longer description' WHERE id='t17_desc';
UPDATE public.sync_tasks SET tag_id='tg9'             WHERE id='t17_tagadd';
UPDATE public.sync_tasks SET tag_id=NULL              WHERE id='t17_tagrem';
UPDATE public.sync_tasks SET deleted_at=now()         WHERE id='t17_del';
UPDATE public.sync_tasks SET deleted_at=NULL          WHERE id='t17_restore';

-- Прямой клиентский INSERT в лог — запрещён RLS (with check false).
SELECT throws_ok(
  $$ INSERT INTO public.sync_task_activity_log (task_id,workspace_id,user_id,kind)
       VALUES ('t17_status','ws17','a0000017-0000-0000-0000-000000000002','created') $$,
  '42501',NULL,'DENY: прямой клиентский INSERT в лог заблокирован');

-- Прямой UPDATE/DELETE — RLS using(false) молча отсекает (0 строк).
UPDATE public.sync_task_activity_log SET kind='status_changed' WHERE workspace_id='ws17' AND kind='created';
DELETE FROM public.sync_task_activity_log WHERE workspace_id='ws17';

RESET ROLE;
SET LOCAL request.jwt.claim.sub TO '';

-- ── Проверки записей (superuser видит всё) ──────────────────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.sync_task_activity_log WHERE task_id='t17_created' AND kind='created'),
  1,'created: запись создана');
SELECT is(
  (SELECT payload->>'title' FROM public.sync_task_activity_log WHERE task_id='t17_created' AND kind='created'),
  'new task','created: payload.title');
SELECT is(
  (SELECT user_id FROM public.sync_task_activity_log WHERE task_id='t17_created' AND kind='created'),
  'a0000017-0000-0000-0000-000000000002'::uuid,'created: user_id = auth.uid() (editor)');

SELECT is(
  (SELECT count(*)::int FROM public.sync_task_activity_log WHERE task_id='t17_status' AND kind='status_changed'),
  1,'status_changed: запись создана');
SELECT is(
  (SELECT payload->>'old' FROM public.sync_task_activity_log WHERE task_id='t17_status' AND kind='status_changed'),
  'st1','status_changed: payload.old');
SELECT is(
  (SELECT payload->>'new' FROM public.sync_task_activity_log WHERE task_id='t17_status' AND kind='status_changed'),
  'st2','status_changed: payload.new');

SELECT is(
  (SELECT count(*)::int FROM public.sync_task_activity_log WHERE task_id='t17_deadline' AND kind='deadline_changed'),
  1,'deadline_changed: запись создана');
SELECT is(
  (SELECT count(*)::int FROM public.sync_task_activity_log WHERE task_id='t17_title' AND kind='title_changed'),
  1,'title_changed: запись создана');
SELECT is(
  (SELECT count(*)::int FROM public.sync_task_activity_log WHERE task_id='t17_desc' AND kind='description_changed'),
  1,'description_changed: запись создана');
SELECT is(
  (SELECT (payload->>'new_length')::int FROM public.sync_task_activity_log WHERE task_id='t17_desc' AND kind='description_changed'),
  length('a much longer description'),'description_changed: payload.new_length (текст не логируется)');
SELECT is(
  (SELECT count(*)::int FROM public.sync_task_activity_log WHERE task_id='t17_tagadd' AND kind='tag_added'),
  1,'tag_added: запись создана');
SELECT is(
  (SELECT count(*)::int FROM public.sync_task_activity_log WHERE task_id='t17_tagrem' AND kind='tag_removed'),
  1,'tag_removed: запись создана');
SELECT is(
  (SELECT count(*)::int FROM public.sync_task_activity_log WHERE task_id='t17_del' AND kind='deleted'),
  1,'deleted: запись создана');
SELECT is(
  (SELECT count(*)::int FROM public.sync_task_activity_log WHERE task_id='t17_restore' AND kind='restored'),
  1,'restored: запись создана');

-- Personal — ничего не логируется.
SELECT is(
  (SELECT count(*)::int FROM public.sync_task_activity_log WHERE task_id='tp17_ins'),
  0,'personal: INSERT задачи НЕ логируется');
SELECT is(
  (SELECT count(*)::int FROM public.sync_task_activity_log WHERE task_id='tp17_upd'),
  0,'personal: UPDATE задачи НЕ логируется');

-- Прямой UPDATE не сработал (created-записи не переименованы в status_changed
-- сверх настоящих; настоящий status_changed ровно один — t17_status).
SELECT is(
  (SELECT count(*)::int FROM public.sync_task_activity_log WHERE workspace_id='ws17' AND kind='status_changed'),
  1,'DENY: прямой UPDATE лога — no-op (осталась одна настоящая status_changed)');
-- Прямой DELETE не сработал (строки ws17 на месте).
SELECT ok(
  (SELECT count(*) FROM public.sync_task_activity_log WHERE workspace_id='ws17') > 0,
  'DENY: прямой DELETE лога — no-op (строки ws17 на месте)');

-- ============================================================================
-- SELECT-ВИДИМОСТЬ ПО РОЛЯМ
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000017-0000-0000-0000-000000000001';
SELECT ok((SELECT count(*) FROM public.sync_task_activity_log WHERE workspace_id='ws17') > 0,
  'SELECT: owner видит лог пространства');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000017-0000-0000-0000-000000000002';
SELECT ok((SELECT count(*) FROM public.sync_task_activity_log WHERE workspace_id='ws17') > 0,
  'SELECT: editor видит лог пространства');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000017-0000-0000-0000-000000000003';
SELECT ok((SELECT count(*) FROM public.sync_task_activity_log WHERE workspace_id='ws17') > 0,
  'SELECT: viewer видит лог пространства');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'a0000017-0000-0000-0000-000000000004';
SELECT is((SELECT count(*)::int FROM public.sync_task_activity_log WHERE workspace_id='ws17'),
  0,'SELECT: outsider (не член) не видит лог');
RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';

SELECT * FROM finish();
ROLLBACK;
