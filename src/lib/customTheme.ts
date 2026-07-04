// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.29: применение кастом-темы через инъекцию CSS-переменных на :root.
// Пользователь задаёт 3 цвета (accent, bg, text) — остальные производные (surface,
// border, muted, faint, accent-hover, accent-soft) вычисляются автоматически.
//
// Дизайн-решение: не спрашивать 10 цветов, только 3 базовых — этого достаточно
// для узнаваемой темы. Остальные вычисляются линейной интерполяцией в HSL/RGB.

/** hex #RRGGBB → [r,g,b] в диапазоне 0..255. Возвращает [0,0,0] на невалид. */
function hexToRgb(hex: string): [number, number, number] {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Смешивание двух hex-цветов в пропорции t (0 = a, 1 = b). */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Оценка luminance (яркости) для определения светлая/тёмная тема. 0..1. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(x => x / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface CustomThemeInput {
  accent: string; // #RRGGBB
  bg: string;
  text: string;
}

/** Полный набор CSS-переменных, вычисленных из 3 базовых цветов. */
export interface CustomThemeVars {
  '--bg': string;
  '--surface': string;
  '--surface-alt': string;
  '--border': string;
  '--border-soft': string;
  '--text': string;
  '--muted': string;
  '--faint': string;
  '--accent': string;
  '--accent-hover': string;
  '--accent-soft': string;
  '--color-accent': string;
  'color-scheme': 'light' | 'dark';
}

/**
 * Вычислить все производные переменные из 3 базовых.
 * Логика:
 * - Определяем light/dark по luminance(bg).
 * - surface = bg смешать с text на 4%  → чуть контрастнее фона
 * - surface-alt = bg смешать с text на 8%
 * - border = bg смешать с text на 20%
 * - border-soft = bg смешать с text на 12%
 * - muted = text смешать с bg на 40%
 * - faint = text смешать с bg на 65%
 * - accent-hover = accent смешать с (light? #000 : #fff) на 12%
 * - accent-soft = accent смешать с bg на 82%
 */
export function deriveCustomTheme(input: CustomThemeInput): CustomThemeVars {
  const { accent, bg, text } = input;
  const isDark = luminance(bg) < 0.5;
  return {
    '--bg': bg,
    '--surface': mix(bg, text, 0.04),
    '--surface-alt': mix(bg, text, 0.08),
    '--border': mix(bg, text, 0.20),
    '--border-soft': mix(bg, text, 0.12),
    '--text': text,
    '--muted': mix(text, bg, 0.40),
    '--faint': mix(text, bg, 0.65),
    '--accent': accent,
    '--accent-hover': mix(accent, isDark ? '#ffffff' : '#000000', 0.12),
    '--accent-soft': mix(accent, bg, 0.82),
    '--color-accent': accent, // Tailwind alias, если используется
    'color-scheme': isDark ? 'dark' : 'light',
  };
}

/**
 * Применить кастом-переменные к :root. Если theme != 'custom', снять все ранее
 * заинжекченные inline-стили, чтобы вернуться к CSS-темам из globals.css.
 */
export function applyCustomTheme(vars: CustomThemeVars | null) {
  const root = document.documentElement;
  const keys: (keyof CustomThemeVars)[] = [
    '--bg', '--surface', '--surface-alt', '--border', '--border-soft',
    '--text', '--muted', '--faint', '--accent', '--accent-hover', '--accent-soft',
    '--color-accent',
  ];
  if (vars) {
    for (const k of keys) {
      root.style.setProperty(k, vars[k] as string);
    }
    root.style.setProperty('color-scheme', vars['color-scheme']);
  } else {
    for (const k of keys) root.style.removeProperty(k);
    root.style.removeProperty('color-scheme');
  }
}

/** Валидация hex-цвета. */
export function isValidHex(s: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(s.trim());
}

/** Дефолты для кастом-темы при первом включении — тёплые бежевые тона. */
export const CUSTOM_THEME_DEFAULTS: CustomThemeInput = {
  accent: '#5B7FB8',
  bg: '#F7F6F2',
  text: '#28251D',
};
