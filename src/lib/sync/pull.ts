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
import { uuidv7 } from '../uuid';
import {
  PULL_ORDER,
  WORKSPACE_MEMBERS_SPEC,
  resolveStatusIdByUuid,
  resolveTagIdByUuid,
  resolveTaskIdByUuid,
  type TableSpec,
} from './mappers';
import {
  listMembershipWorkspaceIds,
  computeWorkspaceId,
  LOCAL_WS_ID,
} from './workspace';

/**
 * v0.9.35-dev.6.10.3 — Маркер «отложить строку» (deferred by design).
 *
 * Отличает ОЖИДАЕМОЕ отложение (например, задача-сирота, чей статус ещё не
 * пришёл из облака) от НАСТОЯЩЕЙ ошибки (сеть, RLS, битый SQL). Отложение —
 * это нормальная часть протокола: строка просто применится на следующем pull,
 * когда придёт её parent. Поэтому оно НЕ должно поднимать статус sync в 'error'
 * в UI (иначе у пользователя вечная «ошибка синхронизации» — это была Проблема №3).
 */
export class DeferRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeferRowError';
  }
}

/**
 * F16 (ADR 0010, roadmap §7.16) — маркер «локальная SQLite повреждена».
 *
 * В отличие от DeferRowError (ожидаемое отложение до прихода parent'а), это
 * НАСТОЯЩАЯ фатальная ошибка: applier наткнулся на признак физической
 * порчи локальной базы (malformed image / SQLITE_CORRUPT) или на расхождение
 * unique-индекса с данными (SELECT WHERE uuid=? не находит строку, но INSERT
 * в неё же ловит 2067). Продолжать применять строки поверх такой базы
 * бессмысленно и опасно — pullAll должен прервать цикл apply и НЕ звать
 * prunePhantomWorkspaces (иначе он дочистит остатки ещё не восстановленной
 * базы и снесёт ws, у которых просто не успело появиться membership).
 */
export class SqliteCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqliteCorruptError';
  }
}

/**
 * Признак повреждения SQLite в тексте ошибки: malformed image (code 11),
 * явное упоминание SQLITE_CORRUPT, либо code: 11 в сообщении драйвера.
 */
function isSqliteCorruptionMessage(msg: string): boolean {
  return (
    /database disk image is malformed/i.test(msg) ||
    /code:?\s*11\b/i.test(msg) ||
    /SQLITE_CORRUPT/i.test(msg) ||
    // F16 escalation: серверных дубликатов по (workspace_id, user_id) НЕТ
    // (RLS + UNIQUE на sync_workspace_members + реконсиль accept_invite F15
    // гарантируют это). Значит UNIQUE fail на этом индексе при INSERT-пути
    // (uuid не найден локальным матчером, хотя строка с тем же (ws, user)
    // физически уже есть) — признак битого локального uuid-индекса, а не
    // бизнес-коллизии. Трактуем как corruption.
    /UNIQUE constraint failed: workspace_members\.workspace_id,\s*workspace_members\.user_id/i.test(msg) ||
    // Аналогично workspaces.uuid / workspace_members.uuid / task_activity_log.uuid —
    // все три наблюдались в прод-логах пользователя как спутники malformed (code 11).
    /UNIQUE constraint failed: workspaces\.uuid/i.test(msg) ||
    /UNIQUE constraint failed: workspace_members\.uuid/i.test(msg) ||
    /UNIQUE constraint failed: task_activity_log\.uuid/i.test(msg)
  );
}

/**
 * Оборачивает applyCloudRow* — если внутри вылетело исключение с признаком
 * порчи SQLite, поднимает флаг для App.tsx/syncNow и перебрасывает исключение
 * как SqliteCorruptError (чтобы pullAll отличил его от обычной ошибки строки
 * и от DeferRowError).
 */
