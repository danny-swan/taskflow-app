// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * db.f29LegacyWsNormalize.test.ts — F29 (ADR 0022): нормализация legacy
 * workspace_id при восстановлении workspace-aware слота.
 *
 * F28 сделал слот workspace-aware: `applyBackup` сохраняет исходный
 * `task.workspace_id` строки (`resolveWsId`) вместо повсеместной штамповки
 * единым `importWsId`. Это обнажило старый рассинхрон: задачи первого личного
 * пространства, созданные ДО переклейки `ws_local → ws_<uid>`
 * (`reconcileLocalPlaceholder`, src/lib/sync/workspace.ts), несут legacy
 * `workspace_id='ws_local'` — значения, которого нет среди восстановленных
 * `payload.workspaces`. `filterByWorkspace` (src/store/workspaceScope.ts)
 * фильтрует UI строго по равенству `workspace_id===currentWorkspaceId` —
 * legacy-строки не совпадают и выпадают из «Мои задачи», хотя счётчик/
 * статистика (не ws-scoped) их видят.
 *
 * Фикс: в workspace-aware режиме `applyBackup` переназначает workspace_id
 * строк, которых НЕТ среди восстановленных `payload.workspaces`, на
 * канонический personal ws (settings-указатель, если он в восстановленном
 * наборе, иначе personal-строка с наименьшим sort_order). Строки с валидным
 * workspace_id (входит в payload.workspaces) не трогаются.
 *
 * Гоняем реальный db.ts в web-режиме (sql.js) — по образцу
 * db.workspaceAwareBackup.test.ts.
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

