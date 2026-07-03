/**
 * Vitest setup — v0.9.20.
 *
 * Загружается перед каждым тестовым файлом. Настраивает jest-dom матчеры,
 * замалчивает шумные console-выхлопы и мокает Tauri IPC / localStorage
 * там, где это глобально удобно.
 */
import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Автоматически размонтируем React-компоненты между тестами.
afterEach(() => {
  cleanup();
});

// Tauri IPC — при импорте многих модулей вызывает @tauri-apps/api,
// которое в jsdom без mock кидает. Мокаем базовое ядро.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => undefined),
  emit: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(async () => null),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  message: vi.fn(async () => undefined),
  confirm: vi.fn(async () => true),
  ask: vi.fn(async () => true),
  open: vi.fn(async () => null),
  save: vi.fn(async () => null),
}));

// Замалчиваем console.warn из тестируемого кода — он валит stderr
// в error-path тестах. Тесты, которым нужно проверить warn, могут
// переопределить его локально через vi.spyOn(console,'warn').
vi.spyOn(console, 'warn').mockImplementation(() => {});

// jsdom не реализует matchMedia — некоторые компоненты (тёмная тема) на неё смотрят.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
