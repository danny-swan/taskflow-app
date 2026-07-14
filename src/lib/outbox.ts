/**
 * Sync outbox — очередь pending-изменений для push'а в облако (Supabase).
 *
 * v0.9.35-dev.2: только enqueue-логика. Реальный push будет добавлен в dev.4.
 *
 * Grain: row-level, dedup по (entity_table, entity_uuid).
 * Пейлоад не храним — push при отправке берёт свежее состояние строки из
 * entity_table по uuid, что автоматически даёт "последнее значение выигрывает"
 * для нескольких быстрых изменений подряд.
 *
 * API синхронный — соответствует db.run/db.all в остальном сторе.
 */
import * as db from './db';

/** Таблицы, изменения которых синхронизируются. */
export type SyncEntityTable =
  | 'tasks'
  | 'tags'
  | 'statuses'
  | 'task_templates'
  | 'overdue_events'
  | 'task_hold_periods'
  | 'workspaces'
  | 'workspace_members'
  | 'workspace_settings';

/** Тип операции в outbox. */
export type SyncOutboxOp = 'upsert' | 'delete';

/**
 * Ставит запись в outbox для последующего push'а.
 *
 * Идемпотентно: повторный вызов с той же (entity_table, entity_uuid)
 * не создаёт дубликат, а обновляет op/queued_at и обнуляет счётчик
 * попыток (через ON CONFLICT).
 *
 * Правило замены op:
 * - Новая 'delete' всегда перезаписывает — финальное состояние.
 * - Новая 'upsert' поверх старой 'upsert' — просто обновляем queued_at.
 * - Новая 'upsert' поверх старой 'delete' — не должно происходить в UI
 *   (нет операции восстановления удалённой строки в dev.2). Если случится,
 *   op станет 'upsert' — push отправит текущее состояние строки, у которой
 *   deleted_at IS NULL (либо не отправит, если пользователь удалил её снова
 *   до синхронизации). Безопасно.
 *
 * `entity_uuid` может быть NULL для строк, созданных до миграции v5 backfill'а
 * или в переходный момент. В этом случае молча пропускаем enqueue.
 */
export function enqueueOutbox(
  entityTable: SyncEntityTable,
  entityUuid: string | null | undefined,
  op: SyncOutboxOp,
): void {
  if (!entityUuid) {
    // Строка без uuid — не можем сослаться на неё стабильно.
    // Такие строки будут подхвачены при следующем изменении, когда получат uuid.
    return;
  }

  // ON CONFLICT по UNIQUE(entity_table, entity_uuid) — dedup без гонок.
  // queued_at сбрасывается на текущий момент, счётчик попыток обнуляется.
  db.run(
    `INSERT INTO sync_outbox
       (entity_table, entity_uuid, op, queued_at, attempt_count, last_attempt_at, last_error)
     VALUES (?, ?, ?, datetime('now'), 0, NULL, NULL)
     ON CONFLICT(entity_table, entity_uuid) DO UPDATE SET
       op = excluded.op,
       queued_at = excluded.queued_at,
       attempt_count = 0,
       last_attempt_at = NULL,
       last_error = NULL`,
    [entityTable, entityUuid, op],
  );

  // v0.9.35-dev.4: планируем debounced авто-sync (в prod). В dev-сборке no-op.
  // Ленивый import через then-callback чтобы не создавать циклическую зависимость
  // на этапе module init (sync/index → push/pull → mappers → db).
  // Ошибки в auto-sync не должны валить операцию enqueueOutbox.
  try {
    void import('./sync').then(m => m.scheduleAutoSync()).catch(() => {});
  } catch {
    // ignore — если sync module недоступен (например, в тесте с моками), не мешаем.
  }
}

/**
 * Возвращает количество pending-записей в outbox (для отладки / UI индикатора).
 */
export function outboxPendingCount(): number {
  const row = db.get<{ count: number }>(`SELECT COUNT(*) as count FROM sync_outbox`);
  return row?.count ?? 0;
}

/**
 * Есть ли в outbox неотправленные изменения по конкретному пространству —
 * либо сама строка `workspaces` (uuid == workspaceId), либо любая его
 * `workspace_members` (owner-membership создателя).
 *
 * Используется гейтом инвайтов: серверная RPC `invite_to_workspace` проверяет
 * владельца по СЕРВЕРНОЙ `sync_workspace_members`, поэтому приглашать можно
 * только после того, как ws + owner-membership реально доставлены push'ем.
 * Пока по ним есть pending outbox — пространство ещё не на сервере.
 *
 * db-ошибки (например, БД не инициализирована в отдельных render-путях)
 * трактуем как «pending нет»: гейт не должен ронять UI/флоу.
 */
export function workspaceHasPendingOutbox(workspaceId: string | null | undefined): boolean {
  if (!workspaceId) return false;
  try {
    const row = db.get<{ n: number }>(
      `SELECT (
         (SELECT COUNT(*) FROM sync_outbox
            WHERE entity_table = 'workspaces' AND entity_uuid = ?)
         +
         (SELECT COUNT(*) FROM sync_outbox o
            JOIN workspace_members m ON m.uuid = o.entity_uuid
           WHERE o.entity_table = 'workspace_members' AND m.workspace_id = ?)
       ) AS n`,
      [workspaceId, workspaceId],
    );
    return (row?.n ?? 0) > 0;
  } catch {
    return false;
  }
}
