// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// F51 — аватар текущего пользователя в журнале активности.
//
// Баг: в ветке «это я» задавалась только подпись «вы», а variant/color
// оставались дефолтными (1/null), поэтому в «Истории» пользователь видел у себя
// серую заглушку, хотя на вкладке «Участники» его аватар рисовался верно.
// Presence тут не спасает: usePresenceStore.byId сознательно не содержит
// самого себя. Источник истины — кэш публичных профилей (F40, ADR 0031).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ActivityRecord } from '../store/useTaskActivityStore';
import type { MemberProfile } from '../lib/memberProfiles';

let storeState: Record<string, unknown>;
let presenceState: { byId: Record<string, unknown> };
let cache: Record<string, MemberProfile>;

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: Record<string, unknown>) => unknown) => selector(storeState),
}));
vi.mock('../store/usePresenceStore', () => ({
  usePresenceStore: (selector: (s: typeof presenceState) => unknown) => selector(presenceState),
}));
vi.mock('../lib/memberProfiles', () => ({
  lookupCachedMemberProfile: (id: string | null | undefined) => (id ? cache[id] : undefined),
}));

import { ActivityAuthorRow } from './ActivityEntry';

const ME = 'dc3e4f8e-8453-4df0-adf8-a528ea820c02';

function profile(over: Partial<MemberProfile> = {}): MemberProfile {
  return {
    user_id: ME,
    public_user_id: 'TF-7EDA2R',
    nickname: 'Daniil Lebedev',
    avatar_variant: 5,
    avatar_color: '#fc1d1d',
    bio: null,
    ...over,
  };
}

function rec(over: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: 'log-1',
    taskId: 't1',
    workspaceId: 'ws1',
    userId: ME,
    kind: 'status_changed',
    payload: {},
    createdAt: new Date().toISOString(),
    ...over,
  } as ActivityRecord;
}

/** Обёртка аватара: Avatar кладёт цвет в inline-style на внешний <span>. */
function avatarEl(root: HTMLElement): HTMLElement {
  const el = root.querySelector('li > span');
  if (!el) throw new Error('аватар не отрендерен');
  return el as HTMLElement;
}

beforeEach(() => {
  storeState = { language: 'ru', boundUserId: ME };
  presenceState = { byId: {} };
  cache = {};
});

describe('ActivityAuthorRow — своя строка (F51)', () => {
  it('подпись остаётся «вы»', () => {
    cache[ME] = profile();
    render(<ul><ActivityAuthorRow record={rec()} lang="ru" /></ul>);
    expect(screen.getByText('вы')).toBeTruthy();
  });

  it('аватар берётся из кэша профилей, а не заглушка', () => {
    cache[ME] = profile();
    const { container } = render(<ul><ActivityAuthorRow record={rec()} lang="ru" /></ul>);
    // Цвет из профиля должен реально примениться к аватару.
    expect(avatarEl(container).style.color).toBe('rgb(252, 29, 29)');
    // Заглушка узнаётся по классу темы вместо явного цвета.
    expect(avatarEl(container).className).not.toContain('bg-surface-alt');
  });

  it('своя и чужая строка с разными профилями дают разные аватары', () => {
    const other = 'c40d7b5c-2037-40cf-822e-8b7173f0c509';
    cache[ME] = profile();
    cache[other] = profile({ user_id: other, public_user_id: 'TF-Z8TSB7', nickname: 'Lucy', avatar_variant: 2, avatar_color: '#e0803c' });
    const mine = render(<ul><ActivityAuthorRow record={rec()} lang="ru" /></ul>);
    const mineHtml = mine.container.innerHTML;
    expect(avatarEl(mine.container).style.color).toBe('rgb(252, 29, 29)');
    mine.unmount();
    const theirs = render(<ul><ActivityAuthorRow record={rec({ userId: other })} lang="ru" /></ul>);
    expect(avatarEl(theirs.container).style.color).toBe('rgb(224, 128, 60)');
    expect(mineHtml).not.toBe(theirs.container.innerHTML);
  });

  it('без кэша не падает — остаётся дефолтный аватар и подпись «вы»', () => {
    const { container } = render(<ul><ActivityAuthorRow record={rec()} lang="ru" /></ul>);
    expect(screen.getByText('вы')).toBeTruthy();
    expect(avatarEl(container).style.color).toBe('');
  });
});
