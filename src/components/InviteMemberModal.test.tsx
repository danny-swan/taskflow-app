// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Рендер-тесты модалки приглашения (Wave B, PR-b-04).
//
// Проверяет: валидацию формата TF-ID (кнопка disabled), happy-path (invite с
// нормализованным id + выбранной ролью, тост + закрытие), маппинг кода ошибки
// InviteRpcError → переведённый текст в role="alert", и функцию inviteErrorKey.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InviteRpcError, type InviteErrorCode } from '../lib/invites';

const invite = vi.fn();
const pushToast = vi.fn();
let storeState: any;
let invitesState: any;

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector(storeState),
}));
vi.mock('../store/useInvitesStore', () => ({
  useInvitesStore: (selector: (s: any) => unknown) => selector(invitesState),
}));

import { InviteMemberModal, inviteErrorKey } from './InviteMemberModal';

beforeEach(() => {
  invite.mockReset();
  pushToast.mockReset();
  storeState = { language: 'ru', pushToast };
  invitesState = { invite };
});

const submitBtn = () => screen.getByRole('button', { name: 'Пригласить' });
const tfidInput = () => screen.getByPlaceholderText('TF-ABC12');

describe('InviteMemberModal', () => {
  it('кнопка disabled при невалидном формате, активна при валидном', () => {
    render(<InviteMemberModal open workspaceId="ws_s" onClose={() => {}} />);
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(tfidInput(), { target: { value: 'not-valid' } });
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(tfidInput(), { target: { value: 'tf-abc12' } });
    expect((submitBtn() as HTMLButtonElement).disabled).toBe(false);
  });

  it('happy-path: invite с нормализованным TF-ID + ролью, тост и закрытие', async () => {
    invite.mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<InviteMemberModal open workspaceId="ws_s" onClose={onClose} />);
    fireEvent.change(tfidInput(), { target: { value: ' tf-abc12 ' } });
    fireEvent.click(submitBtn());
    await waitFor(() => expect(invite).toHaveBeenCalled());
    expect(invite).toHaveBeenCalledWith({ workspaceId: 'ws_s', targetPublicId: 'TF-ABC12', role: 'editor' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(pushToast).toHaveBeenCalledWith('Приглашение отправлено');
  });

  it('выбор роли viewer передаётся в invite', async () => {
    invite.mockResolvedValue(undefined);
    render(<InviteMemberModal open workspaceId="ws_s" onClose={() => {}} />);
    fireEvent.change(tfidInput(), { target: { value: 'TF-ABC12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Наблюдатель' }));
    fireEvent.click(submitBtn());
    await waitFor(() => expect(invite).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'viewer' }),
    ));
  });

  it('ошибка InviteRpcError мапится в переведённый текст (role=alert)', async () => {
    invite.mockRejectedValue(new InviteRpcError('already_member', 'user is already a member'));
    render(<InviteMemberModal open workspaceId="ws_s" onClose={() => {}} />);
    fireEvent.change(tfidInput(), { target: { value: 'TF-ABC12' } });
    fireEvent.click(submitBtn());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Пользователь уже участник этого пространства');
  });
});

describe('inviteErrorKey', () => {
  it.each<[InviteErrorCode, string]>([
    ['target_not_found', 'ws_invite_err_target_not_found'],
    ['target_free_plan', 'ws_invite_err_target_free_plan'],
    ['self_invite', 'ws_invite_err_self_invite'],
    ['already_member', 'ws_invite_err_already_member'],
    ['not_authorized', 'ws_invite_err_not_authorized'],
    ['invalid_role', 'ws_invite_err_invalid_role'],
    ['limit_exceeded', 'ws_invite_err_limit_exceeded'],
    ['invite_expired', 'ws_invite_err_invite_expired'],
    ['invite_not_pending', 'ws_invite_err_invite_not_pending'],
    ['unknown', 'ws_invite_err_unknown'],
  ])('код %s → ключ %s', (code, key) => {
    expect(inviteErrorKey(code)).toBe(key);
  });
});
