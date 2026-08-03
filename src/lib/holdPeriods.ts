// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * holdPeriods.ts — учёт интервалов статуса «Приостановлено» для столбца
 * «Холд» в Статистике.
 *
 * Модель (согласована с пользователем):
 *   • «Холд» задачи = сумма длительностей всех её холд-интервалов в днях.
 *   • Длительность интервала = разница ДАТ (end − start), целые дни:
 *       02.06 → 02.06 = 0 дней (поставили и сняли в тот же день),
 *       02.06 → 05.06 = 3 дня.
 *   • Открытый интервал (задача сейчас на холде) считается «до сейчас».
 *   • Несколько интервалов складываются.
 *
 * Каждый переход статуса в/из «Приостановлено» фиксируется строкой в локальной
 * таблице task_hold_periods (миграция v10) и синхронизируется как overdue_events
 * (client-authored → sync_outbox → sync_task_hold_periods). Серверного триггера
 * нет: клиент — единственный автор строк, что важно для local-only режима.
 */
import * as db from './db';
import type { Status } from '../store/useStore';
import { uuidv7 } from './uuid';
import { getClientId } from './clientId';
import { enqueueOutbox } from './outbox';

/** Имя статуса «Приостановлено» (единый источник правды из сида db.ts). */
export const HOLD_STATUS_NAME = 'Приостановлено';

/** Интервал холда — минимальный набор полей для расчёта дней. */
export interface HoldPeriod {
  started_at: string;
  ended_at: string | null;
}

/** true, если статус с этим id — «Приостановлено». */
export function isHoldStatus(statusId: number | null | undefined, statuses: Status[]): boolean {
  if (statusId == null) return false;
  const s = statuses.find(x => x.id === statusId);
  return s?.name === HOLD_STATUS_NAME;
}

/**
 * Длительность одного интервала в целых днях по разнице ДАТ (не inclusive).
 * Нормализуем к локальному дню, чтобы сдвиг времени/TZ не давал лишних суток.
 * ended = null → считаем до `now`.
 */
export function holdDaysForPeriod(startISO: string, endISO: string | null, now: Date = new Date()): number {
  const start = new Date(startISO);
  if (isNaN(start.getTime())) return 0;
  const end = endISO ? new Date(endISO) : now;
  if (isNaN(end.getTime())) return 0;
  const sd = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const ed = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  const diff = Math.round((ed - sd) / 86400000);
  return Math.max(0, diff);
}

/** Сумма дней по всем интервалам задачи. */
export function holdDaysFromPeriods(periods: HoldPeriod[], now: Date = new Date()): number {
  return periods.reduce((sum, p) => sum + holdDaysForPeriod(p.started_at, p.ended_at, now), 0);
}

/**
 * Фиксирует переход статуса задачи относительно «Приостановлено».
 * Вызывается из store после UPDATE tasks.status_id.
 *
 *   вошли в холд (old ≠ hold, new = hold)  → INSERT открытого интервала;
 *   вышли из холда (old = hold, new ≠ hold) → закрываем открытый интервал (ended_at = now).
 *
 * Идемпотентность:
 *   • при входе не открываем второй интервал, если открытый уже есть;
 *   • при выходе закрываем самый свежий открытый интервал (обычно он один).
 *
 * Возвращает true, если что-то записали.
 */
export function recordHoldTransition(
  taskId: number,
  oldStatusId: number | null | undefined,
  newStatusId: number | null | undefined,
  statuses: Status[],
): boolean {
  const wasHold = isHoldStatus(oldStatusId, statuses);
  const isHold = isHoldStatus(newStatusId, statuses);
  if (wasHold === isHold) return false;

  const now = new Date().toISOString();
  try {
    if (isHold && !wasHold) {
      // Вход в холд. Не плодим дубль, если открытый интервал уже есть.
      const open = db.get<{ id: number }>(
        `SELECT id FROM task_hold_periods
          WHERE task_id = ? AND ended_at IS NULL AND deleted_at IS NULL
          ORDER BY id DESC LIMIT 1`,
        [taskId],
      );
      if (open) return false;
      const rowUuid = uuidv7();
      // Wave A: интервал холда наследует workspace_id своей задачи.
      db.run(
        `INSERT INTO task_hold_periods
           (task_id, started_at, ended_at, created_at, updated_at, uuid, version, client_id, workspace_id)
         VALUES (?, ?, NULL, ?, ?, ?, 1, ?, (SELECT workspace_id FROM tasks WHERE id = ?))`,
        [taskId, now, now, now, rowUuid, getClientId(), taskId],
      );
      enqueueOutbox('task_hold_periods', rowUuid, 'upsert');
      return true;
    }

    // Выход из холда — закрываем открытый интервал.
    const open = db.get<{ id: number; uuid: string | null }>(
      `SELECT id, uuid FROM task_hold_periods
        WHERE task_id = ? AND ended_at IS NULL AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 1`,
      [taskId],
    );
    if (!open) return false;
    db.run(
      `UPDATE task_hold_periods
         SET ended_at = ?, updated_at = ?, version = version + 1
       WHERE id = ?`,
      [now, now, open.id],
    );
    enqueueOutbox('task_hold_periods', open.uuid, 'upsert');
    return true;
  } catch (e) {
    // Таблица могла ещё не появиться (миграция v10 не прошла) — не валим store.
    console.warn('[holdPeriods] recordHoldTransition skipped for task', taskId, e);
    return false;
  }
}

/**
 * Возвращает карту task_id → суммарные дни холда для всех задач.
 * Один проход по task_hold_periods; используется в Статистике.
 */
export function holdDaysByTask(now: Date = new Date()): Map<number, number> {
  const result = new Map<number, number>();
  let rows: { task_id: number; started_at: string; ended_at: string | null }[] = [];
  try {
    rows = db.all<{ task_id: number; started_at: string; ended_at: string | null }>(
      `SELECT task_id, started_at, ended_at
         FROM task_hold_periods
        WHERE deleted_at IS NULL`,
    );
  } catch (e) {
    // Таблицы ещё нет — холд везде 0.
    console.warn('[holdPeriods] holdDaysByTask skipped:', e);
    return result;
  }
  for (const r of rows) {
    const days = holdDaysForPeriod(r.started_at, r.ended_at, now);
    result.set(r.task_id, (result.get(r.task_id) ?? 0) + days);
  }
  return result;
}
