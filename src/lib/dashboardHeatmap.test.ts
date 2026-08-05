// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// F50 — тепловая карта «Активность · 12w» на Дашборде.
//
// Баг: сетка стартовала с «83 дня назад» (произвольный день недели), а подписи
// строк в UI жёстко заданы Пн…Вс. Из-за этого строка «Пн» показывала данные
// другого дня недели, и сдвиг менялся каждый день (совпадение — только по
// вторникам). Тест закрепляет инвариант «строка j — это день недели j (Пн=0)»
// сразу для всех 7 возможных дней недели «сегодня».
import { describe, it, expect } from 'vitest';
import { heatmapDayKeys, localDayKey, HEATMAP_WEEKS } from './dashboard';

/** ISO-номер дня недели по локальным полям: Пн=0 … Вс=6. */
function isoDow(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

describe('heatmapDayKeys (F50)', () => {
  it('всегда 12 колонок по 7 дней', () => {
    const weeks = heatmapDayKeys(new Date(2026, 7, 5));
    expect(weeks).toHaveLength(HEATMAP_WEEKS);
    for (const w of weeks) expect(w).toHaveLength(7);
  });

  it('строка j соответствует дню недели labels[j] для ЛЮБОГО дня «сегодня»', () => {
    // 03.08.2026 — понедельник; проходим всю неделю, включая воскресенье.
    for (let offset = 0; offset < 7; offset++) {
      const today = new Date(2026, 7, 3 + offset);
      const weeks = heatmapDayKeys(today);
      for (const week of weeks) {
        for (let j = 0; j < 7; j++) {
          expect(isoDow(week[j])).toBe(j);
        }
      }
    }
  });

  it('последняя колонка — текущая неделя, и «сегодня» в ней есть', () => {
    for (let offset = 0; offset < 7; offset++) {
      const today = new Date(2026, 7, 3 + offset);
      const weeks = heatmapDayKeys(today);
      expect(weeks[weeks.length - 1]).toContain(localDayKey(today));
    }
  });

  it('дни идут подряд без дыр и дублей (12 × 7 = 84 уникальных дня)', () => {
    const weeks = heatmapDayKeys(new Date(2026, 7, 5));
    const flat = weeks.flat();
    expect(new Set(flat).size).toBe(84);
    for (let i = 1; i < flat.length; i++) {
      const [y, m, d] = flat[i - 1].split('-').map(Number);
      const next = new Date(y, m - 1, d + 1);
      expect(flat[i]).toBe(localDayKey(next));
    }
  });

  it('корректно переходит через границу года', () => {
    const weeks = heatmapDayKeys(new Date(2027, 0, 6)); // среда
    const flat = weeks.flat();
    expect(flat[0].startsWith('2026-')).toBe(true);
    expect(flat[flat.length - 1].startsWith('2027-')).toBe(true);
    for (const week of weeks) {
      for (let j = 0; j < 7; j++) expect(isoDow(week[j])).toBe(j);
    }
  });

  it('регрессия: старая формула «-83 дня» давала сдвиг, новая — нет', () => {
    const today = new Date(2026, 7, 5); // среда 05.08.2026 — как в отчёте пользователя
    const legacyStart = new Date(today);
    legacyStart.setDate(legacyStart.getDate() - 12 * 7 + 1);
    expect(isoDow(localDayKey(legacyStart))).not.toBe(0); // старт был четвергом
    expect(isoDow(heatmapDayKeys(today)[0][0])).toBe(0); // теперь — понедельник
  });
});
