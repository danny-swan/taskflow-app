// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * db.workspaceAwareBackup.test.ts — F28 (ADR 0021): слот free-аккаунта
 * (ADR 0014) не сохранял `workspaces`/`workspace_members`, а `applyBackup`
 * штамповал ВСЕ восстановленные строки одним `importWsId`. Следствие: второе
 * вручную созданное личное пространство теряло owner-membership при
 * восстановлении слота → `dedupePersonalWorkspaces` (src/lib/sync/workspace.ts)
 * гасило его как чужой мусор, а задачи разных пространств смешивались в одно.
 *
 * Фикс: `buildBackup({ ..., workspaces: true })` кладёт в дамп `workspaces` +
 * `workspace_members`; присутствие `payload.workspaces` переключает
 * `applyBackup` в workspace-aware режим — каждая восстановленная строка
 * сохраняет СВОЙ `workspace_id`, а не схлопывается в текущее пространство.
 * Легаси-бэкапы (без `workspaces`) продолжают работать по-старому.
 *
 * Гоняем реальный db.ts в web-режиме (sql.js) — по образцу db.applyBackup.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const req = createRequire(import.meta.url);
const WASM_FILE_URL = pathToFileURL(req.resolve('sql.js/dist/sql-wasm.wasm')).href;
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: WASM_FILE_URL }));

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (lsStore.has(k) ? lsStore.get(k)! : null),
    setItem: (k: string, v: string) => { lsStore.set(k, v); },
    removeItem: (k: string) => { lsStore.delete(k); },
    clear: () => lsStore.clear(),
  });
});

