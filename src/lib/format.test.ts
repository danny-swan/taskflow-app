/**
 * Unit-тесты для src/lib/format.ts — форматирование дат.
 *
 * Проверяем ключевые контракты:
 * - парсинг YYYY-MM-DD без сдвига по timezone
 * - обработка пустых/битых входов
 * - локализация RU/EN
 */
import { describe, it, expect } from 'vitest';
import { formatDate, formatDateShort, formatMonthDay } from './format';

describe('formatDate', () => {
  it('форматирует ISO-строку YYYY-MM-DD как dd.MM.yyyy', () => {
    expect(formatDate('2026-05-09')).toBe('09.05.2026');
  });

  it('форматирует Date-объект', () => {
    // Используем локальный конструктор — исключаем TZ-сдвиги.
    expect(formatDate(new Date(2026, 0, 1))).toBe('01.01.2026');
  });

  it('пустое значение → пустая строка', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(undefined)).toBe('');
    expect(formatDate('')).toBe('');
  });

  it('битый ISO → пустая строка', () => {
    expect(formatDate('not-a-date')).toBe('');
  });

  it('игнорирует часть времени в ISO-строке', () => {
    expect(formatDate('2026-05-09T23:59:59.000Z')).toBe('09.05.2026');
  });

  it('пограничные значения (первый и последний день года)', () => {
    expect(formatDate('2026-01-01')).toBe('01.01.2026');
    expect(formatDate('2026-12-31')).toBe('31.12.2026');
  });
});

describe('formatDateShort', () => {
  it('русский месяц по умолчанию', () => {
    expect(formatDateShort('2026-05-09')).toBe('09 май');
  });

  it('английский месяц по флагу', () => {
    expect(formatDateShort('2026-05-09', 'en')).toBe('09 May');
  });

  it('все 12 месяцев на русском', () => {
    const expected = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    for (let m = 1; m <= 12; m++) {
      const iso = `2026-${String(m).padStart(2, '0')}-15`;
      expect(formatDateShort(iso)).toBe(`15 ${expected[m - 1]}`);
    }
  });

  it('пустое значение → пустая строка', () => {
    expect(formatDateShort(null)).toBe('');
    expect(formatDateShort('')).toBe('');
  });
});

describe('formatMonthDay', () => {
  it('парсит MM-DD и форматирует по языку', () => {
    expect(formatMonthDay('05-09', 'ru')).toBe('09 май');
    expect(formatMonthDay('05-09', 'en')).toBe('09 May');
  });

  it('короткий или пустой вход возвращается как есть', () => {
    expect(formatMonthDay('')).toBe('');
    expect(formatMonthDay('05')).toBe('05');
  });
});
