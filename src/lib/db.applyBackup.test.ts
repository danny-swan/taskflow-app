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
