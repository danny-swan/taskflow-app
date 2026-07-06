// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * pull.ts — подтягивание изменений из Supabase в локальную БД.
 *
 * Алгоритм:
 * 1. Для каждой sync-таблицы читаем last_pulled_at из settings.
 *    Если нет — берём '1970-01-01' (первый pull = получаем всё).
 * 2. SELECT WHERE user_id = <me> AND updated_at > last_pulled_at
 *    ORDER BY updated_at LIMIT N.
 * 3. Для каждой строки применяем LWW:
 *    - Ищем локальную строку по uuid.
 *    - Если нет — INSERT (новый integer id, сохраняем uuid).
 *    - Если есть и локальный updated_at >= облачный — пропускаем (мы новее).
 *    - Если есть и облачный updated_at > локальный — UPDATE.
 * 4. Обновляем last_pulled_at на max(updated_at) из пришедших строк.
 *
 * Порядок таблиц при pull такой же как при push: parent'ы первыми, чтобы
 * при UPSERT'е задач можно было разрешить status_id/tag_id uuid'ы в
 * локальные integer id.
 */
import * as db from '../db';
import { supabase } from '../supabase';
import { logger } from '../logger';
import {
  PUSH_ORDER,
  resolveStatusIdByUuid,
  resolveTagIdByUuid,
  resolveTaskIdByUuid,
  type TableSpec,
} from './mappers';

/** Ключ в settings для хранения last_pulled cursor per-table. */
function lastPulledKey(cloudTable: string): string {
  return `sync_last_pulled_${cloudTable}`;
}

/**
 * Читает last_pulled cursor для таблицы из settings.
 * cursorCol определяет начальное значение (updated_at → '1970-01-01', id → zero uuid).
 */
function getLastPulledAt(cloudTable: string, cursorCol: 'updated_at' | 'id' = 'updated_at'): string {
  const row = db.get<{ value: string }>(
    'SELECT value FROM settings WHERE key=?',
    [lastPulledKey(cloudTable)],
  );
  if (row?.value) return row.value;
  return cursorCol === 'id'
    ? '00000000-0000-0000-0000-000000000000'
    : '1970-01-01T00:00:00Z';
}

/** Обновляет last_pulled cursor в settings. */
function setLastPulledAt(cloudTable: string, value: string): void {
  db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [lastPulledKey(cloudTable), value],
  );
}

const PULL_BATCH_SIZE = 500;

/**
 * Тип "row из облака" — общий для всех таблиц, ключевые поля unified'ы.
 * Все sync-таблицы имеют: id (uuid), updated_at, deleted_at, version.
 */
interface CloudRow {
  id: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
  [key: string]: any;
}

/** Применяет одну строку из облака к локальной БД. Возвращает true, если что-то изменили. */
function applyCloudRowTasks(row: CloudRow): boolean {
  const local = db.get<{ id: number; updated_at: string; version: number }>(
    'SELECT id, updated_at, version FROM tasks WHERE uuid=?',
    [row.id],
  );

  if (local) {
    // LWW: если локально новее или равно — пропускаем.
    if (local.updated_at >= row.updated_at) return false;
    // Обновляем.
    db.run(
      `UPDATE tasks
       SET title=?, comment=?,
           status_id=COALESCE(?, status_id),
           tag_id=?,
           start_date=?, deadline=?, finish_date=?,
           sort_order=?, archived=?,
           updated_at=?, deleted_at=?, version=?, client_id=?
       WHERE uuid=?`,
      [
        row.title,
        row.comment,
        resolveStatusIdByUuid(row.status_id),
        resolveTagIdByUuid(row.tag_id),
        row.start_date,
        row.deadline,
        row.finish_date,
        row.sort_order,
        row.archived ? 1 : 0,
        row.updated_at,
        row.deleted_at,
        row.version,
        row.client_id,
        row.id,
      ],
    );
    return true;
  }

  // Локальной строки нет — INSERT новую с сохранением uuid.
  const statusIntId = resolveStatusIdByUuid(row.status_id);
  if (statusIntId === null) {
    // Нельзя вставить задачу без статуса. Логируем и скипаем — pull подхватит
    // при следующей итерации, когда статус подтянется.
    logger.warn(`[sync/pull] task ${row.id}: status ${row.status_id} not yet local, skipping`);
    return false;
  }
  db.run(
    `INSERT INTO tasks
      (uuid, title, comment, status_id, tag_id, start_date, deadline, finish_date,
       sort_order, archived, created_at, updated_at, deleted_at, version, client_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      row.id,
      row.title,
      row.comment,
      statusIntId,
      resolveTagIdByUuid(row.tag_id),
      row.start_date,
      row.deadline,
      row.finish_date,
      row.sort_order,
      row.archived ? 1 : 0,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.version,
      row.client_id,
    ],
  );
  return true;
}

function applyCloudRowStatuses(row: CloudRow): boolean {
  const local = db.get<{ id: number; updated_at: string }>(
    'SELECT id, updated_at FROM statuses WHERE uuid=?',
    [row.id],
  );
  if (local) {
    if (local.updated_at >= row.updated_at) return false;
    db.run(
      `UPDATE statuses
       SET name=?, color=?, behavior=?, sort_order=?, is_seed=?, is_technical=?,
           hidden=?, default_collapsed=?,
           updated_at=?, deleted_at=?, version=?, client_id=?
       WHERE uuid=?`,
      [
        row.name, row.color, row.behavior, row.sort_order,
        row.is_seed ? 1 : 0, row.is_technical ? 1 : 0,
        row.hidden ? 1 : 0, row.default_collapsed ? 1 : 0,
        row.updated_at, row.deleted_at, row.version, row.client_id,
        row.id,
      ],
    );
    return true;
  }
  db.run(
    `INSERT INTO statuses
      (uuid, name, color, behavior, sort_order, is_seed, is_technical,
       hidden, default_collapsed, updated_at, deleted_at, version, client_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      row.id, row.name, row.color, row.behavior, row.sort_order,
      row.is_seed ? 1 : 0, row.is_technical ? 1 : 0,
      row.hidden ? 1 : 0, row.default_collapsed ? 1 : 0,
      row.updated_at, row.deleted_at, row.version, row.client_id,
    ],
  );
  return true;
}

