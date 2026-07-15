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
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const checkAccountBinding = vi.fn();
const createSnapshot = vi.fn(async (..._a: unknown[]) => {});
const setBoundUserId = vi.fn();
const isWebSnapshotLimited = vi.fn(() => false);
vi.mock('../lib/snapshots', () => ({
  checkAccountBinding: (...a: unknown[]) => checkAccountBinding(...a),
  createSnapshot: (...a: unknown[]) => createSnapshot(...a),
  setBoundUserId: (...a: unknown[]) => setBoundUserId(...a),
  isWebSnapshotLimited: () => isWebSnapshotLimited(),
}));

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
vi.mock('../lib/db', () => ({
  clearUserData: () => clearUserData(),
  ensureSeededIfEmpty: () => ensureSeededIfEmpty(),
}));

const syncNow = vi.fn(async () => {});
vi.mock('../lib/sync', () => ({ syncNow: () => syncNow(), cloudHasData: vi.fn() }));

const useAuthMock = vi.fn();
vi.mock('../lib/auth', () => ({ useAuth: () => useAuthMock(), signOut: vi.fn() }));

const pushToast = vi.fn();
const refresh = vi.fn();
const storeState = { language: 'ru', pushToast, refresh };
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
