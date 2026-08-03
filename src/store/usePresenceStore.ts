// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// usePresenceStore — эфемерный список «кто сейчас онлайн» в shared-пространстве
// (Wave C, PR-c-01).
//
// Отдельный стор (не часть useStore): presence живёт ТОЛЬКО в рантайме через
// Supabase Realtime Presence API и НЕ должен попадать в SQLite/персистентность —
// это моментальный снимок «кто в канале сейчас», не данные пользователя. Держим
// его вне оффлайн-first useStore, чтобы presence-события не триггерили sync/
// outbox и не переживали перезагрузку.
//
// Список НЕ включает самого пользователя: presence.ts отфильтровывает свой
// userId до записи в стор, поэтому здесь всегда «кто ещё, кроме меня».
import { create } from 'zustand';

/** Участник presence-канала (публичный минимум профиля, без email). */
export interface PresenceMember {
  userId: string;
  nickname: string | null;
  avatarVariant: number;
  publicUserId: string;
}

interface PresenceState {
  /** id пространства, к которому относится текущий список (или null). */
  workspaceId: string | null;
  /** Онлайн-участники (кроме себя), ключ — userId. */
  byId: Record<string, PresenceMember>;

  /** Полная замена списка (событие presence `sync` — авторитетный снимок). */
  syncFrom: (workspaceId: string, members: PresenceMember[]) => void;
  /** Добавить/обновить участника (событие `join`). */
  join: (workspaceId: string, member: PresenceMember) => void;
  /** Убрать участника (событие `leave`). */
  leave: (userId: string) => void;
  /** Сбросить всё (отписка/логаут/смена пространства). */
  clear: () => void;
}

export const usePresenceStore = create<PresenceState>((set) => ({
  workspaceId: null,
  byId: {},

  syncFrom(workspaceId, members) {
    const byId: Record<string, PresenceMember> = {};
    for (const m of members) byId[m.userId] = m;
    set({ workspaceId, byId });
  },

  join(workspaceId, member) {
    set((s) => ({
      workspaceId,
      byId: { ...s.byId, [member.userId]: member },
    }));
  },

  leave(userId) {
    set((s) => {
      if (!(userId in s.byId)) return s;
      const byId = { ...s.byId };
      delete byId[userId];
      return { byId };
    });
  },

  clear() {
    set({ workspaceId: null, byId: {} });
  },
}));

/** Селектор: онлайн-участники активного пространства массивом. */
export function selectPresenceMembers(s: PresenceState): PresenceMember[] {
  return Object.values(s.byId);
}
