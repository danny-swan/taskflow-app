// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Unit-тесты usePresenceStore (Wave C, PR-c-01): трассировка join/leave/sync.
import { describe, it, expect, beforeEach } from 'vitest';
import { usePresenceStore, selectPresenceMembers, type PresenceMember } from './usePresenceStore';

const m = (userId: string, over: Partial<PresenceMember> = {}): PresenceMember => ({
  userId,
  nickname: over.nickname ?? `nick-${userId}`,
  avatarVariant: over.avatarVariant ?? 1,
  publicUserId: over.publicUserId ?? `TF-${userId.toUpperCase()}`,
});

function members(): PresenceMember[] {
  return selectPresenceMembers(usePresenceStore.getState());
}

beforeEach(() => {
  usePresenceStore.getState().clear();
});

describe('usePresenceStore', () => {
  it('стартует пустым', () => {
    expect(members()).toEqual([]);
    expect(usePresenceStore.getState().workspaceId).toBeNull();
  });

  it('join добавляет участника и фиксирует workspaceId', () => {
    usePresenceStore.getState().join('ws-1', m('a'));
    expect(usePresenceStore.getState().workspaceId).toBe('ws-1');
    expect(members().map((x) => x.userId)).toEqual(['a']);
  });

  it('join нескольких + leave убирает нужного', () => {
    const s = usePresenceStore.getState();
    s.join('ws-1', m('a'));
    s.join('ws-1', m('b'));
    s.join('ws-1', m('c'));
    expect(members().map((x) => x.userId).sort()).toEqual(['a', 'b', 'c']);

    s.leave('b');
    expect(members().map((x) => x.userId).sort()).toEqual(['a', 'c']);
  });

  it('повторный join того же userId обновляет meta, не дублирует', () => {
    const s = usePresenceStore.getState();
    s.join('ws-1', m('a', { nickname: 'old' }));
    s.join('ws-1', m('a', { nickname: 'new' }));
    expect(members()).toHaveLength(1);
    expect(members()[0].nickname).toBe('new');
  });

  it('leave несуществующего — no-op', () => {
    usePresenceStore.getState().join('ws-1', m('a'));
    usePresenceStore.getState().leave('zzz');
    expect(members().map((x) => x.userId)).toEqual(['a']);
  });

  it('syncFrom заменяет список целиком (авторитетный снимок)', () => {
    const s = usePresenceStore.getState();
    s.join('ws-1', m('a'));
    s.join('ws-1', m('b'));
    s.syncFrom('ws-1', [m('c'), m('d')]);
    expect(members().map((x) => x.userId).sort()).toEqual(['c', 'd']);
  });

  it('clear сбрасывает участников и workspaceId', () => {
    const s = usePresenceStore.getState();
    s.join('ws-1', m('a'));
    s.clear();
    expect(members()).toEqual([]);
    expect(usePresenceStore.getState().workspaceId).toBeNull();
  });
});
