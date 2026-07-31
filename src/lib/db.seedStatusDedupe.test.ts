// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * db.seedStatusDedupe.test.ts — F19 (ADR 0013), Задача 1: дубли сид-статусов
 * («две „Важно“, две „В работе“…») в личном пространстве после рестарта.
 *
 * ПЕРВОПРИЧИНА (проверена, не принята на веру):
 *   • идентичность сид-справочника НЕ детерминирована — tauriSeed(), seed(),
 *     ensureSeededIfEmpty() и store.seedDefaultStatuses() генерируют СВЕЖИЙ
 *     uuidv7() на каждый прогон;
 *   • единственный ключ дедупа на стороне pull (applyCloudRowStatuses) — uuid;
 *   • все локальные guard'ы — `COUNT(*)==0` по ЛОКАЛЬНОЙ базе, они не видят,
 *     что семантически тот же набор уже лежит в облаке.
 * ⇒ любое ВТОРОЕ поколение сида (переустановка, второе устройство,
 *   clearUserData + бутстрап free-плана, resetDatabase) уезжает в облако рядом
 *   с первым, ближайший pull приносит чужое поколение обратно → 14 статусов.
 *
 * Симптом «после рестарта» и «не всегда» объясняется тем, что второе поколение
 * приезжает АСИНХРОННЫМ pull'ом (за entitlement-гейтом и сетью), а не в initDb.
 *
 * Отдельно проверяется, что простой последовательный рестарт (без облака) НЕ
 * плодит дубли — гипотеза «сид перезапускается из-за негидрированного зеркала»
 * не подтвердилась и в фикс не заложена.
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

