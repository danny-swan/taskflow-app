// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * Bug #5 — editor не администрирует справочник/настройки пространства.
 *
 * ADR 0005: owner=admin (справочник статусов/тегов/шаблонов + настройки),
 * editor=редактор ЗАДАЧ (в т.ч. смена status_id/tag_id конкретной задачи).
 *
 * Проверяем UI-гейт (useCanManageWorkspace → role === 'owner') на реальном
 * компонентном слое: мокаем ТОЛЬКО useStore, workspaceScope НЕ мокаем — тест
 * покрывает настоящую цепочку роль → гейт из (currentWorkspaceId, boundUserId,
 * workspaceMembers, workspaces).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Status, Tag, Task, TaskTemplate } from '../store/useStore';

const UID = 'user-abc';

const statuses: Status[] = [
  { id: 1, name: 'В работе', color: '#3b82f6', behavior: 'middle', sort_order: 1, is_seed: 1, is_technical: 0, hidden: 0, default_collapsed: 0, workspace_id: 'ws_s' } as Status,
  { id: 3, name: 'Выполнено', color: '#10b981', behavior: 'archive', sort_order: 2, is_seed: 1, is_technical: 0, hidden: 0, default_collapsed: 0, workspace_id: 'ws_s' } as Status,
];
const tags: Tag[] = [
  { id: 7, name: 'СРОЧНО', color: '#ef4444', workspace_id: 'ws_s' } as Tag,
];
const taskTemplates: TaskTemplate[] = [
  { id: 5, name: 'Шаблон А', title: 'Заголовок', comment: '', workspace_id: 'ws_s' } as TaskTemplate,
];

function makeState(role: 'owner' | 'editor' | 'viewer', kind: 'shared' | 'personal' = 'shared'): Record<string, unknown> {
  return {
    language: 'ru',
    statuses,
    tags,
    taskTemplates,
    workspaces: [{ id: 'ws_s', name: 'Shared', kind, owner_id: null, sort_order: 0 }],
    workspaceMembers: [{ id: 'm1', workspace_id: 'ws_s', user_id: UID, role, invited_by: null, joined_at: null }],
    boundUserId: UID,
    currentWorkspaceId: 'ws_s',
    overdueMode: 'calendar',
    setOverdueMode: vi.fn(),
    renameWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    addStatus: vi.fn(),
    updateStatus: vi.fn(),
    deleteStatus: vi.fn(),
    reorderStatuses: vi.fn(),
    addTag: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
    updateTemplate: vi.fn(),
    deleteTemplate: vi.fn(),
    addTemplate: vi.fn(),
    updateTask: vi.fn(),
    softDeleteTask: vi.fn(),
    pushToast: vi.fn(),
  };
}

let state: Record<string, unknown> = makeState('editor');

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

// Тяжёлые/несвязанные с гейтом записи компоненты — заглушки.
vi.mock('./TaskActivityLog', () => ({ TaskActivityLog: () => null }));
vi.mock('./MembersTab', () => ({ MembersTab: () => <div>members</div> }));
vi.mock('./WorkspaceHistoryTab', () => ({ WorkspaceHistoryTab: () => <div>history</div> }));

import { StatusesSection, TagsSection, TemplatesSection } from '../pages/Settings';
import { WorkspaceSettingsPage } from '../pages/WorkspaceSettings';
import { TaskModal } from './TaskModal';

const OWNER_ONLY_HINT = 'Только владелец пространства может менять статусы, тэги, шаблоны и настройки.';

function makeTask(): Task {
  return {
    id: 42, uuid: 'uuid-42', title: 'Починить кран', comment: '', tag_id: null,
    status_id: 1, start_date: null, deadline: null, finish_date: null,
    created_at: '2026-06-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
    sort_order: 0, archived: 0, workspace_id: 'ws_s',
  } as Task;
}

