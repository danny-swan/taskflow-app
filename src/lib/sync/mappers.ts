// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * mappers.ts — конвертация локальных строк (integer id + uuid) ↔ облачных
 * (только uuid). Sync-таблицы облака полностью uuid-based, локальные строки
 * ссылаются друг на друга через integer id (tasks.status_id → statuses.id).
 *
 * При push мы должны заменить integer'ы на uuid'ы соответствующих строк.
 * При pull — наоборот: получить uuid'ы, найти локальные строки с этими
 * uuid'ами и подставить их integer id.
 *
 * ВАЖНО: NULL значения (tag_id = NULL — задача без тега) остаются NULL.
 */
import * as db from '../db';

/** Локальная строка задачи со всеми sync-колонками. */
export interface LocalTaskRow {
  id: number;
  uuid: string;
  title: string;
  comment: string;
  status_id: number;
  tag_id: number | null;
  start_date: string | null;
  deadline: string | null;
  finish_date: string | null;
  created_at: string;
  updated_at: string;
  sort_order: number;
  archived: number;  // 0/1
  deleted_at: string | null;
  version: number;
  client_id: string | null;
  workspace_id: string;
}

/** Payload для sync_tasks в Supabase (integer'ы заменены на uuid'ы). */
export interface CloudTaskPayload {
  id: string;                    // uuid задачи
  user_id: string;               // uuid из auth
  workspace_id: string;          // ws_<uid> (или иное пространство)
  title: string;
  comment: string;
  status_id: string | null;      // uuid статуса
  tag_id: string | null;         // uuid тега или NULL
  start_date: string | null;
  deadline: string | null;
  finish_date: string | null;
  sort_order: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_id: string;
}

/**
 * Резолвит локальный status_id (int) → uuid статуса.
 * Возвращает null если статус не найден или без uuid (странная база).
 *
 * Если передан workspaceId — поиск ограничен этим пространством (иначе задача
 * из одного ws могла бы подхватить uuid статуса другого ws). В Wave A ws один,
 * поэтому фильтр эквивалентен старому поведению, но код готов к shared (Wave B).
 */
export function resolveStatusUuid(statusId: number, workspaceId?: string | null): string | null {
  const row = workspaceId
    ? db.get<{ uuid: string | null }>(
        'SELECT uuid FROM statuses WHERE id=? AND workspace_id=?',
        [statusId, workspaceId],
      )
    : db.get<{ uuid: string | null }>('SELECT uuid FROM statuses WHERE id=?', [statusId]);
  return row?.uuid ?? null;
}

/** Резолвит локальный tag_id (int) → uuid тега. NULL → NULL. Опц. фильтр по ws. */
export function resolveTagUuid(tagId: number | null, workspaceId?: string | null): string | null {
  if (tagId === null || tagId === undefined) return null;
  const row = workspaceId
    ? db.get<{ uuid: string | null }>(
        'SELECT uuid FROM tags WHERE id=? AND workspace_id=?',
        [tagId, workspaceId],
      )
    : db.get<{ uuid: string | null }>('SELECT uuid FROM tags WHERE id=?', [tagId]);
  return row?.uuid ?? null;
}

/**
 * Резолвит uuid статуса → локальный id. NULL/несуществующий → null.
 * Опц. workspaceId ограничивает поиск пространством задачи (защита от подхвата
 * статуса чужого ws при коллизиях; в Wave A ws один).
 */
export function resolveStatusIdByUuid(uuid: string | null, workspaceId?: string | null): number | null {
  if (!uuid) return null;
  const row = workspaceId
    ? db.get<{ id: number }>(
        'SELECT id FROM statuses WHERE uuid=? AND workspace_id=? AND deleted_at IS NULL',
        [uuid, workspaceId],
      )
    : db.get<{ id: number }>('SELECT id FROM statuses WHERE uuid=? AND deleted_at IS NULL', [uuid]);
  return row?.id ?? null;
}

/** Резолвит uuid тега → локальный id. NULL → NULL. Опц. фильтр по ws. */
export function resolveTagIdByUuid(uuid: string | null, workspaceId?: string | null): number | null {
  if (!uuid) return null;
  const row = workspaceId
    ? db.get<{ id: number }>(
        'SELECT id FROM tags WHERE uuid=? AND workspace_id=? AND deleted_at IS NULL',
        [uuid, workspaceId],
      )
    : db.get<{ id: number }>('SELECT id FROM tags WHERE uuid=? AND deleted_at IS NULL', [uuid]);
  return row?.id ?? null;
}