function applyCloudRowTags(row: CloudRow): boolean {
  const local = db.get<{ id: number; updated_at: string }>(
    'SELECT id, updated_at FROM tags WHERE uuid=?',
    [row.id],
  );
  if (local) {
    if (local.updated_at >= row.updated_at) return false;
    db.run(
      `UPDATE tags
       SET name=?, color=?, sort_order=?,
           updated_at=?, deleted_at=?, version=?, client_id=?
       WHERE uuid=?`,
      [row.name, row.color, row.sort_order,
       row.updated_at, row.deleted_at, row.version, row.client_id, row.id],
    );
    return true;
  }
  db.run(
    `INSERT INTO tags (uuid, name, color, sort_order, updated_at, deleted_at, version, client_id)
     VALUES (?,?,?,?,?,?,?,?)`,
    [row.id, row.name, row.color, row.sort_order,
     row.updated_at, row.deleted_at, row.version, row.client_id],
  );
  return true;
}

/**
 * overdue_events: append-only, нет updated_at/version. LWW идёт по id
 * (uuidv7 монотонный). Если локально есть — обновляем только deleted_at,
 * остальное immutable. Если нет — INSERT (при условии что task уже локально).
 */
function applyCloudRowOverdueEvents(row: CloudRow): boolean {
  const local = db.get<{ id: number; deleted_at: string | null }>(
    'SELECT id, deleted_at FROM overdue_events WHERE uuid=?',
    [row.id],
  );
  if (local) {
    // Меняем только если deleted_at отличается (единственное mutable-поле).
    if ((local.deleted_at ?? null) === (row.deleted_at ?? null)) return false;
    db.run(
      `UPDATE overdue_events SET deleted_at=?, updated_at=? WHERE uuid=?`,
      [row.deleted_at, new Date().toISOString(), row.id],
    );
    return true;
  }
  // Новая строка. Нужна локальная task_id (int).
  const taskId = resolveTaskIdByUuid(row.task_id);
  if (taskId === null) {
    logger.warn(`[sync/pull] overdue_event ${row.id}: task ${row.task_id} не локально, deferred`);
    return false;
  }
  db.run(
    `INSERT INTO overdue_events
      (uuid, task_id, deadline_snapshot, event_date, created_at, updated_at,
       deleted_at, version, client_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      row.id,
      taskId,
      row.deadline_snapshot,
      row.event_date,
      row.created_at,
      row.created_at,           // updated_at = created_at у append-only
      row.deleted_at,
      1,                        // version — локально всегда 1 для overdue
      row.client_id,
    ],
  );
  return true;
}

function applyCloudRowTemplates(row: CloudRow): boolean {
  const local = db.get<{ id: number; updated_at: string }>(
    'SELECT id, updated_at FROM task_templates WHERE uuid=?',
    [row.id],
  );
  if (local) {
    if (local.updated_at >= row.updated_at) return false;
    db.run(
      `UPDATE task_templates
       SET name=?, title=?, comment=?,
           status_id=?, tag_id=?, sort_order=?,
           updated_at=?, deleted_at=?, version=?, client_id=?
       WHERE uuid=?`,
      [row.name, row.title, row.comment,
       row.status_id ? resolveStatusIdByUuid(row.status_id) : null,
       resolveTagIdByUuid(row.tag_id),
       row.sort_order,
       row.updated_at, row.deleted_at, row.version, row.client_id, row.id],
    );
    return true;
  }
  db.run(
    `INSERT INTO task_templates
      (uuid, name, title, comment, status_id, tag_id, sort_order,
       created_at, updated_at, deleted_at, version, client_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [row.id, row.name, row.title, row.comment,
     row.status_id ? resolveStatusIdByUuid(row.status_id) : null,
     resolveTagIdByUuid(row.tag_id),
     row.sort_order, row.created_at, row.updated_at, row.deleted_at,
     row.version, row.client_id],
  );
  return true;
}

/** Карта applier'ов по имени облачной таблицы. */
const APPLIERS: Record<string, (row: CloudRow) => boolean> = {
  sync_tasks: applyCloudRowTasks,
  sync_statuses: applyCloudRowStatuses,
  sync_tags: applyCloudRowTags,
  sync_task_templates: applyCloudRowTemplates,
  sync_overdue_events: applyCloudRowOverdueEvents,
};

/**
 * Описание курсора для pull. Большинство таблиц пуллятся по updated_at,
 * а overdue_events — по id (uuidv7 монотонный).
 */
function cursorColumnFor(cloudTable: string): 'updated_at' | 'id' {
  return cloudTable === 'sync_overdue_events' ? 'id' : 'updated_at';
}

/** Ключ settings для last_pulled cursor value. */
function lastPulledCursorKey(cloudTable: string): string {
  return `sync_last_pulled_${cloudTable}`;
}

/** Начальное значение курсора — чтобы вычитать всё при первом pull. */
function initialCursorValue(cloudTable: string): string {
  return cloudTable === 'sync_overdue_events'
    ? '00000000-0000-0000-0000-000000000000'
    : '1970-01-01T00:00:00Z';
}

export interface PullResult {
  /** Сколько строк применено. */
  applied: number;
  /** Сколько строк получено но пропущено (LWW: локально новее). */
  skipped: number;
  /** Сколько строк не удалось применить (например, нет parent'а). */
  deferred: number;
  /** Первая ошибка. */
  firstError: string | null;
}

/**
 * Пуллит одну таблицу. Обновляет last_pulled_at на max(updated_at).
 */
async function pullTable(userId: string, spec: TableSpec): Promise<PullResult> {
  const result: PullResult = { applied: 0, skipped: 0, deferred: 0, firstError: null };
  const applier = APPLIERS[spec.cloud];
  if (!applier) {
    logger.warn(`[sync/pull] no applier for ${spec.cloud}, skipping`);
    return result;
  }

  const cursorCol = cursorColumnFor(spec.cloud);
  const lastPulled = getLastPulledAt(spec.cloud, cursorCol);
  try {
    const { data, error } = await supabase
      .from(spec.cloud)
      .select('*')
      .eq('user_id', userId)
      .gt(cursorCol, lastPulled)
      .order(cursorCol, { ascending: true })
      .limit(PULL_BATCH_SIZE);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return result;

    let maxCursor = lastPulled;
    for (const raw of data as CloudRow[]) {
      try {
        const changed = applier(raw);
        if (changed) result.applied++;
        else result.skipped++;
        const rowCursor = String((raw as any)[cursorCol] ?? '');
        if (rowCursor > maxCursor) maxCursor = rowCursor;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`[sync/pull] ${spec.cloud} apply failed for ${raw.id}:`, msg);
        result.deferred++;
        if (!result.firstError) result.firstError = msg;
      }
    }

    // Сохраняем прогресс. Если applied+skipped == батч, возможно есть ещё —
    // orchestrator позовёт нас снова.
    setLastPulledAt(spec.cloud, maxCursor);
    logger.info(
      `[sync/pull] ${spec.cloud}: +${result.applied} applied, ${result.skipped} skipped, ${result.deferred} deferred`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`[sync/pull] ${spec.cloud} failed:`, msg);
    result.firstError = msg;
  }

  return result;
}

