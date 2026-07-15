// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Bug F — утечка данных между аккаунтами на free-tier.
//
// При входе под другим аккаунтом с рассинхроном bound_user_id раньше free-tier
// делал early-return: локальная база прошлого аккаунта оставалась видимой, а
// bound_user_id — чужим. Проверяем, что теперь free-tier делает локальную
// перепривязку (снимок → clearUserData → setBoundUserId(new) →
// reconcilePersonalWorkspace → ensureSeededIfEmpty), НЕ дёргает синхронизацию и
// НЕ показывает модалку с тремя вариантами. Платный путь — прежний (модалка).
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const checkAccountBinding = vi.fn();
const createSnapshot = vi.fn(async (..._a: unknown[]) => {});
const setBoundUserId = vi.fn();
const getBoundUserId = vi.fn<() => string | null>(() => null);
const isWebSnapshotLimited = vi.fn(() => false);
vi.mock('../lib/snapshots', () => ({
  checkAccountBinding: (...a: unknown[]) => checkAccountBinding(...a),
  createSnapshot: (...a: unknown[]) => createSnapshot(...a),
  setBoundUserId: (...a: unknown[]) => setBoundUserId(...a),
  getBoundUserId: () => getBoundUserId(),
  isWebSnapshotLimited: () => isWebSnapshotLimited(),
}));

const getClientId = vi.fn(() => 'client-test');
vi.mock('../lib/clientId', () => ({ getClientId: () => getClientId() }));

const pushAll = vi.fn(async (_uid?: string, _clientId?: string) => ({ pushed: 0, failed: 0 }));
vi.mock('../lib/sync/push', () => ({ pushAll: (uid?: string, clientId?: string) => pushAll(uid, clientId) }));

const getEntitlement = vi.fn();
const isProOrTrial = vi.fn();
vi.mock('../lib/entitlements', () => ({
  getEntitlement: (...a: unknown[]) => getEntitlement(...a),
  isProOrTrial: (...a: unknown[]) => isProOrTrial(...a),
}));

const reconcilePersonalWorkspace = vi.fn();
vi.mock('../lib/sync/workspace', () => ({
  reconcilePersonalWorkspace: (...a: unknown[]) => reconcilePersonalWorkspace(...a),
}));

const clearUserData = vi.fn(async () => {});
const ensureSeededIfEmpty = vi.fn(async () => {});
const ensureWelcomeTaskIfNeeded = vi.fn(async (_userId?: string) => false);
const dbGet = vi.fn<(sql: string, params?: unknown[]) => unknown>(() => ({ n: 0 }));
vi.mock('../lib/db', () => ({
  clearUserData: () => clearUserData(),
  ensureSeededIfEmpty: () => ensureSeededIfEmpty(),
  ensureWelcomeTaskIfNeeded: (u?: string) => ensureWelcomeTaskIfNeeded(u),
  get: (sql: string, params?: unknown[]) => dbGet(sql, params),
}));

const syncNow = vi.fn(async () => {});
const cloudHasData = vi.fn(async (_uid?: string) => true);
vi.mock('../lib/sync', () => ({ syncNow: () => syncNow(), cloudHasData: (uid?: string) => cloudHasData(uid) }));

const useAuthMock = vi.fn();
vi.mock('../lib/auth', () => ({ useAuth: () => useAuthMock(), signOut: vi.fn() }));

const pushToast = vi.fn();
const refresh = vi.fn();
const reloadAccountBinding = vi.fn();
const storeState = { language: 'ru', pushToast, refresh, reloadAccountBinding };
vi.mock('../store/useStore', () => ({
  useStore: Object.assign(
    (selector: (s: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState },
  ),
}));

// Modal → просто рендерим детей, когда open.
vi.mock('./Modal', () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
}));

import { AccountSwitchGate } from './AccountSwitchGate';

beforeEach(() => {
  vi.clearAllMocks();
  isWebSnapshotLimited.mockReturnValue(false);
  getBoundUserId.mockReturnValue(null);
  getClientId.mockReturnValue('client-test');
  ensureWelcomeTaskIfNeeded.mockResolvedValue(false);
  dbGet.mockReturnValue({ n: 0 });
  pushAll.mockResolvedValue({ pushed: 0, failed: 0 });
  cloudHasData.mockResolvedValue(true);
});

