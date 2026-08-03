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

// F40 (ADR 0031): публичные профили участников приходят из RPC-обёртки; в тестах
// подменяем её карту, чтобы проверить «ник, иначе TF-id» и реальные аватары.
let memberProfilesMap: any = {};
vi.mock('../lib/memberProfiles', async (importActual) => {
  const actual = await importActual<typeof import('../lib/memberProfiles')>();
  return {
    ...actual,
    useWorkspaceMemberProfiles: () => ({ byId: memberProfilesMap, loading: false, refetch: vi.fn() }),
  };
});

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

const profile = (over: Partial<any> = {}) => ({
  user_id: over.user_id ?? 'other-ed',
  public_user_id: over.public_user_id ?? 'TF-EDIT01',
  nickname: 'nickname' in over ? over.nickname : null,
  avatar_variant: over.avatar_variant ?? 1,
  avatar_color: over.avatar_color ?? null,
  bio: 'bio' in over ? over.bio : null,
});

beforeEach(() => {
  memberProfilesMap = {};
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

// ─── F40: ник / TF-id / реальные аватары вместо куска uuid ──────────────────
describe('MembersTab — отображение участников (F40)', () => {
  it('показывает ник участника, если он задан', () => {
    setup({ role: 'owner' });
    memberProfilesMap = {
      'other-ed': profile({ user_id: 'other-ed', nickname: 'Даниил', public_user_id: 'TF-EDIT01' }),
    };
    render(<MembersTab />);
    expect(screen.getByRole('button', { name: 'Даниил' })).toBeTruthy();
  });

  it('показывает TF-id, если ник пустой', () => {
    setup({ role: 'owner' });
    memberProfilesMap = {
      'other-vw': profile({ user_id: 'other-vw', nickname: null, public_user_id: 'TF-VIEW01' }),
    };
    render(<MembersTab />);
    expect(screen.getByRole('button', { name: 'TF-VIEW01' })).toBeTruthy();
  });

  it('внутренний uuid участника в разметку не попадает', () => {
    setup({ role: 'owner' });
    memberProfilesMap = {
      'other-ed': profile({ user_id: 'other-ed', nickname: 'Даниил' }),
    };
    const { container } = render(<MembersTab />);
    // Раньше здесь были первые 8 символов uuid — теперь ни ника-заглушки, ни id.
    expect(container.innerHTML).not.toContain('other-vw');
    expect(screen.getByText('Участник')).toBeTruthy(); // профиля нет в карте
  });

  it('аватар берётся из профиля участника (форма + явный цвет)', () => {
    setup({ role: 'owner' });
    memberProfilesMap = {
      'other-ed': profile({ user_id: 'other-ed', avatar_variant: 6, avatar_color: '#4fa35b' }),
    };
    const { container } = render(<MembersTab />);
    const colored = Array.from(container.querySelectorAll<HTMLElement>('span[style]'))
      .filter(el => el.style.color === 'rgb(79, 163, 91)');
    expect(colored.length).toBeGreaterThan(0);
  });

  it('клик по имени открывает карточку участника с TF-id и «о себе»', () => {
    setup({ role: 'owner' });
    memberProfilesMap = {
      'other-ed': profile({
        user_id: 'other-ed', nickname: 'Даниил', public_user_id: 'TF-EDIT01', bio: 'сорсинг',
      }),
    };
    render(<MembersTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Даниил' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('TF-EDIT01')).toBeTruthy();
    expect(screen.getByText('сорсинг')).toBeTruthy();
  });
});
