/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 * https://polyformproject.org/licenses/noncommercial/1.0.0/
 */

/**
 * F39 (ADR 0030): разбор целевой секции «Настроек» из хэша маршрута.
 *
 * Приложение работает под HashRouter (`src/main.tsx`), поэтому весь маршрут
 * живёт в `window.location.hash`: для `navigate('/settings#subscription')`
 * реальный адрес — `#/settings#subscription`, то есть
 * `window.location.hash === '#/settings#subscription'`, а НЕ `'#subscription'`.
 * Старая проверка в `Settings.tsx` сравнивала `window.location.hash` со строкой
 * `'#subscription'` и потому не срабатывала никогда. Правильный источник —
 * `useLocation().hash` из react-router: он отдаёт хэш ВНУТРИ маршрута
 * (`'#subscription'`), одинаково в HashRouter и BrowserRouter.
 *
 * Здесь только чистая функция разбора — её можно проверить тестами без
 * рендера тяжёлой страницы настроек.
 */

/** Ключи секций «Настроек» (совпадают с типом `Sub` в `src/pages/Settings.tsx`). */
export const SETTINGS_SECTIONS = [
  'general',
  'account',
  'subscription',
  // F49 (ADR 0035): 'tags' / 'statuses' убраны — справочники больше не секции
  // «Настроек», а вкладки экрана «Настройки пространства». Старые глубокие
  // ссылки вида `/settings#statuses` теперь дают null и оставляют текущую
  // секцию (деградация, а не ошибка) — в коде таких переходов нет.
  'stats',
  'theme',
  'templates',
  'io',
  'storage',
  'sync',
  'updates',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * Достаёт секцию из хэша маршрута.
 *
 * Принимает как хэш из react-router (`'#subscription'`, `'subscription'`), так и
 * полный `window.location.hash` формата HashRouter
 * (`'#/settings#updates'`) — на случай вызова до монтирования роутера.
 * Возвращает `null`, если секции нет или она неизвестна (тогда вызывающий
 * оставляет свою текущую/дефолтную секцию).
 */
export function parseSettingsSection(hash: string | null | undefined): SettingsSection | null {
  if (!hash) return null;
  // Берём часть после последнего '#': '#/settings#updates' → 'updates',
  // '#subscription' → 'subscription'.
  const raw = hash.slice(hash.lastIndexOf('#') + 1).trim().toLowerCase();
  if (!raw || raw.startsWith('/')) return null;
  return (SETTINGS_SECTIONS as readonly string[]).includes(raw)
    ? (raw as SettingsSection)
    : null;
}
