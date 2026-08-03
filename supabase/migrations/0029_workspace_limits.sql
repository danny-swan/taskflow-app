-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0029_workspace_limits.sql — тарифные лимиты на количество пространств (Wave A, PR-5).
--
-- Техплан: docs/architecture/workspaces-plan.md (§4, тарифы). Дополняет фундамент
-- 0027/0028 серверным гейтом на число активных (deleted_at IS NULL) workspaces у
-- владельца:
--   • Free  — максимум 2 пространства (в Wave A это 2 personal; shared лимит = 0);
--   • Pro / trial / lifetime (активный entitlement) — максимум 7 суммарно по всем
--     kind (в Wave A это фактически 7 personal, т.к. shared ещё заблокирован
--     check-constraint'ом 0027 + триггером block_shared_workspaces).
--
-- Платный статус определяется по public.user_entitlements (0007): активная строка
-- plan IN ('pro','trial','lifetime') с valid_until в будущем (или NULL для
-- lifetime). Терминология и семантика зеркалят клиентский resolveEntitlement()
-- из src/lib/entitlements.ts (lifetime → бессрочно, trial/pro → до valid_until).
--
-- ─── ФОРВАРД-СОВМЕСТИМОСТЬ С shared (Wave B) ────────────────────────────────
-- Счётчик считает ВСЕ активные пространства владельца (любого kind), а не только
-- personal, поэтому при открытии shared в Wave B (снятие check-constraint'а)
-- лимитная логика не потребует изменений. get_workspace_limit уже различает
-- personal/shared для free (shared → 0), что тоже готово к Wave B.
--
-- ─── СИСТЕМНЫЕ КАСКАДЫ / service_role ───────────────────────────────────────
-- Триггер (как assert_at_least_one_owner / block_personal_workspace_delete из
-- 0028) пропускает операции без auth.uid() (service_role, backfill 0027,
-- pgTAP-сетапы, суперпользователь). Лимит — UX/тарифный гейт для реальных
-- пользовательских INSERT'ов из клиента (всегда под ролью authenticated с
-- выставленным JWT). Security-барьер здесь не нужен: RLS 0027 уже изолирует
-- данные, а обойти лимит через service_role может только сервер/админ.
--
-- Идемпотентна: create or replace / drop ... if exists. На прод НЕ применяется
-- до решения релизить Wave A (как и 0027/0028).
-- ============================================================================

-- ============================================================================
-- 1. get_workspace_limit — лимит пространств для владельца по kind
-- ============================================================================
-- Возвращает МАКСИМАЛЬНОЕ разрешённое число активных пространств для uid при
-- создании пространства данного kind:
--   • платный (pro/trial/lifetime активен) → 7 (суммарно по всем kind);
--   • free + personal                      → 2;
--   • free + shared                        → 0 (shared на free недоступен вообще).
-- SECURITY DEFINER: читает user_entitlements минуя RLS (own-row), чтобы гейт
-- работал под ролью вызывающего внутри триггера.
create or replace function public.get_workspace_limit(uid uuid, workspace_kind text)
returns int
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when exists (
      select 1 from public.user_entitlements e
      where e.user_id = uid
        and e.plan in ('pro', 'trial', 'lifetime')
        and (e.plan = 'lifetime' or (e.valid_until is not null and e.valid_until > now()))
    ) then 7                                   -- платный: 7 суммарно по всем kind
    when workspace_kind = 'shared' then 0      -- free: shared недоступен
    else 2                                     -- free: 2 personal
  end;
$$;

comment on function public.get_workspace_limit(uuid, text) is
  'Тарифный лимит активных пространств владельца по kind: платный (pro/trial/lifetime активен) = 7 суммарно; free personal = 2; free shared = 0. SECURITY DEFINER (читает user_entitlements минуя RLS).';

revoke execute on function public.get_workspace_limit(uuid, text) from anon, authenticated, public;

-- ============================================================================
-- 2. enforce_workspace_limit — BEFORE INSERT триггер на sync_workspaces
-- ============================================================================
-- Считает активные (deleted_at IS NULL) пространства владельца NEW.owner_id
-- (не считая вставляемую строку) и сравнивает с get_workspace_limit. При
-- достижении/превышении лимита — RAISE EXCEPTION с машиночитаемым текстом
-- 'workspace_limit_exceeded' (ERRCODE P0001), который клиент распознаёт и
-- показывает апселл вместо generic error.
-- SECURITY DEFINER — критично: счётчик обязан видеть ВСЕ строки владельца минуя
-- RLS. При реальном push порядок «сначала все workspaces, потом все members»
-- (PUSH_ORDER, PR-2) означает, что на момент INSERT'а N-го пространства
-- owner-членства предыдущих ещё не вставлены → под RLS (has_workspace_role) они
-- невидимы и count был бы занижен. DEFINER-контекст даёт честный подсчёт.
create or replace function public.enforce_workspace_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_count int;
  v_limit int;
begin
  -- Гейт только для «пользователь создаёт СВОЁ пространство»: auth.uid() совпадает
  -- с owner_id. Это ровно то, что гарантирует RLS-политика INSERT (0027:
  -- owner_id = auth.uid() = user_id), поэтому для реального клиента условие всегда
  -- истинно. Пропускаем всё остальное:
  --   • service_role / backfill 0027 / суперпользователь (auth.uid() IS NULL);
  --   • вставки от чужого имени (owner_id <> auth.uid()) — доступны только
  --     доверенным (service_role/админ), лимит на них не распространяется.
  -- IS DISTINCT FROM корректно обрабатывает NULL.
  if (select auth.uid()) is distinct from new.owner_id then
    return new;
  end if;

  -- Активные пространства этого владельца (любого kind), кроме вставляемой строки.
  -- Форвард-совместимо с shared: считаем суммарно по всем kind (см. шапку файла).
  select count(*) into v_count
  from public.sync_workspaces w
  where w.owner_id = new.owner_id
    and w.deleted_at is null
    and w.id <> new.id;

  v_limit := public.get_workspace_limit(new.owner_id, new.kind);

  if v_count >= v_limit then
    raise exception 'workspace_limit_exceeded'
      using errcode = 'P0001',
            detail  = format('owner=%s kind=%s active=%s limit=%s', new.owner_id, new.kind, v_count, v_limit),
            hint    = 'Тарифный лимит пространств достигнут. Free: 2, Pro: 7.';
  end if;

  return new;
end;
$$;

comment on function public.enforce_workspace_limit() is
  'Guard: BEFORE INSERT на sync_workspaces. Не даёт превысить тарифный лимит активных пространств владельца (Free 2 / Pro 7). RAISE ''workspace_limit_exceeded'' (P0001). Гейт только когда auth.uid() = owner_id (клиент создаёт своё ws); service_role/backfill/вставки от чужого имени пропускает.';

drop trigger if exists enforce_workspace_limit on public.sync_workspaces;
create trigger enforce_workspace_limit
  before insert on public.sync_workspaces
  for each row execute function public.enforce_workspace_limit();

revoke execute on function public.enforce_workspace_limit() from anon, authenticated, public;
