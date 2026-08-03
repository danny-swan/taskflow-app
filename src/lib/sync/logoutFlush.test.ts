/**
 * logoutFlush.test.ts — Fix 5 (fix-round2): досыл outbox перед logout.
 *
 * Проверяем контракт flushOutboxBeforeLogout():
 *   • pro + непустой outbox (bound === session) → push вызван, attempted=true;
 *   • free → push НЕ вызван, attempted=false (no-op, данные локальны);
 *   • пустой outbox → push НЕ вызван;
 *   • push с failed>0 → attempted=true, failed=true (вызывающий покажет снимок).
 *
 * Мокаем зависимости; проверяем именно решение «слать / не слать».
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const getBoundUserId = vi.fn<() => string | null>(() => 'user-1');
vi.mock('../snapshots', () => ({ getBoundUserId: () => getBoundUserId() }));

const getClientId = vi.fn(() => 'client-1');
vi.mock('../clientId', () => ({ getClientId: () => getClientId() }));

const getEntitlement = vi.fn(async (_uid?: string, _email?: string | null) => ({ effectivePlan: 'pro' }));
const isProOrTrial = vi.fn((_e?: unknown) => true);
vi.mock('../entitlements', () => ({
  getEntitlement: (uid?: string, email?: string | null) => getEntitlement(uid, email),
  isProOrTrial: (e?: unknown) => isProOrTrial(e),
}));

const dbGet = vi.fn<(sql: string) => unknown>(() => ({ n: 3 }));
vi.mock('../db', () => ({ get: (sql: string) => dbGet(sql) }));

vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface PushRes { pushed: number; failed: number; skipped: number; firstError: string | null }
const pushAll = vi.fn(async (_uid?: string, _clientId?: string): Promise<PushRes> => ({
  pushed: 3, failed: 0, skipped: 0, firstError: null,
}));
vi.mock('./push', () => ({ pushAll: (uid?: string, clientId?: string) => pushAll(uid, clientId) }));

beforeEach(() => {
  vi.clearAllMocks();
  getBoundUserId.mockReturnValue('user-1');
  getClientId.mockReturnValue('client-1');
  getEntitlement.mockResolvedValue({ effectivePlan: 'pro' });
  isProOrTrial.mockReturnValue(true);
  dbGet.mockReturnValue({ n: 3 });
  pushAll.mockResolvedValue({ pushed: 3, failed: 0, skipped: 0, firstError: null });
});

describe('flushOutboxBeforeLogout — Fix 5', () => {
  it('pro + непустой outbox: push вызван, attempted=true, failed=false', async () => {
    const { flushOutboxBeforeLogout } = await import('./logoutFlush');
    const r = await flushOutboxBeforeLogout('user-1', 'a@b.c');
    expect(pushAll).toHaveBeenCalledWith('user-1', 'client-1');
    expect(r).toEqual({ attempted: true, failed: false });
  });

  it('free: push НЕ вызван, attempted=false (данные локальны)', async () => {
    isProOrTrial.mockReturnValue(false);
    const { flushOutboxBeforeLogout } = await import('./logoutFlush');
    const r = await flushOutboxBeforeLogout('user-1', 'a@b.c');
    expect(pushAll).not.toHaveBeenCalled();
    expect(r).toEqual({ attempted: false, failed: false });
  });

  it('пустой outbox: push НЕ вызван', async () => {
    dbGet.mockReturnValue({ n: 0 });
    const { flushOutboxBeforeLogout } = await import('./logoutFlush');
    const r = await flushOutboxBeforeLogout('user-1', 'a@b.c');
    expect(pushAll).not.toHaveBeenCalled();
    expect(r.attempted).toBe(false);
  });

  it('другая сессия (bound !== userId): no-op, push НЕ вызван', async () => {
    getBoundUserId.mockReturnValue('other-user');
    const { flushOutboxBeforeLogout } = await import('./logoutFlush');
    const r = await flushOutboxBeforeLogout('user-1', 'a@b.c');
    expect(pushAll).not.toHaveBeenCalled();
    expect(r.attempted).toBe(false);
  });

  it('push упал (failed>0): attempted=true, failed=true', async () => {
    pushAll.mockResolvedValue({ pushed: 1, failed: 2, skipped: 0, firstError: 'network down' });
    const { flushOutboxBeforeLogout } = await import('./logoutFlush');
    const r = await flushOutboxBeforeLogout('user-1', 'a@b.c');
    expect(pushAll).toHaveBeenCalled();
    expect(r).toEqual({ attempted: true, failed: true });
  });
});
