// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Unit-тесты presence.ts (Wave C, PR-c-01): создание presence-канала, track на
// SUBSCRIBED, обработка sync/join/leave (с исключением себя) и очистка на
// unsubscribe. Supabase Realtime channel полностью замокан.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Мок Supabase-канала ─────────────────────────────────────────────────────
type Handler = (payload?: any) => void;

function makeChannel() {
  const handlers: Record<string, Handler> = {};
  let subscribeCb: ((status: string) => void) | undefined;
  let state: Record<string, any[]> = {};
  const ch: any = {
    on(_type: string, filter: { event: string }, cb: Handler) {
      handlers[filter.event] = cb;
      return ch;
    },
    subscribe(cb: (status: string) => void) {
      subscribeCb = cb;
      return ch;
    },
    track: vi.fn(async () => {}),
    untrack: vi.fn(async () => {}),
    presenceState: () => state,
    // тест-хелперы
    _fire: (event: string, payload?: any) => handlers[event]?.(payload),
    _connect: () => subscribeCb?.('SUBSCRIBED'),
    _setState: (s: Record<string, any[]>) => { state = s; },
  };
  return ch;
}

let lastChannel: any;
const channelSpy = vi.fn((name: string, config: any) => {
  lastChannel = makeChannel();
  lastChannel._name = name;
  lastChannel._config = config;
  return lastChannel;
});
const removeChannel = vi.fn(async (_c: any) => {});

vi.mock('./supabase', () => ({
  supabase: {
    channel: (name: string, config: any) => channelSpy(name, config),
    removeChannel: (c: any) => removeChannel(c),
  },
}));

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// presence.ts тянет useStore (для хука) — заглушаем, чтобы не поднимать БД.
vi.mock('../store/useStore', () => ({ useStore: vi.fn() }));
// fetchProfile используется только хуком — здесь тестируем subscribe-функцию.
vi.mock('./profile', () => ({ fetchProfile: vi.fn(async () => null) }));

import { subscribeWorkspacePresence } from './presence';
import { usePresenceStore, selectPresenceMembers } from '../store/usePresenceStore';

const PROFILE = {
  userId: 'me',
  nickname: 'Я',
  avatarVariant: 3,
  publicUserId: 'TF-ME0001',
};

const meta = (n: string, v = 1, pid = 'TF-X') => ({
  nickname: n,
  avatar_variant: v,
  public_user_id: pid,
  presence_ref: `ref-${Math.random()}`,
});

function members() {
  return selectPresenceMembers(usePresenceStore.getState());
}

beforeEach(() => {
  channelSpy.mockClear();
  removeChannel.mockClear();
  usePresenceStore.getState().clear();
});

describe('subscribeWorkspacePresence', () => {
  it('создаёт канал presence-ws-<id> с ключом presence = userId', () => {
    subscribeWorkspacePresence('ws-1', PROFILE);
    expect(lastChannel._name).toBe('presence-ws-ws-1');
    expect(lastChannel._config).toEqual({ config: { presence: { key: 'me' } } });
  });

  it('track вызывается на SUBSCRIBED с публичным meta (без email)', () => {
    subscribeWorkspacePresence('ws-1', PROFILE);
    lastChannel._connect();
    expect(lastChannel.track).toHaveBeenCalledWith({
      nickname: 'Я',
      avatar_variant: 3,
      public_user_id: 'TF-ME0001',
    });
    // никаких email-полей в meta.
    const arg = lastChannel.track.mock.calls[0][0];
    expect(Object.keys(arg)).not.toContain('email');
  });

  it('join чужого пользователя добавляет его в стор', () => {
    subscribeWorkspacePresence('ws-1', PROFILE);
    lastChannel._fire('join', { key: 'other', newPresences: [meta('Друг', 2, 'TF-FR0002')] });
    expect(members()).toHaveLength(1);
    expect(members()[0]).toMatchObject({
      userId: 'other',
      nickname: 'Друг',
      avatarVariant: 2,
      publicUserId: 'TF-FR0002',
    });
  });

  it('join самого себя игнорируется (не показываем свою аватарку)', () => {
    subscribeWorkspacePresence('ws-1', PROFILE);
    lastChannel._fire('join', { key: 'me', newPresences: [meta('Я', 3, 'TF-ME0001')] });
    expect(members()).toHaveLength(0);
  });

  it('leave убирает пользователя', () => {
    subscribeWorkspacePresence('ws-1', PROFILE);
    lastChannel._fire('join', { key: 'other', newPresences: [meta('Друг')] });
    expect(members()).toHaveLength(1);
    lastChannel._fire('leave', { key: 'other', leftPresences: [] });
    expect(members()).toHaveLength(0);
  });

  it('sync пересобирает список из presenceState, исключая себя', () => {
    subscribeWorkspacePresence('ws-1', PROFILE);
    lastChannel._setState({
      me: [meta('Я', 3, 'TF-ME0001')],
      u1: [meta('Один', 1, 'TF-U10001')],
      u2: [meta('Два', 4, 'TF-U20002')],
    });
    lastChannel._fire('sync');
    expect(members().map((x) => x.userId).sort()).toEqual(['u1', 'u2']);
  });

  it('unsubscribe: untrack + removeChannel + очистка стора', () => {
    const unsub = subscribeWorkspacePresence('ws-1', PROFILE);
    lastChannel._fire('join', { key: 'other', newPresences: [meta('Друг')] });
    expect(members()).toHaveLength(1);

    unsub();
    expect(lastChannel.untrack).toHaveBeenCalled();
    expect(removeChannel).toHaveBeenCalledWith(lastChannel);
    expect(members()).toHaveLength(0);
    expect(usePresenceStore.getState().workspaceId).toBeNull();
  });
});
