// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Bug C — терпимые lookup'ы status/tag в TaskModal.
//
// После смены пространства / pull задача может ссылаться на status_id или
// tag_id, которых нет в наборе текущего ws. Проверяем, что модалка не падает
// (белый экран), а резолвит статус в первый доступный не-технический, тэг — в
// «—», и что при пустом наборе статусов рендер тоже не бросает.
import { render, screen } from '@testing-library/react';
import { forwardRef } from 'react';
import { describe, it, expect, vi } from 'vitest';
import type { Status, Tag, Task } from '../store/useStore';

const statuses: Status[] = [
  { id: 10, name: 'В работе', color: '#3b82f6', behavior: 'middle', sort_order: 1, is_seed: 1, is_technical: 0, hidden: 0, default_collapsed: 0 },
  { id: 11, name: 'Готово', color: '#10b981', behavior: 'archive', sort_order: 2, is_seed: 1, is_technical: 0, hidden: 0, default_collapsed: 0 },
  { id: 99, name: '__tech__', color: '#000', behavior: 'middle', sort_order: 9, is_seed: 0, is_technical: 1, hidden: 1, default_collapsed: 0 },
];
const tags: Tag[] = [{ id: 5, name: 'ДОМ', color: '#5B7FB8', sort_order: 0 }];

const state: Record<string, unknown> = {
  language: 'ru',
  workspaces: [],
  currentWorkspaceId: 'ws_x',
  updateTask: vi.fn(),
  softDeleteTask: vi.fn(),
  addTag: vi.fn(() => 7),
  addTemplate: vi.fn(() => 1),
  pushToast: vi.fn(),
};

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

vi.mock('../store/workspaceScope', () => ({
  useCurrentWorkspaceStatuses: () => currentStatuses,
  useCurrentWorkspaceTags: () => tags,
  useCanEdit: () => true,
  useCanManageWorkspace: () => true,
}));

// Лёгкие заглушки тяжёлых детей — тест про lookup-логику, не про них.
vi.mock('./Modal', () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
}));
vi.mock('./EmojiPicker', () => ({
  EmojiPicker: () => null,
  useEmojiPicker: () => ({
    emojiButtonProps: { onClick: vi.fn() },
    buttonRef: { current: null },
    emojiPickerProps: {},
  }),
}));
vi.mock('./PromptDialog', () => ({
  usePrompt: () => ({ prompt: vi.fn(), PromptUI: () => null }),
}));
vi.mock('./DatePicker', () => ({ DatePicker: () => null }));
vi.mock('./TaskActivityLog', () => ({ TaskActivityLog: () => null }));
vi.mock('./AutoGrowTextarea', () => ({
  AutoGrowTextarea: forwardRef<HTMLTextAreaElement, any>((props, ref) => (
    <textarea ref={ref} value={props.value} onChange={props.onChange} />
  )),
}));

let currentStatuses: Status[] = statuses;

import { TaskModal } from './TaskModal';

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 1, title: 'T', comment: '', tag_id: null, status_id: 10,
    start_date: null, deadline: null, finish_date: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    sort_order: 0, archived: 0,
    ...overrides,
  };
}

describe('TaskModal — терпимые lookup status/tag (Bug C)', () => {
  it('dangling status_id → резолвится в первый не-технический, без падения', () => {
    currentStatuses = statuses;
    const task = makeTask({ status_id: 12345 }); // такого статуса нет
    render(<TaskModal task={task} onClose={vi.fn()} />);
    const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    // Резолв в первый доступный не-технический (id=10), а не пустой value.
    expect(select.value).toBe('10');
    // Технический статус не попал в опции.
    expect(screen.queryByRole('option', { name: '__tech__' })).toBeNull();
  });

  it('dangling tag_id → показывается «—» (null)', () => {
    currentStatuses = statuses;
    const task = makeTask({ tag_id: 999 }); // такого тэга нет
    render(<TaskModal task={task} onClose={vi.fn()} />);
    const tagSelect = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
    expect(tagSelect.value).toBe('');
  });

  it('пустой набор статусов не роняет рендер', () => {
    currentStatuses = [];
    const task = makeTask({ status_id: 10 });
    expect(() => render(<TaskModal task={task} onClose={vi.fn()} />)).not.toThrow();
  });
});
