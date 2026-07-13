// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// RTL-тесты PresenceIndicator (Wave C, PR-c-01): рендер N аватарок, «+N» при
// переполнении, тултип nickname/fallback TF-ID, скрытие на personal и при
// пустом списке.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { usePresenceStore, type PresenceMember } from '../store/usePresenceStore';

// language берём напрямую, kind — через мок workspaceScope.
vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector({ language: 'ru' }),
}));

let currentWorkspace: { id: string; kind: string } | null;
vi.mock('../store/workspaceScope', () => ({
  useCurrentWorkspace: () => currentWorkspace,
}));

import { PresenceIndicator } from './PresenceIndicator';

const mk = (userId: string, over: Partial<PresenceMember> = {}): PresenceMember => ({
  userId,
  nickname: 'nickname' in over ? over.nickname! : `Ник ${userId}`,
  avatarVariant: over.avatarVariant ?? 1,
  publicUserId: over.publicUserId ?? `TF-${userId.toUpperCase()}`,
});

function seed(ws: string, list: PresenceMember[]) {
  usePresenceStore.getState().syncFrom(ws, list);
}

beforeEach(() => {
  usePresenceStore.getState().clear();
  currentWorkspace = { id: 'ws-1', kind: 'shared' };
});

describe('PresenceIndicator', () => {
  it('не рендерится на personal-пространстве', () => {
    currentWorkspace = { id: 'p1', kind: 'personal' };
    seed('p1', [mk('a')]);
    render(<PresenceIndicator />);
    expect(screen.queryByTestId('presence-indicator')).toBeNull();
  });

  it('не рендерится при пустом списке (я один)', () => {
    seed('ws-1', []);
    render(<PresenceIndicator />);
    expect(screen.queryByTestId('presence-indicator')).toBeNull();
  });

  it('рендерит N аватарок без переполнения (<= 5)', () => {
    seed('ws-1', [mk('a'), mk('b'), mk('c')]);
    render(<PresenceIndicator />);
    expect(screen.getAllByTestId('presence-avatar')).toHaveLength(3);
    expect(screen.queryByTestId('presence-overflow')).toBeNull();
  });

  it('ровно 5 — без бейджа «+N»', () => {
    seed('ws-1', [mk('a'), mk('b'), mk('c'), mk('d'), mk('e')]);
    render(<PresenceIndicator />);
    expect(screen.getAllByTestId('presence-avatar')).toHaveLength(5);
    expect(screen.queryByTestId('presence-overflow')).toBeNull();
  });

  it('переполнение (7) → 4 аватарки + «+3»', () => {
    seed('ws-1', ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => mk(id)));
    render(<PresenceIndicator />);
    expect(screen.getAllByTestId('presence-avatar')).toHaveLength(4);
    expect(screen.getByTestId('presence-overflow').textContent).toBe('+3');
  });

  it('тултип: nickname, если задан', () => {
    seed('ws-1', [mk('a', { nickname: 'Алиса' })]);
    render(<PresenceIndicator />);
    expect(screen.getByTitle('Алиса')).toBeTruthy();
  });

  it('тултип: fallback на public_user_id (TF-XXXXXX), если nickname пустой/null', () => {
    seed('ws-1', [
      mk('a', { nickname: null, publicUserId: 'TF-AAA111' }),
      mk('b', { nickname: '   ', publicUserId: 'TF-BBB222' }),
    ]);
    render(<PresenceIndicator />);
    expect(screen.getByTitle('TF-AAA111')).toBeTruthy();
    expect(screen.getByTitle('TF-BBB222')).toBeTruthy();
  });
});