describe('StatusesSection — гейт справочника по роли (Bug #5)', () => {
  it('editor: нет «Добавить статус», виден owner-only хинт', () => {
    state = makeState('editor');
    render(<StatusesSection />);
    expect(screen.queryByRole('button', { name: 'Добавить статус' })).toBeNull();
    expect(screen.getByText(OWNER_ONLY_HINT)).toBeInTheDocument();
  });

  it('owner: «Добавить статус» доступна, хинта нет', () => {
    state = makeState('owner');
    render(<StatusesSection />);
    expect(screen.getByRole('button', { name: 'Добавить статус' })).toBeInTheDocument();
    expect(screen.queryByText(OWNER_ONLY_HINT)).toBeNull();
  });

  it('personal: владелец — полный доступ к статусам', () => {
    state = makeState('owner', 'personal');
    render(<StatusesSection />);
    expect(screen.getByRole('button', { name: 'Добавить статус' })).toBeInTheDocument();
  });
});

describe('TagsSection — гейт справочника по роли (Bug #5)', () => {
  it('editor: нет «Добавить тэг», поля тегов disabled', () => {
    state = makeState('editor');
    render(<TagsSection />);
    expect(screen.queryByRole('button', { name: 'Добавить тэг' })).toBeNull();
    expect(screen.getByText(OWNER_ONLY_HINT)).toBeInTheDocument();
    const nameInput = screen.getByDisplayValue('СРОЧНО') as HTMLInputElement;
    expect(nameInput.disabled).toBe(true);
  });

  it('owner: «Добавить тэг» доступна, поля активны', () => {
    state = makeState('owner');
    render(<TagsSection />);
    expect(screen.getByRole('button', { name: 'Добавить тэг' })).toBeInTheDocument();
    const nameInput = screen.getByDisplayValue('СРОЧНО') as HTMLInputElement;
    expect(nameInput.disabled).toBe(false);
  });
});

describe('TemplatesSection — гейт справочника по роли (Bug #5)', () => {
  it('editor: нет «Изменить»/«Удалить» шаблона, виден owner-only хинт', () => {
    state = makeState('editor');
    render(<TemplatesSection lang="ru" />);
    expect(screen.queryByRole('button', { name: 'Изменить' })).toBeNull();
    expect(screen.getByText(OWNER_ONLY_HINT)).toBeInTheDocument();
  });

  it('owner: «Изменить» шаблон доступно', () => {
    state = makeState('owner');
    render(<TemplatesSection lang="ru" />);
    expect(screen.getByRole('button', { name: 'Изменить' })).toBeInTheDocument();
  });
});

describe('DeadlinesSection (настройки ws) — гейт по роли (Bug #5)', () => {
  it('editor: переключатель режима просрочки disabled', () => {
    state = makeState('editor');
    render(<WorkspaceSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Дедлайны' }));
    const btn = screen.getByRole('button', { name: 'Календарные дни' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('owner: переключатель режима просрочки активен', () => {
    state = makeState('owner');
    render(<WorkspaceSettingsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Дедлайны' }));
    const btn = screen.getByRole('button', { name: 'Календарные дни' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

describe('TaskModal — editor правит ЗАДАЧУ, но не справочник (Bug #5)', () => {
  it('editor: может менять статус задачи и сохранять, но нет «Сохранить как шаблон» и «+» нового тэга', () => {
    state = makeState('editor');
    render(<TaskModal task={makeTask()} onClose={vi.fn()} />);
    // Смена статуса задачи (UPDATE sync_tasks) остаётся доступной editor'у.
    const comboboxes = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(comboboxes[0].disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument();
    // Справочник (новый тэг / шаблон) — недоступен.
    expect(screen.queryByText('Сохранить как шаблон')).toBeNull();
    expect(screen.queryByRole('button', { name: '+' })).toBeNull();
  });

  it('owner: доступны «Сохранить как шаблон» и «+» нового тэга', () => {
    state = makeState('owner');
    render(<TaskModal task={makeTask()} onClose={vi.fn()} />);
    expect(screen.getByText('Сохранить как шаблон')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+' })).toBeInTheDocument();
  });
});