/**
 * Полный pull: пуллит все таблицы в порядке PUSH_ORDER (parent'ы первыми).
 * Если applied+skipped == PULL_BATCH_SIZE — было много изменений, идём
 * следующей итерацией той же таблицы (max 5 итераций).
 */
export async function pullAll(userId: string): Promise<PullResult> {
  const total: PullResult = { applied: 0, skipped: 0, deferred: 0, firstError: null };
  for (const spec of PUSH_ORDER) {
    for (let i = 0; i < 5; i++) {
      const r = await pullTable(userId, spec);
      total.applied += r.applied;
      total.skipped += r.skipped;
      total.deferred += r.deferred;
      if (!total.firstError && r.firstError) total.firstError = r.firstError;
      if (r.applied + r.skipped < PULL_BATCH_SIZE) break;
      // Иначе — было batch_size, возможно есть ещё.
    }
  }
  return total;
}

// Экспорт для тестов
export const _internals = {
  getLastPulledAt,
  setLastPulledAt,
  applyCloudRowTasks,
  applyCloudRowStatuses,
  applyCloudRowTags,
  applyCloudRowTemplates,
  applyCloudRowOverdueEvents,
  cursorColumnFor,
  initialCursorValue,
  lastPulledCursorKey,
  APPLIERS,
  PULL_BATCH_SIZE,
};
