// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Unit-тесты сервисного слоя приглашений (Wave B, PR-b-04).
//
// Покрывает:
//   • контракт 4 RPC (имя функции + переданные параметры, happy-path);
//   • маппинг всех кодов ошибок PostgREST → InviteRpcError.code (0032);
//   • listMyPendingInvites / listWorkspaceInvites (фильтры select).
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Управляемый мок supabase (rpc + from-builder + auth.getUser) ───────────
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
let selectResult: { data: unknown; error: unknown } = { data: [], error: null };
let currentUser: { id: string } | null = { id: 'uid-me' };

const calls = {
  rpcName: null as string | null,
  rpcParams: null as Record<string, unknown> | null,
  from: null as string | null,
  eq: [] as [string, unknown][],
  order: null as [string, unknown] | null,
};

vi.mock('./supabase', () => {
  const makeBuilder = () => {
    const builder: Record<string, any> = {};
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => { calls.eq.push([col, val]); return builder; };
    builder.order = (col: string, opts: unknown) => {
      calls.order = [col, opts];
      return Promise.resolve(selectResult);
    };
    return builder;
  };
  return {
    supabase: {
      rpc: (name: string, params: Record<string, unknown>) => {
        calls.rpcName = name;
        calls.rpcParams = params;
        return Promise.resolve(rpcResult);
      },
      from: (table: string) => { calls.from = table; return makeBuilder(); },
      auth: { getUser: () => Promise.resolve({ data: { user: currentUser }, error: null }) },
    },
  };
});

import {
  inviteToWorkspace,
  acceptInvite,
  rejectInvite,
  cancelInvite,
  listMyPendingInvites,
  listWorkspaceInvites,
  parseInviteError,
  InviteRpcError,
} from './invites';

beforeEach(() => {
  rpcResult = { data: null, error: null };
  selectResult = { data: [], error: null };
  currentUser = { id: 'uid-me' };
  calls.rpcName = null;
  calls.rpcParams = null;
  calls.from = null;
  calls.eq = [];
  calls.order = null;
});

describe('inviteToWorkspace', () => {
  it('вызывает RPC invite_to_workspace с нормализованным TF-ID', async () => {
    rpcResult = { data: { id: 'inv_1', workspace_id: 'ws_s', role: 'editor', status: 'pending' }, error: null };
    const res = await inviteToWorkspace({ workspaceId: 'ws_s', targetPublicId: ' tf-abc12 ', role: 'editor' });
    expect(calls.rpcName).toBe('invite_to_workspace');
    expect(calls.rpcParams).toEqual({ p_workspace_id: 'ws_s', p_target_public_id: 'TF-ABC12', p_role: 'editor' });
    expect(res.id).toBe('inv_1');
  });

  it('разворачивает массив-результат в единичную строку', async () => {
    rpcResult = { data: [{ id: 'inv_9' }], error: null };
    const res = await inviteToWorkspace({ workspaceId: 'ws_s', targetPublicId: 'TF-ZZZ99', role: 'viewer' });
    expect(res.id).toBe('inv_9');
  });

  it.each([
    ['user not found', '22023', 'target_not_found'],
    ['target user is on free plan and cannot join shared workspaces', '22023', 'target_free_plan'],
    ['cannot invite yourself', '22023', 'self_invite'],
    ['user is already a member', '22023', 'already_member'],
    ['invalid role: manager', '22023', 'invalid_role'],
    ['only workspace owner can invite', '42501', 'not_authorized'],
    ['not authenticated', '42501', 'not_authorized'],
  ])('ошибку "%s" (%s) мапит в код %s', async (message, code, expected) => {
    rpcResult = { data: null, error: { message, code } };
    await expect(inviteToWorkspace({ workspaceId: 'ws_s', targetPublicId: 'TF-ABC12', role: 'editor' }))
      .rejects.toMatchObject({ code: expected });
  });
});

