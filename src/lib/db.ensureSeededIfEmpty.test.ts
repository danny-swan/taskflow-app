/**
 * db.ensureSeededIfEmpty.test.ts — Unit-тест ensureSeededIfEmpty() (v0.9.35-dev.6.10.3).
 *
 * ensureSeededIfEmpty() закрывает Проблему №3 синхронизации: после «Загрузить
 * облачные» (clearUserData) база пуста, а если в облаке нет статусов
 * (исторические сид-статусы без uuid туда никогда не попадали), то pull приносит
 * только задачи — и они без статусов откладываются (deferred). Пользователь
 * видел пустой экран (или «одну стартовую задачу» после рестарта).
 *
 * Контракт функции:
 *   • сеет базовые статусы (7 шт) и теги (5 шт) с uuid — ТОЛЬКО если статусов нет;
 *   • НЕ создаёт welcome-задачу (иначе плодилась бы «одна стартовая задача»);
 *   • добавляет засеянные строки в sync_outbox (чтобы ушли в облако при push);
 *   • идемпотентна: если статусы уже есть — ничего не делает (возвращает false).
 *
 * Гоняем реальный db.ts в web-режиме (sql.js), мокая только Vite-специфичный
 * `?url`-импорт wasm на реальный путь файла из node_modules.
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

function tableCount(all: (sql: string) => any[], table: string): number {
  return all(`SELECT COUNT(*) AS c FROM ${table}`)[0].c as number;
}

describe('ensureSeededIfEmpty() — сев базовых статусов после пустого облака', () => {
  it('после clearUserData сеет статусы+теги (с uuid), но БЕЗ welcome-задачи', async () => {
    const db = await import('./db');
    const { initDb, all, clearUserData, ensureSeededIfEmpty } = db;
    await initDb();

    // Эмулируем «Загрузить облачные»: база очищена, облако без статусов
    // (задач тоже нет — мы проверяем именно сев статусов, не применение задач).
    await clearUserData();
    expect(tableCount(all, 'statuses')).toBe(0);

    const seeded = await ensureSeededIfEmpty();
    expect(seeded).toBe(true);

    // 7 статусов (6 видимых + технический «Удалено») и 5 тегов.
    expect(tableCount(all, 'statuses')).toBe(7);
    expect(tableCount(all, 'tags')).toBe(5);

    // Все статусы получили uuid (иначе не запушатся в облако).
    const noUuid = all(`SELECT COUNT(*) AS c FROM statuses WHERE uuid IS NULL OR uuid = ''`)[0].c as number;
    expect(noUuid).toBe(0);

    // Ключевая гарантия Проблемы №3: welcome-задача НЕ создаётся.
    expect(tableCount(all, 'tasks')).toBe(0);

    // Технический статус «Удалено» присутствует (нужен для удаления задач).
    const deleted = all(`SELECT is_technical, hidden FROM statuses WHERE name = 'Удалено'`)[0];
    expect(deleted.is_technical).toBe(1);
    expect(deleted.hidden).toBe(1);
  });

  it('добавляет засеянные статусы/теги в sync_outbox (уйдут в облако при push)', async () => {
    const db = await import('./db');
    const { initDb, all, clearUserData, ensureSeededIfEmpty } = db;
    await initDb();

    await clearUserData();
    expect(tableCount(all, 'sync_outbox')).toBe(0);

    await ensureSeededIfEmpty();

    // 7 статусов + 5 тегов = 12 записей в очереди пуша. Задач в outbox нет.
    const statusOutbox = all(`SELECT COUNT(*) AS c FROM sync_outbox WHERE entity_table = 'statuses'`)[0].c as number;
    const tagOutbox = all(`SELECT COUNT(*) AS c FROM sync_outbox WHERE entity_table = 'tags'`)[0].c as number;
    const taskOutbox = all(`SELECT COUNT(*) AS c FROM sync_outbox WHERE entity_table = 'tasks'`)[0].c as number;
    expect(statusOutbox).toBe(7);
    expect(tagOutbox).toBe(5);
    expect(taskOutbox).toBe(0);
  });

  it('идемпотентна: если статусы уже есть — ничего не делает (возвращает false)', async () => {
    const db = await import('./db');
    const { initDb, run, all, ensureSeededIfEmpty } = db;
    await initDb();

    // initDb засеял статусы (initDb → seed на пустой базе). Зафиксируем число.
    const before = tableCount(all, 'statuses');
    expect(before).toBeGreaterThan(0);

    // Ставим маркер, чтобы отличить существующий статус от «пересеянного».
    run(`UPDATE statuses SET color = '#SENTINEL' WHERE name = 'Важно'`);

    const seeded = await ensureSeededIfEmpty();
    expect(seeded).toBe(false);

    // Число статусов не изменилось, а маркер на месте (не перезатёрт севом).
    expect(tableCount(all, 'statuses')).toBe(before);
    const marked = all(`SELECT color FROM statuses WHERE name = 'Важно'`)[0].color as string;
    expect(marked).toBe('#SENTINEL');
  });
});
