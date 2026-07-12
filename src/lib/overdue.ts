/**
 * v0.9.2 (№3): детектор пересечений дедлайна.
 *
 * Каждый раз, когда задача *впервые* оказалась «просроченной» (её дедлайн
 * наступил в прошлом, а сама она ещё не в архивном статусе), мы фиксируем
 * событие в таблице `overdue_events`. Если у задачи потом сдвинули дедлайн
 * вперёд и она опять просрочилась — это НОВОЕ событие (новая точка на
 * графике «Активность» на дашборде).
 *
 * Логика дубликата: для конкретной задачи мы смотрим её самое последнее
 * событие. Если у него `deadline_snapshot === task.deadline` — значит,
 * событие для этого дедлайна уже создано, повторно не пишем. Как только
 * дедлайн изменился (или события ещё не было), а задача сейчас просрочена
 * и не в архивном статусе — создаём новое событие.
 *
 * Без бэкфилла: детектор запускается только начиная с v0.9.2, поэтому
 * задачи, которые были просрочены до обновления, не попадают в историю
 * до тех пор, пока их дедлайн не будет изменён (тогда — как обычно).
 */
import * as db from './db';
import type { Task, Status } from '../store/useStore';
import { uuidv7 } from './uuid';
import { getClientId } from './clientId';
import { enqueueOutbox } from './outbox';

/**
 * Проверить одну задачу и, если нужно, создать запись в overdue_events.
 * Возвращает true, если событие было создано.
 */
export function detectOverdueEventForTask(
  task: Task,
  statuses: Status[],
  today: string,
): boolean {
  // Без дедлайна — просрочки быть не может.
  if (!task.deadline) return false;

  // Дедлайн ещё не наступил (сегодня или в будущем) — не просрочено.
  // Замечу: task с дедлайном «сегодня» НЕ считается просроченной (согласовано
  // в v0.9.1 №4 для графика «Активность»).
  if (task.deadline >= today) return false;

  // Задача в архивном/техническом статусе (Выполнено, Удалено и т.п.) —
  // пересечение дедлайна не фиксируем.
  const status = statuses.find(s => s.id === task.status_id);
  if (!status) return false;
  if (status.behavior === 'archive' || status.is_technical === 1 || task.archived) return false;

  // Проверяем последнее событие по этой задаче.
  try {
    // v0.9.35-dev.1: игнорируем удалённые события (deleted_at IS NULL).
    const last = db.get<{ deadline_snapshot: string }>(
      `SELECT deadline_snapshot FROM overdue_events
       WHERE task_id = ? AND deleted_at IS NULL
       ORDER BY id DESC LIMIT 1`,
      [task.id],
    );
    if (last && last.deadline_snapshot === task.deadline) {
      // Событие для этого конкретного дедлайна уже есть — не дублируем.
      return false;
    }

    // Создаём новое событие. event_date = сегодня (день, когда мы поняли,
    // что задача просрочена). deadline_snapshot = дедлайн на момент события.
    // v0.9.35-dev.2: uuid/client_id/version=1 + enqueue в sync_outbox.
    const rowUuid = uuidv7();
    const clientId = getClientId();
    const now = new Date().toISOString();
    // Wave A: overdue_event наследует workspace_id своей задачи.
    db.run(
      `INSERT INTO overdue_events (task_id, deadline_snapshot, event_date,
                                   uuid, client_id, version, updated_at, workspace_id)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [task.id, task.deadline, today, rowUuid, clientId, now, task.workspace_id ?? null],
    );
    enqueueOutbox('overdue_events', rowUuid, 'upsert');
    return true;
  } catch (e) {
    // v0.9.3 hotfix: если таблица overdue_events недоступна — не валим детектор.
    console.warn('[overdue] detect skipped for task', task.id, e);
    return false;
  }
}

/**
 * Пройти по всем задачам и зафиксировать пересечения дедлайна.
 * Вызывается один раз при старте приложения (после init) и после каждого
 * updateTask, который мог повлиять на дедлайн/статус.
 *
 * Возвращает кол-во созданных событий (для логов).
 */
export function detectOverdueEvents(
  tasks: Task[],
  statuses: Status[],
  today: string,
): number {
  let created = 0;
  for (const task of tasks) {
    try {
      if (detectOverdueEventForTask(task, statuses, today)) created++;
    } catch (e) {
      // Отдельная задача не должна ломать всю проверку.
      console.warn('[overdue] detect failed for task', task.id, e);
    }
  }
  return created;
}

/**
 * Считает кол-во событий пересечения дедлайна за каждый день интервала.
 * Возвращает Map<'YYYY-MM-DD', count>. Дни без событий отсутствуют
 * — вызывающая сторона должна сама заполнять нули для оси X.
 */
export function overdueEventsByDate(
  fromDate: string,
  toDate: string,
  workspaceId?: string | null,
): Map<string, number> {
  const map = new Map<string, number>();
  try {
    // v0.9.35-dev.1: только актуальные события (deleted_at IS NULL).
    // Wave A: при заданном workspaceId ограничиваем текущим пространством.
    const wsClause = workspaceId ? ' AND workspace_id = ?' : '';
    const params = workspaceId ? [fromDate, toDate, workspaceId] : [fromDate, toDate];
    const rows = db.all<{ event_date: string; c: number }>(
      `SELECT event_date, COUNT(*) AS c FROM overdue_events
       WHERE event_date >= ? AND event_date <= ?
         AND deleted_at IS NULL${wsClause}
       GROUP BY event_date`,
      params,
    );
    for (const r of rows) map.set(r.event_date, Number(r.c));
  } catch (e) {
    // v0.9.3 hotfix: если таблица overdue_events по какой-то причине недоступна
    // (старый webDb-кеш без миграции, баг в миграторе и т.п.), не валим дашборд.
    console.warn('[overdue] overdueEventsByDate failed, returning empty map:', e);
  }
  return map;
}