describe('acceptInvite', () => {
  it('вызывает accept_invite и возвращает workspaceId + role', async () => {
    rpcResult = { data: { workspace_id: 'ws_s', role: 'editor' }, error: null };
    const res = await acceptInvite('inv_1');
    expect(calls.rpcName).toBe('accept_invite');
    expect(calls.rpcParams).toEqual({ p_invite_id: 'inv_1' });
    expect(res).toEqual({ workspaceId: 'ws_s', role: 'editor' });
  });

  it('лимит тарифа → limit_exceeded', async () => {
    rpcResult = { data: null, error: { message: 'workspace limit exceeded', code: '22023' } };
    await expect(acceptInvite('inv_1')).rejects.toMatchObject({ code: 'limit_exceeded' });
  });

  it('чужой/не-pending инвайт → invite_not_pending', async () => {
    rpcResult = { data: null, error: { message: 'invite not found or not for you', code: '42501' } };
    await expect(acceptInvite('inv_x')).rejects.toMatchObject({ code: 'invite_not_pending' });
  });
});

describe('rejectInvite / cancelInvite', () => {
  it('rejectInvite вызывает reject_invite', async () => {
    await rejectInvite('inv_1');
    expect(calls.rpcName).toBe('reject_invite');
    expect(calls.rpcParams).toEqual({ p_invite_id: 'inv_1' });
  });

  it('cancelInvite вызывает cancel_invite', async () => {
    await cancelInvite('inv_2');
    expect(calls.rpcName).toBe('cancel_invite');
    expect(calls.rpcParams).toEqual({ p_invite_id: 'inv_2' });
  });

  it('cancelInvite на чужой инвайт → invite_not_pending', async () => {
    rpcResult = { data: null, error: { message: 'invite not found or not permitted', code: '42501' } };
    await expect(cancelInvite('inv_2')).rejects.toMatchObject({ code: 'invite_not_pending' });
  });
});

describe('listMyPendingInvites', () => {
  it('фильтрует по target_user_id текущего юзера и status=pending', async () => {
    selectResult = { data: [{ id: 'inv_1', status: 'pending' }], error: null };
    const res = await listMyPendingInvites();
    expect(calls.from).toBe('sync_workspace_invites');
    expect(calls.eq).toContainEqual(['target_user_id', 'uid-me']);
    expect(calls.eq).toContainEqual(['status', 'pending']);
    expect(res).toHaveLength(1);
  });

  it('без сессии возвращает пустой список без запроса', async () => {
    currentUser = null;
    const res = await listMyPendingInvites();
    expect(res).toEqual([]);
    expect(calls.from).toBeNull();
  });
});

describe('listWorkspaceInvites', () => {
  it('фильтрует по workspace_id и status=pending', async () => {
    selectResult = { data: [{ id: 'inv_a' }, { id: 'inv_b' }], error: null };
    const res = await listWorkspaceInvites('ws_s');
    expect(calls.from).toBe('sync_workspace_invites');
    expect(calls.eq).toContainEqual(['workspace_id', 'ws_s']);
    expect(calls.eq).toContainEqual(['status', 'pending']);
    expect(res).toHaveLength(2);
  });

  it('ошибка select пробрасывается как InviteRpcError', async () => {
    selectResult = { data: null, error: { message: 'boom', code: 'XX000' } };
    await expect(listWorkspaceInvites('ws_s')).rejects.toBeInstanceOf(InviteRpcError);
  });
});

describe('parseInviteError', () => {
  it('истёкший инвайт → invite_expired', () => {
    expect(parseInviteError({ message: 'invite has expired', code: '42501' }).code).toBe('invite_expired');
  });

  it('неизвестная ошибка → unknown', () => {
    expect(parseInviteError({ message: 'something weird', code: 'XX999' }).code).toBe('unknown');
  });

  it('пустая ошибка → unknown с дефолтным текстом', () => {
    expect(parseInviteError(null).code).toBe('unknown');
  });
});
