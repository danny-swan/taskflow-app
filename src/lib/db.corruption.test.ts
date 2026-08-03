/**
 * db.corruption.test.ts — Unit-тест detectAndRecoverCorruption() (F16, ADR 0010,
 * roadmap §7.16).
 *
 * Проверяем веб-ветку (sql.js + localStorage), т.к. jsdom-окружение unit-тестов
 * не эмулирует Tauri (IS_TAURI вычисляется из window.__TAURI_INTERNALS__, которого
 * здесь нет — см. src/lib/db.ts:10). Tauri-ветка (getTauriDb + PRAGMA integrity_check
 * через @tauri-apps/plugin-sql) проверяется вручную/в e2e, т.к. requires нативный
 * SQLite-плагин, недоступный в vitest+jsdom.
 *
 * Сценарии:
 *   (a) чистый localStorage (ничего не сохранено) → {recovered:false}, storage
 *       не тронут;
 *   (b) "мусорные" байты вместо валидной SQLite-базы → {recovered:true}, storage
 *       очищен (STORAGE_KEY и STORAGE_KEY_TS удалены);
 *   (c) валидная пустая база (создана через initDb, т.е. настоящий sql.js экспорт)
 *       → {recovered:false}, integrity_check проходит.
 *
 * Гоняем реальный db.ts в web-режиме (sql.js), мокая только Vite-специфичный
 * `?url`-импорт wasm на реальный путь файла из node_modules (тот же паттерн,
 * что в db.ensureSeededIfEmpty.test.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const req = createRequire(import.meta.url);
const WASM_FILE_URL = pathToFileURL(req.resolve('sql.js/dist/sql-wasm.wasm')).href;
vi.mock('sql.js/dist/sql-wasm.wasm?url', () => ({ default: WASM_FILE_URL }));

// db.ts хранит сериализованную SQLite-базу в localStorage как JSON.stringify(number[])
// (Array.from(Uint8Array) под ключом STORAGE_KEY). Константа не экспортируется из
// db.ts, поэтому дублируем буквальное значение — как и сам task spec (см. финальное
// сообщение, раздел "расхождения").
const STORAGE_KEY = 'taskflow.sqlite.v1';
const STORAGE_KEY_TS = 'taskflow.sqlite.v1.ts';

const lsStore = new Map<string, string>();
beforeEach(() => {
  lsStore.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (lsStore.has(k) ? lsStore.get(k)! : null),
    setItem: (k: string, v: string) => { lsStore.set(k, v); },
    removeItem: (k: string) => { lsStore.delete(k); },
    clear: () => lsStore.clear(),
  });
  // Каждый тест — со своим модульным состоянием db.ts (SQL/webDb — module-level
  // синглтоны), иначе initDb() во втором тесте увидит уже инициализированный
  // webDb и не пере-проверит localStorage. resetModules гарантирует чистый импорт.
  vi.resetModules();
});

describe('detectAndRecoverCorruption() — F16 авто-восстановление битой локальной SQLite', () => {
  it('(a) чистый localStorage → {recovered:false}, storage не тронут', async () => {
    const db = await import('./db');
    const result = await db.detectAndRecoverCorruption();

    expect(result.recovered).toBe(false);
    expect(result.reason).toBeUndefined();
    // Storage был пуст и должен остаться пустым (removeItem не должен был вызваться
    // ни для STORAGE_KEY, ни для STORAGE_KEY_TS — но т.к. их и не было, проверяем
    // просто отсутствие записей).
    expect(lsStore.has(STORAGE_KEY)).toBe(false);
    expect(lsStore.has(STORAGE_KEY_TS)).toBe(false);
  });

  it('(b) мусорные байты вместо валидной SQLite-базы → {recovered:true}, storage очищен', async () => {
    // Явно битый payload: JSON-массив, который НЕ является валидным SQLite-файлом
    // (нет магической строки заголовка "SQLite format 3"). new SQL.Database(bytes)
    // либо бросит при конструировании, либо PRAGMA integrity_check вернёт не 'ok'.
    lsStore.set(STORAGE_KEY, JSON.stringify([1, 2, 3, 4, 5]));
    lsStore.set(STORAGE_KEY_TS, String(Date.now()));

    const db = await import('./db');
    const result = await db.detectAndRecoverCorruption();

    expect(result.recovered).toBe(true);
    expect(result.reason).toBeTruthy();
    // Восстановление обязано очистить и основной блоб, и метку времени —
    // иначе следующий старт снова прочитает тот же битый payload.
    expect(lsStore.has(STORAGE_KEY)).toBe(false);
    expect(lsStore.has(STORAGE_KEY_TS)).toBe(false);
  });

  it('(c) валидная пустая база (настоящий sql.js экспорт) → {recovered:false}', async () => {
    // Создаём НАСТОЯЩУЮ валидную SQLite-базу через сам db.ts (initDb сериализует
    // sql.js Database.export() в localStorage под STORAGE_KEY), а не через
    // рукописный fixture — так тест не завязан на внутренний формат сериализации.
    const db = await import('./db');
    await db.initDb();
    expect(lsStore.has(STORAGE_KEY)).toBe(true);

    // Второй "холодный старт" на том же (валидном) localStorage — тот же модуль,
    // повторный вызов detectAndRecoverCorruption должен пройти integrity_check.
    const result = await db.detectAndRecoverCorruption();

    expect(result.recovered).toBe(false);
    expect(result.reason).toBeUndefined();
    // Валидная база не должна была быть тронута.
    expect(lsStore.has(STORAGE_KEY)).toBe(true);
  });

  it('(d) F16-escalation: побитовое повреждение валидного blob\'а (байт 100-200) -> {recovered:true}', async () => {
    // Эмулируем прод-сценарий "частичная порча": не полный мусор (как в (b)), а
    // валидный sql.js-экспорт с одним испорченным байтом где-то в области
    // страниц/индексов файла (диапазон 100-200 обычно уже внутри первой page,
    // за пределами 100-байтного заголовка SQLite). Такое повреждение может НЕ
    // сломать constructor и НЕ всегда обвалить integrity_check сразу - именно
    // для этого случая добавлен доп. UNIQUE-probe (см. db.ts, F16 escalation).
    // Тест мягкий: детерминированно перебираем несколько позиций/значений байта
    // и требуем recovered:true хотя бы на part из них, иначе тест слишком хрупкий
    // относительно случайности "какой байт мы испортили". Если ни один из
    // вариантов не детектируется - это тоже полезный сигнал (см. коммент внизу).
    const seedDb = await import('./db');
    await seedDb.initDb();
    const validRaw = lsStore.get(STORAGE_KEY);
    expect(validRaw).toBeTruthy();
    const validBytes = JSON.parse(validRaw as string) as number[];

    let detectedAtLeastOnce = false;
    const positions = [100, 130, 160, 190, 199];
    for (const pos of positions) {
      if (pos >= validBytes.length) continue;
      vi.resetModules();
      lsStore.clear();
      const flipped = validBytes.slice();
      // Флип байта: XOR с 0xFF гарантированно меняет значение независимо от
      // исходного байта (в отличие от простого +1, которое может случайно дать
      // тот же результат по модулю 256 - здесь это не проблема, но XOR нагляднее
      // выражает "испортили бит-паттерн").
      flipped[pos] = flipped[pos] ^ 0xff;
      lsStore.set(STORAGE_KEY, JSON.stringify(flipped));
      lsStore.set(STORAGE_KEY_TS, String(Date.now()));

      const db = await import('./db');
      const result = await db.detectAndRecoverCorruption();
      if (result.recovered) {
        detectedAtLeastOnce = true;
        expect(result.reason).toBeTruthy();
        expect(lsStore.has(STORAGE_KEY)).toBe(false);
        expect(lsStore.has(STORAGE_KEY_TS)).toBe(false);
      }
    }

    // Побитовая порча в теле файла (не в 100-байтном заголовке) не гарантированно
    // ловится constructor'ом/integrity_check/UNIQUE-probe на КАЖДОЙ позиции -
    // SQLite устойчив к порче незанятых/невостребованных байт page. Поэтому
    // требуем детект хотя бы на одной из пробных позиций, а не на всех сразу.
    // Если тест начнёт падать (detectedAtLeastOnce === false) на CI - это сигнал,
    // что диапазон/позиции надо расширить или подобрать под текущий размер
    // пустой БД (см. ADR 0010, "Что осталось").
    expect(detectedAtLeastOnce).toBe(true);
  });
});