/**
 * Строит payload для sync_tasks из локальной строки задачи.
 * user_id и client_id передаются извне (из auth session и getClientId()).
 */
export function taskToCloudPayload(
  row: LocalTaskRow,
  userId: string,
  clientId: string,
): CloudTaskPayload {
  return {
    id: row.uuid,
    user_id: userId,
    workspace_id: row.workspace_id,
    title: row.title,
    comment: row.comment,
    status_id: resolveStatusUuid(row.status_id, row.workspace_id),
    tag_id: resolveTagUuid(row.tag_id, row.workspace_id),
    start_date: row.start_date,
    deadline: row.deadline,
    finish_date: row.finish_date,
    sort_order: row.sort_order,
    archived: row.archived === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    version: row.version,
    client_id: row.client_id ?? clientId,
  };
}

/** Локальная строка статуса. */
export interface LocalStatusRow {
  id: number;
  uuid: string;
  name: string;
  color: string;
  behavior: string;
  sort_order: number;
  is_seed: number;
  is_technical: number;
  hidden: number;
  default_collapsed: number;
  created_at?: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_id: string | null;
  workspace_id: string;
}

/** Payload для sync_statuses. */
export interface CloudStatusPayload {
  id: string;
  user_id: string;
  workspace_id: string;
  name: string;
  color: string;
  behavior: string;
  sort_order: number;
  is_seed: boolean;
  is_technical: boolean;
  hidden: boolean;
  default_collapsed: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_id: string;
}

export function statusToCloudPayload(
  row: LocalStatusRow,
  userId: string,
  clientId: string,
): CloudStatusPayload {
  return {
    id: row.uuid,
    user_id: userId,
    workspace_id: row.workspace_id,
    name: row.name,
    color: row.color,
    behavior: row.behavior,
    sort_order: row.sort_order,
    is_seed: row.is_seed === 1,
    is_technical: row.is_technical === 1,
    hidden: row.hidden === 1,
    default_collapsed: row.default_collapsed === 1,
    created_at: row.created_at ?? row.updated_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    version: row.version,
    client_id: row.client_id ?? clientId,
  };
}

/** Локальная строка тега. */
export interface LocalTagRow {
  id: number;
  uuid: string;
  name: string;
  color: string;
  sort_order: number;
  created_at?: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_id: string | null;
  workspace_id: string;
}

/** Payload для sync_tags. */
export interface CloudTagPayload {
  id: string;
  user_id: string;
  workspace_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_id: string;
}

export function tagToCloudPayload(
  row: LocalTagRow,
  userId: string,
  clientId: string,
): CloudTagPayload {
  return {
    id: row.uuid,
    user_id: userId,
    workspace_id: row.workspace_id,
    name: row.name,
    color: row.color,
    sort_order: row.sort_order,
    created_at: row.created_at ?? row.updated_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    version: row.version,
    client_id: row.client_id ?? clientId,
  };
}

/** Локальная строка шаблона задачи. */
export interface LocalTemplateRow {
  id: number;
  uuid: string;
  name: string;
  title: string;
  comment: string;
  status_id: number | null;
  tag_id: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_id: string | null;
  workspace_id: string;
}

/** Payload для sync_task_templates. */
export interface CloudTemplatePayload {
  id: string;
  user_id: string;
  workspace_id: string;
  name: string;
  title: string;
  comment: string;
  status_id: string | null;
  tag_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_id: string;
}

export function templateToCloudPayload(
  row: LocalTemplateRow,
  userId: string,
  clientId: string,
): CloudTemplatePayload {
  return {
    id: row.uuid,
    user_id: userId,
    workspace_id: row.workspace_id,
    name: row.name,
    title: row.title,
    comment: row.comment,
    status_id: row.status_id !== null ? resolveStatusUuid(row.status_id, row.workspace_id) : null,
    tag_id: resolveTagUuid(row.tag_id, row.workspace_id),
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    version: row.version,
    client_id: row.client_id ?? clientId,
  };
}

