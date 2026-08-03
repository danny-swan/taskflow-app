// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * pendingSync.chip.test.ts — P2: индикатор «pending sync: N».
 *
 * Баг: у free/paywalled-пользователя sync недоступен (оркестратор гейтит план
 * статусом 'paywalled' и никогда не пушит), но чип «pending sync: N» всё равно
 * показывается вместе с «последняя синхронизация: никогда». Счётчик очереди,
 * которая никогда не отправится, только путает.
 *
 * Контракт: когда sync недоступен ('paywalled' — free/истёкший trial, либо
 * 'skipped' — нет сессии), чип НЕ показываем независимо от размера очереди и
 * dev/prod. Для Pro/trial/lifetime (idle/pulling/pushing/synced/error) поведение
 * прежнее: prod показывает при count>0 или занятости/ошибке, dev — всегда.
 */
import { describe, it, expect } from 'vitest';
import { shouldHidePendingChip } from './pendingSync';

describe('P2: видимость чипа pending sync', () => {
  it('paywalled → чип скрыт даже при непустой очереди (prod и dev)', () => {
    expect(shouldHidePendingChip('paywalled', 5, false)).toBe(true);
    expect(shouldHidePendingChip('paywalled', 5, true)).toBe(true);
    expect(shouldHidePendingChip('paywalled', 0, true)).toBe(true);
  });

  it('skipped (нет сессии) → чип скрыт при непустой очереди', () => {
    expect(shouldHidePendingChip('skipped', 3, false)).toBe(true);
    expect(shouldHidePendingChip('skipped', 3, true)).toBe(true);
  });

  it('Pro/trial: prod показывает чип при непустой очереди', () => {
    expect(shouldHidePendingChip('idle', 2, false)).toBe(false);
    expect(shouldHidePendingChip('pushing', 0, false)).toBe(false);
    expect(shouldHidePendingChip('error', 0, false)).toBe(false);
  });

  it('Pro/trial: prod прячет чип, когда очередь пуста и ничего не происходит', () => {
    expect(shouldHidePendingChip('idle', 0, false)).toBe(true);
    expect(shouldHidePendingChip('synced', 0, false)).toBe(true);
  });

  it('Pro/trial: dev всегда показывает чип (кроме sync-недоступен)', () => {
    expect(shouldHidePendingChip('idle', 0, true)).toBe(false);
    expect(shouldHidePendingChip('synced', 0, true)).toBe(false);
  });
});
