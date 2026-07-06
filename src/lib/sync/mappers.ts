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
}

/** Payload для sync_tasks в Supabase (integer'ы заменены на uuid'ы). */
export interface CloudTaskPayload {
  id: string;                    // uuid задачи
  user_id: string;               // uuid из auth
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
 */
export function resolveStatusUuid(statusId: number): string | null {
  const row = db.get<{ uuid: string | null }>(
    'SELECT uuid FROM statuses WHERE id=?',
    [statusId],
  );
  return row?.uuid ?? null;
}

/** Резолвит локальный tag_id (int) → uuid тега. NULL → NULL. */
export function resolveTagUuid(tagId: number | null): string | null {
  if (tagId === null || tagId === undefined) return null;
  const row = db.get<{ uuid: string | null }>(
    'SELECT uuid FROM tags WHERE id=?',
    [tagId],
  );
  return row?.uuid ?? null;
}

/** Резолвит uuid статуса → локальный id. NULL/несуществующий → первый видимый статус. */
export function resolveStatusIdByUuid(uuid: string | null): number | null {
  if (!uuid) return null;
  const row = db.get<{ id: number }>(
    'SELECT id FROM statuses WHERE uuid=? AND deleted_at IS NULL',
    [uuid],
  );
  return row?.id ?? null;
}

/** Резолвит uuid тега → локальный id. NULL → NULL. */
export function resolveTagIdByUuid(uuid: string | null): number | null {
  if (!uuid) return null;
  const row = db.get<{ id: number }>(
    'SELECT id FROM tags WHERE uuid=? AND deleted_at IS NULL',
    [uuid],
  );
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
    title: row.title,
    comment: row.comment,
    status_id: resolveStatusUuid(row.status_id),
    tag_id: resolveTagUuid(row.tag_id),
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
}

/** Payload для sync_statuses. */
export interface CloudStatusPayload {
  id: string;
  user_id: string;
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
}

/** Payload для sync_tags. */
export interface CloudTagPayload {
  id: string;
  user_id: string;
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
}

/** Payload для sync_task_templates. */
export interface CloudTemplatePayload {
  id: string;
  user_id: string;
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
    name: row.name,
    title: row.title,
    comment: row.comment,
    status_id: row.status_id !== null ? resolveStatusUuid(row.status_id) : null,
    tag_id: resolveTagUuid(row.tag_id),
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    version: row.version,
    client_id: row.client_id ?? clientId,
  };
}

/**
 * Табличная информация для push цикла — как читать локальную строку и
 * конвертировать её в payload. Порядок в PUSH_ORDER важен: сначала parent'ы
 * (statuses/tags), потом children (tasks/templates), потом append-only
 * (overdue_events).
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
}

export const TASKS_SPEC: TableSpec<LocalTaskRow, CloudTaskPayload> = {
  outbox: 'tasks',
  cloud: 'sync_tasks',
  fetchLocal: (uuid) => db.get<LocalTaskRow>('SELECT * FROM tasks WHERE uuid=?', [uuid]),
  toCloud: taskToCloudPayload,
};

export const STATUSES_SPEC: TableSpec<LocalStatusRow, CloudStatusPayload> = {
  outbox: 'statuses',
  cloud: 'sync_statuses',
  fetchLocal: (uuid) => db.get<LocalStatusRow>('SELECT * FROM statuses WHERE uuid=?', [uuid]),
  toCloud: statusToCloudPayload,
};

export const TAGS_SPEC: TableSpec<LocalTagRow, CloudTagPayload> = {
  outbox: 'tags',
  cloud: 'sync_tags',
  fetchLocal: (uuid) => db.get<LocalTagRow>('SELECT * FROM tags WHERE uuid=?', [uuid]),
  toCloud: tagToCloudPayload,
};

export const TEMPLATES_SPEC: TableSpec<LocalTemplateRow, CloudTemplatePayload> = {
  outbox: 'task_templates',
  cloud: 'sync_task_templates',
  fetchLocal: (uuid) => db.get<LocalTemplateRow>('SELECT * FROM task_templates WHERE uuid=?', [uuid]),
  toCloud: templateToCloudPayload,
};

/**
 * Порядок push'а: parent'ы первыми, чтобы FK-ссылки на облаке разрешились.
 * statuses → tags → tasks → task_templates.
 * overdue_events на текущей итерации не пушим — они append-only и требуют
 * task_id (uuid задачи) уже присутствующим в облаке. Отложим на dev.5.
 */
export const PUSH_ORDER: TableSpec[] = [
  STATUSES_SPEC,
  TAGS_SPEC,
  TASKS_SPEC,
  TEMPLATES_SPEC,
];

/** Возвращает spec по имени outbox таблицы. */
export function getSpec(outboxTable: string): TableSpec | null {
  return PUSH_ORDER.find(s => s.outbox === outboxTable) ?? null;
}