// ─── overdue_events ─────────────────────────────────────────────────────────
//
// Локальная строка ссылается на задачу через int task_id → tasks.id.
// В облаке task_id — это uuid задачи (без FK, потому что overdue_events
// append-only и задача может быть soft-deleted).
//
// Особенности:
//   * НЕТ updated_at и version в облачной схеме — append-only
//   * pull курсор идёт по id (uuidv7 монотонный, лексикографически = временной)
//   * маппер требует, чтобы у task уже был uuid в облаке (значит task должен
//     быть запушен до overdue_event) — гарантируется через PUSH_ORDER

/** Локальная строка события просрочки. */
export interface LocalOverdueEventRow {
  id: number;
  task_id: number;
  deadline_snapshot: string;
  event_date: string;
  created_at: string;
  updated_at: string;
  uuid: string;
  deleted_at: string | null;
  version: number;
  client_id: string | null;
  workspace_id: string;
}

/** Payload для sync_overdue_events. */
export interface CloudOverdueEventPayload {
  id: string;
  user_id: string;
  workspace_id: string;
  task_id: string;             // uuid задачи
  deadline_snapshot: string;
  event_date: string;
  created_at: string;
  deleted_at: string | null;
  client_id: string;
}

/** Резолвит локальный task_id (int) → uuid задачи. Кидает Error если задача не найдена. */
export function resolveTaskUuid(taskId: number): string {
  const row = db.get<{ uuid: string | null }>(
    'SELECT uuid FROM tasks WHERE id=?',
    [taskId],
  );
  if (!row?.uuid) {
    throw new Error(`task ${taskId} has no uuid (нельзя запушить overdue_event)`);
  }
  return row.uuid;
}

/** Резолвит uuid задачи → локальный id (для pull-side). NULL если не найден. */
export function resolveTaskIdByUuid(uuid: string | null): number | null {
  if (!uuid) return null;
  const row = db.get<{ id: number }>(
    'SELECT id FROM tasks WHERE uuid=?',
    [uuid],
  );
  return row?.id ?? null;
}

export function overdueEventToCloudPayload(
  row: LocalOverdueEventRow,
  userId: string,
  clientId: string,
): CloudOverdueEventPayload {
  return {
    id: row.uuid,
    user_id: userId,
    workspace_id: row.workspace_id,
    task_id: resolveTaskUuid(row.task_id),
    deadline_snapshot: row.deadline_snapshot,
    event_date: row.event_date,
    created_at: row.created_at,
    deleted_at: row.deleted_at,
    client_id: row.client_id ?? clientId,
  };
}

// ─── task_hold_periods ──────────────────────────────────────────────────────
//
// Интервалы статуса «Приостановлено» для столбца «Холд» в Статистике.
// Ссылается на задачу через int task_id → tasks.id; в облаке task_id — uuid.
//
// В отличие от overdue_events, строка МУТАБЕЛЬНА (ended_at закрывается при
// выходе из холда), поэтому есть updated_at + version, а pull идёт по LWW
// (курсор updated_at), как у tasks/statuses/tags.

/** Локальная строка холд-интервала. */
export interface LocalHoldPeriodRow {
  id: number;
  task_id: number;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  uuid: string;
  deleted_at: string | null;
  version: number;
  client_id: string | null;
  workspace_id: string;
}

/** Payload для sync_task_hold_periods. */
export interface CloudHoldPeriodPayload {
  id: string;
  user_id: string;
  workspace_id: string;
  task_id: string;             // uuid задачи
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_id: string;
}

export function holdPeriodToCloudPayload(
  row: LocalHoldPeriodRow,
  userId: string,
  clientId: string,
): CloudHoldPeriodPayload {
  return {
    id: row.uuid,
    user_id: userId,
    workspace_id: row.workspace_id,
    task_id: resolveTaskUuid(row.task_id),
    started_at: row.started_at,
    ended_at: row.ended_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    version: row.version,
    client_id: row.client_id ?? clientId,
  };
}

