// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Bug #2 — гейт приглашений по доставке ws на сервер.
//
// Проверяет, что useInvitesStore.invite:
//   • не зовёт серверную RPC, пока по ws висит pending outbox (flush не помог) —
//     вместо ложного «только владелец» кидает ws_not_synced;
//   • при наличии pending делает flush (syncNow) и, если push прошёл, зовёт RPC;
//   • без pending зовёт RPC сразу, без лишнего syncNow;
//   • ремапит серверный not_authorized в ws_not_synced, если ws всё ещё не доставлен.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const inviteToWorkspace = vi.fn(async () => ({ id: 'inv_1' }));
const listWorkspaceInvites = vi.fn(async () => []);
const workspaceHasPendingOutbox = vi.fn<(id: string | null | undefined) => boolean>();
const syncNow = vi.fn(async () => ({ ok: true }));

// Мокаем сервисный слой инвайтов, но сохраняем настоящий-совместимый InviteRpcError,
// чтобы `instanceof` в сторе и в тесте ссылались на один и тот же класс.
vi.mock('../lib/invites', () => {
  class InviteRpcError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'InviteRpcError';
      this.code = code;
    }
  }
  return {
    InviteRpcError,
    inviteToWorkspace: (...a: unknown[]) => inviteToWorkspace(...(a as [])),
    listWorkspaceInvites: (...a: unknown[]) => listWorkspaceInvites(...(a as [])),
    listMyPendingInvites: vi.fn(async () => []),
    acceptInvite: vi.fn(async () => ({ workspaceId: 'ws_s', role: 'editor' })),
    rejectInvite: vi.fn(async () => {}),
    cancelInvite: vi.fn(async () => {}),
  };
});

vi.mock('../lib/outbox', () => ({
  workspaceHasPendingOutbox: (id: string | null | undefined) => workspaceHasPendingOutbox(id),
}));

vi.mock('../lib/sync', () => ({
  syncNow: () => syncNow(),
}));

vi.mock('./useStore', () => ({
  useStore: {
    getState: () => ({ loadWorkspaces: vi.fn(), loadWorkspaceMembers: vi.fn() }),
  },
}));

import { useInvitesStore } from './useInvitesStore';
import { InviteRpcError } from '../lib/invites';

const params = { workspaceId: 'ws_s', targetPublicId: 'TF-ABC12', role: 'editor' as const };

beforeEach(() => {
  inviteToWorkspace.mockReset().mockResolvedValue({ id: 'inv_1' } as never);
  listWorkspaceInvites.mockClear();
  syncNow.mockReset().mockResolvedValue({ ok: true } as never);
  workspaceHasPendingOutbox.mockReset();
});

describe('useInvitesStore.invite — гейт доставки ws (Bug #2)', () => {
  it('без pending outbox: зовёт RPC сразу, без syncNow', async () => {
    workspaceHasPendingOutbox.mockReturnValue(false);
    await useInvitesStore.getState().invite(params);
    expect(syncNow).not.toHaveBeenCalled();
    expect(inviteToWorkspace).toHaveBeenCalledWith(params);
    expect(listWorkspaceInvites).toHaveBeenCalledWith('ws_s');
  });

  it('pending есть, push доставил ws: flush (syncNow) → затем RPC', async () => {
    // Первый вызов (гейт) — pending, после syncNow — уже нет.
    workspaceHasPendingOutbox.mockReturnValueOnce(true).mockReturnValue(false);
    await useInvitesStore.getState().invite(params);
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(inviteToWorkspace).toHaveBeenCalledWith(params);
  });

  it('pending остался после syncNow (paywalled/offline): ws_not_synced, RPC не зовётся', async () => {
    workspaceHasPendingOutbox.mockReturnValue(true);
    await expect(useInvitesStore.getState().invite(params)).rejects.toMatchObject({
      code: 'ws_not_synced',
    });
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(inviteToWorkspace).not.toHaveBeenCalled();
  });

  it('серверный not_authorized при недоставленном ws ремапится в ws_not_synced', async () => {
    // Гейт проходит (pending нет), RPC падает 42501, но ws снова числится pending.
    workspaceHasPendingOutbox.mockReturnValueOnce(false).mockReturnValue(true);
    inviteToWorkspace.mockRejectedValueOnce(new InviteRpcError('not_authorized', 'only owner'));
    await expect(useInvitesStore.getState().invite(params)).rejects.toMatchObject({
      code: 'ws_not_synced',
    });
  });

  it('серверный not_authorized при доставленном ws пробрасывается как есть', async () => {
    workspaceHasPendingOutbox.mockReturnValue(false);
    inviteToWorkspace.mockRejectedValueOnce(new InviteRpcError('not_authorized', 'only owner'));
    await expect(useInvitesStore.getState().invite(params)).rejects.toMatchObject({
      code: 'not_authorized',
    });
  });
});
