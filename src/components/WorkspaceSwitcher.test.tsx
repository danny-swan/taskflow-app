// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Рендер-тесты переключателя пространств (Wave B, PR-b-05).
//
// Проверяет: сплит «Личные»/«Общие», role-badge (editor/viewer — есть,
// owner/personal — нет), пустое состояние секции «Общие» с TF-ID, сортировку
// (активный первым, остальные по алфавиту).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let workspaces: any[];
let current: any;
let roles: Record<string, any>;
let canEdit = true;
const switchWorkspace = vi.fn();

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector({ language: 'ru', switchWorkspace }),
}));

vi.mock('../store/workspaceScope', () => ({
  useWorkspaces: () => workspaces,
  useCurrentWorkspace: () => current,
  useCanEdit: () => canEdit,
  useWorkspaceRoles: () => roles,
}));

vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));

let profile: any;
vi.mock('../lib/profile', () => ({ useProfile: () => ({ profile }) }));

// CreateWorkspaceModal тянет тяжёлые зависимости — заглушаем.
vi.mock('./CreateWorkspaceModal', () => ({ CreateWorkspaceModal: () => null }));

import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const ws = (id: string, name: string, kind: 'personal' | 'shared') =>
  ({ id, name, kind, owner_id: null, sort_order: 0 });

function renderOpen() {
  const utils = render(<MemoryRouter><WorkspaceSwitcher /></MemoryRouter>);
  fireEvent.click(screen.getByLabelText('Переключить пространство'));
  return utils;
}

beforeEach(() => {
  switchWorkspace.mockReset();
  canEdit = true;
  profile = { public_user_id: 'TF-ME123' };
  roles = {};
});

describe('WorkspaceSwitcher — сплит секций', () => {
  it('разбивает список на «Личные» и «Общие» по kind', () => {
    workspaces = [ws('p1', 'Личное', 'personal'), ws('s1', 'Команда', 'shared')];
    current = workspaces[0];
    roles = { p1: 'owner', s1: 'editor' };
    renderOpen();

    const personal = screen.getByText('Личные').closest('[data-section="personal"]')!;
    const shared = screen.getByText('Общие').closest('[data-section="shared"]')!;
    expect(within(personal as HTMLElement).getByText('Личное')).toBeTruthy();
    expect(within(shared as HTMLElement).getByText('Команда')).toBeTruthy();
  });

  it('клик по пространству вызывает switchWorkspace', () => {
    workspaces = [ws('p1', 'Личное', 'personal'), ws('s1', 'Команда', 'shared')];
    current = workspaces[0];
    roles = { p1: 'owner', s1: 'editor' };
    renderOpen();
    fireEvent.click(screen.getByText('Команда'));
    expect(switchWorkspace).toHaveBeenCalledWith('s1');
  });
});

describe('WorkspaceSwitcher — role-badge', () => {
  it('editor и viewer показывают badge; owner (shared) и personal — нет', () => {
    workspaces = [
      ws('p1', 'Личное', 'personal'),
      ws('se', 'Редакторское', 'shared'),
      ws('sv', 'Наблюдательское', 'shared'),
      ws('so', 'Владельческое', 'shared'),
    ];
    current = workspaces[0];
    roles = { p1: 'owner', se: 'editor', sv: 'viewer', so: 'owner' };
    renderOpen();

    const personal = screen.getByText('Личные').closest('[data-section="personal"]') as HTMLElement;
    const shared = screen.getByText('Общие').closest('[data-section="shared"]') as HTMLElement;

    // Personal без badge.
    const personalBtn = within(personal).getByText('Личное').closest('button')!;
    expect(personalBtn.querySelector('[data-role]')).toBeNull();

    // Editor → badge editor.
    const editorBtn = within(shared).getByText('Редакторское').closest('button')!;
    expect(editorBtn.querySelector('[data-role="editor"]')).not.toBeNull();

    // Viewer → badge viewer.
    const viewerBtn = within(shared).getByText('Наблюдательское').closest('button')!;
    expect(viewerBtn.querySelector('[data-role="viewer"]')).not.toBeNull();

    // Shared-owner → без badge.
    const ownerBtn = within(shared).getByText('Владельческое').closest('button')!;
    expect(ownerBtn.querySelector('[data-role]')).toBeNull();
  });
});

describe('WorkspaceSwitcher — пустое состояние «Общие»', () => {
  it('0 shared → hint с TF-ID пользователя', () => {
    workspaces = [ws('p1', 'Личное', 'personal')];
    current = workspaces[0];
    roles = { p1: 'owner' };
    renderOpen();

    expect(screen.getByText('Общие')).toBeTruthy();
    const hint = screen.getByTestId('ws-shared-empty');
    expect(hint.textContent).toContain('TF-ME123');
  });

  it('без загруженного профиля → hint с плейсхолдером TF', () => {
    profile = null;
    workspaces = [ws('p1', 'Личное', 'personal')];
    current = workspaces[0];
    roles = { p1: 'owner' };
    renderOpen();
    expect(screen.getByTestId('ws-shared-empty').textContent).toContain('TF-');
  });
});

describe('WorkspaceSwitcher — сортировка', () => {
  it('активный первым, остальные по алфавиту', () => {
    workspaces = [
      ws('p1', 'Яблоко', 'personal'),
      ws('p2', 'Банан', 'personal'),
      ws('p3', 'Абрикос', 'personal'),
    ];
    current = workspaces[1]; // Банан — активный
    roles = { p1: 'owner', p2: 'owner', p3: 'owner' };
    renderOpen();

    const section = screen.getByText('Личные').closest('[data-section="personal"]')!;
    const names = within(section as HTMLElement)
      .getAllByRole('button')
      .map(b => b.textContent?.trim());
    expect(names).toEqual(['Банан', 'Абрикос', 'Яблоко']);
  });
});