function withCorruptionGuard(
  tableName: string,
  fn: (row: CloudRow) => boolean,
): (row: CloudRow) => boolean {
  return (row: CloudRow): boolean => {
    try {
      return fn(row);
    } catch (e) {
      if (e instanceof DeferRowError || e instanceof SqliteCorruptError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (isSqliteCorruptionMessage(msg)) {
        if (typeof window !== 'undefined') {
          (window as any).__taskflow_corruption_recovered = 'runtime_during_pull';
          // F16: сбрасываем возможно битую БД из LocalStorage СРАЗУ, до того как
          // scheduleSave() (дебаунс 200ms в db.ts) успеет записать текущее битое
          // состояние обратно. Без этого reload перечитает ту же битую SQLite
          // и цикл повторится.
          try {
            for (const k of ['taskflow.sqlite.v1', 'taskflow.sqlite.v1.ts']) {
              try { window.localStorage.removeItem(k); } catch { /* noop */ }
            }
          } catch { /* noop */ }
        }
        logger.warn(`[sync/pull] SQLITE_CORRUPT detected while applying ${tableName} row ${row.id}:`, msg);
        throw new SqliteCorruptError(`${tableName}: ${msg}`);
      }
      throw e;
    }
  };
}

/**
 * Ключ settings для last_pulled cursor.
 *
 * Wave A PR-2: per-ws-per-table формат `sync_last_pulled_<ws>_<cloudTable>`.
 * Legacy-формат (до ws) — `sync_last_pulled_<cloudTable>`. Если workspaceId не
 * передан — возвращаем legacy-ключ (обратная совместимость вызовов без ws).
 */
function lastPulledKey(cloudTable: string, workspaceId?: string | null): string {
  return workspaceId
    ? `sync_last_pulled_${workspaceId}_${cloudTable}`
    : `sync_last_pulled_${cloudTable}`;
}

function readSetting(key: string): string | null {
  const row = db.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [key]);
  return row?.value ?? null;
}

/**
 * Читает last_pulled cursor для (ws, таблица) из settings.
 *
 * Мягкая миграция ключа (§3.4): если нового per-ws ключа ещё нет, но есть старый
 * `sync_last_pulled_<cloudTable>` — используем его значение как стартовое для
 * personal-ws и сразу переписываем в новый формат (идемпотентно). Так первый
 * pull после PR-2 не перечитывает всё заново.
 */
function getLastPulledAt(
  cloudTable: string,
  cursorCol: 'updated_at' | 'id' | 'created_at' = 'updated_at',
  workspaceId?: string | null,
): string {
  const initial = cursorCol === 'id'
    ? '00000000-0000-0000-0000-000000000000'
    : '1970-01-01T00:00:00Z';

  if (!workspaceId) {
    return readSetting(lastPulledKey(cloudTable)) ?? initial;
  }

  const newKey = lastPulledKey(cloudTable, workspaceId);
  const newVal = readSetting(newKey);
  if (newVal) return newVal;

  // Мягкая миграция: legacy-ключ → per-ws ключ.
  const legacyVal = readSetting(lastPulledKey(cloudTable));
  if (legacyVal) {
    setLastPulledAt(cloudTable, legacyVal, workspaceId);
    return legacyVal;
  }
  return initial;
}

/** Обновляет last_pulled cursor в settings (per-ws при наличии workspaceId). */
function setLastPulledAt(cloudTable: string, value: string, workspaceId?: string | null): void {
  db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [lastPulledKey(cloudTable, workspaceId), value],
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
  row.workspace_id ??= null; // облако всегда шлёт ws_id; защищаемся от undefined-бинда
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
           updated_at=?, deleted_at=?, version=?, client_id=?, workspace_id=?
       WHERE uuid=?`,
      [
        row.title,
        row.comment,
        resolveStatusIdByUuid(row.status_id, row.workspace_id),
        resolveTagIdByUuid(row.tag_id, row.workspace_id),
        row.start_date,
        row.deadline,
        row.finish_date,
        row.sort_order,
        row.archived ? 1 : 0,
        row.updated_at,
        row.deleted_at,
        row.version,
        row.client_id,
        row.workspace_id,
        row.id,
      ],
    );
    return true;
  }

  // Локальной строки нет — INSERT новую с сохранением uuid.
  const statusIntId = resolveStatusIdByUuid(row.status_id, row.workspace_id);
  if (statusIntId === null) {
    // v0.9.35-dev.6.10.3 — ФИКС сирот-задач (Проблема №1: всё улетало в «Важно»).
    //
    // Раньше: если статус задачи не найден локально — мы молча кидали её в
    // первый top-статус («Важно»). На аккаунте, где сид-статусы исторически
    // не попали в облако (создавались без uuid до миграции v9), ВСЕ задачи оказывались
    // сиротами и падали в «Важно» — распределение молча ломалось.
    //
    // Теперь: не применяем задачу без валидного статуса — откладываем (deferred).
    // pull идёт в порядке statuses → tags → tasks (PUSH_ORDER), поэтому если статус
    // есть в облаке — он уже применён к этому моменту, и сюда мы не попадём.
    // Если же статуса нет ни локально, ни в облаке — задача останется deferred до
    // тех пор, пока статус не появится (например, когда «правильное» устройство
    // запушит свои сид-статусы после миграции v9). Курсор last_pulled по
    // задачам НЕ сдвигается за неприменённую строку (deferred → throw ниже),
    // поэтому она будет перечитана на следующем pull.
    throw new DeferRowError(
      `status ${row.status_id} not found locally for task ${row.id} — deferring ` +
      `(cloud statuses not yet pulled or missing)`,
    );
  }
  db.run(
    `INSERT INTO tasks
      (uuid, title, comment, status_id, tag_id, start_date, deadline, finish_date,
       sort_order, archived, created_at, updated_at, deleted_at, version, client_id, workspace_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      row.id,
      row.title,
      row.comment,
      statusIntId,
      resolveTagIdByUuid(row.tag_id, row.workspace_id),
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
      row.workspace_id,
    ],
  );
  return true;
}

