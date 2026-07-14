// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// invites.ts — сервисный слой приглашений в shared-пространства (Wave B, PR-b-04).
//
// Тонкие обёртки над SECURITY DEFINER RPC из миграции 0032:
//   invite_to_workspace / accept_invite / reject_invite / cancel_invite
// плюс два SELECT-списка (мои входящие / инвайты пространства для owner).
//
// Мутация инвайтов на сервере идёт ТОЛЬКО через RPC (прямой DML закрыт RLS +
// grant'ами). Чтение — прямой SELECT из sync_workspace_invites (RLS §3 отдаёт
// приглашённому его строки, owner'у — все строки его пространства).
//
// PostgREST при `raise exception ... using errcode = 'XXXXX'` возвращает объект
// ошибки с `code` (SQLSTATE) и `message` (текст исключения). Мапим их в
// типизированный InviteRpcError, чтобы UI показал переведённое сообщение по коду,
// а не сырой текст из БД (тексты см. в 0032).
import { supabase } from './supabase';

export type InviteRole = 'editor' | 'viewer';
export type InviteStatus = 'pending' | 'accepted' | 'rejected' | 'expired' | 'cancelled';

/** Строка sync_workspace_invites, как её отдаёт SELECT/RPC. */
export interface WorkspaceInvite {
  id: string;
  workspace_id: string;
  inviter_user_id: string;
  target_public_user_id: string;
  target_user_id: string | null;
  role: InviteRole;
  status: InviteStatus;
  expires_at: string;
  created_at: string;
  accepted_at: string | null;
}

/** Типизированные коды ошибок инвайтов (маппинг SQLSTATE + текста из 0032). */
export type InviteErrorCode =
  | 'not_authorized'      // 42501 — не owner / нет сессии / инвайт не для вас
  | 'target_not_found'    // 22023 'user not found'
  | 'target_free_plan'    // 22023 'free plan'
  | 'self_invite'         // 22023 'cannot invite yourself'
  | 'already_member'      // 22023 'already a member'
  | 'invalid_role'        // 22023 'invalid role'
  | 'limit_exceeded'      // 22023 'workspace limit exceeded' (на accept)
  | 'invite_expired'      // истёкший инвайт
  | 'invite_not_pending'  // инвайт не в статусе pending / не найден
  | 'ws_not_synced'       // клиентский гейт: ws ещё не доставлен на сервер (push не прошёл)
  | 'unknown';

/** Форма ошибки, возвращаемая наружу (совместимо с брифом PR-b-04). */
export interface InviteError {
  code: InviteErrorCode;
  message: string;
}

/**
 * Ошибка вызова RPC инвайтов с типизированным кодом. Кидается всеми обёртками
 * ниже вместо сырой PostgREST-ошибки, чтобы UI мапил `code` → переведённый текст.
 */
export class InviteRpcError extends Error implements InviteError {
  readonly code: InviteErrorCode;
  constructor(code: InviteErrorCode, message: string) {
    super(message);
    this.name = 'InviteRpcError';
    this.code = code;
  }
}

/** Минимальный shape ошибки supabase-js/PostgREST (code = SQLSTATE, message = текст). */
interface PostgrestErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * Маппинг PostgREST-ошибки в типизированный InviteRpcError по SQLSTATE + тексту.
 * Тексты исключений заведены в 0032 и здесь матчатся подстрокой (устойчиво к
 * дополнительным деталям вроде `invalid role: xyz`).
 */
export function parseInviteError(error: PostgrestErrorLike | null | undefined): InviteRpcError {
  const rawMessage = error?.message ?? '';
  const message = rawMessage.toLowerCase();
  const sqlstate = error?.code ?? '';

  if (message.includes('expired')) {
    return new InviteRpcError('invite_expired', rawMessage);
  }
  if (message.includes('user not found')) {
    return new InviteRpcError('target_not_found', rawMessage);
  }
  if (message.includes('free plan')) {
    return new InviteRpcError('target_free_plan', rawMessage);
  }
  if (message.includes('cannot invite yourself')) {
    return new InviteRpcError('self_invite', rawMessage);
  }
  if (message.includes('already a member')) {
    return new InviteRpcError('already_member', rawMessage);
  }
  if (message.includes('invalid role')) {
    return new InviteRpcError('invalid_role', rawMessage);
  }
  if (message.includes('workspace limit exceeded')) {
    return new InviteRpcError('limit_exceeded', rawMessage);
  }
  if (message.includes('invite not found') || message.includes('not permitted')) {
    // accept/reject/cancel на не-pending/чужой/несуществующий инвайт (42501).
    return new InviteRpcError('invite_not_pending', rawMessage);
  }
  if (sqlstate === '42501') {
    // 'only workspace owner can invite' / 'not authenticated'.
    return new InviteRpcError('not_authorized', rawMessage);
  }
  return new InviteRpcError('unknown', rawMessage || 'unknown invite error');
}

/** id текущего пользователя (для фильтра «мои входящие»). */
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

const INVITE_COLUMNS =
  'id, workspace_id, inviter_user_id, target_public_user_id, target_user_id, role, status, expires_at, created_at, accepted_at';

/** owner приглашает пользователя по публичному TF-ID. Возвращает созданный/существующий pending. */
export async function inviteToWorkspace(params: {
  workspaceId: string;
  targetPublicId: string;
  role: InviteRole;
}): Promise<WorkspaceInvite> {
  const { data, error } = await supabase.rpc('invite_to_workspace', {
    p_workspace_id: params.workspaceId,
    p_target_public_id: params.targetPublicId.trim().toUpperCase(),
    p_role: params.role,
  });
  if (error) throw parseInviteError(error);
  const row = Array.isArray(data) ? data[0] : data;
  return row as WorkspaceInvite;
}

/** Приглашённый принимает инвайт. Возвращает ws-id + полученную роль. */
export async function acceptInvite(inviteId: string): Promise<{ workspaceId: string; role: InviteRole }> {
  const { data, error } = await supabase.rpc('accept_invite', { p_invite_id: inviteId });
  if (error) throw parseInviteError(error);
  const row = (Array.isArray(data) ? data[0] : data) as { workspace_id: string; role: InviteRole } | null;
  return { workspaceId: row?.workspace_id ?? '', role: (row?.role ?? 'editor') as InviteRole };
}

/** Приглашённый отклоняет инвайт. */
export async function rejectInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('reject_invite', { p_invite_id: inviteId });
  if (error) throw parseInviteError(error);
}

/** owner отзывает pending-инвайт своего пространства. */
export async function cancelInvite(inviteId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_invite', { p_invite_id: inviteId });
  if (error) throw parseInviteError(error);
}

/** Мои входящие pending-инвайты (адресованные текущему пользователю). */
export async function listMyPendingInvites(): Promise<WorkspaceInvite[]> {
  const uid = await currentUserId();
  if (!uid) return [];
  const { data, error } = await supabase
    .from('sync_workspace_invites')
    .select(INVITE_COLUMNS)
    .eq('target_user_id', uid)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw parseInviteError(error);
  return (data ?? []) as unknown as WorkspaceInvite[];
}

/** Pending-инвайты конкретного пространства (доступно owner'у по RLS). */
export async function listWorkspaceInvites(workspaceId: string): Promise<WorkspaceInvite[]> {
  const { data, error } = await supabase
    .from('sync_workspace_invites')
    .select(INVITE_COLUMNS)
    .eq('workspace_id', workspaceId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw parseInviteError(error);
  return (data ?? []) as unknown as WorkspaceInvite[];
}