describe('AccountSwitchGate — free-tier перепривязка (Bug F)', () => {
  it('free + рассинхрон: очистка+перепривязка локально, без sync и без модалки', async () => {
    useAuthMock.mockReturnValue({ session: { user: { id: 'new-uid', email: 'a@b.c' } } });
    checkAccountBinding.mockReturnValue({ mismatch: true, boundUserId: 'old-uid' });
    getEntitlement.mockResolvedValue({ tier: 'free' });
    isProOrTrial.mockReturnValue(false);

    render(<AccountSwitchGate />);

    await waitFor(() => expect(clearUserData).toHaveBeenCalledTimes(1));
    expect(createSnapshot).toHaveBeenCalledWith('before_account_switch');
    expect(setBoundUserId).toHaveBeenCalledWith('new-uid');
    expect(reconcilePersonalWorkspace).toHaveBeenCalledWith('new-uid');
    expect(ensureSeededIfEmpty).toHaveBeenCalledTimes(1);
    // Fix 1: free-tier тоже получает welcome-задачу локально.
    expect(ensureWelcomeTaskIfNeeded).toHaveBeenCalledWith('new-uid');
    // Fix 2: стор перечитывает привязку → computeRole увидит owner-роль.
    expect(reloadAccountBinding).toHaveBeenCalled();
    // Синхронизация у free заблокирована — не дёргаем.
    expect(syncNow).not.toHaveBeenCalled();
    // Модалка с тремя вариантами free-юзеру не показывается.
    expect(screen.queryByText('Вы вошли под другим аккаунтом')).toBeNull();
  });

  it('pro + рассинхрон: показываем модалку, локальные данные не трогаем до выбора', async () => {
    useAuthMock.mockReturnValue({ session: { user: { id: 'new-uid', email: 'a@b.c' } } });
    checkAccountBinding.mockReturnValue({ mismatch: true, boundUserId: 'old-uid' });
    getEntitlement.mockResolvedValue({ tier: 'pro' });
    isProOrTrial.mockReturnValue(true);

    render(<AccountSwitchGate />);

    await waitFor(() =>
      expect(screen.getByText('Вы вошли под другим аккаунтом')).toBeInTheDocument(),
    );
    expect(clearUserData).not.toHaveBeenCalled();
    expect(setBoundUserId).not.toHaveBeenCalled();
  });

  it('нет рассинхрона: ничего не делаем', async () => {
    useAuthMock.mockReturnValue({ session: { user: { id: 'uid', email: 'a@b.c' } } });
    checkAccountBinding.mockReturnValue({ mismatch: false });

    render(<AccountSwitchGate />);

    await waitFor(() => expect(checkAccountBinding).toHaveBeenCalled());
    expect(clearUserData).not.toHaveBeenCalled();
    expect(screen.queryByText('Вы вошли под другим аккаунтом')).toBeNull();
  });
});

describe('AccountSwitchGate — долив outbox перед стиранием (Fix 3)', () => {
  async function openProModalAndPickCloud() {
    useAuthMock.mockReturnValue({ session: { user: { id: 'new-uid', email: 'a@b.c' } } });
    checkAccountBinding.mockReturnValue({ mismatch: true, boundUserId: 'new-uid' });
    getEntitlement.mockResolvedValue({ tier: 'pro' });
    isProOrTrial.mockReturnValue(true);
    // Уходящая база принадлежит текущей сессии → активна ветка сетевого долива.
    getBoundUserId.mockReturnValue('new-uid');
    dbGet.mockReturnValue({ n: 3 }); // есть несинхронизированные строки

    render(<AccountSwitchGate />);
    await waitFor(() =>
      expect(screen.getByText('Вы вошли под другим аккаунтом')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText('Загрузить облачные'));
  }

  it('провал push (failed>0): НЕ стираем, показываем ошибку', async () => {
    pushAll.mockResolvedValue({ pushed: 1, failed: 1 });
    await openProModalAndPickCloud();

    await waitFor(() => expect(pushAll).toHaveBeenCalledWith('new-uid', 'client-test'));
    // Снимок всегда сделан, но стирание отменено.
    expect(createSnapshot).toHaveBeenCalledWith('before_account_switch');
    expect(clearUserData).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByText(/Остались несинхронизированные изменения/),
      ).toBeInTheDocument(),
    );
  });

  it('успешный push (failed=0): доливаем, затем стираем', async () => {
    pushAll.mockResolvedValue({ pushed: 3, failed: 0 });
    await openProModalAndPickCloud();

    await waitFor(() => expect(clearUserData).toHaveBeenCalledTimes(1));
    // Долив выполнен до стирания.
    expect(pushAll).toHaveBeenCalledWith('new-uid', 'client-test');
    expect(setBoundUserId).toHaveBeenCalledWith(null);
  });
});
