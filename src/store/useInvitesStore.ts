// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// useInvitesStore — состояние приглашений в shared-пространства (Wave B, PR-b-04).
//
// Отдельный стор (не часть useStore): инвайты живут ТОЛЬКО на сервере (таблица
// sync_workspace_invites не участвует в SQLite-зеркале/outbox), читаются и
// меняются исключительно через RPC-обёртки из lib/invites. Держим их вне
// оффлайн-first useStore, чтобы не смешивать серверное-only состояние с
// локальным зеркалом.
//
// Синхронизация с основным useStore: после accept инвайта членство + пространство
// появляются на сервере, поэтому дёргаем syncNow() (lazy import, как и в
// switchWorkspace) + перечитываем workspaces/members из локальной БД.
import { create } from 'zustand';
import { logger } from '../lib/logger';
import { useStore } from './useStore';
import {
  inviteToWorkspace,
  acceptInvite,
  rejectInvite,
  cancelInvite,
  listMyPendingInvites,
  listWorkspaceInvites,
  type InviteRole,
  type WorkspaceInvite,
} from '../lib/invites';

interface InvitesState {
  myPending: WorkspaceInvite[];                        // мои входящие pending
  workspaceInvites: Record<string, WorkspaceInvite[]>; // {ws_id: pending этого ws (для owner)}
  loading: boolean;
  error: string | null;

  loadMyPending: () => Promise<void>;
  loadWorkspaceInvites: (workspaceId: string) => Promise<void>;
  invite: (params: { workspaceId: string; targetPublicId: string; role: InviteRole }) => Promise<void>;
  accept: (inviteId: string) => Promise<{ workspaceId: string }>;
  reject: (inviteId: string) => Promise<void>;
  cancel: (inviteId: string) => Promise<void>;
}

/** После accept — дотянуть облако (новое членство/пространство) в локальную БД. */
async function resyncWorkspaces(): Promise<void> {
  try {
    const m = await import('../lib/sync');
    await m.syncNow?.();
  } catch (e) {
    logger.warn('[invites] resync after accept failed:', e);
  }
  useStore.getState().loadWorkspaces();
  useStore.getState().loadWorkspaceMembers();
}

export const useInvitesStore = create<InvitesState>((set, get) => ({
  myPending: [],
  workspaceInvites: {},
  loading: false,
  error: null,

  async loadMyPending() {
    set({ loading: true, error: null });
    try {
      const rows = await listMyPendingInvites();
      set({ myPending: rows, loading: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('[invites] loadMyPending failed:', msg);
      set({ myPending: [], loading: false, error: msg });
    }
  },

  async loadWorkspaceInvites(workspaceId) {
    set({ loading: true, error: null });
    try {
      const rows = await listWorkspaceInvites(workspaceId);
      set(s => ({ workspaceInvites: { ...s.workspaceInvites, [workspaceId]: rows }, loading: false }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('[invites] loadWorkspaceInvites failed:', msg);
      set({ loading: false, error: msg });
    }
  },

  async invite(params) {
    // Ошибку намеренно НЕ глотаем: модалка мапит code → переведённый текст.
    await inviteToWorkspace(params);
    await get().loadWorkspaceInvites(params.workspaceId);
  },

  async accept(inviteId) {
    const { workspaceId } = await acceptInvite(inviteId);
    set(s => ({ myPending: s.myPending.filter(i => i.id !== inviteId) }));
    await resyncWorkspaces();
    return { workspaceId };
  },

  async reject(inviteId) {
    await rejectInvite(inviteId);
    set(s => ({ myPending: s.myPending.filter(i => i.id !== inviteId) }));
  },

  async cancel(inviteId) {
    await cancelInvite(inviteId);
    set(s => {
      const next: Record<string, WorkspaceInvite[]> = {};
      for (const [ws, list] of Object.entries(s.workspaceInvites)) {
        next[ws] = list.filter(i => i.id !== inviteId);
      }
      return { workspaceInvites: next };
    });
  },
}));
