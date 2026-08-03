// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// F30 (ADR 0023) — авто-restore из файлового снимка как fallback-источник
// при входе в free-аккаунт, когда localStorage-слот (ADR 0014/F21) пуст.
//
// Порядок, который проверяем (AccountSwitchGate.tsx, free-ветка):
//   1. loadLocalAccountData(sessionUserId) — slot, как раньше (обратная
//      совместимость, без перезапуска).
//   2. Если !restored — findLatestAccountSnapshot(sessionUserId) (обёртка над
//      readRegistry() из lib/snapshots) ищет последний непустой снимок
//      label==='before_account_switch' с boundUserId===sessionUserId.
//      Если найден — restoreSnapshot(id). Пустые снимки (taskCount=0 /
//      size===4096) не восстанавливаются.
//   3. Если ничего не найдено — ensureSeededIfEmpty() + ensureWelcomeTaskIfNeeded().
//
// Тест рендерит реальный компонент AccountSwitchGate (как и
// AccountSwitchGate.test.tsx), но фокусируется ИСКЛЮЧИТЕЛЬНО на 4 сценариях
// восстановления, описанных в брифе F30. Мокаем snapshots.ts,
// localAccountStore и db-seed функции; проверяем последовательность вызовов
// через invocationCallOrder и то, что seed НЕ зовётся при успешном restore.
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const checkAccountBinding = vi.fn();
const createSnapshot = vi.fn(async (..._a: unknown[]) => {});
const setBoundUserId = vi.fn();
const getBoundUserId = vi.fn<() => string | null>(() => null);
const isWebSnapshotLimited = vi.fn(() => false);
const readRegistry = vi.fn<() => Array<{
  id: string;
  label: string;
  createdAt: string;
  size: number;
  platform: 'tauri' | 'web';
  boundUserId?: string | null;
  taskCount?: number;
}>>(() => []);
const restoreSnapshot = vi.fn<(id: string) => Promise<{ needsRestart: boolean }>>(
  async () => ({ needsRestart: false }),
);
vi.mock('../lib/snapshots', () => ({
  checkAccountBinding: (...a: unknown[]) => checkAccountBinding(...a),
  createSnapshot: (...a: unknown[]) => createSnapshot(...a),
  setBoundUserId: (...a: unknown[]) => setBoundUserId(...a),
  getBoundUserId: () => getBoundUserId(),
  isWebSnapshotLimited: () => isWebSnapshotLimited(),
  readRegistry: () => readRegistry(),
  restoreSnapshot: (id: string) => restoreSnapshot(id),
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

// F21 (ADR 0014): localStorage-слот — быстрый путь без перезапуска.
const saveLocalAccountData = vi.fn(async (_uid: string | null) => true);
const loadLocalAccountData = vi.fn(async (_uid: string | null) => false);
vi.mock('../lib/localAccountStore', () => ({
  saveLocalAccountData: (uid: string | null) => saveLocalAccountData(uid),
  loadLocalAccountData: (uid: string | null) => loadLocalAccountData(uid),
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

const NEW_UID = 'new-uid';
const OLD_UID = 'old-uid';

function snapMeta(overrides: Partial<{
  id: string;
  label: string;
  createdAt: string;
  size: number;
  platform: 'tauri' | 'web';
  boundUserId: string | null;
  taskCount: number;
}> = {}) {
  return {
    id: 'snap_1',
    label: 'before_account_switch',
    createdAt: '2026-08-01T00:00:00.000Z',
    size: 180224,
    platform: 'tauri' as const,
    boundUserId: NEW_UID,
    taskCount: 5,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isWebSnapshotLimited.mockReturnValue(false);
  getBoundUserId.mockReturnValue(null);
  getClientId.mockReturnValue('client-test');
  ensureWelcomeTaskIfNeeded.mockResolvedValue(false);
  dbGet.mockReturnValue({ n: 0 });
  pushAll.mockResolvedValue({ pushed: 0, failed: 0 });
  cloudHasData.mockResolvedValue(true);
  saveLocalAccountData.mockResolvedValue(true);
  loadLocalAccountData.mockResolvedValue(false);
  readRegistry.mockReturnValue([]);
  restoreSnapshot.mockResolvedValue({ needsRestart: false });

  useAuthMock.mockReturnValue({ session: { user: { id: NEW_UID, email: 'a@b.c' } } });
  checkAccountBinding.mockReturnValue({ mismatch: true, boundUserId: OLD_UID });
  getEntitlement.mockResolvedValue({ tier: 'free' });
  isProOrTrial.mockReturnValue(false);
});

describe('F30 — авто-restore из файлового снимка (fallback при пустом slot)', () => {
  it('1) slot непуст → восстановление из slot, файловый снимок не трогается, seed не вызывается, перезапуска нет', async () => {
    loadLocalAccountData.mockResolvedValue(true);

    render(<AccountSwitchGate />);

    await waitFor(() => expect(loadLocalAccountData).toHaveBeenCalledWith(NEW_UID));
    // Файловый снимок как источник restore не трогается вовсе.
    expect(readRegistry).not.toHaveBeenCalled();
    expect(restoreSnapshot).not.toHaveBeenCalled();
    // Seed не вызывается.
    expect(ensureSeededIfEmpty).not.toHaveBeenCalled();
    expect(ensureWelcomeTaskIfNeeded).not.toHaveBeenCalled();
    // Тост про восстановление slot (без упоминания снимка/перезапуска).
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        'Вы вошли под другим аккаунтом. Восстановлены локальные данные этого аккаунта.',
      ),
    );
  });

  it('2) slot пуст + есть непустой before_account_switch снимок для sessionUserId → restoreSnapshot(id), seed не вызывается, needsRestart прокинут', async () => {
    loadLocalAccountData.mockResolvedValue(false);
    const meta = snapMeta({ id: 'snap_good', boundUserId: NEW_UID, taskCount: 7 });
    readRegistry.mockReturnValue([meta]);
    restoreSnapshot.mockResolvedValue({ needsRestart: true });

    render(<AccountSwitchGate />);

    await waitFor(() => expect(restoreSnapshot).toHaveBeenCalledWith('snap_good'));
    // Seed НЕ вызывается — данные найдены в файловом снимке.
    expect(ensureSeededIfEmpty).not.toHaveBeenCalled();
    expect(ensureWelcomeTaskIfNeeded).not.toHaveBeenCalled();
    // Последовательность: slot проверен раньше, чем снимок восстановлен.
    expect(loadLocalAccountData.mock.invocationCallOrder[0])
      .toBeLessThan(restoreSnapshot.mock.invocationCallOrder[0]);
    // needsRestart:true прокинут дальше — не обычный тост, а диалог перезапуска
    // (тот же механизм, что Settings.tsx handleRestoreSnapshot → restartAfterRestore).
    // Обычный тост о восстановлении НЕ показывается (стор ещё не обновлён до рестарта).
    await waitFor(() =>
      expect(screen.getByText(/перезапуск/i)).toBeInTheDocument(),
    );
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('3) slot пуст + снимков для sessionUserId нет (новый аккаунт) → seed вызывается', async () => {
    loadLocalAccountData.mockResolvedValue(false);
    readRegistry.mockReturnValue([]); // реально новый аккаунт — снимков нет вовсе

    render(<AccountSwitchGate />);

    await waitFor(() => expect(ensureSeededIfEmpty).toHaveBeenCalledTimes(1));
    expect(ensureWelcomeTaskIfNeeded).toHaveBeenCalledWith(NEW_UID);
    expect(restoreSnapshot).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(
        'Вы вошли под другим аккаунтом. Локальные данные очищены, снимок сохранён.',
      ),
    );
  });

  it('4) slot пуст + только пустой (size=4096/taskCount=0) снимок → трактуется как «нет данных» → seed, restoreSnapshot не вызывается', async () => {
    loadLocalAccountData.mockResolvedValue(false);
    const emptySnap = snapMeta({ id: 'snap_empty', boundUserId: NEW_UID, size: 4096, taskCount: 0 });
    readRegistry.mockReturnValue([emptySnap]);

    render(<AccountSwitchGate />);

    await waitFor(() => expect(ensureSeededIfEmpty).toHaveBeenCalledTimes(1));
    expect(ensureWelcomeTaskIfNeeded).toHaveBeenCalledWith(NEW_UID);
    // Пустышку восстанавливать нельзя — restoreSnapshot не должен был вызваться.
    expect(restoreSnapshot).not.toHaveBeenCalled();
  });

  it('доп: снимок постороннего (уходящего) аккаунта boundUserId!==sessionUserId игнорируется, а не восстанавливается', async () => {
    loadLocalAccountData.mockResolvedValue(false);
    // Safety-снимок уходящего аккаунта — тот же label, но чужой boundUserId.
    const foreignSnap = snapMeta({ id: 'snap_foreign', boundUserId: OLD_UID, taskCount: 9 });
    readRegistry.mockReturnValue([foreignSnap]);

    render(<AccountSwitchGate />);

    await waitFor(() => expect(ensureSeededIfEmpty).toHaveBeenCalledTimes(1));
    expect(restoreSnapshot).not.toHaveBeenCalled();
  });

  it('доп: из нескольких непустых снимков для sessionUserId выбирается самый свежий по createdAt', async () => {
    loadLocalAccountData.mockResolvedValue(false);
    const older = snapMeta({ id: 'snap_older', boundUserId: NEW_UID, taskCount: 3, createdAt: '2026-07-01T00:00:00.000Z' });
    const newer = snapMeta({ id: 'snap_newer', boundUserId: NEW_UID, taskCount: 4, createdAt: '2026-08-01T00:00:00.000Z' });
    readRegistry.mockReturnValue([older, newer]);
    restoreSnapshot.mockResolvedValue({ needsRestart: false });

    render(<AccountSwitchGate />);

    await waitFor(() => expect(restoreSnapshot).toHaveBeenCalledWith('snap_newer'));
    expect(restoreSnapshot).not.toHaveBeenCalledWith('snap_older');
  });
});