function applyCloudRowStatuses(row: CloudRow): boolean {
  row.workspace_id ??= null;
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
           updated_at=?, deleted_at=?, version=?, client_id=?, workspace_id=?
       WHERE uuid=?`,
      [
        row.name, row.color, row.behavior, row.sort_order,
        row.is_seed ? 1 : 0, row.is_technical ? 1 : 0,
        row.hidden ? 1 : 0, row.default_collapsed ? 1 : 0,
        row.updated_at, row.deleted_at, row.version, row.client_id, row.workspace_id,
        row.id,
      ],
    );
    return true;
  }
  db.run(
    `INSERT INTO statuses
      (uuid, name, color, behavior, sort_order, is_seed, is_technical,
       hidden, default_collapsed, updated_at, deleted_at, version, client_id, workspace_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      row.id, row.name, row.color, row.behavior, row.sort_order,
      row.is_seed ? 1 : 0, row.is_technical ? 1 : 0,
      row.hidden ? 1 : 0, row.default_collapsed ? 1 : 0,
      row.updated_at, row.deleted_at, row.version, row.client_id, row.workspace_id,
    ],
  );
  return true;
}

function applyCloudRowTags(row: CloudRow): boolean {
  row.workspace_id ??= null;
  const local = db.get<{ id: number; updated_at: string }>(
    'SELECT id, updated_at FROM tags WHERE uuid=?',
    [row.id],
  );
  if (local) {
    if (local.updated_at >= row.updated_at) return false;
    db.run(
      `UPDATE tags
       SET name=?, color=?, sort_order=?,
           updated_at=?, deleted_at=?, version=?, client_id=?, workspace_id=?
       WHERE uuid=?`,
      [row.name, row.color, row.sort_order,
       row.updated_at, row.deleted_at, row.version, row.client_id, row.workspace_id, row.id],
    );
    return true;
  }
  db.run(
    `INSERT INTO tags (uuid, name, color, sort_order, updated_at, deleted_at, version, client_id, workspace_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [row.id, row.name, row.color, row.sort_order,
     row.updated_at, row.deleted_at, row.version, row.client_id, row.workspace_id],
  );
  return true;
}

/**
 * overdue_events: append-only, нет updated_at/version. LWW идёт по id
 * (uuidv7 монотонный). Если локально есть — обновляем только deleted_at,
 * остальное immutable. Если нет — INSERT (при условии что task уже локально).
 */
function applyCloudRowOverdueEvents(row: CloudRow): boolean {
  row.workspace_id ??= null;
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
    // v0.9.35-dev.6.10.3 — отложение, а не «false» (иначе курсор сдвинется и
    // событие потеряется). Помечаем DeferRowError → курсор заморозится.
    throw new DeferRowError(
      `overdue_event ${row.id}: task ${row.task_id} not local yet — deferring`,
    );
  }
  db.run(
    `INSERT INTO overdue_events
      (uuid, task_id, deadline_snapshot, event_date, created_at, updated_at,
       deleted_at, version, client_id, workspace_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
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
      row.workspace_id,
    ],
  );
  return true;
}

function applyCloudRowTemplates(row: CloudRow): boolean {
  row.workspace_id ??= null;
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
           updated_at=?, deleted_at=?, version=?, client_id=?, workspace_id=?
       WHERE uuid=?`,
      [row.name, row.title, row.comment,
       row.status_id ? resolveStatusIdByUuid(row.status_id, row.workspace_id) : null,
       resolveTagIdByUuid(row.tag_id, row.workspace_id),
       row.sort_order,
       row.updated_at, row.deleted_at, row.version, row.client_id, row.workspace_id, row.id],
    );
    return true;
  }
  db.run(
    `INSERT INTO task_templates
      (uuid, name, title, comment, status_id, tag_id, sort_order,
       created_at, updated_at, deleted_at, version, client_id, workspace_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [row.id, row.name, row.title, row.comment,
     row.status_id ? resolveStatusIdByUuid(row.status_id, row.workspace_id) : null,
     resolveTagIdByUuid(row.tag_id, row.workspace_id),
     row.sort_order, row.created_at, row.updated_at, row.deleted_at,
     row.version, row.client_id, row.workspace_id],
  );
  return true;
}

/**
 * task_hold_periods: мутабельная строка (ended_at закрывается при выходе из
 * холда), поэтому LWW по updated_at, как у tasks. Ссылается на task через
 * uuid; если задача ещё не локальна — откладываем (DeferRowError).
 */
