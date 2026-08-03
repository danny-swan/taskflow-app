/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v1.0.3 — тесты kill-switch'а Sentry.
 *
 * Sentry временно выключен (закончился бесплатный период + транспорт режется
 * CSP). Тесты фиксируют контракт: без VITE_SENTRY_ENABLED=true|1 функция
 * initSentry() НЕ вызывает Sentry.init, а isSentryEnabled() остаётся false.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const initMock = vi.fn();

vi.mock('@sentry/react', () => ({
  init: (...args: unknown[]) => initMock(...args),
  browserTracingIntegration: () => ({ name: 'BrowserTracing' }),
}));

/** Свежий модуль на каждый кейс — `initialized` внутри него это module state. */
async function loadSentryModule() {
  vi.resetModules();
  return await import('./sentry');
}

describe('sentry kill-switch (VITE_SENTRY_ENABLED)', () => {
  beforeEach(() => {
    initMock.mockClear();
    // DSN задан во всех кейсах — проверяем именно влияние флага.
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@o0.ingest.sentry.io/1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('флаг не задан → Sentry.init не вызывается (default OFF)', async () => {
    vi.stubEnv('VITE_SENTRY_ENABLED', '');
    const { initSentry, isSentryEnabled, isSentryAllowed } = await loadSentryModule();

    initSentry();

    expect(initMock).not.toHaveBeenCalled();
    expect(isSentryAllowed()).toBe(false);
    expect(isSentryEnabled()).toBe(false);
  });

  it('флаг = "false" → Sentry.init не вызывается', async () => {
    vi.stubEnv('VITE_SENTRY_ENABLED', 'false');
    const { initSentry, isSentryEnabled } = await loadSentryModule();

    initSentry();

    expect(initMock).not.toHaveBeenCalled();
    expect(isSentryEnabled()).toBe(false);
  });

  it('флаг выключен, но DSN пустой → всё равно no-op', async () => {
    vi.stubEnv('VITE_SENTRY_ENABLED', 'off');
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const { initSentry, isSentryEnabled } = await loadSentryModule();

    initSentry();

    expect(initMock).not.toHaveBeenCalled();
    expect(isSentryEnabled()).toBe(false);
  });

  it('флаг = "true" + DSN → Sentry.init вызывается (обратимость выключения)', async () => {
    vi.stubEnv('VITE_SENTRY_ENABLED', 'true');
    const { initSentry, isSentryEnabled, isSentryAllowed } = await loadSentryModule();

    initSentry();

    expect(isSentryAllowed()).toBe(true);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(isSentryEnabled()).toBe(true);
    expect(initMock.mock.calls[0][0]).toMatchObject({
      dsn: 'https://public@o0.ingest.sentry.io/1',
      sendDefaultPii: false,
    });
  });

  it('флаг = "1" (и регистр/пробелы не важны) → включено', async () => {
    vi.stubEnv('VITE_SENTRY_ENABLED', ' TRUE ');
    const { isSentryAllowed } = await loadSentryModule();
    expect(isSentryAllowed()).toBe(true);

    vi.stubEnv('VITE_SENTRY_ENABLED', '1');
    const mod = await loadSentryModule();
    expect(mod.isSentryAllowed()).toBe(true);
  });

  it('флаг = "true", но DSN пустой → init не вызывается (старое условие живо)', async () => {
    vi.stubEnv('VITE_SENTRY_ENABLED', 'true');
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const { initSentry, isSentryEnabled } = await loadSentryModule();

    initSentry();

    expect(initMock).not.toHaveBeenCalled();
    expect(isSentryEnabled()).toBe(false);
  });
});