// ─── workspaces / workspace_members / workspace_settings ────────────────────
//
// Три новые ws-сущности (Wave A PR-2). Пространство и членство — «родители» для
// всех прочих sync-таблиц (задача/статус ссылаются на workspace_id), поэтому в
// PUSH_ORDER идут первыми. Поля — строго как в 0027 (сервер) и v11 (локально).
//
// Особенности контракта относительно шести старых таблиц:
//   * sync_workspaces имеет собственный id (== ws_<uid>) + user_id + owner_id
//     (в Wave A user_id == owner_id). Локально нет колонки user_id — берём
//     owner_id (или переданный userId как fallback).
//   * sync_workspace_settings НЕ имеет колонок id и user_id: PK = (workspace_id,
//     key). Поэтому upsert идёт onConflict 'workspace_id,key', а pull скоупится
//     по workspace_id (не по user_id). Локальный uuid используется только как
//     ключ outbox/fetchLocal.

/** Локальная строка пространства. */
export interface LocalWorkspaceRow {
  id: number;
  uuid: string;                  // = серверный sync_workspaces.id (ws_<uid>)
  name: string;
  kind: string;
  owner_id: string | null;       // uuid владельца
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_id: string | null;
}

/** Payload для sync_workspaces. */
export interface CloudWorkspacePayload {
  id: string;
  user_id: string;
  owner_id: string;
  name: string;
  kind: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_id: string;
}

export function workspaceToCloudPayload(
  row: LocalWorkspaceRow,
  userId: string,
  clientId: string,
): CloudWorkspacePayload {
  // Bug A: серверный RLS требует owner_id=auth.uid() AND user_id=auth.uid() на
  // INSERT sync_workspaces. Пушить ws может ТОЛЬКО его владелец, поэтому живой
  // userId из сессии авторитетнее локального owner_id (который мог протухнуть при
  // рассинхроне bound_user_id и давал вечный 42501 → залипший outbox).
  const owner = userId || row.owner_id || '';
  return {
    id: row.uuid,
    user_id: owner,            // Wave A: владелец == пользователь
    owner_id: owner,
    name: row.name,
    kind: row.kind,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    version: row.version,
    client_id: row.client_id ?? clientId,
  };
}

/** Локальная строка членства. */
export interface LocalMemberRow {
  id: number;
  uuid: string;
  workspace_id: string;
  user_id: string | null;
  role: string;
  invited_by: string | null;
  joined_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_id: string | null;
}

/** Payload для sync_workspace_members. */
export interface CloudMemberPayload {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  invited_by: string | null;
  joined_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_id: string;
}

export function memberToCloudPayload(
  row: LocalMemberRow,
  userId: string,
  clientId: string,
): CloudMemberPayload {
  return {
    id: row.uuid,
    workspace_id: row.workspace_id,
    // owner-membership пушит только сам владелец → user_id обязан совпадать с
    // auth.uid() живой сессии (иначе RLS 42501, как у workspaces). Чужие роли
    // (invite/remove участника) не трогаем — там user_id принадлежит другому.
    user_id: row.role === 'owner' ? (userId || row.user_id || '') : (row.user_id ?? userId),
    role: row.role,
    invited_by: row.invited_by,
    joined_at: row.joined_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    version: row.version,
    client_id: row.client_id ?? clientId,
  };
}

/** Локальная строка настройки пространства. */
export interface LocalSettingRow {
  id: number;
  uuid: string | null;
  workspace_id: string;
  key: string;
  value: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_id: string | null;
}

/** Payload для sync_workspace_settings (PK = workspace_id+key, без id/user_id). */
export interface CloudSettingPayload {
  workspace_id: string;
  key: string;
  value: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  client_id: string;
}

export function settingToCloudPayload(
  row: LocalSettingRow,
  _userId: string,
  clientId: string,
): CloudSettingPayload {
  return {
    workspace_id: row.workspace_id,
    key: row.key,
    value: row.value,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    version: row.version,
    client_id: row.client_id ?? clientId,
  };
}

// ─── task_activity_log ──────────────────────────────────────────────────────
//
// Исторический журнал изменений задач в shared-пространствах (миграция 0034,
// Wave C). ПУЛЛ-ONLY: строки создаёт только серверный триггер log_task_activity;
// клиент их читает, но НИКОГДА не пушит (toCloud кидает). В outbox не попадает,
// поэтому в PUSH_ORDER его нет — только в PULL_ORDER.
//
// Особенности:
//   * Иммутабельный append-only — нет updated_at/version/deleted_at.
//   * pull-курсор идёт по created_at (см. cursorColumnFor в pull.ts).
//   * task_id хранится как серверный uuid задачи (без резолюции в int) — UI
//     фильтрует записи по tasks.uuid.
//   * payload (jsonb в облаке) в локальной SQLite-зеркалке хранится как TEXT
//     (JSON-строка).

