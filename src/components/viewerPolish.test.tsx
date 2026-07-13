/**
 * Wave C PR-c-05 — read-only полировка для роли viewer в shared-пространстве.
 *
 * Проверяем UX-гейт (useCanEdit) на уровне компонентов: у viewer'а элементы
 * записи скрыты/задизейблены, у editor'а — доступны. Роль вычисляется реально
 * (useCanEdit → useCurrentWorkspaceRole) из замоканного состояния store по
 * (currentWorkspaceId, boundUserId, workspaceMembers) — саму workspaceScope НЕ
 * мокаем, чтобы тест покрывал настоящую цепочку.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Status, Task } from '../store/useStore';

const UID = 'user-abc';

const statuses: Status[] = [
  { id: 1, name: 'В работе', color: '#3b82f6', behavior: 'middle', sort_order: 1, is_seed: 1, is_technical: 0, hidden: 0, default_collapsed: 0, workspace_id: 'ws_s' } as Status,
  { id: 3, name: 'Выполнено', color: '#10b981', behavior: 'archive', sort_order: 2, is_seed: 1, is_technical: 0, hidden: 0, default_collapsed: 0, workspace_id: 'ws_s' } as Status,
];

function makeState(role: 'viewer' | 'editor'): Record<string, unknown> {
  return {
    language: 'ru',
    statuses,
    tags: [],
    workspaces: [{ id: 'ws_s', name: 'Shared', kind: 'shared', owner_id: null, sort_order: 0 }],
    workspaceMembers: [{ id: 'm1', workspace_id: 'ws_s', user_id: UID, role, invited_by: null, joined_at: null }],
    boundUserId: UID,
    currentWorkspaceId: 'ws_s',
    overdueMode: 'calendar',
    updateTask: vi.fn(),
    softDeleteTask: vi.fn(),
    addTag: vi.fn(),
    addTemplate: vi.fn(),
    pushToast: vi.fn(),
  };
}

// Мутабельная ссылка — переопределяем перед каждым render'ом.
let state: Record<string, unknown> = makeState('viewer');

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

// TaskActivityLog тянет собственный store и БД — не относится к гейту записи.
vi.mock('./TaskActivityLog', () => ({ TaskActivityLog: () => null }));

import { TaskCard } from './TaskCard';
import { TaskModal } from './TaskModal';

function makeTask(): Task {
  return {
    id: 42,
    uuid: 'uuid-42',
    title: 'Починить кран',
    comment: 'привет',
    tag_id: null,
    status_id: 1,
    start_date: null,
    deadline: null,
    finish_date: null,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    sort_order: 0,
    archived: 0,
    workspace_id: 'ws_s',
  } as Task;
}

describe('TaskCard — гейт записи по роли', () => {
  it('viewer: кнопки удаления/готово/перетаскивания скрыты', () => {
    state = makeState('viewer');
    render(<TaskCard task={makeTask()} onOpenModal={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отметить выполненной' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Перетащить' })).toBeNull();
  });

  it('editor: кнопки удаления/готово/перетаскивания присутствуют', () => {
    state = makeState('editor');
    render(<TaskCard task={makeTask()} onOpenModal={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отметить выполненной' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Перетащить' })).toBeInTheDocument();
  });
});

describe('TaskModal — гейт записи по роли', () => {
  it('viewer: нет «Сохранить»/«Удалить», поля disabled, есть read-only tooltip', () => {
    state = makeState('viewer');
    render(<TaskModal task={makeTask()} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Сохранить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
    // Кнопка закрытия называется «Закрыть» (не «Отмена») у viewer.
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument();
    // Поле «Название» задизейблено.
    const title = screen.getByDisplayValue('Починить кран') as HTMLTextAreaElement;
    expect(title.disabled).toBe(true);
    // Tooltip read-only присутствует (на select статуса).
    expect(
      document.querySelector('[title="Только просмотр. Обратитесь к владельцу или редактору."]'),
    ).not.toBeNull();
  });

  it('editor: есть «Сохранить»/«Удалить», поле активно', () => {
    state = makeState('editor');
    render(<TaskModal task={makeTask()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
    const title = screen.getByDisplayValue('Починить кран') as HTMLTextAreaElement;
    expect(title.disabled).toBe(false);
  });
});
