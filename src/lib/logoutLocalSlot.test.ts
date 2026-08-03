/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * F37 (ADR 0029) — слот free-аккаунта пишется прямо перед обычным выходом.
 *
 * Проверяем контракт `saveFreeSlotBeforeLogout`:
 *   1) free + база наша → слот пишется, очередь нативных записей сбрасывается;
 *   2) pro/trial → no-op (инвариант ADR 0014: слот только для free);
 *   3) bound_user_id чужой (середина смены аккаунта) → no-op;
 *   4) saveLocalAccountData вернул false → attempted=true, saved=false, warn;
 *   5) исключение внутри → не пробрасывается наружу (выход не блокируется).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getBoundUserId = vi.fn<() => string | null>(() => 'u1');
const getEntitlement = vi.fn(async (_u?: string, _e?: string | null) => ({ plan: 'free' }) as any);
const isProOrTrial = vi.fn((ent: any) => ent?.plan === 'pro' || ent?.plan === 'trial');
const saveLocalAccountData = vi.fn(async (_u: string | null) => true);
const flushNativeWrites = vi.fn(async () => {});
const warn = vi.fn();

vi.mock('./snapshots', () => ({ getBoundUserId: () => getBoundUserId() }));
vi.mock('./entitlements', () => ({
  getEntitlement: (u: string, e: string | null) => getEntitlement(u, e),
  isProOrTrial: (ent: any) => isProOrTrial(ent),
}));
vi.mock('./localAccountStore', () => ({
  saveLocalAccountData: (u: string | null) => saveLocalAccountData(u),
}));
vi.mock('./db', () => ({ flushNativeWrites: () => flushNativeWrites() }));
vi.mock('./logger', () => ({ logger: { warn: (...a: unknown[]) => warn(...a), info: () => {} } }));

import { saveFreeSlotBeforeLogout } from './logoutLocalSlot';

beforeEach(() => {
  vi.clearAllMocks();
  getBoundUserId.mockReturnValue('u1');
  getEntitlement.mockResolvedValue({ plan: 'free' } as any);
  saveLocalAccountData.mockResolvedValue(true);
});

describe('F37: saveFreeSlotBeforeLogout', () => {
  it('free + наша база: пишет слот и сбрасывает очередь нативных записей', async () => {
    const r = await saveFreeSlotBeforeLogout('u1', 'u1@example.com');
    expect(r).toEqual({ attempted: true, saved: true });
    expect(saveLocalAccountData).toHaveBeenCalledWith('u1');
    expect(flushNativeWrites).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('pro/trial: no-op — слот принадлежит free (ADR 0014)', async () => {
    getEntitlement.mockResolvedValue({ plan: 'pro' } as any);
    const r = await saveFreeSlotBeforeLogout('u1', null);
    expect(r).toEqual({ attempted: false, saved: false });
    expect(saveLocalAccountData).not.toHaveBeenCalled();
  });

  it('база принадлежит другому аккаунту: no-op, чужое состояние не пишем', async () => {
    getBoundUserId.mockReturnValue('someone-else');
    const r = await saveFreeSlotBeforeLogout('u1', null);
    expect(r).toEqual({ attempted: false, saved: false });
    expect(saveLocalAccountData).not.toHaveBeenCalled();
    expect(getEntitlement).not.toHaveBeenCalled();
  });

  it('привязки нет вовсе: no-op', async () => {
    getBoundUserId.mockReturnValue(null);
    const r = await saveFreeSlotBeforeLogout('u1', null);
    expect(r).toEqual({ attempted: false, saved: false });
    expect(saveLocalAccountData).not.toHaveBeenCalled();
  });

  it('слот не записался: attempted=true, saved=false + предупреждение в лог', async () => {
    saveLocalAccountData.mockResolvedValue(false);
    const r = await saveFreeSlotBeforeLogout('u1', null);
    expect(r).toEqual({ attempted: true, saved: false });
    expect(warn).toHaveBeenCalled();
  });

  it('исключение внутри не блокирует выход', async () => {
    saveLocalAccountData.mockRejectedValue(new Error('localStorage boom'));
    const r = await saveFreeSlotBeforeLogout('u1', null);
    expect(r).toEqual({ attempted: true, saved: false });
    expect(warn).toHaveBeenCalled();
  });
});
