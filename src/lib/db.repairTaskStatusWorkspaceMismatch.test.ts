// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * db.repairTaskStatusWorkspaceMismatch.test.ts — F32 (ADR 0025).
 *
 * Доказано на реальной data.db пользователя (2026-08-03): applyBackup (до
 * фикса в этом же F32) перепривязывал task.status_id по ИМЕНИ статуса без
 * учёта workspace_id. При 2+ пространствах с одноимёнными сид-статусами
 * («Сегодня», «Взять в работу», ...) это уже испортило данные на диске —
 * часть задач ссылается на status_id из ЧУЖОГО workspace. Доска рендерит
 * колонки по статусам ТЕКУЩЕГО workspace → такие задачи невидимы, хотя
 * счётчик (считает по workspace_id задачи, не статуса) показывает верное
 * число. Ровно симптом пользователя: «после переключения аккаунта доска
 * пустая, счётчик верный».
 *
 * repairTaskStatusWorkspaceMismatch() — идемпотентный ремонт УЖЕ битых
 * данных: для задачи, чей статус принадлежит другому workspace, перепривязка
 * на одноимённый статус её собственного workspace. Никогда не удаляет задачи;
 * если одноимённого статуса в целевом ws нет — задача не трогается.
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

describe('F32: repairTaskStatusWorkspaceMismatch()', () => {
  it('1. чинит MISMATCH: задача ws A со статусом ws B рекбиндится на одноимённый статус ws A', async () => {
    const dbMod = await import('./db');
    const { initDb, run, get, repairTaskStatusWorkspaceMismatch } = dbMod;
    await initDb();

    const wsA = 'ws_repair_a';
    const wsB = 'ws_repair_b';
    run(
      `INSERT OR IGNORE INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,1)`,
      [wsA, 'Мои задачи', 'personal', 'user-repair', 0, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'],
    );
    run(
      `INSERT OR IGNORE INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,1)`,
      [wsB, 'new test3', 'personal', 'user-repair', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'],
    );
    run(`DELETE FROM tasks WHERE workspace_id='ws_local'`);
    run(`DELETE FROM statuses WHERE workspace_id='ws_local'`);
    run(`DELETE FROM workspaces WHERE uuid='ws_local'`);

    run(`INSERT INTO statuses (name, color, behavior, sort_order, workspace_id) VALUES ('Сегодня', '#111', 'top', 0, ?)`, [wsA]);
    run(`INSERT INTO statuses (name, color, behavior, sort_order, workspace_id) VALUES ('Взять в работу', '#111', 'middle', 1, ?)`, [wsA]);
    run(`INSERT INTO statuses (name, color, behavior, sort_order, workspace_id) VALUES ('Сегодня', '#222', 'top', 0, ?)`, [wsB]);
    run(`INSERT INTO statuses (name, color, behavior, sort_order, workspace_id) VALUES ('Взять в работу', '#222', 'middle', 1, ?)`, [wsB]);

    const statusTodayA = get<any>(`SELECT id FROM statuses WHERE workspace_id=? AND name='Сегодня'`, [wsA]);
    const statusTakeA = get<any>(`SELECT id FROM statuses WHERE workspace_id=? AND name='Взять в работу'`, [wsA]);
    const statusTodayB = get<any>(`SELECT id FROM statuses WHERE workspace_id=? AND name='Сегодня'`, [wsB]);
    const statusTakeB = get<any>(`SELECT id FROM statuses WHERE workspace_id=? AND name='Взять в работу'`, [wsB]);

    // MISMATCH, воспроизводящий реальную data.db: задачи в ws A, но status_id
    // указывает на статусы ws B (id=4, id=8 в проде — здесь используем реальные
    // id, сгенерированные тестовой БД).
    run(
      `INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('Добро пожаловать', '', ?, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`,
      [statusTodayB.id, wsA],
    );
    run(
      `INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('Задача 1', '', ?, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`,
      [statusTakeB.id, wsA],
    );
    // Задача БЕЗ mismatch (правильно привязана в своём ws) — не должна измениться.
    run(
      `INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('OK task ws B', '', ?, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`,
      [statusTakeB.id, wsB],
    );

    await repairTaskStatusWorkspaceMismatch();

    const welcome = get<any>(`SELECT * FROM tasks WHERE title='Добро пожаловать'`);
    const task1 = get<any>(`SELECT * FROM tasks WHERE title='Задача 1'`);
    const okTask = get<any>(`SELECT * FROM tasks WHERE title='OK task ws B'`);

    // Рекбинд на одноимённый статус СОБСТВЕННОГО ws.
    expect(welcome.status_id).toBe(statusTodayA.id);
    expect(task1.status_id).toBe(statusTakeA.id);

    // Задача без mismatch не изменилась.
    expect(okTask.status_id).toBe(statusTakeB.id);

    // Все задачи целы (никто не удалён).
    const allTasks = dbMod.all<any>(`SELECT title FROM tasks WHERE title IN ('Добро пожаловать','Задача 1','OK task ws B')`);
    expect(allTasks.length).toBe(3);
  });

  it('2. идемпотентность: повторный вызов ничего не портит', async () => {
    const dbMod = await import('./db');
    const { initDb, run, get, repairTaskStatusWorkspaceMismatch } = dbMod;
    await initDb();

    const wsA = 'ws_idem_a';
    const wsB = 'ws_idem_b';
    run(`INSERT OR IGNORE INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,1)`, [wsA, 'A', 'personal', 'u', 0, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z']);
    run(`INSERT OR IGNORE INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,1)`, [wsB, 'B', 'personal', 'u', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z']);
    run(`DELETE FROM tasks WHERE workspace_id='ws_local'`);
    run(`DELETE FROM statuses WHERE workspace_id='ws_local'`);
    run(`DELETE FROM workspaces WHERE uuid='ws_local'`);

    run(`INSERT INTO statuses (name, color, behavior, sort_order, workspace_id) VALUES ('Сегодня', '#111', 'top', 0, ?)`, [wsA]);
    run(`INSERT INTO statuses (name, color, behavior, sort_order, workspace_id) VALUES ('Сегодня', '#222', 'top', 0, ?)`, [wsB]);
    const statusA = get<any>(`SELECT id FROM statuses WHERE workspace_id=? AND name='Сегодня'`, [wsA]);
    const statusB = get<any>(`SELECT id FROM statuses WHERE workspace_id=? AND name='Сегодня'`, [wsB]);

    run(`INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('T', '', ?, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`, [statusB.id, wsA]);

    const firstChanges = await repairTaskStatusWorkspaceMismatch();
    expect(firstChanges).toBeGreaterThanOrEqual(1);
    const afterFirst = get<any>(`SELECT * FROM tasks WHERE title='T'`);
    expect(afterFirst.status_id).toBe(statusA.id);

    const secondChanges = await repairTaskStatusWorkspaceMismatch();
    expect(secondChanges).toBe(0); // no-op — mismatch уже устранён
    const afterSecond = get<any>(`SELECT * FROM tasks WHERE title='T'`);
    expect(afterSecond.status_id).toBe(statusA.id); // не изменилось
  });

  it('3. нет одноимённого статуса в целевом ws → задача НЕ трогается и НЕ удаляется', async () => {
    const dbMod = await import('./db');
    const { initDb, run, get, all, repairTaskStatusWorkspaceMismatch } = dbMod;
    await initDb();

    const wsA = 'ws_noname_a';
    const wsB = 'ws_noname_b';
    run(`INSERT OR IGNORE INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,1)`, [wsA, 'A', 'personal', 'u', 0, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z']);
    run(`INSERT OR IGNORE INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,1)`, [wsB, 'B', 'personal', 'u', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z']);
    run(`DELETE FROM tasks WHERE workspace_id='ws_local'`);
    run(`DELETE FROM statuses WHERE workspace_id='ws_local'`);
    run(`DELETE FROM workspaces WHERE uuid='ws_local'`);

    // ws A НЕ имеет статуса «Уникальный» — только ws B.
    run(`INSERT INTO statuses (name, color, behavior, sort_order, workspace_id) VALUES ('Сегодня', '#111', 'top', 0, ?)`, [wsA]);
    run(`INSERT INTO statuses (name, color, behavior, sort_order, workspace_id) VALUES ('Уникальный', '#222', 'middle', 1, ?)`, [wsB]);
    const uniqueB = get<any>(`SELECT id FROM statuses WHERE workspace_id=? AND name='Уникальный'`, [wsB]);

    run(`INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('Orphaned', '', ?, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`, [uniqueB.id, wsA]);

    await repairTaskStatusWorkspaceMismatch();

    // Задача цела, НЕ удалена, status_id НЕ тронут (нет одноимённого статуса в ws A).
    const task = get<any>(`SELECT * FROM tasks WHERE title='Orphaned'`);
    expect(task).toBeTruthy();
    expect(task.status_id).toBe(uniqueB.id);

    const allTasks = all<any>(`SELECT * FROM tasks WHERE title='Orphaned'`);
    expect(allTasks.length).toBe(1);
  });
});
