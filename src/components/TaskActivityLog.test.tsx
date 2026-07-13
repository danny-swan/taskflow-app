// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Рендер-тесты TaskActivityLog (Wave C, PR-c-03): свёрнуто по умолчанию,
// разворот вызывает загрузку, резолв автора (вы/presence-ник/короткий id),
// пустое состояние и «Показать ещё».
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ActivityRecord } from '../store/useTaskActivityStore';

let storeState: any;
let presenceState: any;
let activityResult: any;
const loadMore = vi.fn();

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector(storeState),
}));
vi.mock('../store/usePresenceStore', () => ({
  usePresenceStore: (selector: (s: any) => unknown) => selector(presenceState),
}));
vi.mock('../store/useTaskActivityStore', () => ({
  useTaskActivity: (taskUuid: string | null | undefined) => {
    // Пустой результат, пока секция свёрнута (taskUuid=null).
    if (!taskUuid) return { records: [], hasMore: false, loadMore, reload: vi.fn() };
    return activityResult;
  },
}));

import { TaskActivityLog } from './TaskActivityLog';

function rec(over: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: `log-${Math.random().toString(36).slice(2)}`,
    taskId: 't1',
    workspaceId: 'ws1',
    userId: 'author-uuid-1234567890',
    kind: 'status_changed',
    payload: {},
    createdAt: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => {
  loadMore.mockReset();
  storeState = { language: 'ru', boundUserId: 'me-uuid' };
  presenceState = { byId: {} };
  activityResult = { records: [], hasMore: false, loadMore, reload: vi.fn() };
});

describe('TaskActivityLog', () => {
  it('свёрнут по умолчанию — записи не отрендерены', () => {
    activityResult = { records: [rec()], hasMore: false, loadMore, reload: vi.fn() };
    render(<TaskActivityLog taskUuid="t1" />);
    // Заголовок-кнопка есть, но список ещё не раскрыт.
    expect(screen.getByRole('button', { name: /История изменений/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('разворот показывает пустое состояние', () => {
    render(<TaskActivityLog taskUuid="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /История изменений/i }));
    expect(screen.getByText(/Пока нет изменений/i)).toBeTruthy();
  });

  it('автор «вы» когда userId === boundUserId', () => {
    activityResult = { records: [rec({ userId: 'me-uuid' })], hasMore: false, loadMore, reload: vi.fn() };
    render(<TaskActivityLog taskUuid="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /История изменений/i }));
    expect(screen.getByText('вы')).toBeTruthy();
  });

  it('автор — ник из presence', () => {
    presenceState = { byId: { 'author-uuid-1234567890': { nickname: 'Алиса', publicUserId: 'TF-AAA11', avatarVariant: 3 } } };
    activityResult = { records: [rec()], hasMore: false, loadMore, reload: vi.fn() };
    render(<TaskActivityLog taskUuid="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /История изменений/i }));
    expect(screen.getByText('Алиса')).toBeTruthy();
  });

  it('офлайн-автор — короткий id (не email)', () => {
    activityResult = { records: [rec({ userId: 'abcdef01-2345-6789' })], hasMore: false, loadMore, reload: vi.fn() };
    render(<TaskActivityLog taskUuid="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /История изменений/i }));
    expect(screen.getByText('abcdef01')).toBeTruthy();
  });

  it('«Показать ещё» рендерится и дёргает loadMore', () => {
    activityResult = { records: [rec()], hasMore: true, loadMore, reload: vi.fn() };
    render(<TaskActivityLog taskUuid="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /История изменений/i }));
    const more = screen.getByRole('button', { name: /Показать ещё/i });
    fireEvent.click(more);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('нет «Показать ещё» когда hasMore=false', () => {
    activityResult = { records: [rec()], hasMore: false, loadMore, reload: vi.fn() };
    render(<TaskActivityLog taskUuid="t1" />);
    fireEvent.click(screen.getByRole('button', { name: /История изменений/i }));
    expect(screen.queryByRole('button', { name: /Показать ещё/i })).toBeNull();
  });
});
