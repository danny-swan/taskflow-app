// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Тесты слоя публичных профилей участников (F40, ADR 0031).
//
// Контракт: RPC get_workspace_member_profiles отдаёт публичный минимум (без
// email); клиент нормализует строки, кэширует их в localStorage (чтобы имена не
// «мигали» в офлайне) и показывает ник, иначе TF-id.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('./supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('./logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  normalizeMemberProfileRow,
  fetchWorkspaceMemberProfiles,
  memberDisplayName,
  readMemberProfileCache,
  resetMemberProfileCache,
  lookupCachedMemberProfile,
  type MemberProfile,
} from './memberProfiles';

const row = (over: Record<string, unknown> = {}) => ({
  user_id: 'u1',
  public_user_id: 'TF-AAA111',
  nickname: null,
  avatar_variant: 1,
  avatar_color: null,
  bio: null,
  ...over,
});

beforeEach(() => {
  rpc.mockReset();
  localStorage.clear();
  resetMemberProfileCache();
});

describe('normalizeMemberProfileRow', () => {
  it('приводит строку RPC к контракту', () => {
    const p = normalizeMemberProfileRow(row({ nickname: 'Даниил', avatar_variant: '6', avatar_color: '#ff8800', bio: 'привет' }));
    expect(p).toEqual({
      user_id: 'u1',
      public_user_id: 'TF-AAA111',
      nickname: 'Даниил',
      avatar_variant: 6,
      avatar_color: '#ff8800',
      bio: 'привет',
    });
  });

  it('отбрасывает строки без user_id или public_user_id', () => {
    expect(normalizeMemberProfileRow(row({ user_id: null }))).toBeNull();
    expect(normalizeMemberProfileRow(row({ public_user_id: undefined }))).toBeNull();
  });

  it('битый avatar_variant падает на 1', () => {
    expect(normalizeMemberProfileRow(row({ avatar_variant: 'нет' }))?.avatar_variant).toBe(1);
    expect(normalizeMemberProfileRow(row({ avatar_variant: null }))?.avatar_variant).toBe(1);
  });
});

describe('fetchWorkspaceMemberProfiles', () => {
  it('вызывает RPC с id пространства и фильтрует мусор', async () => {
    rpc.mockResolvedValue({ data: [row(), row({ user_id: null }), row({ user_id: 'u2', public_user_id: 'TF-BBB222' })], error: null });
    const list = await fetchWorkspaceMemberProfiles('ws_1');
    expect(rpc).toHaveBeenCalledWith('get_workspace_member_profiles', { p_workspace_id: 'ws_1' });
    expect(list.map(p => p.user_id)).toEqual(['u1', 'u2']);
  });

  it('пустой ответ — легальный (не участник / нет данных)', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchWorkspaceMemberProfiles('ws_1')).resolves.toEqual([]);
  });

  it('ошибка RPC пробрасывается наружу', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('permission denied') });
    await expect(fetchWorkspaceMemberProfiles('ws_1')).rejects.toThrow('permission denied');
  });

  it('в ответе нет email-поля (публичный минимум)', async () => {
    rpc.mockResolvedValue({ data: [row({ email: 'a@b.c' })], error: null });
    const [p] = await fetchWorkspaceMemberProfiles('ws_1');
    expect(Object.keys(p)).not.toContain('email');
  });
});

describe('кэш публичных профилей', () => {
  it('пустой и битый localStorage не ломают чтение', () => {
    expect(readMemberProfileCache()).toEqual({});
    localStorage.setItem('tf.memberProfiles.v1', '{не json');
    resetMemberProfileCache();
    expect(readMemberProfileCache()).toEqual({});
    localStorage.setItem('tf.memberProfiles.v1', '[1,2,3]');
    resetMemberProfileCache();
    expect(readMemberProfileCache()).toEqual({});
  });

  it('lookupCachedMemberProfile находит профиль по user_id', () => {
    const p: MemberProfile = {
      user_id: 'u9', public_user_id: 'TF-CCC333', nickname: 'Ник', avatar_variant: 3, avatar_color: '#4fa35b', bio: null,
    };
    localStorage.setItem('tf.memberProfiles.v1', JSON.stringify({ u9: p }));
    resetMemberProfileCache();
    expect(lookupCachedMemberProfile('u9')).toEqual(p);
    expect(lookupCachedMemberProfile('нет-такого')).toBeUndefined();
    expect(lookupCachedMemberProfile(null)).toBeUndefined();
  });
});

describe('memberDisplayName', () => {
  it('ник, если он задан', () => {
    expect(memberDisplayName(normalizeMemberProfileRow(row({ nickname: 'Даниил' }))!)).toBe('Даниил');
  });

  it('TF-id, если ник пустой или из пробелов', () => {
    expect(memberDisplayName(normalizeMemberProfileRow(row())!)).toBe('TF-AAA111');
    expect(memberDisplayName(normalizeMemberProfileRow(row({ nickname: '   ' }))!)).toBe('TF-AAA111');
  });

  it('без профиля — null (вызывающий покажет нейтральную подпись)', () => {
    expect(memberDisplayName(undefined)).toBeNull();
  });
});
