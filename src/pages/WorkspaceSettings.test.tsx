// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Тесты вкладок WorkspaceSettings (Wave C, PR-c-04): вкладка «История» видна
// ТОЛЬКО в shared-пространстве и доступна всем ролям (owner/editor/viewer);
// в personal-пространстве вкладки «История» и «Участники» отсутствуют.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let storeState: any;
let currentWs: any;
let currentRole: any;

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector(storeState),
}));
vi.mock('../store/workspaceScope', () => ({
  useCurrentWorkspace: () => currentWs,
  useCurrentWorkspaceRole: () => currentRole,
}));
vi.mock('./Settings', () => ({
  StatusesSection: () => <div>statuses-section</div>,
  TagsSection: () => <div>tags-section</div>,
}));
vi.mock('../components/MembersTab', () => ({ MembersTab: () => <div>members-tab</div> }));
vi.mock('../components/WorkspaceHistoryTab', () => ({ WorkspaceHistoryTab: () => <div>history-tab</div> }));
vi.mock('../components/ConfirmDialog', () => ({ ConfirmDialog: () => null }));

import { WorkspaceSettingsPage } from './WorkspaceSettings';

beforeEach(() => {
  storeState = {
    language: 'ru',
    renameWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    overdueMode: 'calendar',
    setOverdueMode: vi.fn(),
  };
});

describe('WorkspaceSettings — вкладка История', () => {
  it('personal ws: вкладки «История» нет', () => {
    currentWs = { id: 'ws_me', name: 'Личное', kind: 'personal' };
    currentRole = 'owner';
    render(<WorkspaceSettingsPage />);
    expect(screen.queryByRole('button', { name: /^История$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Участники/ })).toBeNull();
  });

  it.each(['owner', 'editor', 'viewer'])('shared ws: роль %s видит вкладку «История»', (role) => {
    currentWs = { id: 'ws1', name: 'Команда', kind: 'shared' };
    currentRole = role;
    render(<WorkspaceSettingsPage />);
    expect(screen.getByRole('button', { name: /^История$/ })).toBeTruthy();
  });
});
