/**
 * Unit-тесты для src/lib/utils.ts — вспомогательные утилиты дат/цветов.
 */
import { describe, it, expect } from 'vitest';
import {
  cls,
  formatDate,
  daysBetween,
  readableTextColor,
  calendarDaysDiff,
  businessDaysDiff,
  daysUntilDeadline,
} from './utils';

describe('cls', () => {
  it('фильтрует falsy значения', () => {
    expect(cls('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('пустой список → пустая строка', () => {
    expect(cls()).toBe('');
  });
});

describe('formatDate (utils)', () => {
  it('форматирует дату в ru-RU локали как dd.MM.yy', () => {
    // "2026-05-09" в UTC → в Europe/Moscow всё равно 9 мая.
    const r = formatDate('2026-05-09T12:00:00.000Z');
    expect(r).toMatch(/^09\.05\.26$/);
  });

  it('пусто → «—»', () => {
    expect(formatDate()).toBe('—');
    expect(formatDate(null)).toBe('—');
  });

  it('битая дата возвращается как есть', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('daysBetween', () => {
  it('только начало (без end) — от начала до сегодня, >= 1', () => {
    const iso = new Date().toISOString().slice(0, 10);
    expect(daysBetween(iso)).toBe(1);
  });

  it('одинаковый день → 1 (включительно с обеих сторон)', () => {
    expect(daysBetween('2026-07-01', '2026-07-01')).toBe(1);
  });

  it('несколько дней', () => {
    expect(daysBetween('2026-07-01', '2026-07-03')).toBe(3);
  });

  it('битая дата → null', () => {
    expect(daysBetween('not-a-date', '2026-07-01')).toBeNull();
  });
});

describe('readableTextColor', () => {
  it('чёрный текст на светлом фоне', () => {
    expect(readableTextColor('#FFFFFF')).toBe('#28251D');
    expect(readableTextColor('#F0E68C')).toBe('#28251D'); // khaki
  });

  it('белый текст на тёмном фоне', () => {
    expect(readableTextColor('#000000')).toBe('#FFFFFF');
    expect(readableTextColor('#1A1A1A')).toBe('#FFFFFF');
  });

  it('битый hex → чёрный по умолчанию', () => {
    expect(readableTextColor('nope')).toBe('#000');
  });
});

describe('calendarDaysDiff', () => {
  it('положительная разница', () => {
    expect(calendarDaysDiff('2026-07-01', '2026-07-03')).toBe(2);
  });

  it('одинаковый день → 0', () => {
    expect(calendarDaysDiff('2026-07-01', '2026-07-01')).toBe(0);
  });

  it('отрицательная разница', () => {
    expect(calendarDaysDiff('2026-07-03', '2026-07-01')).toBe(-2);
  });
});

describe('businessDaysDiff', () => {
  // Календарь июля 2026 для справки:
  // Пн 6, Вт 7, Ср 8, Чт 9, Пт 10, Сб 11, Вс 12, Пн 13.
  it('одинаковый день → 0', () => {
    expect(businessDaysDiff('2026-07-06', '2026-07-06')).toBe(0);
  });

  it('пятница → понедельник = 1 будний (Пт входит, Сб/Вс пропущены)', () => {
    expect(businessDaysDiff('2026-07-03', '2026-07-06')).toBe(1);
  });

  it('Пн → Пн (7 дней) = 5 будних', () => {
    expect(businessDaysDiff('2026-07-06', '2026-07-13')).toBe(5);
  });

  it('обратный порядок → отрицательное значение', () => {
    expect(businessDaysDiff('2026-07-13', '2026-07-06')).toBe(-5);
  });
});

describe('daysUntilDeadline', () => {
  it('calendar-режим повторяет calendarDaysDiff', () => {
    expect(daysUntilDeadline('2026-07-10', '2026-07-06', 'calendar')).toBe(4);
  });

  it('business-режим повторяет businessDaysDiff', () => {
    expect(daysUntilDeadline('2026-07-13', '2026-07-06', 'business')).toBe(5);
  });

  it('просрочка → отрицательное', () => {
    expect(daysUntilDeadline('2026-07-01', '2026-07-06', 'calendar')).toBe(-5);
  });
});
