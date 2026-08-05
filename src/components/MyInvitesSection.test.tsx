// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Рендер-тесты сайдбар-секции «Мои приглашения» (Wave B, PR-b-04).
//
// Проверяет: гейт по boundUserId (нет → null), рендер входящих pending с
// счётчиком, accept → switchWorkspace + тост, лимит-гард (limit_exceeded →
// тарифный тост, без переключения), reject → тост.
//
// F56 (ADR 0036): карточка показывает название пространства и строку «От: …»
// с аватаром пригласившего; клик открывает MemberInfoModal. Если обогащения
// нет (RPC недоступна → legacy-fallback), карточка выглядит как раньше —
// нейтральный заголовок и без строки «От».
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InviteRpcError } from '../lib/invites';

const pushToast = vi.fn();
const switchWorkspace = vi.fn();
const loadMyPending = vi.fn(async () => {});
const accept = vi.fn();
const reject = vi.fn();
let storeState: any;
let invitesState: any;

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector(storeState),
}));
vi.mock('../store/useInvitesStore', () => ({
  useInvitesStore: (selector: (s: any) => unknown) => selector(invitesState),
}));

import { MyInvitesSection } from './MyInvitesSection';

/** Приглашение БЕЗ обогащения — как его отдаёт legacy-fallback. */
const inv = (id: string, role = 'editor') => ({
  id, workspace_id: 'ws_s', workspace_name: null, inviter_user_id: 'owner-1',
  target_public_user_id: 'TF-ME123', role, status: 'pending',
  expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  created_at: '', inviter: null,
});

/** Приглашение с полями из RPC get_my_pending_invites (миграция 0044). */
const invRich = (id: string, over: Record<string, unknown> = {}) => ({
  ...inv(id),
  workspace_name: 'Leaf team',
  inviter: {
    user_id: 'owner-1', public_user_id: 'TF-7EDA2R', nickname: 'Daniil Lebedev',
    avatar_variant: 5, avatar_color: '#fc1d1d', bio: 'про меня',
  },
  ...over,
});

function setup(opts: { bound: string | null; pending?: any[] }) {
  storeState = { language: 'ru', boundUserId: opts.bound, pushToast, switchWorkspace };
  invitesState = { myPending: opts.pending ?? [], loadMyPending, accept, reject };
}

beforeEach(() => {
  pushToast.mockReset();
  switchWorkspace.mockReset();
  loadMyPending.mockClear();
  accept.mockReset();
  reject.mockReset();
});

describe('MyInvitesSection', () => {
  it('без boundUserId → ничего не рендерит', () => {
    setup({ bound: null, pending: [inv('i1')] });
    const { container } = render(<MyInvitesSection />);
    expect(container.firstChild).toBeNull();
  });

  it('без входящих → ничего не рендерит (пин отсутствует), но грузит список', () => {
    setup({ bound: 'me', pending: [] });
    const { container } = render(<MyInvitesSection />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('invite-pin')).toBeNull();
    expect(loadMyPending).toHaveBeenCalled();
  });

  it('без обогащения (legacy-путь) — прежний нейтральный заголовок и без строки «От»', () => {
    setup({ bound: 'me', pending: [inv('i1')] });
    render(<MyInvitesSection />);
    expect(screen.getByText('Приглашение в общее пространство')).toBeTruthy();
    expect(screen.queryByText('От:')).toBeNull();
  });

  it('F56: показывает название пространства вместо нейтрального заголовка', () => {
    setup({ bound: 'me', pending: [invRich('i1')] });
    render(<MyInvitesSection />);
    expect(screen.getByText('Leaf team')).toBeTruthy();
    expect(screen.queryByText('Приглашение в общее пространство')).toBeNull();
  });

  it('F56: показывает ник пригласившего, а клик открывает карточку профиля с TF-id', () => {
    setup({ bound: 'me', pending: [invRich('i1')] });
    render(<MyInvitesSection />);
    expect(screen.getByText('От:')).toBeTruthy();
    fireEvent.click(screen.getByText('Daniil Lebedev'));
    expect(screen.getByText('Профиль участника')).toBeTruthy();
    expect(screen.getByText('TF-7EDA2R')).toBeTruthy();
    expect(screen.getByText('про меня')).toBeTruthy();
    expect(screen.getByText('Владелец')).toBeTruthy();
  });

  it('F56: без ника подписью служит TF-id пригласившего', () => {
    setup({ bound: 'me', pending: [invRich('i1', { inviter: {
      user_id: 'owner-1', public_user_id: 'TF-7EDA2R', nickname: null,
      avatar_variant: 1, avatar_color: null, bio: null,
    } })] });
    render(<MyInvitesSection />);
    expect(screen.getByText('TF-7EDA2R')).toBeTruthy();
  });

  it('F56: пустое название пространства не затирает нейтральный заголовок', () => {
    setup({ bound: 'me', pending: [invRich('i1', { workspace_name: '   ' })] });
    render(<MyInvitesSection />);
    expect(screen.getByText('Приглашение в общее пространство')).toBeTruthy();
  });

  it('рендерит pending со счётчиком, пином и нейтральным именем', () => {
    setup({ bound: 'me', pending: [inv('i1'), inv('i2')] });
    render(<MyInvitesSection />);
    expect(screen.getAllByText('Приглашение в общее пространство')).toHaveLength(2);
    const pin = screen.getByTestId('invite-pin');
    expect(pin.textContent).toBe('2');
    expect(pin.getAttribute('aria-label')).toBe('Неотвеченных приглашений: 2');
  });

  it('accept → switchWorkspace + тост принятия', async () => {
    accept.mockResolvedValue({ workspaceId: 'ws_s' });
    setup({ bound: 'me', pending: [inv('i1')] });
    render(<MyInvitesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Принять' }));
    await waitFor(() => expect(accept).toHaveBeenCalledWith('i1'));
    await waitFor(() => expect(switchWorkspace).toHaveBeenCalledWith('ws_s'));
    expect(pushToast).toHaveBeenCalledWith('Вы приняли приглашение');
  });

  it('accept при лимите → тарифный тост, без переключения', async () => {
    accept.mockRejectedValue(new InviteRpcError('limit_exceeded', 'workspace limit exceeded'));
    setup({ bound: 'me', pending: [inv('i1')] });
    render(<MyInvitesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Принять' }));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(
      'Достигнут лимит рабочих пространств. Освободите слот, чтобы принять это приглашение.',
    ));
    expect(switchWorkspace).not.toHaveBeenCalled();
  });

  it('reject → тост отклонения', async () => {
    reject.mockResolvedValue(undefined);
    setup({ bound: 'me', pending: [inv('i1')] });
    render(<MyInvitesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));
    await waitFor(() => expect(reject).toHaveBeenCalledWith('i1'));
    expect(pushToast).toHaveBeenCalledWith('Приглашение отклонено');
  });
});