/** Локальная строка зеркала журнала активности (SQLite). */
export interface LocalActivityLogRow {
  id: number;
  uuid: string;                  // = серверный sync_task_activity_log.id
  task_id: string;               // серверный uuid задачи
  workspace_id: string;
  user_id: string;
  kind: string;
  payload: string;               // JSON-строка
  created_at: string;
}

/**
 * Табличная информация для push цикла — как читать локальную строку и
 * конвертировать её в payload. Порядок в PUSH_ORDER важен: сначала parent'ы
 * (workspaces/members → statuses/tags), потом children (tasks/templates), потом
 * append-only (overdue_events).
 */
export interface TableSpec<L = any, C = any> {
  /** Имя таблицы в outbox (совпадает с локальной таблицей). */
  outbox: string;
  /** Имя таблицы в облаке (Supabase). */
  cloud: string;
  /** SELECT одной строки по uuid из локальной таблицы. */
  fetchLocal: (uuid: string) => L | null;
  /** Конвертация локальной строки в облачный payload. */
  toCloud: (row: L, userId: string, clientId: string) => C;
  /** Колонка(и) конфликта для upsert. По умолчанию 'id'. */
  onConflict?: string;
  /**
   * Как скоупить pull:
   *   • 'user_id' — WHERE user_id = <me> (только СВОИ строки; годится для входа
   *     в набор — sync_workspace_members);
   *   • 'workspace_id' — WHERE workspace_id IN (<мои ws>) (данные пространства,
   *     принадлежащие любому владельцу — опираемся на серверный RLS по членству);
   *   • 'id' — WHERE id IN (<мои ws>) (для sync_workspaces, у которой сам id и есть
   *     идентификатор пространства, отдельной колонки workspace_id нет).
   * По умолчанию (не задано) = 'user_id'.
   */
  pullScope?: 'user_id' | 'workspace_id' | 'id';
}

export const TASKS_SPEC: TableSpec<LocalTaskRow, CloudTaskPayload> = {
  outbox: 'tasks',
  cloud: 'sync_tasks',
  fetchLocal: (uuid) => db.get<LocalTaskRow>('SELECT * FROM tasks WHERE uuid=?', [uuid]),
  toCloud: taskToCloudPayload,
  pullScope: 'workspace_id',   // P0: тянем по пространству, не по user_id (shared-ws)
};

export const STATUSES_SPEC: TableSpec<LocalStatusRow, CloudStatusPayload> = {
  outbox: 'statuses',
  cloud: 'sync_statuses',
  fetchLocal: (uuid) => db.get<LocalStatusRow>('SELECT * FROM statuses WHERE uuid=?', [uuid]),
  toCloud: statusToCloudPayload,
  pullScope: 'workspace_id',   // P0
};

export const TAGS_SPEC: TableSpec<LocalTagRow, CloudTagPayload> = {
  outbox: 'tags',
  cloud: 'sync_tags',
  fetchLocal: (uuid) => db.get<LocalTagRow>('SELECT * FROM tags WHERE uuid=?', [uuid]),
  toCloud: tagToCloudPayload,
  pullScope: 'workspace_id',   // P0
};

export const TEMPLATES_SPEC: TableSpec<LocalTemplateRow, CloudTemplatePayload> = {
  outbox: 'task_templates',
  cloud: 'sync_task_templates',
  fetchLocal: (uuid) => db.get<LocalTemplateRow>('SELECT * FROM task_templates WHERE uuid=?', [uuid]),
  toCloud: templateToCloudPayload,
  pullScope: 'workspace_id',   // P0
};

export const OVERDUE_EVENTS_SPEC: TableSpec<LocalOverdueEventRow, CloudOverdueEventPayload> = {
  outbox: 'overdue_events',
  cloud: 'sync_overdue_events',
  fetchLocal: (uuid) => db.get<LocalOverdueEventRow>('SELECT * FROM overdue_events WHERE uuid=?', [uuid]),
  toCloud: overdueEventToCloudPayload,
  pullScope: 'workspace_id',   // P0
};