/** Создаёт второе личное пространство с owner-membership (как createWorkspace в useStore.ts). */
function createSecondPersonalWorkspace(
  dbMod: typeof import('./db'),
  wsUuid: string,
  userId: string,
  memberUuid: string,
) {
  dbMod.run(
    `INSERT INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,1)`,
    [wsUuid, 'Второе личное', 'personal', userId, 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'],
  );
  dbMod.run(
    `INSERT INTO workspace_members (uuid, workspace_id, user_id, role, joined_at, created_at, updated_at, version) VALUES (?,?,?, 'owner', ?,?,?,1)`,
    [memberUuid, wsUuid, userId, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'],
  );
}

describe('F28: buildBackup/applyBackup workspace-aware', () => {
  it('1. workspace-aware roundtrip: workspaces/workspace_members восстановлены, задачи сохраняют свой workspace_id', async () => {
    const dbMod = await import('./db');
    const { initDb, run, all, get, buildBackup, applyBackup } = dbMod;
    await initDb();

    const userId = 'user-f28-a';
    const personalWs = 'ws_' + userId.replace(/-/g, '');
    const secondWs = 'ws_second_manual';
    const memberUuid = 'wsm_' + userId.replace(/-/g, '');
    const secondMemberUuid = 'wsm_second_manual';

    // initDb() всегда сеет системное легаси-пространство `ws_local` (из сееда миграций v11) —
    // оно остаётся в базе как третье пространство. Личное пространство пользователя
    // (детерминированный `ws_<uid>`) создаётся явно, так же как второе.
    run(
      `INSERT OR IGNORE INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,1)`,
      [personalWs, 'Мои задачи', 'personal', userId, 0, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'],
    );
    run(
      `INSERT OR IGNORE INTO workspace_members (uuid, workspace_id, user_id, role, joined_at, created_at, updated_at, version) VALUES (?,?,?, 'owner', ?,?,?,1)`,
      [memberUuid, personalWs, userId, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'],
    );

    // Второе вручную созданное личное пространство.
    createSecondPersonalWorkspace(dbMod, secondWs, userId, secondMemberUuid);

    // Загрубо убираем сеедовые `ws_local`/`wsm_local` и его welcome-задачу (сеедятся внутри initDb,
    // миграция v11), чтобы счёт во второй части теста был детерминирован.
    run(`DELETE FROM tasks WHERE workspace_id='ws_local'`);
    run(`DELETE FROM workspace_members WHERE workspace_id='ws_local'`);
    run(`DELETE FROM workspaces WHERE uuid='ws_local'`);

    // Задачи в разных пространствах.
    run(
      `INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('Task in WS1', '', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`,
      [personalWs],
    );
    run(
      `INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('Task in WS2', '', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`,
      [secondWs],
    );

    const backup = buildBackup({ tasks: true, tags: true, statuses: true, workspaces: true });
    expect(Array.isArray(backup.workspaces)).toBe(true);
    expect(Array.isArray(backup.workspace_members)).toBe(true);
    expect(backup.workspaces!.length).toBe(2);
    expect(backup.workspace_members!.length).toBe(2);
    expect(backup.workspaces!.some((w: any) => w.uuid === personalWs)).toBe(true);
    expect(backup.workspaces!.some((w: any) => w.uuid === secondWs)).toBe(true);

    // Симулируем clearUserData() + чистую базу нового аккаунта, потом восстанавливаем слот.
    run('DELETE FROM tasks');
    run('DELETE FROM workspace_members');
    run('DELETE FROM workspaces');

    const counts = await applyBackup(backup, 'replace');
    expect(counts.workspaces).toBe(2);
    expect(counts.workspace_members).toBe(2);
    expect(counts.tasks).toBe(2);

    // Оба пространства восстановлены.
    const ws1 = get<any>('SELECT * FROM workspaces WHERE uuid=?', [personalWs]);
    const ws2 = get<any>('SELECT * FROM workspaces WHERE uuid=?', [secondWs]);
    expect(ws1).toBeTruthy();
    expect(ws2).toBeTruthy();
    expect(ws1.deleted_at).toBeFalsy();
    expect(ws2.deleted_at).toBeFalsy();

    // Оба членства восстановлены (критично для dedupe — см. тест 4 ниже).
    const m1 = get<any>('SELECT * FROM workspace_members WHERE workspace_id=? AND user_id=?', [personalWs, userId]);
    const m2 = get<any>('SELECT * FROM workspace_members WHERE workspace_id=? AND user_id=?', [secondWs, userId]);
    expect(m1).toBeTruthy();
    expect(m2).toBeTruthy();

    // КРИТИЧНО: задачи сохранили СВОЙ исходный workspace_id, а не схлопнулись в один.
    const t1 = get<any>(`SELECT * FROM tasks WHERE title='Task in WS1'`);
    const t2 = get<any>(`SELECT * FROM tasks WHERE title='Task in WS2'`);
    expect(t1.workspace_id).toBe(personalWs);
    expect(t2.workspace_id).toBe(secondWs);
    expect(t1.workspace_id).not.toBe(t2.workspace_id);

    // Восстановленные строки поставлены в очередь на push (sync-идентичность, dev.6.10.4).
    const wsOutbox = all<any>(`SELECT * FROM sync_outbox WHERE entity_table='workspaces' AND entity_uuid=?`, [secondWs]);
    expect(wsOutbox.length).toBe(1);
  });

  it('2. легаси-бэкап без workspaces работает по-старому (importWsId-штамповка)', async () => {
    const dbMod = await import('./db');
    const { initDb, run, get, buildBackup, applyBackup } = dbMod;
    await initDb();

    run(`INSERT INTO tasks (title, comment, status_id, created_at, updated_at) VALUES ('Legacy task', '', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`);

    // Легаси-вызов buildBackup — БЕЗ workspaces (как делают snapshots.ts/Settings.tsx).
    const backup = buildBackup({ tasks: true, tags: true, statuses: true });
    expect(backup.workspaces).toBeUndefined();
    expect(backup.workspace_members).toBeUndefined();

    const currentWsId = get<{ value: string }>(`SELECT value FROM settings WHERE key='current_workspace_id'`)?.value
      ?? get<{ value: string }>(`SELECT value FROM settings WHERE key='personal_workspace_id'`)?.value
      ?? 'ws_local';

    run('DELETE FROM tasks');
    const counts = await applyBackup(backup, 'replace');
    // Легаси-формат: workspaces/workspace_members НЕ пришли в payload → не трогаем их таблицы.
    expect(counts.workspaces).toBe(0);
    expect(counts.workspace_members).toBe(0);

    const restored = get<any>(`SELECT * FROM tasks WHERE title='Legacy task'`);
    expect(restored).toBeTruthy();
    // Обратная совместимость: легаси-бэкап по-прежнему штампует текущим importWsId.
    expect(restored.workspace_id).toBe(currentWsId);
  });

  it('3. два личных пространства переживают save→load слота без смешивания задач', async () => {
    const dbMod = await import('./db');
    const { initDb, run, get, buildBackup, applyBackup } = dbMod;
    await initDb();

    const userId = 'user-f28-b';
    const wsA = 'ws_' + userId.replace(/-/g, '');
    const wsB = 'ws_manual_second';

    run(
      `INSERT OR IGNORE INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,1)`,
      [wsA, 'Мои задачи', 'personal', userId, 0, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'],
    );
    run(
      `INSERT OR IGNORE INTO workspace_members (uuid, workspace_id, user_id, role, joined_at, created_at, updated_at, version) VALUES (?,?,?, 'owner', ?,?,?,1)`,
      ['wsm_a_' + userId, wsA, userId, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'],
    );
    createSecondPersonalWorkspace(dbMod, wsB, userId, 'wsm_b_' + userId);

    run(`INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('A1', '', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`, [wsA]);
    run(`INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('A2', '', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`, [wsA]);
    run(`INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('B1', '', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`, [wsB]);

    // save слота (как localAccountStore.saveLocalAccountData)
    const slotPayload = buildBackup({ tasks: true, tags: true, statuses: true, workspaces: true });

    // Эмулируем смену аккаунта: clearUserData стирает всё.
    run('DELETE FROM tasks');
    run('DELETE FROM workspace_members');
    run('DELETE FROM workspaces');

    // load слота (как localAccountStore.loadLocalAccountData)
    await applyBackup(slotPayload, 'replace');

    const tasksWsA = dbMod.all<any>('SELECT title FROM tasks WHERE workspace_id=?', [wsA]).map(r => r.title).sort();
    const tasksWsB = dbMod.all<any>('SELECT title FROM tasks WHERE workspace_id=?', [wsB]).map(r => r.title).sort();
    expect(tasksWsA).toEqual(['A1', 'A2']);
    expect(tasksWsB).toEqual(['B1']);

    const wsBRow = get<any>('SELECT * FROM workspaces WHERE uuid=?', [wsB]);
    expect(wsBRow).toBeTruthy();
    expect(wsBRow.deleted_at).toBeFalsy();
  });

  it('4. dedupePersonalWorkspaces не гасит второе личное пространство после восстановления', async () => {
    const dbMod = await import('./db');
    const { initDb, run, buildBackup, applyBackup } = dbMod;
    await initDb();

    const userId = 'user-f28-c';
    const wsA = 'ws_' + userId.replace(/-/g, '');
    const wsB = 'ws_manual_dedupe_check';

    run(
      `INSERT OR IGNORE INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,1)`,
      [wsA, 'Мои задачи', 'personal', userId, 0, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'],
    );
    run(
      `INSERT OR IGNORE INTO workspace_members (uuid, workspace_id, user_id, role, joined_at, created_at, updated_at, version) VALUES (?,?,?, 'owner', ?,?,?,1)`,
      ['wsm_a_' + userId, wsA, userId, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'],
    );
    createSecondPersonalWorkspace(dbMod, wsB, userId, 'wsm_b_' + userId);

    const slotPayload = buildBackup({ tasks: true, tags: true, statuses: true, workspaces: true });

    // Смена аккаунта: всё стёрто.
    run('DELETE FROM tasks');
    run('DELETE FROM workspace_members');
    run('DELETE FROM workspaces');

    await applyBackup(slotPayload, 'replace');

    // dedupePersonalWorkspaces не экспортируется — проверяем его инвариант напрямую
    // (hasLocalMembership), т.к. именно от него зависит, погасит ли dedupe пространство.
    const { reconcilePersonalWorkspace } = await import('./sync/workspace');
    const changed = reconcilePersonalWorkspace(userId);
    void changed;

    const wsBAfter = dbMod.get<any>('SELECT * FROM workspaces WHERE uuid=?', [wsB]);
    const memberBAfter = dbMod.get<any>(
      'SELECT * FROM workspace_members WHERE workspace_id=? AND user_id=? AND deleted_at IS NULL',
      [wsB, userId],
    );
    // Второе личное пространство ДОЛЖНО пережить reconcile+dedupe: у него есть
    // живое членство (восстановлено вместе с ws в workspace-aware слоте).
    expect(wsBAfter).toBeTruthy();
    expect(wsBAfter.deleted_at).toBeFalsy();
    expect(memberBAfter).toBeTruthy();
  });
});
