/**
 * db.applyBackup.test.ts — Unit-тест applyBackup() (v0.9.35-dev.6.10.4).
 *
 * Баги А/Б: восстановление снимка вставляло строки БЕЗ uuid/version/deleted_at/
 * client_id и НЕ ставило их в sync_outbox. Итог — «задача восстановлена, но
 * пропадает после следующего pull» (баг А) и «восстановленная после полного
 * удаления задача снова не появляется» (баг Б), потому что pull-логика
 * ориентируется на uuid/version, а без outbox-записи push никогда их не
 * отправлял в облако.
 *
 * Проверяем контракт: после applyBackup() каждая восстановленная строка
 * (statuses/tags/tasks/task_templates) имеет непустой uuid, client_id,
 * числовой version и попадает в sync_outbox с op='upsert'.
 *
 * Гоняем реальный db.ts в web-режиме (sql.js), мокая только Vite-специфичный
 * `?url`-импорт wasm на реальный путь файла из node_modules — по образцу
 * db.clearUserData.test.ts.
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

describe('applyBackup() — сохранение sync-идентичности восстановленных строк', () => {
  it('восстановленная задача получает uuid/client_id/version и попадает в sync_outbox', async () => {
    const db = await import('./db');
    const { initDb, run, get, all, buildBackup, applyBackup } = db;

    await initDb();
    // Даём устройству известный client_id, чтобы проверить его проброс в restore.
    run(
      `INSERT INTO settings (key, value) VALUES ('client_id', 'client-xyz') ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );

    // Задача, которую «удалили» перед снимком не участвует — снимок строим ДО удаления.
    run(
      `INSERT INTO tasks (title, comment, status_id, created_at, updated_at) VALUES ('Важная задача', '', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
    );

    // Снимок «до удаления» — как делает createSnapshot(). initDb() может
    // засеять дефолтную приветственную задачу — проверяем «есть хотя бы
    // наша строка», а не точное число (по образцу db.clearUserData.test.ts).
    const backup = buildBackup({ tasks: true, tags: false, statuses: false });
    expect(backup.tasks?.some((t: any) => t.title === 'Важная задача')).toBe(true);

    // Пользователь удаляет задачу (эмулируем permanentlyDeleteTask — просто DELETE).
    run(`DELETE FROM tasks WHERE title = 'Важная задача'`);
    expect(all(`SELECT * FROM tasks WHERE title = 'Важная задача'`).length).toBe(0);

    // Восстанавливаем снимок.
    await applyBackup(backup, 'replace');

    const restored = get<any>(`SELECT * FROM tasks WHERE title = 'Важная задача'`);
    expect(restored).toBeTruthy();
    // Баг А/Б: раньше эти поля были NULL/отсутствовали после restore.
    expect(restored.uuid).toBeTruthy();
    expect(typeof restored.uuid).toBe('string');
    expect(restored.client_id).toBe('client-xyz');
    expect(typeof restored.version).toBe('number');
    expect(restored.version).toBeGreaterThanOrEqual(1);

    // Должна быть поставлена в очередь на push — иначе следующий pull её затрёт.
    const outboxRow = get<any>(
      `SELECT * FROM sync_outbox WHERE entity_table = 'tasks' AND entity_uuid = ?`,
      [restored.uuid],
    );
    expect(outboxRow).toBeTruthy();
    expect(outboxRow.op).toBe('upsert');
  });

  it('повторное восстановление того же uuid увеличивает version и не дублирует outbox-запись', async () => {
    const db = await import('./db');
    const { initDb, run, get, all, buildBackup, applyBackup } = db;

    await initDb();
    run(`INSERT INTO tasks (title, comment, status_id, created_at, updated_at) VALUES ('T', '', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`);

    const backup1 = buildBackup({ tasks: true, tags: false, statuses: false });
    run(`DELETE FROM tasks`);
    await applyBackup(backup1, 'replace');

    const afterFirst = get<any>(`SELECT * FROM tasks WHERE title = 'T'`);
    const uuid = afterFirst.uuid;
    // Схема задаёт version DEFAULT 1 для обычного 'T' до restore —
    // applyBackup всегда делает version+1, чтобы победить в сравнении с облаком.
    expect(afterFirst.version).toBe(2);

    // Строим второй снимок ИЗ уже восстановленного состояния (несёт тот же uuid/version=2)
    // и восстанавливаем его снова поверх удалённой задачи — эмулируем повторный restore.
    const backup2 = buildBackup({ tasks: true, tags: false, statuses: false });
    run(`DELETE FROM tasks`);
    await applyBackup(backup2, 'replace');

    const afterSecond = get<any>(`SELECT * FROM tasks WHERE title = 'T'`);
    expect(afterSecond.uuid).toBe(uuid);
    expect(afterSecond.version).toBe(3); // version+1 при каждом restore

    const outboxRows = all<any>(`SELECT * FROM sync_outbox WHERE entity_table = 'tasks' AND entity_uuid = ?`, [uuid]);
    expect(outboxRows.length).toBe(1); // ON CONFLICT DO UPDATE — не дублируется
    expect(outboxRows[0].op).toBe('upsert');
    expect(outboxRows[0].attempt_count).toBe(0);
  });
});

// F32 (ADR 0025): applyBackup перепривязывал task.status_id по имени статуса
// БЕЗ учёта workspace_id. При 2+ пространствах с одноимёнными сид-статусами
// («Сегодня», «Взять в работу», ...) последняя по порядку вставки запись в
// name→id мапе перетирала предыдущую — задача из ws A получала status_id
// статуса из ws B (доска рендерит колонки по текущему ws → задача невидима,
// хотя счётчик по workspace_id показывает верное число). Доказано на реальной
// data.db пользователя (2026-08-03).
describe('F32: applyBackup — workspace-aware перепривязка status_id/tag_id', () => {
  it('1. два ws с ОДНОИМЁННЫМИ статусами разных id → восстановленная задача получает status_id СВОЕГО ws', async () => {
    const dbMod = await import('./db');
    const { initDb, run, all, get, buildBackup, applyBackup } = dbMod;
    await initDb();

    const wsA = 'ws_aaaaaaaaaaaaaaaa';
    const wsB = 'ws_bbbbbbbbbbbbbbbb';
    run(
      `INSERT OR IGNORE INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,1)`,
      [wsA, 'Мои задачи', 'personal', 'user-f32', 0, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'],
    );
    run(
      `INSERT OR IGNORE INTO workspaces (uuid, name, kind, owner_id, sort_order, created_at, updated_at, version) VALUES (?,?,?,?,?,?,?,1)`,
      [wsB, 'new test3', 'personal', 'user-f32', 1, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'],
    );
    // Убираем сеедовый ws_local и его артефакты, чтобы счёт был детерминирован.
    run(`DELETE FROM tasks WHERE workspace_id='ws_local'`);
    run(`DELETE FROM statuses WHERE workspace_id='ws_local'`);
    run(`DELETE FROM workspaces WHERE uuid='ws_local'`);

    // Одноимённые seed-статусы в ОБОИХ пространствах, с разными id (сид-набор).
    run(`INSERT INTO statuses (name, color, behavior, sort_order, workspace_id) VALUES ('Сегодня', '#111', 'top', 0, ?)`, [wsA]);
    run(`INSERT INTO statuses (name, color, behavior, sort_order, workspace_id) VALUES ('Взять в работу', '#111', 'middle', 1, ?)`, [wsA]);
    run(`INSERT INTO statuses (name, color, behavior, sort_order, workspace_id) VALUES ('Сегодня', '#222', 'top', 0, ?)`, [wsB]);
    run(`INSERT INTO statuses (name, color, behavior, sort_order, workspace_id) VALUES ('Взять в работу', '#222', 'middle', 1, ?)`, [wsB]);

    const statusTodayA = get<any>(`SELECT id FROM statuses WHERE workspace_id=? AND name='Сегодня'`, [wsA]);
    const statusTakeA = get<any>(`SELECT id FROM statuses WHERE workspace_id=? AND name='Взять в работу'`, [wsA]);
    const statusTodayB = get<any>(`SELECT id FROM statuses WHERE workspace_id=? AND name='Сегодня'`, [wsB]);
    expect(statusTodayA.id).not.toBe(statusTodayB.id);

    // Задачи: одна в ws A на статусе «Сегодня» ws A, одна в ws B на статусе «Взять в работу» ws B.
    run(
      `INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('Добро пожаловать', '', ?, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`,
      [statusTodayA.id, wsA],
    );
    const statusTakeB = get<any>(`SELECT id FROM statuses WHERE workspace_id=? AND name='Взять в работу'`, [wsB]);
    run(
      `INSERT INTO tasks (title, comment, status_id, created_at, updated_at, workspace_id) VALUES ('Задача B', '', ?, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z', ?)`,
      [statusTakeB.id, wsB],
    );

    const backup = buildBackup({ tasks: true, tags: true, statuses: true, workspaces: true });

    // Симулируем restore на чистую БД (как account-switch restore).
    run('DELETE FROM tasks');
    run('DELETE FROM statuses');
    run('DELETE FROM workspaces');
    run('DELETE FROM workspace_members');

    await applyBackup(backup, 'replace');

    const restoredWelcome = get<any>(`SELECT * FROM tasks WHERE title='Добро пожаловать'`);
    const restoredB = get<any>(`SELECT * FROM tasks WHERE title='Задача B'`);
    expect(restoredWelcome).toBeTruthy();
    expect(restoredB).toBeTruthy();

    // КРИТИЧНО (F32): status_id восстановленной задачи принадлежит её ЖЕ ws, не чужому.
    const welcomeStatus = get<any>(`SELECT * FROM statuses WHERE id=?`, [restoredWelcome.status_id]);
    const bStatus = get<any>(`SELECT * FROM statuses WHERE id=?`, [restoredB.status_id]);
    expect(welcomeStatus).toBeTruthy();
    expect(bStatus).toBeTruthy();
    expect(restoredWelcome.workspace_id).toBe(welcomeStatus.workspace_id);
    expect(restoredB.workspace_id).toBe(bStatus.workspace_id);
    expect(welcomeStatus.name).toBe('Сегодня');
    expect(bStatus.name).toBe('Взять в работу');

    // Убеждаемся, что оба ws действительно сохранили РАЗНЫЕ статусы «Сегодня» —
    // регресс-проверка того, что мапа не схлопнула их в один id.
    const allTodayStatuses = all<any>(`SELECT * FROM statuses WHERE name='Сегодня'`);
    expect(allTodayStatuses.length).toBe(2);
  });

  it('2. легаси-бэкап БЕЗ workspace_id у статусов → перепривязка по имени работает как раньше (fallback)', async () => {
    const dbMod = await import('./db');
    const { initDb, run, get, buildBackup, applyBackup } = dbMod;
    await initDb();

    // Легаси-сценарий: один workspace, buildBackup БЕЗ workspaces (как делали
    // старые snapshots/экспорт до F28) — payload.statuses не несёт workspace_id
    // осмысленно (легаси-формат не отправляет колонку в осознанном виде, но
    // т.к. buildBackup здесь просто SELECT *, колонка может физически быть —
    // важно, что БЕЗ payload.workspaces isWorkspaceAware=false и resolveWsId
    // всегда возвращает единый importWsId, так что ws-aware ключ вырождается
    // в тот же fallback-путь).
    run(`DELETE FROM statuses`);
    run(`INSERT INTO statuses (name, color, behavior, sort_order) VALUES ('Сегодня', '#111', 'top', 0)`);
    run(`INSERT INTO statuses (name, color, behavior, sort_order) VALUES ('Взять в работу', '#111', 'middle', 1)`);
    const statusToday = get<any>(`SELECT id FROM statuses WHERE name='Сегодня'`);

    run(
      `INSERT INTO tasks (title, comment, status_id, created_at, updated_at) VALUES ('Legacy status task', '', ?, '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z')`,
      [statusToday.id],
    );

    // Легаси buildBackup — без workspaces (statuses/tags/tasks только).
    const backup = buildBackup({ tasks: true, tags: true, statuses: true });
    expect(backup.workspaces).toBeUndefined();

    run('DELETE FROM tasks');
    run('DELETE FROM statuses');

    const counts = await applyBackup(backup, 'replace');
    // Счёт задач в backup может включать сеедовую welcome-задачу из initDb()
    // (по образцу db.applyBackup.test.ts выше) — важно наличие НАШЕЙ строки,
    // а не точное число.
    expect(counts.tasks).toBeGreaterThanOrEqual(1);

    const restored = get<any>(`SELECT * FROM tasks WHERE title='Legacy status task'`);
    expect(restored).toBeTruthy();
    const restoredStatus = get<any>(`SELECT * FROM statuses WHERE id=?`, [restored.status_id]);
    expect(restoredStatus).toBeTruthy();
    expect(restoredStatus.name).toBe('Сегодня'); // Фолбэк по имени сработал как раньше.
  });
});