export const HOLD_PERIODS_SPEC: TableSpec<LocalHoldPeriodRow, CloudHoldPeriodPayload> = {
  outbox: 'task_hold_periods',
  cloud: 'sync_task_hold_periods',
  fetchLocal: (uuid) => db.get<LocalHoldPeriodRow>('SELECT * FROM task_hold_periods WHERE uuid=?', [uuid]),
  toCloud: holdPeriodToCloudPayload,
  pullScope: 'workspace_id',   // P0
};

export const WORKSPACES_SPEC: TableSpec<LocalWorkspaceRow, CloudWorkspacePayload> = {
  outbox: 'workspaces',
  cloud: 'sync_workspaces',
  fetchLocal: (uuid) => db.get<LocalWorkspaceRow>('SELECT * FROM workspaces WHERE uuid=?', [uuid]),
  toCloud: workspaceToCloudPayload,
  pullScope: 'id',   // P0: у sync_workspaces сам id == ws-id (нет колонки workspace_id)
};

export const WORKSPACE_MEMBERS_SPEC: TableSpec<LocalMemberRow, CloudMemberPayload> = {
  outbox: 'workspace_members',
  cloud: 'sync_workspace_members',
  fetchLocal: (uuid) => db.get<LocalMemberRow>('SELECT * FROM workspace_members WHERE uuid=?', [uuid]),
  toCloud: memberToCloudPayload,
  pullScope: 'user_id',   // P0: членство — ВХОД в набор ws, тянем строго по своему user_id
};

export const WORKSPACE_SETTINGS_SPEC: TableSpec<LocalSettingRow, CloudSettingPayload> = {
  outbox: 'workspace_settings',
  cloud: 'sync_workspace_settings',
  fetchLocal: (uuid) => db.get<LocalSettingRow>('SELECT * FROM workspace_settings WHERE uuid=?', [uuid]),
  toCloud: settingToCloudPayload,
  onConflict: 'workspace_id,key',   // серверный PK — (workspace_id, key), нет id
  pullScope: 'workspace_id',        // таблица без user_id → скоуп по ws
};

/**
 * ПУЛЛ-ONLY spec журнала активности. В PUSH_ORDER НЕ входит (клиент не пушит):
 * fetchLocal читает локальное зеркало, toCloud кидает — на случай, если строка
 * по ошибке попадёт в push-цикл, лучше упасть, чем молча отправить лог.
 */
export const ACTIVITY_LOG_SPEC: TableSpec<LocalActivityLogRow, never> = {
  outbox: 'task_activity_log',
  cloud: 'sync_task_activity_log',
  fetchLocal: (uuid) => db.get<LocalActivityLogRow>('SELECT * FROM task_activity_log WHERE uuid=?', [uuid]),
  toCloud: () => {
    throw new Error('sync_task_activity_log is pull-only (пишет только серверный триггер)');
  },
  pullScope: 'workspace_id',   // таблица без user_id-скоупа клиента → по ws
};

/**
 * Порядок push'а: parent'ы первыми, чтобы ссылки на облаке разрешились.
 * workspaces → workspace_members → workspace_settings → statuses → tags →
 * tasks → task_templates → overdue_events → task_hold_periods.
 * Пространство и членство — «родители» для всего (RLS через членство), их надо
 * создать раньше любых строк, ссылающихся на workspace_id. overdue_events идут
 * ПОСЛЕ tasks — их маппер требует task.uuid, уже запушенный и видимый в облаке.
 */
export const PUSH_ORDER: TableSpec[] = [
  WORKSPACES_SPEC,
  WORKSPACE_MEMBERS_SPEC,
  WORKSPACE_SETTINGS_SPEC,
  STATUSES_SPEC,
  TAGS_SPEC,
  TASKS_SPEC,
  TEMPLATES_SPEC,
  OVERDUE_EVENTS_SPEC,
  HOLD_PERIODS_SPEC,
];

/**
 * Порядок pull'а: всё из PUSH_ORDER плюс пулл-only журнал активности в конце
 * (после tasks — записи ссылаются на task.uuid, который к этому моменту локален).
 */
export const PULL_ORDER: TableSpec[] = [
  ...PUSH_ORDER,
  ACTIVITY_LOG_SPEC,
];

/** Возвращает spec по имени outbox таблицы. */
export function getSpec(outboxTable: string): TableSpec | null {
  return PUSH_ORDER.find(s => s.outbox === outboxTable) ?? null;
}
