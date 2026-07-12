/**
 * Рендер-тесты вкладки «Участники» (Wave A, PR-4).
 *
 * Проверяет: форма добавления видна только owner; невалидный TF-ID → toast без
 * вызова addWorkspaceMember; валидный + найден → addWorkspaceMember + toast;
 * валидный + не найден → toast «не найден»; себя показываем как «вы».
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// findUserByPublicId мокаем; PUBLIC_ID_RE берём настоящий.
const findUserByPublicId = vi.fn();
vi.mock('../lib/profile', async (importActual) => {
  const actual = await importActual<typeof import('../lib/profile')>();
  return { ...actual, findUserByPublicId: (...a: any[]) => findUserByPublicId(...a) };
});

const addWorkspaceMember = vi.fn();
const updateWorkspaceMemberRole = vi.fn();
const removeWorkspaceMember = vi.fn();
const pushToast = vi.fn();

const UID = 'user-me';
let storeState: any;

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector(storeState),
}));

import { WorkspaceMembers } from './WorkspaceMembers';

const member = (id: string, user_id: string, role: string) =>
  ({ id, workspace_id: 'ws_s', user_id, role, invited_by: null, joined_at: null });

beforeEach(() => {
  findUserByPublicId.mockReset();
  addWorkspaceMember.mockReset();
  updateWorkspaceMemberRole.mockReset();
  removeWorkspaceMember.mockReset();
  pushToast.mockReset();
  storeState = {
    language: 'ru',
    currentWorkspaceId: 'ws_s',
    boundUserId: UID,
    workspaceMembers: [member('m-me', UID, 'owner')],
    addWorkspaceMember, updateWorkspaceMemberRole, removeWorkspaceMember, pushToast,
  };
});

describe('WorkspaceMembers', () => {
  it('owner видит форму добавления; себя показывает как «вы»', () => {
    render(<WorkspaceMembers />);
    expect(screen.getByPlaceholderText(/TF-ID/i)).toBeTruthy();
    expect(screen.getByText('вы')).toBeTruthy();
  });

  it('не-owner НЕ видит форму добавления', () => {
    storeState.workspaceMembers = [member('m-me', UID, 'editor')];
    render(<WorkspaceMembers />);
    expect(screen.queryByPlaceholderText(/TF-ID/i)).toBeNull();
  });

  it('невалидный TF-ID → toast, addWorkspaceMember не вызывается', async () => {
    render(<WorkspaceMembers />);
    fireEvent.change(screen.getByPlaceholderText(/TF-ID/i), { target: { value: 'нет' } });
    fireEvent.click(screen.getByRole('button', { name: /Добавить/i }));
    await waitFor(() => expect(pushToast).toHaveBeenCalled());
    expect(findUserByPublicId).not.toHaveBeenCalled();
    expect(addWorkspaceMember).not.toHaveBeenCalled();
  });

  it('валидный + найден → addWorkspaceMember + toast «добавлен»', async () => {
    findUserByPublicId.mockResolvedValue({ id: 'user-x', nickname: 'Икс', avatar_variant: 3 });
    render(<WorkspaceMembers />);
    fireEvent.change(screen.getByPlaceholderText(/TF-ID/i), { target: { value: 'TF-ABC12' } });
    fireEvent.click(screen.getByRole('button', { name: /Добавить/i }));
    await waitFor(() => expect(addWorkspaceMember).toHaveBeenCalledWith('user-x', 'editor'));
    expect(pushToast).toHaveBeenCalledWith('Участник добавлен');
  });

  it('валидный + не найден → toast «не найден», без addWorkspaceMember', async () => {
    findUserByPublicId.mockResolvedValue(null);
    render(<WorkspaceMembers />);
    fireEvent.change(screen.getByPlaceholderText(/TF-ID/i), { target: { value: 'TF-ZZZ99' } });
    fireEvent.click(screen.getByRole('button', { name: /Добавить/i }));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith('Пользователь с таким TF-ID не найден'));
    expect(addWorkspaceMember).not.toHaveBeenCalled();
  });
});
