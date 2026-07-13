// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// MembersTab — вкладка «Участники» ws-настроек (Wave B, PR-b-04).
//
// Замена Wave-A WorkspaceMembers (прямой add по TF-ID теперь закрыт RLS). Состав
// пространства читается из локального зеркала (store.workspaceMembers), меняется
// по ролям:
//   • owner: «Пригласить» (InviteMemberModal), promote/demote, remove участника,
//     + секция «Приглашения» с pending-инвайтами и «Отозвать» (useInvitesStore).
//   • editor/viewer: только список + «Покинуть пространство» (удаляет своё
//     членство).
//
// Ников других участников у нас нет (own-row RLS на профилях), поэтому кроме себя
// («вы») показываем короткий id. Приглашения читаются с сервера через RPC-обёртки.
import { useEffect, useState } from 'react';
import { Trash2, UserPlus, ArrowUp, ArrowDown, LogOut, Clock } from 'lucide-react';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { InviteMemberModal } from './InviteMemberModal';
import { useStore, type WorkspaceMember } from '../store/useStore';
import { useInvitesStore } from '../store/useInvitesStore';
import { tr } from '../lib/i18n';

export function MembersTab() {
  const lang = useStore(s => s.language);
  const members = useStore(s => s.workspaceMembers);
  const currentWorkspaceId = useStore(s => s.currentWorkspaceId);
  const boundUserId = useStore(s => s.boundUserId);
  const updateWorkspaceMemberRole = useStore(s => s.updateWorkspaceMemberRole);
  const removeWorkspaceMember = useStore(s => s.removeWorkspaceMember);

  const workspaceInvites = useInvitesStore(s => s.workspaceInvites);
  const loadWorkspaceInvites = useInvitesStore(s => s.loadWorkspaceInvites);
  const cancelInvite = useInvitesStore(s => s.cancel);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);

  const rows = members.filter(m => m.workspace_id === currentWorkspaceId);
  const isOwner = rows.some(m => m.user_id === boundUserId && m.role === 'owner');
  const myMembership = rows.find(m => m.user_id === boundUserId);
  const pending = currentWorkspaceId ? workspaceInvites[currentWorkspaceId] ?? [] : [];

  // owner подтягивает pending-инвайты пространства с сервера.
  useEffect(() => {
    if (isOwner && currentWorkspaceId) void loadWorkspaceInvites(currentWorkspaceId);
  }, [isOwner, currentWorkspaceId, loadWorkspaceInvites]);

  const roleLabel = (role: string) =>
    role === 'owner'
      ? tr(lang, 'ws_members_role_owner')
      : role === 'editor'
        ? tr(lang, 'ws_members_role_editor')
        : tr(lang, 'ws_members_role_viewer');

  const displayName = (m: WorkspaceMember): string => {
    if (m.user_id && m.user_id === boundUserId) return tr(lang, 'ws_members_you');
    return m.user_id ? m.user_id.slice(0, 8) : '—';
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display text-[16px] font-semibold">{tr(lang, 'ws_tab_members')}</h3>
        {isOwner && (
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-lg font-medium text-white bg-accent hover:bg-accent-hover transition-colors"
          >
            <UserPlus size={15} />
            {tr(lang, 'ws_members_invite_button')}
          </button>
        )}
      </div>

      <div className="border border-border-soft rounded-lg overflow-hidden bg-surface">
        {rows.map(m => {
          const isSelf = !!m.user_id && m.user_id === boundUserId;
          return (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-border-soft last:border-b-0">
              <Avatar variant={1} size={32} />
              <span className="flex-1 text-[13px] truncate">{displayName(m)}</span>
              <span className="text-[12px] text-muted px-1">{roleLabel(m.role)}</span>

              {isOwner && !isSelf && m.role === 'viewer' && (
                <button
                  onClick={() => updateWorkspaceMemberRole(m.id, 'editor')}
                  title={tr(lang, 'ws_members_promote_editor')}
                  aria-label={tr(lang, 'ws_members_promote_editor')}
                  className="p-1 text-muted hover:text-accent"
                ><ArrowUp size={15} /></button>
              )}
              {isOwner && !isSelf && m.role === 'editor' && (
                <button
                  onClick={() => updateWorkspaceMemberRole(m.id, 'viewer')}
                  title={tr(lang, 'ws_members_demote_viewer')}
                  aria-label={tr(lang, 'ws_members_demote_viewer')}
                  className="p-1 text-muted hover:text-accent"
                ><ArrowDown size={15} /></button>
              )}
              {isOwner && !isSelf && (
                <button
                  onClick={() => setRemoveId(m.id)}
                  title={tr(lang, 'ws_members_remove_confirm_title')}
                  aria-label={tr(lang, 'ws_members_remove_confirm_title')}
                  className="p-1 text-muted hover:text-[var(--status-important)]"
                ><Trash2 size={14} /></button>
              )}
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="px-3 py-8 text-center text-muted text-[13px]">{tr(lang, 'ws_members_empty')}</div>
        )}
      </div>

      {/* Не-owner может покинуть пространство (удалить своё членство). */}
      {!isOwner && myMembership && (
        <button
          onClick={() => setLeaveOpen(true)}
          className="mt-4 flex items-center gap-2 px-4 py-2 text-[13px] rounded-lg border border-[var(--status-important)]/40 text-[var(--status-important)] hover:bg-[var(--status-important)]/10 transition-colors"
        >
          <LogOut size={15} />
          {tr(lang, 'ws_members_leave')}
        </button>
      )}

      {/* owner: pending-приглашения пространства. */}
      {isOwner && (
        <div className="mt-6">
          <h4 className="font-display text-[14px] font-semibold mb-2">{tr(lang, 'ws_invites_section_title')}</h4>
          <div className="border border-border-soft rounded-lg overflow-hidden bg-surface">
            {pending.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-border-soft last:border-b-0">
                <Clock size={15} className="text-muted shrink-0" />
                <span className="flex-1 text-[13px] font-mono truncate">{inv.target_public_user_id}</span>
                <span className="text-[12px] text-muted px-1">{roleLabel(inv.role)}</span>
                <span className="text-[11px] text-faint px-1">{tr(lang, 'ws_invites_status_pending')}</span>
                <button
                  onClick={() => setCancelId(inv.id)}
                  className="px-2 py-1 text-[12px] rounded border border-border-soft text-muted hover:text-[var(--status-important)] hover:border-[var(--status-important)]/40 transition-colors"
                >
                  {tr(lang, 'ws_invites_cancel')}
                </button>
              </div>
            ))}
            {pending.length === 0 && (
              <div className="px-3 py-6 text-center text-muted text-[13px]">{tr(lang, 'ws_invites_section_empty')}</div>
            )}
          </div>
        </div>
      )}

      {currentWorkspaceId && (
        <InviteMemberModal
          open={inviteOpen}
          workspaceId={currentWorkspaceId}
          onClose={() => setInviteOpen(false)}
        />
      )}

      <ConfirmDialog
        open={removeId !== null}
        title={tr(lang, 'ws_members_remove_confirm_title')}
        message={tr(lang, 'ws_members_remove_confirm_msg')}
        confirmLabel={tr(lang, 'ws_members_remove_confirm_title')}
        cancelLabel={tr(lang, 'cancel')}
        danger
        onConfirm={() => { if (removeId !== null) removeWorkspaceMember(removeId); setRemoveId(null); }}
        onCancel={() => setRemoveId(null)}
      />

      <ConfirmDialog
        open={leaveOpen}
        title={tr(lang, 'ws_members_leave_confirm_title')}
        message={tr(lang, 'ws_members_leave_confirm_msg')}
        confirmLabel={tr(lang, 'ws_members_leave')}
        cancelLabel={tr(lang, 'cancel')}
        danger
        onConfirm={() => { if (myMembership) removeWorkspaceMember(myMembership.id); setLeaveOpen(false); }}
        onCancel={() => setLeaveOpen(false)}
      />

      <ConfirmDialog
        open={cancelId !== null}
        title={tr(lang, 'ws_invites_cancel')}
        message={tr(lang, 'ws_invites_cancel')}
        confirmLabel={tr(lang, 'ws_invites_cancel')}
        cancelLabel={tr(lang, 'cancel')}
        danger
        onConfirm={() => { if (cancelId !== null) void cancelInvite(cancelId); setCancelId(null); }}
        onCancel={() => setCancelId(null)}
      />
    </div>
  );
}