/** Создаёт личное/второе пространство с owner-membership (как createWorkspace в useStore.ts). */
function createWorkspaceWithMember(
  dbMod: typeof import('./db'),
  wsUuid: string,
  userId: string,
  memberUuid: string,
  sortOrder: number,
  name = 'Мои задачи',
) {
  dbMod.run(
    `INSERT INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,1)`,
    [wsUuid, name, 'personal', userId, sortOrder, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'],
  );
  dbMod.run(
    `INSERT INTO workspace_members (uuid, workspace_id, user_id, role, joined_at, created_at, updated_at, version) VALUES (?,?,?, 'owner', ?,?,?,1)`,
    [memberUuid, wsUuid, userId, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'],
  );
}

describe('F29: applyBackup нормализует legacy workspace_id при restore', () => {
  it('1. legacy roundtrip: ws_local-задача склеивается с canonical personal (sort_order=0), второе пространство не трогается', async () => {
    const dbMod = await import('./db');
    const { initDb, run, buildBackup, applyBackup } = dbMod;
    await initDb();

    const userId = 'user-f29-a';
    const canonicalWs = 'ws_' + userId.replace(/-/g, ''); // ws_<uid>, sort_order=0
    const manualWs = 'ws_manual'; // второе личное, sort_order=1

    createWorkspaceWithMember(dbMod, canonicalWs, userId, 'wsm_a_' + userId, 0, 'Мои задачи');
    createWorkspaceWithMember(dbMod, manualWs, userId, 'wsm_b_' + userId, 1, 'Второе личное');

    // Убираем сеедовый ws_local/его welcome-задачу, чтобы счёт был детерминирован.
    run(`DELETE FROM tasks WHERE workspace_id='ws_local'`);
    run(`DELETE FROM workspace_members WHERE workspace_id='ws_local'`);
    run(`DELETE FROM workspaces WHERE uuid='ws_local'`);

    // Legacy-задача: создана ДО переклейки ws_local→ws_<uid>, несёт старый workspace_id.
    run(
      `INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('Legacy task', '', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'ws_local')`,
    );
    // Задача второго (валидного) пространства.
    run(
      `INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('Second ws task', '', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`,
      [manualWs],
    );

    // settings.current_workspace_id указывает на canonical (как после reconcile до restore).
    run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('current_workspace_id', ?)`, [canonicalWs]);
    run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('personal_workspace_id', ?)`, [canonicalWs]);

    const backup = buildBackup({ tasks: true, tags: true, statuses: true, workspaces: true });
    expect(backup.workspaces!.some((w: any) => w.uuid === canonicalWs)).toBe(true);
    expect(backup.workspaces!.some((w: any) => w.uuid === manualWs)).toBe(true);
    // Legacy 'ws_local' НЕ входит в восстановленный набор — его строки уже не существует.
    expect(backup.workspaces!.some((w: any) => w.uuid === 'ws_local')).toBe(false);

    // Симулируем смену аккаунта: всё стёрто, потом restore слота.
    run('DELETE FROM tasks');
    run('DELETE FROM workspace_members');
    run('DELETE FROM workspaces');

    await applyBackup(backup, 'replace');

    const legacyTask = dbMod.get<any>(`SELECT * FROM tasks WHERE title='Legacy task'`);
    const secondTask = dbMod.get<any>(`SELECT * FROM tasks WHERE title='Second ws task'`);

    // Legacy-задача переназначена на canonical personal (sort_order=0), НЕ осталась на 'ws_local'.
    expect(legacyTask.workspace_id).toBe(canonicalWs);
    expect(legacyTask.workspace_id).not.toBe('ws_local');
    // Задача второго пространства НЕ смешана с canonical — осталась на своём ws.
    expect(secondTask.workspace_id).toBe(manualWs);
    expect(legacyTask.workspace_id).not.toBe(secondTask.workspace_id);
  });

  it('2. не-legacy задачи (workspace_id входит в payload.workspaces) НЕ переназначаются', async () => {
    const dbMod = await import('./db');
    const { initDb, run, buildBackup, applyBackup } = dbMod;
    await initDb();

    const userId = 'user-f29-b';
    const canonicalWs = 'ws_' + userId.replace(/-/g, '');
    const manualWs = 'ws_manual_valid';

    createWorkspaceWithMember(dbMod, canonicalWs, userId, 'wsm_a_' + userId, 0, 'Мои задачи');
    createWorkspaceWithMember(dbMod, manualWs, userId, 'wsm_b_' + userId, 1, 'Второе личное');

    run(`DELETE FROM tasks WHERE workspace_id='ws_local'`);
    run(`DELETE FROM workspace_members WHERE workspace_id='ws_local'`);
    run(`DELETE FROM workspaces WHERE uuid='ws_local'`);

    run(
      `INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('WS1 task', '', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`,
      [canonicalWs],
    );
    run(
      `INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('WS2 task', '', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`,
      [manualWs],
    );

    run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('current_workspace_id', ?)`, [canonicalWs]);

    const backup = buildBackup({ tasks: true, tags: true, statuses: true, workspaces: true });

    run('DELETE FROM tasks');
    run('DELETE FROM workspace_members');
    run('DELETE FROM workspaces');

    await applyBackup(backup, 'replace');

    const t1 = dbMod.get<any>(`SELECT * FROM tasks WHERE title='WS1 task'`);
    const t2 = dbMod.get<any>(`SELECT * FROM tasks WHERE title='WS2 task'`);

    // F28-поведение сохранено: валидные workspace_id (входят в payload.workspaces) не меняются.
    expect(t1.workspace_id).toBe(canonicalWs);
    expect(t2.workspace_id).toBe(manualWs);
  });

  it('3. два личных пространства без legacy-строк переживают save→load, normalize — no-op', async () => {
    const dbMod = await import('./db');
    const { initDb, run, buildBackup, applyBackup } = dbMod;
    await initDb();

    const userId = 'user-f29-c';
    const wsA = 'ws_' + userId.replace(/-/g, '');
    const wsB = 'ws_manual_second_c';

    createWorkspaceWithMember(dbMod, wsA, userId, 'wsm_a_' + userId, 0, 'Мои задачи');
    createWorkspaceWithMember(dbMod, wsB, userId, 'wsm_b_' + userId, 1, 'Второе личное');

    run(`DELETE FROM tasks WHERE workspace_id='ws_local'`);
    run(`DELETE FROM workspace_members WHERE workspace_id='ws_local'`);
    run(`DELETE FROM workspaces WHERE uuid='ws_local'`);

    run(`INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('A1', '', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`, [wsA]);
    run(`INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('A2', '', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`, [wsA]);
    run(`INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('B1', '', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`, [wsB]);

    run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('current_workspace_id', ?)`, [wsA]);

    const slotPayload = buildBackup({ tasks: true, tags: true, statuses: true, workspaces: true });

    run('DELETE FROM tasks');
    run('DELETE FROM workspace_members');
    run('DELETE FROM workspaces');

    await applyBackup(slotPayload, 'replace');

    const tasksWsA = dbMod.all<any>('SELECT title FROM tasks WHERE workspace_id=?', [wsA]).map(r => r.title).sort();
    const tasksWsB = dbMod.all<any>('SELECT title FROM tasks WHERE workspace_id=?', [wsB]).map(r => r.title).sort();
    // Нет legacy-строк → normalize no-op, задачи не перемешаны (F28-инвариант сохранён).
    expect(tasksWsA).toEqual(['A1', 'A2']);
    expect(tasksWsB).toEqual(['B1']);
  });

  it('4. легаси-бэкап без payload.workspaces (isWorkspaceAware=false) — normalize НЕ применяется, importWsId-штамповка как раньше', async () => {
    const dbMod = await import('./db');
    const { initDb, run, get, buildBackup, applyBackup } = dbMod;
    await initDb();

    // Легаси-задача с любым workspace_id — при легаси-бэкапе (без workspaces) поведение
    // должно остаться прежним: importWsId-штамповка, а не F29-нормализация (её нет вне
    // workspace-aware режима — нет payload.workspaces, чтобы вычислить canonical/valid-набор).
    run(`INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('Legacy no-ws-payload', '', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', 'ws_local')`);

    const backup = buildBackup({ tasks: true, tags: true, statuses: true }); // БЕЗ workspaces: true
    expect(backup.workspaces).toBeUndefined();

    const currentWsId = get<{ value: string }>(`SELECT value FROM settings WHERE key='current_workspace_id'`)?.value
      ?? get<{ value: string }>(`SELECT value FROM settings WHERE key='personal_workspace_id'`)?.value
      ?? 'ws_local';

    run('DELETE FROM tasks');
    const counts = await applyBackup(backup, 'replace');
    expect(counts.workspaces).toBe(0);
    expect(counts.workspace_members).toBe(0);

    const restored = get<any>(`SELECT * FROM tasks WHERE title='Legacy no-ws-payload'`);
    expect(restored).toBeTruthy();
    // Обратная совместимость: легаси-бэкап штампует importWsId, как и до F29.
    expect(restored.workspace_id).toBe(currentWsId);
  });
});
