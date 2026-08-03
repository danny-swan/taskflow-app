import { describe, it, expect } from 'vitest';
import { parseSettingsSection, SETTINGS_SECTIONS } from './settingsSections';

/**
 * F39 (ADR 0030): секция «Настроек» берётся из хэша МАРШРУТА.
 * Ключевой регресс, который ловят эти кейсы: под HashRouter
 * `window.location.hash` равен `'#/settings#subscription'`, а не
 * `'#subscription'` — прежняя строгая проверка `=== '#subscription'`
 * не срабатывала никогда.
 */
describe('parseSettingsSection', () => {
  it('хэш из react-router: #subscription → subscription', () => {
    expect(parseSettingsSection('#subscription')).toBe('subscription');
  });

  it('хэш из react-router: #updates → updates (кнопка «Открыть» в тосте обновления)', () => {
    expect(parseSettingsSection('#updates')).toBe('updates');
  });

  it('полный window.location.hash под HashRouter тоже разбирается', () => {
    expect(parseSettingsSection('#/settings#subscription')).toBe('subscription');
    expect(parseSettingsSection('#/settings#updates')).toBe('updates');
  });

  it('без хэша / пустой / только маршрут → null (остаётся текущая секция)', () => {
    expect(parseSettingsSection('')).toBeNull();
    expect(parseSettingsSection(null)).toBeNull();
    expect(parseSettingsSection(undefined)).toBeNull();
    expect(parseSettingsSection('#')).toBeNull();
    expect(parseSettingsSection('#/settings')).toBeNull();
  });

  it('неизвестная секция → null, а не падение', () => {
    expect(parseSettingsSection('#nope')).toBeNull();
    expect(parseSettingsSection('#/settings#nope')).toBeNull();
  });

  it('регистр и пробелы не важны', () => {
    expect(parseSettingsSection('#Subscription')).toBe('subscription');
    expect(parseSettingsSection('#  updates  ')).toBe('updates');
  });

  it('каждая секция из списка разбирается сама в себя', () => {
    for (const key of SETTINGS_SECTIONS) {
      expect(parseSettingsSection(`#${key}`)).toBe(key);
    }
  });
});