function applyCloudRowHoldPeriods(row: CloudRow): boolean {
  row.workspace_id ??= null;
  const local = db.get<{ id: number; updated_at: string }>(
    'SELECT id, updated_at FROM task_hold_periods WHERE uuid=?',
    [row.id],
  );
  if (local) {
    if (local.updated_at >= row.updated_at) return false;
    db.run(
      `UPDATE task_hold_periods
       SET started_at=?, ended_at=?, updated_at=?, deleted_at=?, version=?, client_id=?, workspace_id=?
       WHERE uuid=?`,
      [row.started_at, row.ended_at, row.updated_at, row.deleted_at,
       row.version, row.client_id, row.workspace_id, row.id],
    );
    return true;
  }
  const taskId = resolveTaskIdByUuid(row.task_id);
  if (taskId === null) {
    throw new DeferRowError(
      `hold_period ${row.id}: task ${row.task_id} not local yet — deferring`,
    );
  }
  db.run(
    `INSERT INTO task_hold_periods
      (uuid, task_id, started_at, ended_at, created_at, updated_at,
       deleted_at, version, client_id, workspace_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      row.id,
      taskId,
      row.started_at,
      row.ended_at,
      row.created_at,
      row.updated_at,
      row.deleted_at,
      row.version,
      row.client_id,
      row.workspace_id,
    ],
  );
  return true;
}

/**
 * workspaces: собственный id (== ws_<uid>) — matched по uuid. LWW по updated_at.
 * Локальная таблица не имеет user_id; owner_id приходит из облака.
 */
function applyCloudRowWorkspaces(row: CloudRow): boolean {
  const local = db.get<{ id: number; updated_at: string }>(
    'SELECT id, updated_at FROM workspaces WHERE uuid=?',
    [row.id],
  );
  if (local) {
    if (local.updated_at >= row.updated_at) return false;
    db.run(
      `UPDATE workspaces
       SET name=?, kind=?, owner_id=?, sort_order=?,
           updated_at=?, deleted_at=?, version=?, client_id=?
       WHERE uuid=?`,
      [row.name, row.kind, row.owner_id, row.sort_order,
       row.updated_at, row.deleted_at, row.version, row.client_id, row.id],
    );
    return true;
  }
  db.run(
    `INSERT INTO workspaces
      (uuid, name, kind, owner_id, sort_order, created_at, updated_at, deleted_at, version, client_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [row.id, row.name, row.kind, row.owner_id, row.sort_order,
     row.created_at, row.updated_at, row.deleted_at, row.version, row.client_id],
  );
  return true;
}

/** workspace_members: matched по uuid (серверный id). LWW по updated_at. */
function applyCloudRowMembers(row: CloudRow): boolean {
  const local = db.get<{ id: number; updated_at: string }>(
    'SELECT id, updated_at FROM workspace_members WHERE uuid=?',
    [row.id],
  );
  if (local) {
    if (local.updated_at >= row.updated_at) return false;
    db.run(
      `UPDATE workspace_members
       SET workspace_id=?, user_id=?, role=?, invited_by=?, joined_at=?,
           updated_at=?, deleted_at=?, version=?, client_id=?
       WHERE uuid=?`,
      [row.workspace_id, row.user_id, row.role, row.invited_by, row.joined_at,
       row.updated_at, row.deleted_at, row.version, row.client_id, row.id],
    );
    return true;
  }
  db.run(
    `INSERT INTO workspace_members
      (uuid, workspace_id, user_id, role, invited_by, joined_at,
       created_at, updated_at, deleted_at, version, client_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [row.id, row.workspace_id, row.user_id, row.role, row.invited_by, row.joined_at,
     row.created_at, row.updated_at, row.deleted_at, row.version, row.client_id],
  );
  return true;
}

/**
 * workspace_settings: серверный PK = (workspace_id, key), нет колонки id.
 * Matched локально по (workspace_id, key). LWW по updated_at. Локальный uuid —
 * генерируем при вставке (нужен для outbox/fetchLocal при обратном push'е).
 */
function applyCloudRowSettings(row: CloudRow): boolean {
  const local = db.get<{ id: number; updated_at: string }>(
    'SELECT id, updated_at FROM workspace_settings WHERE workspace_id=? AND key=?',
    [row.workspace_id, row.key],
  );
  if (local) {
    if (local.updated_at >= row.updated_at) return false;
    db.run(
      `UPDATE workspace_settings
       SET value=?, updated_at=?, deleted_at=?, version=?, client_id=?
       WHERE workspace_id=? AND key=?`,
      [row.value, row.updated_at, row.deleted_at, row.version, row.client_id,
       row.workspace_id, row.key],
    );
    return true;
  }
  db.run(
    `INSERT INTO workspace_settings
      (uuid, workspace_id, key, value, created_at, updated_at, deleted_at, version, client_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [uuidv7(), row.workspace_id, row.key, row.value,
     row.created_at, row.updated_at, row.deleted_at, row.version, row.client_id],
  );
  return true;
}

/**
 * task_activity_log: иммутабельный append-only журнал (миграция 0034). Только
 * INSERT — если строка с таким uuid уже есть локально, ничего не делаем (лог
 * не меняется). task_id хранится как серверный uuid задачи (без резолюции в
 * int). payload (jsonb) кладём как JSON-строку. НЕ откладываем при отсутствии
 * задачи локально: лог самодостаточен (task_id — просто uuid для фильтрации в
 * UI), а сама задача в shared-ws могла быть soft-deleted и вообще не пуллиться.
 */
function applyCloudRowActivityLog(row: CloudRow): boolean {
  const local = db.get<{ id: number }>(
    'SELECT id FROM task_activity_log WHERE uuid=?',
    [row.id],
  );
  if (local) return false; // иммутабельно — уже есть, не трогаем
  db.run(
    `INSERT INTO task_activity_log
      (uuid, task_id, workspace_id, user_id, kind, payload, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [
      row.id,
      row.task_id,
      row.workspace_id,
      row.user_id,
      row.kind,
      JSON.stringify(row.payload ?? {}),
      row.created_at,
    ],
  );
  return true;
}

/**
 * Карта applier'ов по имени облачной таблицы.
 *
 * F16 (ADR 0010, roadmap §7.16): каждый applier обёрнут withCorruptionGuard —
 * любая ошибка с признаком физической порчи локальной SQLite (malformed
 * image / SQLITE_CORRUPT / расхождение unique-индекса с данными) поднимается
 * как SqliteCorruptError, а не тонет как обычная ошибка строки.
 */
const APPLIERS: Record<string, (row: CloudRow) => boolean> = {
  sync_workspaces: withCorruptionGuard('sync_workspaces', applyCloudRowWorkspaces),
  sync_workspace_members: withCorruptionGuard('sync_workspace_members', applyCloudRowMembers),
  sync_workspace_settings: withCorruptionGuard('sync_workspace_settings', applyCloudRowSettings),
  sync_tasks: withCorruptionGuard('sync_tasks', applyCloudRowTasks),
  sync_statuses: withCorruptionGuard('sync_statuses', applyCloudRowStatuses),
  sync_tags: withCorruptionGuard('sync_tags', applyCloudRowTags),
  sync_task_templates: withCorruptionGuard('sync_task_templates', applyCloudRowTemplates),
  sync_overdue_events: withCorruptionGuard('sync_overdue_events', applyCloudRowOverdueEvents),
  sync_task_hold_periods: withCorruptionGuard('sync_task_hold_periods', applyCloudRowHoldPeriods),
  sync_task_activity_log: withCorruptionGuard('sync_task_activity_log', applyCloudRowActivityLog),
};

/**
 * Описание курсора для pull. Большинство таблиц пуллятся по updated_at,
 * overdue_events — по id (uuidv7 монотонный), а иммутабельный журнал активности
 * (нет updated_at) — по created_at.
 */
function cursorColumnFor(cloudTable: string): 'updated_at' | 'id' | 'created_at' {
  if (cloudTable === 'sync_overdue_events') return 'id';
  if (cloudTable === 'sync_task_activity_log') return 'created_at';
  return 'updated_at';
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
  /**
   * F14: максимальный курсор, достигнутый в этом батче. Нужен для in-memory
   * пагинации ПОЛНОГО pull (когда курсор в settings НЕ продвигается) — чтобы
   * следующий батч читал с `.gt(maxCursor)`, а не бесконечно перечитывал первые
   * PULL_BATCH_SIZE строк от epoch.
   */
  maxCursor?: string;
  /**
   * F16 (ADR 0010, roadmap §7.16): локальная SQLite оказалась повреждена во время
   * apply. Когда true — pullAll НЕ вызывает prunePhantomWorkspaces за этот цикл.
   */
  corruption?: boolean;
}

/**
 * Пуллит одну таблицу. Обновляет last_pulled_at на max(updated_at).
 *
 * Скоуп: таблицы с user_id фильтруются по user_id; таблицы без него
 * (sync_workspace_settings) — по workspace_id IN (<мои ws>). Курсор хранится
 * per-ws (ключ по первому/personal ws — в Wave A он один).
 */
async function pullTable(
  userId: string,
  spec: TableSpec,
  workspaceIds: string[],
  opts?: { fullFrom?: string },
): Promise<PullResult> {
  const result: PullResult = { applied: 0, skipped: 0, deferred: 0, firstError: null };
  let _corruptError: SqliteCorruptError | null = null;
  const applier = APPLIERS[spec.cloud];
  if (!applier) {
    logger.warn(`[sync/pull] no applier for ${spec.cloud}, skipping`);
    return result;
  }

  const cursorCol = cursorColumnFor(spec.cloud);
  const cursorWs = workspaceIds[0] ?? null;
  // F14: ПОЛНЫЙ pull (fullFrom задан) читает от переданного курсора (для первого
  // батча — epoch) и НЕ трогает сохранённый в settings курсор. Так членство на
  // каждом старте перечитывается целиком (чинит симптомы 1 и 3), а data-таблицы
  // остаются инкрементальными по своему per-ws курсору.
  const full = opts?.fullFrom !== undefined;
  const lastPulled = full ? opts!.fullFrom! : getLastPulledAt(spec.cloud, cursorCol, cursorWs);
  result.maxCursor = lastPulled;
  try {
    // Скоуп-фильтр первым. P0: почти всё тянем по пространству (workspace_id IN
    // <мои ws> для data-таблиц; id IN <мои ws> для самой sync_workspaces, где id
    // и есть ws-id). По user_id остаётся только членство — вход в набор ws.
    let scoped;
    if (spec.pullScope === 'workspace_id') {
      scoped = supabase.from(spec.cloud).select('*').in('workspace_id', workspaceIds);
    } else if (spec.pullScope === 'id') {
      scoped = supabase.from(spec.cloud).select('*').in('id', workspaceIds);
    } else {
      scoped = supabase.from(spec.cloud).select('*').eq('user_id', userId);
    }
    const query = scoped
      .gt(cursorCol, lastPulled)
      .order(cursorCol, { ascending: true })
      .limit(PULL_BATCH_SIZE);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return result;

    let maxCursor = lastPulled;
    // v0.9.35-dev.6.10.3 — Консервативный курсор при deferred-строках.
    // Строки приходят отсортированными по cursorCol по возрастанию. Если какая-то
    // строка отложена (deferred, напр. задача-сирота без статуса), мы НЕ должны
    // двигать курсор дальше её — иначе на следующем pull мы её больше не перечитаем
    // (её updated_at < нового курсора) и она навсегда останется неприменённой. Поэтому
    // после первой deferred-строки перестаём сдвигать курсор для этой таблицы.
    let cursorFrozen = false;
    for (const raw of data as CloudRow[]) {
      try {
        const changed = applier(raw);
        if (changed) result.applied++;
        else result.skipped++;
        const rowCursor = String((raw as any)[cursorCol] ?? '');
        if (!cursorFrozen && rowCursor > maxCursor) maxCursor = rowCursor;
      } catch (e) {
        if (e instanceof SqliteCorruptError) {
          // F16: фатально — прерываем цикл по этой таблице сразу. Не двигаем
          // курсор (он и так не сдвинут — база повреждена, писать в settings опасно).
          logger.error(`[sync/pull] ${spec.cloud} SQLITE_CORRUPT, aborting table apply:`, e.message);
          result.corruption = true;
          result.firstError = e.message;
          _corruptError = e;
          break;
        }
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof DeferRowError) {
          // ОЖИДАЕМОЕ отложение (parent ещё не пришёл) — НЕ считаем ошибкой sync.
          // Не пишем в firstError, чтобы UI не показывал «ошибку синхронизации».
          logger.info(`[sync/pull] ${spec.cloud} row ${raw.id} deferred: ${msg}`);
        } else {
          // Настоящая ошибка (сеть/RLS/SQL) — поднимаем в firstError.
          logger.warn(`[sync/pull] ${spec.cloud} apply failed for ${raw.id}:`, msg);
          if (!result.firstError) result.firstError = msg;
        }
        result.deferred++;
        // Замораживаем курсор: всё, что после этой строки, будет перечитано
        // заново на следующем pull (включая саму deferred-строку).
        cursorFrozen = true;
      }
    }

    if (_corruptError) {
      return result; // F16: не сохраняем прогресс/курсор, флаг/error уже выставлены
    }

    // Сохраняем прогресс. Если applied+skipped == батч, возможно есть ещё —
    // orchestrator позовёт нас снова. F14: при ПОЛНОМ pull курсор в settings НЕ
    // продвигаем (иначе следующий старт снова станет инкрементальным); отдаём
    // maxCursor вызывающему для in-memory пагинации этого же прохода.
    result.maxCursor = maxCursor;
    if (!full) setLastPulledAt(spec.cloud, maxCursor, cursorWs);
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
 * Полный pull: пуллит все таблицы в порядке PULL_ORDER (parent'ы первыми,
 * пулл-only журнал активности в конце).
 * Если applied+skipped == PULL_BATCH_SIZE — было много изменений, идём
 * следующей итерацией той же таблицы (max 5 итераций).
 */
export async function pullAll(userId: string): Promise<PullResult> {
  const total: PullResult = { applied: 0, skipped: 0, deferred: 0, firstError: null };

  try {
    // ── Фаза 1: членство (F14: ПОЛНЫЙ pull в двух скопах, без инкремент-курсора) ─
    // Проход A (вход в набор): свои строки членства (user_id=me), ПОЛНО — читаем от
    // epoch, игнорируя сохранённый курсор. Строку членства в чужом shared-ws создаёт
    // серверный accept_invite (user_id=me). Полнота чинит симптом 3: локально
    // погашенные/удалённые prune'ом свои membership-строки восстанавливаются на
    // КАЖДОМ старте (инкрементальный курсор «в будущем» их больше не приносил).
    await pullSpecPaged(userId, WORKSPACE_MEMBERS_SPEC, listMembershipWorkspaceIds(userId), total, { full: true });
    if (total.corruption) return total;

    // ── Набор пространств ──────────────────────────────────────────────────────
    // Пересчитываем ПОСЛЕ прохода A из СВЕЖЕподтянутого членства (а не из локальной
    // таблицы workspaces) — так чужой ws попадает в набор, разрывая chicken-and-egg.
    const workspaceIds = listMembershipWorkspaceIds(userId);

    // Проход B (со-участники): членство по `workspace_id IN (мои ws)`, тоже ПОЛНО.
    // Даёт строки owner/других editor'ов того же ws (чинит симптом 1 — участники
    // shared не видны). Серверный RLS (has_workspace_role viewer+) отдаёт их —
    // подтверждено прод-пробой. Клон spec с pullScope='workspace_id'.
    const membersByWorkspaceSpec: TableSpec = { ...WORKSPACE_MEMBERS_SPEC, pullScope: 'workspace_id' };
    await pullSpecPaged(userId, membersByWorkspaceSpec, workspaceIds, total, { full: true });
    if (total.corruption) return total;

    // ── Фаза 2: пространства и их данные ────────────────────────────────────────
    // Тянем каждое пространство ОТДЕЛЬНО, чтобы у каждого был свой per-ws курсор:
    // иначе свежедобавленный shared-ws со «старыми» updated_at был бы отсечён общим
    // курсором ведущего ws (его lastPulled уже «в будущем» относительно тех строк).
    const phase2 = PULL_ORDER.filter(s => s.cloud !== WORKSPACE_MEMBERS_SPEC.cloud);
    for (const ws of workspaceIds) {
      for (const spec of phase2) {
        await pullSpecPaged(userId, spec, [ws], total);
        if (total.corruption) return total;
      }
    }

    prunePhantomWorkspaces(userId);
    return total;
  } catch (e) {
    // F16 (ADR 0010, roadmap §7.16): страховочная сетка — если SqliteCorruptError
    // всё же долетит сюда напрямую (а не через total.corruption), не даём pullAll
    // упасть с необработанным исключением и не зовём prunePhantomWorkspaces.
    if (e instanceof SqliteCorruptError) {
      logger.error('[sync/pull] pullAll aborted: SqliteCorruptError:', e.message);
      return { ...total, corruption: true, firstError: e.message };
    }
    throw e;
  }
}

/**
 * Пуллит один spec с пагинацией (до 5 батчей PULL_BATCH_SIZE) и агрегирует
 * результат в total. Вынесено из pullAll, чтобы переиспользовать в обеих фазах.
 */
async function pullSpecPaged(
  userId: string,
  spec: TableSpec,
  workspaceIds: string[],
  total: PullResult,
  opts?: { full?: boolean },
): Promise<void> {
  // F14: при ПОЛНОМ pull курсор в settings не продвигается, поэтому пагинацию
  // ведём in-memory — от epoch, затем от maxCursor предыдущего батча. Иначе при
  // >PULL_BATCH_SIZE строк мы бы бесконечно перечитывали первый батч.
  let fullCursor = opts?.full ? initialCursorValue(spec.cloud) : undefined;
  for (let i = 0; i < 5; i++) {
    const r = await pullTable(
      userId,
      spec,
      workspaceIds,
      opts?.full ? { fullFrom: fullCursor } : undefined,
    );
    total.applied += r.applied;
    total.skipped += r.skipped;
    total.deferred += r.deferred;
    if (!total.firstError && r.firstError) total.firstError = r.firstError;
    if (r.corruption) {
      // F16 (ADR 0010, roadmap §7.16): локальная SQLite повреждена — прерываем
      // пагинацию этого spec сразу, поднимаем флаг в total — pullAll проверяет
      // его после каждого вызова pullSpecPaged и останавливается, не дойдя
      // до prunePhantomWorkspaces.
      total.corruption = true;
      return;
    }
    if (r.applied + r.skipped < PULL_BATCH_SIZE) break;
    // Иначе — было batch_size, возможно есть ещё.
    if (opts?.full && r.maxCursor) fullCursor = r.maxCursor;
  }
}

/**
 * Bug #1 (фикс #1): подчистка «фантомных» пространств прошлых аккаунтов.
 *
 * После pull'а членство текущего пользователя (`workspace_members` с активным
 * `deleted_at IS NULL`) — источник истины о том, к каким ws он ПРИНАДЛЕЖИТ.
 * RLS на сервере возвращает членство только для этих ws, поэтому локальные
 * строки `workspaces`/`workspace_members`/`workspace_settings` для ws, которых
 * нет в этом наборе, — это остатки прошлого аккаунта или старых экспериментов,
 * просочившиеся в локальный SQLite. Удаляем их, чтобы они не рисовались в
 * сайдбаре.
 *
 * Набор допустимых ws строится по ЧЛЕНСТВУ текущего пользователя (а не по
 * `owner_id`), поэтому shared-пространства, где юзер — editor/viewer, сохраняются.
 * В набор всегда включаем детерминированный personal-ws (`ws_<uid>`) и локальный
 * placeholder `ws_local` — на случай, если членство ещё не подтянулось (холодный
 * старт) или reconcile ещё не переклеил local-only базу.
 *
 * @returns число удалённых строк из таблицы `workspaces` (для логов/тестов).
 */
function prunePhantomWorkspaces(userId: string): number {
  // F16 (ADR 0010, roadmap §7.16): если в текущем цикле pull локальная SQLite
  // оказалась повреждена (флаг ставится в detectAndRecoverCorruption/withCorruptionGuard),
  // не чистим фантомные ws прямо после того, как база была битой — ещё нет
  // подтверждения, что membership успело восстановиться, и pruning снесёт рабочие
  // shared workspaces (исходный симптом F16 — пустой сайдбар после рестарта).
  if (typeof window !== 'undefined' && (window as any).__taskflow_corruption_recovered) {
    logger.warn('[sync/pull] prunePhantomWorkspaces skipped: DB was corrupt this cycle');
    return 0;
  }

  const allowed = new Set<string>([computeWorkspaceId(userId), LOCAL_WS_ID]);
  try {
    const rows = db.all<{ workspace_id: string | null }>(
      `SELECT DISTINCT workspace_id FROM workspace_members
        WHERE user_id=? AND deleted_at IS NULL`,
      [userId],
    );
    for (const r of rows) if (r.workspace_id) allowed.add(r.workspace_id);
  } catch {
    // Таблицы workspace_members нет на базе до v11 — чистить нечего.
    return 0;
  }

  // Регрессия D/E: только что созданные локально ws (и их owner-membership) ещё
  // не подтверждены pull'ом — они висят в sync_outbox. Не сносим их, иначе pull
  // удалит свежесозданный shared-ws до первого round-trip, и он «исчезнет».
  try {
    const pend = db.all<{ workspace_id: string | null }>(
      `SELECT entity_uuid AS workspace_id FROM sync_outbox WHERE entity_table='workspaces'
       UNION
       SELECT m.workspace_id FROM sync_outbox o
         JOIN workspace_members m ON m.uuid = o.entity_uuid
        WHERE o.entity_table='workspace_members'`,
    );
    for (const r of pend) if (r.workspace_id) allowed.add(r.workspace_id);
  } catch { /* sync_outbox недоступен в отдельных путях — не критично */ }

  const ids = [...allowed];
  const placeholders = ids.map(() => '?').join(',');
  let removed = 0;
  try {
    const phantoms = db.all<{ uuid: string }>(
      `SELECT uuid FROM workspaces
        WHERE uuid IS NOT NULL AND uuid NOT IN (${placeholders})`,
      ids,
    );
    removed = phantoms.length;
    if (removed > 0) {
      db.run(`DELETE FROM workspaces WHERE uuid NOT IN (${placeholders})`, ids);
      db.run(`DELETE FROM workspace_members WHERE workspace_id NOT IN (${placeholders})`, ids);
      db.run(`DELETE FROM workspace_settings WHERE workspace_id NOT IN (${placeholders})`, ids);
      logger.info(`[sync/pull] удалено фантомных пространств: ${removed}`);
    }
  } catch (e) {
    logger.warn('[sync/pull] prunePhantomWorkspaces failed:', e);
  }
  return removed;
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
  applyCloudRowHoldPeriods,
  applyCloudRowWorkspaces,
  applyCloudRowMembers,
  applyCloudRowSettings,
  applyCloudRowActivityLog,
  prunePhantomWorkspaces,
  lastPulledKey,
  cursorColumnFor,
  initialCursorValue,
  lastPulledCursorKey,
  APPLIERS,
  PULL_BATCH_SIZE,
};