async function makePersistentNativeAdapter() {
  const SQL = await initSqlJs({ locateFile: () => WASM_FILE_URL });
  const nd = new SQL.Database();
  return {
    execute: async (sql: string, params: any[] = []) => {
      nd.run(sql, params);
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

async function loadDb() {
  (window as any).__TAURI_INTERNALS__ = {};
  vi.resetModules();
  return await import('./db');
}

/**
 * Эмулирует pull «второго поколения» сида из облака: чужие uuid, те же имена,
 * то же пространство. Пишем прямо в нативную БД — так же, как это сделал бы
 * applyCloudRowStatuses через fire-and-forget db.run().
 */
async function pullForeignSeedGeneration(wsId: string, uuidPrefix: string) {
  const names = ['Важно', 'Сегодня', 'В процессе', 'Взять в работу', 'Приостановлено', 'Выполнено', 'Удалено'];
  for (let i = 0; i < names.length; i++) {
    await H.adapter.execute(
      `INSERT INTO statuses
         (uuid, name, color, behavior, sort_order, is_seed, is_technical,
          hidden, default_collapsed, updated_at, version, client_id, workspace_id)
       VALUES (?,?,?,?,?,1,0,0,0,?,1,?,?)`,
      [`${uuidPrefix}-${i}`, names[i], '#111111', 'middle', i,
       '2026-07-20T10:00:00.000Z', 'other-device', wsId],
    );
  }
}

describe('F19: дубли сид-статусов в личном пространстве', () => {
  it('простой последовательный рестарт НЕ плодит дубли (контроль гипотезы)', async () => {
    H.adapter = await makePersistentNativeAdapter();
    await bootDb();
    await bootDb();
    const db3 = await bootDb();
    try {
      const n = db3.get<{ c: number }>('SELECT COUNT(*) AS c FROM statuses WHERE deleted_at IS NULL')!;
      expect(n.c).toBe(7);
    } finally {
      (window as any).__TAURI_INTERNALS__ = undefined;
    }
  });

  it('второе поколение сида из облака схлопывается на рестарте (7, а не 14)', async () => {
    H.adapter = await makePersistentNativeAdapter();
    const db1 = await bootDb();
    const wsRow = db1.get<{ workspace_id: string }>(
      `SELECT workspace_id FROM statuses WHERE name='Важно'`,
    )!;
    const wsId = wsRow.workspace_id;

    // «Своё» поколение получило uuidv7 (начинается с 0…) — чужое делаем
    // лексикографически МЕНЬШЕ, чтобы проверить именно детерминированный выбор
    // победителя, а не «оставим то, что было локально».
    await pullForeignSeedGeneration(wsId, '0000-cloud');

    // Пока дедупа нет — в нативной БД действительно 14 живых строк.
    const rawNative = await H.adapter.select(
      'SELECT COUNT(*) AS c FROM statuses WHERE deleted_at IS NULL',
    );
    expect(rawNative[0].c).toBe(14);

    (window as any).__TAURI_INTERNALS__ = undefined;

    const db2 = await bootDb();
    try {
      const live = db2.all<{ name: string; uuid: string }>(
        'SELECT name, uuid FROM statuses WHERE deleted_at IS NULL ORDER BY sort_order',
      );
      expect(live.length).toBe(7);
      expect(new Set(live.map(r => r.name)).size).toBe(7);
      // Победитель детерминирован: наименьший uuid в группе (uuidv7 монотонен,
      // поэтому это «более раннее поколение» — одинаково на всех устройствах).
      expect(live.every(r => r.uuid.startsWith('0000-cloud'))).toBe(true);

      // Погашение — ЛОКАЛЬНОЕ: в облако удаление не уходит.
      const outbox = db2.all<{ c: number }>(
        `SELECT COUNT(*) AS c FROM sync_outbox WHERE entity_table='statuses' AND op='delete'`,
      );
      expect(outbox[0].c).toBe(0);

      // Дедуп доехал и до нативной БД, а не только до зеркала.
      const nativeLive = await H.adapter.select(
        'SELECT COUNT(*) AS c FROM statuses WHERE deleted_at IS NULL',
      );
      expect(nativeLive[0].c).toBe(7);

      // Идемпотентность: повторный прогон ничего не трогает.
      const again = await db2.dedupeSeedStatuses();
      expect(again).toBe(0);
    } finally {
      (window as any).__TAURI_INTERNALS__ = undefined;
    }
  });

  it('задачи проигравшего поколения переезжают на выжившего близнеца', async () => {
    H.adapter = await makePersistentNativeAdapter();
    const db1 = await bootDb();
    const wsId = db1.get<{ workspace_id: string }>(
      `SELECT workspace_id FROM statuses WHERE name='Важно'`,
    )!.workspace_id;
    const mine = db1.get<{ id: number; uuid: string }>(
      `SELECT id, uuid FROM statuses WHERE name='Важно'`,
    )!;

    // Локальная задача висит на «своём» (проигрывающем) статусе.
    await H.adapter.execute(
      `INSERT INTO tasks (uuid, title, comment, status_id, sort_order, archived,
                          created_at, updated_at, version, workspace_id)
       VALUES (?,?,?,?,?,0,?,?,1,?)`,
      ['task-1', 'Задача', '', mine.id, 0,
       '2026-07-20T10:00:00.000Z', '2026-07-20T10:00:00.000Z', wsId],
    );
    await pullForeignSeedGeneration(wsId, '0000-cloud');

    (window as any).__TAURI_INTERNALS__ = undefined;

    const db2 = await bootDb();
    try {
      const keeper = db2.get<{ id: number; uuid: string }>(
        `SELECT id, uuid FROM statuses WHERE name='Важно' AND deleted_at IS NULL`,
      )!;
      expect(keeper.uuid).toBe('0000-cloud-0');
      const task = db2.get<{ status_id: number }>(`SELECT status_id FROM tasks WHERE uuid='task-1'`)!;
      expect(task.status_id).toBe(keeper.id);
      // Ни одна задача не осталась на погашенном статусе.
      const orphans = db2.get<{ c: number }>(
        `SELECT COUNT(*) AS c FROM tasks t
          JOIN statuses s ON s.id=t.status_id
         WHERE s.deleted_at IS NOT NULL`,
      )!;
      expect(orphans.c).toBe(0);
    } finally {
      (window as any).__TAURI_INTERNALS__ = undefined;
    }
  });

  it('конкурентный двойной initDb на чистой базе не сеет справочник дважды', async () => {
    H.adapter = await makePersistentNativeAdapter();
    const db = await loadDb();
    try {
      await Promise.all([db.initDb(), db.initDb()]);
      const native = await H.adapter.select(
        'SELECT COUNT(*) AS c FROM statuses WHERE deleted_at IS NULL',
      );
      expect(native[0].c).toBe(7);
    } finally {
      (window as any).__TAURI_INTERNALS__ = undefined;
    }
  });
});
