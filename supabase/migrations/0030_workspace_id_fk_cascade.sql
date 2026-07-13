-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0030_workspace_id_fk_cascade.sql — ссылочная целостность workspace_id
-- (Wave B, PR-b-01 «feat/ws-b-01-integrity»).
--
-- Реализует пункт 5 ADR 0005 (docs/adr/0005-shared-workspaces.md) и §3
-- docs/architecture/wave-b-plan.md: закрывает два инварианта, унаследованных из
-- Wave A (PR-6) — «workspace_id без FK» и «нет ON DELETE CASCADE» — вводя
-- настоящие внешние ключи с каскадным удалением для всех восьми таблиц с
-- колонкой workspace_id (6 sync-таблиц + sync_workspace_members +
-- sync_workspace_settings). Плюс снимает guard block_shared_workspaces, открывая
-- kind='shared' на уровне СХЕМЫ (продуктово shared по-прежнему закрыт до PR-b-03/04:
-- нет UI, нет invitations RPC; для free он ещё и упирается в тарифный лимит 0).
--
-- ─── РАСХОЖДЕНИЕ С ПЛАНОМ: workspace_id ОСТАЁТСЯ text, НЕ переводится в uuid ───
-- План (wave-b-plan §3, ADR 0005 п.5) предполагал ALTER COLUMN ... TYPE uuid
-- USING workspace_id::uuid. Это НЕВОЗМОЖНО без ломающего клиентского изменения:
--   • sync_workspaces.id — text PRIMARY KEY, а не uuid (0027);
--   • id генерируются детерминированно как 'ws_' || replace(user_id,'-','')
--     для personal и 'ws_' || uuidv7-hex для новых (src/store/useStore.ts:
--     createWorkspace, src/lib/migrations.ts v11). Префикс 'ws_' делает значение
--     невалидным uuid: 'ws_4111...'::uuid → ERROR invalid input syntax for uuid.
--   • Клиент и сервер обязаны генерировать ИДЕНТИЧНЫЙ id, чтобы personal-ws
--     склеивался по PK при первом sync (0027, шапка; workspaces-plan §2.3).
--     Смена формата id на uuid сломала бы этот инвариант и офлайн-first дедуп.
-- Поэтому FK+CASCADE навешиваются на СУЩЕСТВУЮЩИЙ text-тип (text→text FK на
-- text PK полностью валиден). Суть решения ADR 0005 (референсная целостность +
-- каскад, orphan'ы физически невозможны, тривиальный cleanup-job) достигается
-- без смены типа. Реальный переход на uuid — отдельная скоординированная работа
-- (снятие префикса 'ws_' на клиенте+сервере), вне scope PR-b-01. Подробности —
-- в docs/architecture/wave-b-plan.md §3-факт.
--
-- Совместимо с vanilla Postgres 15 (CI). Идемпотентна: audit-блок повторяем,
-- FK через DROP CONSTRAINT IF EXISTS перед ADD, guard через DROP ... IF EXISTS.
-- На прод НЕ применяется до решения релизить направление workspaces.
-- ============================================================================

-- ============================================================================
-- 1. DATA AUDIT — до навешивания FK убеждаемся, что данные консистентны
-- ============================================================================
-- Orphan-scan: каждый непустой workspace_id в восьми дочерних таблицах ОБЯЗАН
-- иметь строку в sync_workspaces(id). Если найдены orphan'ы — миграция падает с
-- явным сообщением (сколько и в какой таблице). Orphan'ы НЕ удаляются
-- автоматически — это решение оставляется человеку (могли прийти из бага sync,
-- удалять вслепую нельзя). NULL workspace_id пропускаем: колонка NOT NULL в 6
-- sync-таблицах (0027 §6), но в members/settings формально nullable, а NULL в
-- FK всегда допустим.
--
-- ЗАМЕЧАНИЕ про «валидный uuid»: план требовал проверить, что все workspace_id —
-- валидные UUID. Здесь эта проверка НЕПРИМЕНИМА (см. шапку: id имеют формат
-- 'ws_<hex>', это осознанный дизайн, а не мусор). Единственный реальный
-- prerequisite для FK — отсутствие orphan'ов, его и проверяем.
do $$
declare
  t            text;
  v_orphans    bigint;
  v_total      bigint := 0;
  v_report     text := '';
begin
  foreach t in array array[
    'sync_tasks',
    'sync_statuses',
    'sync_tags',
    'sync_task_templates',
    'sync_overdue_events',
    'sync_task_hold_periods',
    'sync_workspace_members',
    'sync_workspace_settings'
  ]
  loop
    execute format(
      'select count(*) from public.%I c
         where c.workspace_id is not null
           and not exists (select 1 from public.sync_workspaces w where w.id = c.workspace_id)',
      t
    ) into v_orphans;

    if v_orphans > 0 then
      v_total := v_total + v_orphans;
      v_report := v_report || format('  • %s: %s orphan(s)%s', t, v_orphans, chr(10));
    end if;
  end loop;

  if v_total > 0 then
    raise exception E'0030 data audit FAILED: найдено % orphan-строк workspace_id (нет соответствующего sync_workspaces.id):\n%Разберитесь с ними вручную (не удаляем автоматически) перед навешиванием FK.',
      v_total, v_report
      using errcode = 'foreign_key_violation';
  end if;

  raise notice '0030 data audit OK: orphan-строк workspace_id не найдено (проверено 8 таблиц).';
end $$;

-- ============================================================================
-- 2. FK + ON DELETE CASCADE для восьми таблиц с workspace_id
-- ============================================================================
-- Имя FK предсказуемое: <table>_workspace_id_fkey. DEFERRABLE INITIALLY IMMEDIATE
-- — задел на будущее (если outbox когда-нибудь пушит workspace и child в одной
-- транзакции, проверку можно будет отложить до COMMIT через SET CONSTRAINTS).
-- Сейчас PUSH_ORDER (0027/PR-2) гарантирует parent-first, отложенность не нужна,
-- но запас безвреден. Тип колонки не меняем (см. шапку) — FK на text.
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
    'sync_task_hold_periods',
    'sync_workspace_members',
    'sync_workspace_settings'
  ]
  loop
    execute format('alter table public.%I drop constraint if exists %I',
                   t, t || '_workspace_id_fkey');
    execute format(
      'alter table public.%I
         add constraint %I
         foreign key (workspace_id) references public.sync_workspaces(id)
         on delete cascade
         deferrable initially immediate',
      t, t || '_workspace_id_fkey'
    );
  end loop;
