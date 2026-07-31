// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// F19 (ADR 0013) — блокирующий оверлей старта.
//
// Ключевые инварианты, которые здесь фиксируются:
//   • виден, пока БД не готова / сессия выясняется;
//   • виден, пока первый sync-цикл не дошёл до терминального статуса;
//   • НИКОГДА не висит вечно: grace-таймаут (sync не стартовал) и hard-таймаут;
//   • снявшись один раз, обратно не появляется (фоновый sync не перекрывает UI);
//   • перекрывает экран и гасит клики под собой.
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector({ language: 'ru' }),
}));

let syncStatus = 'idle';
let listener: ((s: { status: string }) => void) | null = null;
vi.mock('../lib/sync', () => ({
  getSyncState: () => ({ status: syncStatus }),
  subscribeSyncState: (fn: (s: { status: string }) => void) => {
    listener = fn;
    return () => { listener = null; };
  },
}));

import { BootOverlay, BOOT_SYNC_GRACE_MS, BOOT_HARD_TIMEOUT_MS } from './BootOverlay';

/** Прогоняет фейковые таймеры + микротаски (динамический import в эффекте). */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Даёт разрешиться `import('../lib/sync')` внутри эффекта. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const overlay = () => screen.queryByTestId('boot-overlay');

beforeEach(() => {
  vi.useFakeTimers();
  syncStatus = 'idle';
  listener = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('BootOverlay: фаза «БД не готова»', () => {
  it('виден, пока dbReady=false', async () => {
    render(<BootOverlay dbReady={false} authLoading={false} waitForSync={false} />);
    await flush();
    expect(overlay()).not.toBeNull();
    expect(screen.getByText('Загрузка пространств…')).toBeTruthy();
  });

  it('виден, пока сессия выясняется (authLoading=true), даже если БД готова', async () => {
    render(<BootOverlay dbReady authLoading waitForSync={false} />);
    await flush();
    expect(overlay()).not.toBeNull();
  });

  it('скрыт сразу, если БД готова, сессия известна и ждать pull не нужно', async () => {
    render(<BootOverlay dbReady authLoading={false} waitForSync={false} />);
    await flush();
    expect(overlay()).toBeNull();
  });

  it('перекрывает весь экран и помечен как busy — клики под ним не проходят', async () => {
    render(<BootOverlay dbReady={false} authLoading={false} waitForSync={false} />);
    await flush();
    const el = overlay()!;
    expect(el.className).toContain('fixed');
    expect(el.className).toContain('inset-0');
    expect(el.getAttribute('aria-busy')).toBe('true');
    expect(el.getAttribute('role')).toBe('status');
  });

  it('снимается, когда dbReady переключается в true', async () => {
    const { rerender } = render(
      <BootOverlay dbReady={false} authLoading={false} waitForSync={false} />,
    );
    await flush();
    expect(overlay()).not.toBeNull();
    rerender(<BootOverlay dbReady authLoading={false} waitForSync={false} />);
    await flush();
    expect(overlay()).toBeNull();
  });
});

describe('BootOverlay: фаза «первый pull»', () => {
  it('держится, пока sync не дошёл до терминального статуса', async () => {
    syncStatus = 'pulling';
    render(<BootOverlay dbReady authLoading={false} waitForSync />);
    await flush();
    expect(overlay()).not.toBeNull();

    // Стартовавший sync переживает grace-таймаут — ждём именно его завершения.
    await advance(BOOT_SYNC_GRACE_MS + 100);
    expect(overlay()).not.toBeNull();

    await act(async () => { listener?.({ status: 'synced' }); });
    expect(overlay()).toBeNull();
  });

  it('терминальный статус error тоже снимает оверлей (не блокируем при сбое)', async () => {
    syncStatus = 'pulling';
    render(<BootOverlay dbReady authLoading={false} waitForSync />);
    await flush();
    await act(async () => { listener?.({ status: 'error' }); });
    expect(overlay()).toBeNull();
  });

  it('grace-таймаут: sync-цикл вообще не стартовал — ждать нечего', async () => {
    syncStatus = 'idle';
    render(<BootOverlay dbReady authLoading={false} waitForSync />);
    await flush();
    expect(overlay()).not.toBeNull();
    await advance(BOOT_SYNC_GRACE_MS + 100);
    expect(overlay()).toBeNull();
  });

  it('hard-таймаут: sync стартовал и завис — оверлей всё равно снимается', async () => {
    syncStatus = 'pulling';
    render(<BootOverlay dbReady authLoading={false} waitForSync />);
    await flush();
    await advance(BOOT_SYNC_GRACE_MS + 100);
    expect(overlay()).not.toBeNull();
    await advance(BOOT_HARD_TIMEOUT_MS);
    expect(overlay()).toBeNull();
  });

  it('одноразовость: повторный не-терминальный статус не возвращает оверлей', async () => {
    syncStatus = 'synced';
    render(<BootOverlay dbReady authLoading={false} waitForSync />);
    await flush();
    expect(overlay()).toBeNull();
    // Фоновый sync через минуту — UI перекрывать нельзя.
    await act(async () => { listener?.({ status: 'pulling' }); });
    expect(overlay()).toBeNull();
  });
});
