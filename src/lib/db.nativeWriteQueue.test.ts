// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * db.nativeWriteQueue.test.ts — F37 (ADR 0029): записи в нативную SQLite идут
 * ОДНОЙ последовательной очередью, и её можно дождаться (`flushNativeWrites`).
 *
 * Корень бага: в Tauri `run()` применял SQL к sql.js-зеркалу синхронно, а в
 * нативную базу отправлял независимым промисом на каждую команду
 * (`getTauriDb().then(d => d.execute(...))`). Порядок применения при этом не
 * гарантирован: медленная первая команда могла лечь ПОСЛЕ быстрой второй.
 * Для пачки clearUserData → applyBackup это значит, что DELETE мог примениться
 * после INSERT — в зеркале данные есть, в файле нет, и после перезапуска
 * приложения задача «пропадала». Точки ожидания не было вовсе, поэтому выход из
 * аккаунта, снимок и подмена файла БД не могли дождаться незавершённых записей.
 *
 * Тест гоняет РЕАЛЬНЫЙ Tauri-путь db.ts с sql.js-адаптером вместо нативного
 * @tauri-apps/plugin-sql; адаптер умеет искусственно задерживать выбранные
 * команды, чтобы проверить именно порядок.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import initSqlJs from 'sql.js';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const req = createRequire(import.meta.url);
const WASM_FILE_URL = pathToFileURL(req.resolve('sql.js/dist/sql-wasm.wasm')).href;
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: WASM_FILE_URL }));

const H = vi.hoisted(() => ({ adapter: null as any }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => H.adapter } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => 'data.db' }));

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

/**
 * sql.js-адаптер с интерфейсом tauri-plugin-sql. `slowMarker` — подстрока SQL,
 * применение которой искусственно задерживается: так воспроизводится
 * переупорядочение, из-за которого баг и возникал.
 */
async function makeNativeAdapter(opts: { slowMarker?: string; delayMs?: number } = {}) {
  const SQL = await initSqlJs({ locateFile: () => WASM_FILE_URL });
  const nd = new SQL.Database();
  const applied: string[] = [];
  return {
    applied,
    execute: async (sql: string, params: any[] = []) => {
      if (opts.slowMarker && sql.includes(opts.slowMarker)) {
        await new Promise((r) => setTimeout(r, opts.delayMs ?? 30));
      }
      nd.run(sql, params);
      applied.push(sql);
      return { rowsAffected: nd.getRowsModified(), lastInsertId: 0 };
    },
    select: async (sql: string, params: any[] = []) => {
      const s = nd.prepare(sql);
      s.bind(params);
      const rows: any[] = [];
      while (s.step()) rows.push(s.getAsObject());
      s.free();
      return rows;
    },
  };
}

async function bootDb() {
  (window as any).__TAURI_INTERNALS__ = {};
  vi.resetModules();
  const db = await import('./db');
  await db.initDb();
  return db;
}

describe('F37: последовательная очередь нативных записей (Tauri)', () => {
  it('порядок сохраняется: медленный INSERT применяется ДО быстрого DELETE', async () => {
    // INSERT в tags искусственно медленный. Без очереди DELETE обогнал бы его,
    // и в нативной базе осталась бы строка, которой в зеркале уже нет.
    H.adapter = await makeNativeAdapter({ slowMarker: 'INSERT INTO tags', delayMs: 40 });
    const db = await bootDb();
    try {
      // initDb сам пишет в нативную БД (схема/миграции) — считаем только то,
      // что добавилось после старта.
      await db.flushNativeWrites();
      const base = H.adapter.applied.length;
      db.run(
        `INSERT INTO tags (name, color, sort_order) VALUES (?,?,?)`,
        ['f37-queue', '#fff', 999],
      );
      db.run(`DELETE FROM tags WHERE name = ?`, ['f37-queue']);

      await db.flushNativeWrites();
      // Обе команды обязаны быть УЖЕ применены: flush — это точка ожидания, а не
      // «подождать немножко». Без очереди flush возвращался мгновенно и здесь
      // была бы одна команда (или ни одной).
      expect(H.adapter.applied.length - base).toBe(2);

      // Порядок применения = порядок вызовов. Без очереди быстрый DELETE
      // обгонял медленный INSERT, и строка оставалась в файле навсегда.
      const tail = H.adapter.applied.slice(base);
      expect(tail[0]).toContain('INSERT INTO tags');
      expect(tail[1]).toContain('DELETE FROM tags');

      const rows = await H.adapter.select('SELECT name FROM tags WHERE name = ?', ['f37-queue']);
      expect(rows.length).toBe(0);
    } finally {
      (window as any).__TAURI_INTERNALS__ = undefined;
    }
  });

  it('flushNativeWrites дожидается записи: до него строки в нативной БД ещё нет', async () => {
    H.adapter = await makeNativeAdapter({ slowMarker: 'INSERT INTO tags', delayMs: 30 });
    const db = await bootDb();
    try {
      db.run(
        `INSERT INTO tags (name, color, sort_order) VALUES (?,?,?)`,
        ['f37-flush', '#fff', 998],
      );

      // Зеркало видит строку сразу — синхронный контракт run() не изменился.
      expect(db.get('SELECT name FROM tags WHERE name = ?', ['f37-flush'])).not.toBeNull();
      // Нативная база — ещё нет (запись в очереди).
      const before = await H.adapter.select('SELECT name FROM tags WHERE name = ?', ['f37-flush']);
      expect(before.length).toBe(0);

      await db.flushNativeWrites();

      const after = await H.adapter.select('SELECT name FROM tags WHERE name = ?', ['f37-flush']);
      expect(after.length).toBe(1);
    } finally {
      (window as any).__TAURI_INTERNALS__ = undefined;
    }
  });

  it('ошибка одной записи не рвёт очередь: следующая команда всё равно доезжает', async () => {
    H.adapter = await makeNativeAdapter();
    const db = await bootDb();
    const origExecute = H.adapter.execute;
    try {
      let failedOnce = false;
      H.adapter.execute = async (sql: string, params: any[] = []) => {
        if (!failedOnce && sql.includes('f37-boom')) {
          failedOnce = true;
          throw new Error('native write boom');
        }
        return origExecute(sql, params);
      };
      db.run(`UPDATE tags SET name = ? WHERE name = ?`, ['f37-boom', 'f37-boom']);
      db.run(
        `INSERT INTO tags (name, color, sort_order) VALUES (?,?,?)`,
        ['f37-after-error', '#fff', 997],
      );

      await db.flushNativeWrites();

      const rows = await H.adapter.select('SELECT name FROM tags WHERE name = ?', ['f37-after-error']);
      expect(rows.length).toBe(1);
    } finally {
      H.adapter.execute = origExecute;
      (window as any).__TAURI_INTERNALS__ = undefined;
    }
  });

  it('web-режим: flushNativeWrites — no-op и не бросает', async () => {
    (window as any).__TAURI_INTERNALS__ = undefined;
    vi.resetModules();
    const db = await import('./db');
    await db.initDb();
    await expect(db.flushNativeWrites()).resolves.toBeUndefined();
  });
});