end $$;

-- Комментарии на колонках: фиксируем наличие FK+CASCADE (0027 их не добавлял).
comment on column public.sync_tasks.workspace_id is
  'Пространство задачи. FK → sync_workspaces(id) ON DELETE CASCADE (0030).';
comment on column public.sync_statuses.workspace_id is
  'Пространство статуса. FK → sync_workspaces(id) ON DELETE CASCADE (0030).';
comment on column public.sync_tags.workspace_id is
  'Пространство тега. FK → sync_workspaces(id) ON DELETE CASCADE (0030).';
comment on column public.sync_task_templates.workspace_id is
  'Пространство шаблона. FK → sync_workspaces(id) ON DELETE CASCADE (0030).';
comment on column public.sync_overdue_events.workspace_id is
  'Пространство события просрочки. FK → sync_workspaces(id) ON DELETE CASCADE (0030).';
comment on column public.sync_task_hold_periods.workspace_id is
  'Пространство периода паузы. FK → sync_workspaces(id) ON DELETE CASCADE (0030).';
comment on column public.sync_workspace_members.workspace_id is
  'Пространство членства. FK → sync_workspaces(id) ON DELETE CASCADE (0030).';
comment on column public.sync_workspace_settings.workspace_id is
  'Пространство настройки. FK → sync_workspaces(id) ON DELETE CASCADE (0030).';

-- ============================================================================
-- 3. Снятие guard block_shared_workspaces — открываем kind='shared' в схеме
-- ============================================================================
-- ВНИМАНИЕ: в 0027 это НЕ check-constraint (как называет план), а ТРИГГЕР
-- block_shared_workspaces + одноимённая функция. Снимаем оба. После этого
-- kind='shared' допустим на уровне схемы (CHECK (kind in ('personal','shared'))
-- из 0027 его и так разрешал). Продуктовое открытие shared — PR-b-03/04/05.
-- Для free тарифный лимит get_workspace_limit(uid,'shared')=0 (0029) продолжает
-- не давать создать shared — регресс подтверждается в тесте 13 и 11.
drop trigger   if exists block_shared_workspaces on public.sync_workspaces;
drop function  if exists public.block_shared_workspaces();
