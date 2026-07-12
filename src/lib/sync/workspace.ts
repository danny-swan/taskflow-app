// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * sync/workspace.ts — утилиты пространств для sync-конвейера (Wave A PR-2).
 *
 * Здесь:
 *   • computeWorkspaceId(userId) — детерминированный id personal-пространства,
 *     совпадающий с серверным backfill'ом (0027) и клиентской v11:
 *         'ws_' + userId.toLowerCase().replace(/-/g, '')
 *   • listWorkspaceIds() — множество ws-id, к которым принадлежит юзер (в Wave A
 *     это {personal}). Используется pull (скоуп) и realtime (filter in.(…)).
 *   • reconcilePersonalWorkspace(userId) — согласование local-only пространства
 *     `ws_local` с детерминированным серверным `ws_<uid>` при первой привязке/
 *     логине (см. §3.3 плана и «Разъезд id personal-ws» в §4).
 */
import * as db from '../db';
import { logger } from '../logger';
import { enqueueOutbox } from '../outbox';

/** Локальный placeholder-id personal-пространства для непривязанной базы. */
export const LOCAL_WS_ID = 'ws_local';

/** Детерминированный id personal-пространства из user_id (как на сервере). */
export function computeWorkspaceId(userId: string): string {
  return 'ws_' + userId.toLowerCase().replace(/-/g, '');
}

/**
 * Все ws-id, к которым принадлежит юзер. Источник истины — локальная таблица
 * workspaces (наполняется v11-backfill'ом + pull членства). Детерминированный
 * personal-ws добавляется всегда (на случай, если локальная строка ещё не
 * создана/не подтянута). В Wave A результат — ровно один personal-ws.
 */
export function listWorkspaceIds(userId?: string | null): string[] {
  const ids = new Set<string>();
  try {
    const rows = db.all<{ uuid: string | null }>(
      'SELECT uuid FROM workspaces WHERE uuid IS NOT NULL AND deleted_at IS NULL',
    );
    for (const r of rows) if (r.uuid) ids.add(r.uuid);
  } catch {
    // Таблица workspaces может отсутствовать на базе до v11 — не критично.
  }
  if (userId) ids.add(computeWorkspaceId(userId));
  if (ids.size === 0) ids.add(LOCAL_WS_ID);
  return [...ids];
}

/**
 * Согласование `ws_local` → `ws_<uid>` при привязке базы к аккаунту.
 *
 * Локально-only база (созданная без входа) в v11 получила personal-пространство
 * с placeholder-id `ws_local`. После входа под аккаунтом серверный backfill уже
 * создал (или создаст) personal-ws с детерминированным `ws_<uid>`. Чтобы строки
 * склеились по PK при первом sync, нужно ДО push'а переименовать все локальные
 * ссылки `ws_local` → `ws_<uid>` и завести ws/членство под правильным id.
 *
 * Идемпотентно: если `ws_local` уже нет (или база уже под ws_<uid>) — no-op.
 * Вызывается из orchestrator перед pull/push и безопасно при каждом sync.
 *
 * @returns true, если что-то переименовали (для логов/тестов).
 */
export function reconcilePersonalWorkspace(userId: string): boolean {
  const target = computeWorkspaceId(userId);
  if (target === LOCAL_WS_ID) return false;

  // Есть ли локальный placeholder ws_local?
  const localWs = db.get<{ id: number }>(
    'SELECT id FROM workspaces WHERE uuid=?',
    [LOCAL_WS_ID],
  );
  const hasLocalRefs =
    !!localWs ||
    !!db.get<{ n: number }>(
      'SELECT 1 AS n FROM workspace_members WHERE workspace_id=? LIMIT 1',
      [LOCAL_WS_ID],
    );
  if (!hasLocalRefs) {
    // Нет placeholder'а. Всё же убедимся, что owner_id personal-ws проставлен.
    db.run(
      `UPDATE workspaces SET owner_id=? WHERE uuid=? AND (owner_id IS NULL OR owner_id='')`,
      [userId, target],
    );
    return false;
  }

  const memberUuid = 'wsm_' + userId.toLowerCase().replace(/-/g, '');
  const targetWsExists = !!db.get<{ id: number }>(
    'SELECT id FROM workspaces WHERE uuid=?',
    [target],
  );

  // 1. Переносим workspace_id во всех дочерних sync-таблицах.
  for (const t of ['tasks', 'statuses', 'tags', 'task_templates', 'overdue_events', 'task_hold_periods']) {
    try {
      db.run(`UPDATE ${t} SET workspace_id=? WHERE workspace_id=?`, [target, LOCAL_WS_ID]);
    } catch (e) {
      logger.warn(`[sync/workspace] reconcile ${t} failed:`, e);
    }
  }

  // 2. Настройки пространства.
  db.run('UPDATE workspace_settings SET workspace_id=? WHERE workspace_id=?', [target, LOCAL_WS_ID]);

  // 3. Членство: переносим на target, проставляем user_id, чиним uuid.
  db.run(
    `UPDATE workspace_members
       SET workspace_id=?, user_id=COALESCE(NULLIF(user_id,''), ?)
     WHERE workspace_id=?`,
    [target, userId, LOCAL_WS_ID],
  );
  // uuid членства делаем детерминированным (совпадает с серверным backfill'ом).
  db.run(
    `UPDATE workspace_members SET uuid=? WHERE workspace_id=? AND uuid=?`,
    [memberUuid, target, 'wsm_local'],
  );

  // 4. Само пространство: переименовать placeholder или удалить, если target уже есть.
  if (targetWsExists) {
    db.run('DELETE FROM workspaces WHERE uuid=?', [LOCAL_WS_ID]);
  } else if (localWs) {
    db.run(
      `UPDATE workspaces SET uuid=?, owner_id=COALESCE(NULLIF(owner_id,''), ?) WHERE uuid=?`,
      [target, userId, LOCAL_WS_ID],
    );
  }

  // 5. Указатели текущего/personal пространства в settings.
  db.run(
    `UPDATE settings SET value=? WHERE key IN ('personal_workspace_id','current_workspace_id') AND value=?`,
    [target, LOCAL_WS_ID],
  );

  // 6. Ставим на push переименованные ws-сущности под правильным id.
  enqueueOutbox('workspaces', target, 'upsert');
  enqueueOutbox('workspace_members', memberUuid, 'upsert');
  const settings = db.all<{ uuid: string | null }>(
    'SELECT uuid FROM workspace_settings WHERE workspace_id=? AND uuid IS NOT NULL',
    [target],
  );
  for (const s of settings) if (s.uuid) enqueueOutbox('workspace_settings', s.uuid, 'upsert');

  logger.info(`[sync/workspace] reconciled ws_local → ${target}`);
  return true;
}
