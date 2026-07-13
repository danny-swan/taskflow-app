// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Рендер-тесты вкладки «Участники» (Wave B, PR-b-04).
//
// Проверяет ролевой гейт: owner видит «Пригласить», promote/demote/remove и
// секцию «Приглашения» с pending + «Отозвать»; editor/viewer видят только
// «Покинуть». Экшены store/invites дёргаются корректными аргументами.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const updateWorkspaceMemberRole = vi.fn();
const removeWorkspaceMember = vi.fn();
const loadWorkspaceInvites = vi.fn(async () => {});
const cancel = vi.fn(async () => {});
let storeState: any;
let invitesState: any;

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector(storeState),
}));
vi.mock('../store/useInvitesStore', () => ({
  useInvitesStore: (selector: (s: any) => unknown) => selector(invitesState),
}));
vi.mock('./InviteMemberModal', () => ({
  InviteMemberModal: () => null,
}));

import { MembersTab } from './MembersTab';

const member = (id: string, user_id: string, role: string) => ({
  id, workspace_id: 'ws_s', user_id, role, invited_by: null, joined_at: null,
});

const invite = (id: string, role = 'editor') => ({
  id, workspace_id: 'ws_s', inviter_user_id: 'me', target_public_user_id: 'TF-ZZZ99',
  target_user_id: null, role, status: 'pending', expires_at: '', created_at: '', accepted_at: null,
});

function setup(opts: { role: 'owner' | 'editor' | 'viewer'; invites?: any[] }) {
  const members = [
    member('m_me', 'me', opts.role),
    member('m_ed', 'other-ed', 'editor'),
    member('m_vw', 'other-vw', 'viewer'),
  ];
  storeState = {
    language: 'ru',
    workspaceMembers: members,
    currentWorkspaceId: 'ws_s',
    boundUserId: 'me',
    updateWorkspaceMemberRole,
    removeWorkspaceMember,
  };
  invitesState = {
    workspaceInvites: { ws_s: opts.invites ?? [] },
    loadWorkspaceInvites,
    cancel,
  };
}

beforeEach(() => {
  updateWorkspaceMemberRole.mockReset();
  removeWorkspaceMember.mockReset();
  loadWorkspaceInvites.mockClear();
  cancel.mockClear();
});

describe('MembersTab — owner', () => {
  it('видит кнопку «Пригласить» и секцию «Приглашения»', () => {
    setup({ role: 'owner' });
    render(<MembersTab />);
    expect(screen.getByRole('button', { name: 'Пригласить' })).toBeTruthy();
    expect(screen.getByText('Приглашения')).toBeTruthy();
  });

  it('подтягивает pending-инвайты пространства', () => {
    setup({ role: 'owner' });
    render(<MembersTab />);
    expect(loadWorkspaceInvites).toHaveBeenCalledWith('ws_s');
  });

  it('promote viewer → editor', () => {
    setup({ role: 'owner' });
    render(<MembersTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Сделать редактором' }));
    expect(updateWorkspaceMemberRole).toHaveBeenCalledWith('m_vw', 'editor');
  });

  it('demote editor → viewer', () => {
    setup({ role: 'owner' });
    render(<MembersTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Сделать наблюдателем' }));
    expect(updateWorkspaceMemberRole).toHaveBeenCalledWith('m_ed', 'viewer');
  });

  it('remove участника проходит через подтверждение', () => {
    setup({ role: 'owner' });
    render(<MembersTab />);
    // Кнопки-корзины (по одной на m_ed и m_vw), первая — для m_ed.
    fireEvent.click(screen.getAllByRole('button', { name: 'Удалить участника?' })[0]);
    // Открылся ConfirmDialog: его confirm-кнопка добавилась последней.
    const btns = screen.getAllByRole('button', { name: 'Удалить участника?' });
    fireEvent.click(btns[btns.length - 1]);
    expect(removeWorkspaceMember).toHaveBeenCalledWith('m_ed');
  });

  it('pending-инвайт: «Отозвать» вызывает cancel', () => {
    setup({ role: 'owner', invites: [invite('inv_1')] });
    render(<MembersTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Отозвать' }));
    // Подтверждение отзыва.
    const confirmBtns = screen.getAllByRole('button', { name: 'Отозвать' });
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);
    expect(cancel).toHaveBeenCalledWith('inv_1');
  });
});

describe('MembersTab — не-owner', () => {
  it('editor видит «Покинуть», не видит «Пригласить»', () => {
    setup({ role: 'editor' });
    render(<MembersTab />);
    expect(screen.getByRole('button', { name: 'Покинуть пространство' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Пригласить' })).toBeNull();
  });

  it('viewer «Покинуть» → removeWorkspaceMember(своё членство)', () => {
    setup({ role: 'viewer' });
    render(<MembersTab />);
    // Клик по кнопке «Покинуть» открывает ConfirmDialog (confirm тоже «Покинуть...»).
    fireEvent.click(screen.getByRole('button', { name: 'Покинуть пространство' }));
    const leaveBtns = screen.getAllByRole('button', { name: 'Покинуть пространство' });
    fireEvent.click(leaveBtns[leaveBtns.length - 1]);
    expect(removeWorkspaceMember).toHaveBeenCalledWith('m_me');
  });

  it('не подтягивает pending-инвайты (не owner)', () => {
    setup({ role: 'editor' });
    render(<MembersTab />);
    expect(loadWorkspaceInvites).not.toHaveBeenCalled();
  });
});
