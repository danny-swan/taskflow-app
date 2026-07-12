// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// WorkspaceMembers — вкладка «Участники» ws-настроек (Wave A, PR-4).
//
// Только для shared-пространств. Список членства читается из локального зеркала
// (store.workspaceMembers). Приглашение — по ПУБЛИЧНОМУ TF-ID (public_user_id),
// НЕ по email/uuid: клиент валидирует формат, вызывает RPC find_user_by_public_id
// и при успехе делает локальный INSERT + enqueueOutbox через store.addWorkspaceMember.
//
// Гейт: изменять состав/роли может только owner. Чужие профили (nickname/avatar)
// недоступны из-за own-row RLS, поэтому ников других участников у нас нет —
// показываем то, что вернул lookup при добавлении (кэш в рамках сессии), иначе
// короткий id. Себя помечаем «вы».
import { useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { useStore, type WorkspaceMember } from '../store/useStore';
import { tr } from '../lib/i18n';
import { PUBLIC_ID_RE, findUserByPublicId } from '../lib/profile';

type AddRole = 'editor' | 'viewer';

/** Кэш ник/аватар по user_id, наполняемый из lookup при добавлении (сессионный). */
type LookupCache = Record<string, { nickname: string | null; avatar_variant: number }>;

export function WorkspaceMembers() {
  const lang = useStore(s => s.language);
  const members = useStore(s => s.workspaceMembers);
  const currentWorkspaceId = useStore(s => s.currentWorkspaceId);
  const boundUserId = useStore(s => s.boundUserId);
  const addWorkspaceMember = useStore(s => s.addWorkspaceMember);
  const updateWorkspaceMemberRole = useStore(s => s.updateWorkspaceMemberRole);
  const removeWorkspaceMember = useStore(s => s.removeWorkspaceMember);
  const pushToast = useStore(s => s.pushToast);

  const [pid, setPid] = useState('');
  const [addRole, setAddRole] = useState<AddRole>('editor');
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [cache, setCache] = useState<LookupCache>({});

  const isOwner = members.some(
    m => m.workspace_id === currentWorkspaceId && m.user_id === boundUserId && m.role === 'owner',
  );

  const rows = members.filter(m => m.workspace_id === currentWorkspaceId);

  const roleLabel = (role: string) =>
    role === 'owner'
      ? tr(lang, 'ws_members_role_owner')
      : role === 'editor'
        ? tr(lang, 'ws_members_role_editor')
        : tr(lang, 'ws_members_role_viewer');

  const submitAdd = async () => {
    const normalized = pid.trim().toUpperCase();
    if (!PUBLIC_ID_RE.test(normalized)) {
      pushToast(tr(lang, 'ws_members_invalid_tfid'));
      return;
    }
    setBusy(true);
    try {
      const found = await findUserByPublicId(normalized);
      if (!found) {
        pushToast(tr(lang, 'ws_members_not_found'));
        return;
      }
      setCache(c => ({ ...c, [found.id]: { nickname: found.nickname, avatar_variant: found.avatar_variant } }));
      addWorkspaceMember(found.id, addRole);
      pushToast(tr(lang, 'ws_members_added'));
      setPid('');
      setAddRole('editor');
    } catch {
      pushToast(tr(lang, 'ws_members_not_found'));
    } finally {
      setBusy(false);
    }
  };

  const displayName = (m: WorkspaceMember): string => {
    if (m.user_id && m.user_id === boundUserId) return tr(lang, 'ws_members_you');
    const cached = m.user_id ? cache[m.user_id]?.nickname : null;
    if (cached) return cached;
    return m.user_id ? m.user_id.slice(0, 8) : '—';
  };

  const avatarVariant = (m: WorkspaceMember): number => {
    const v = m.user_id ? cache[m.user_id]?.avatar_variant : undefined;
    return typeof v === 'number' ? v : 1;
  };

  return (
    <div className="max-w-2xl">
      <h3 className="font-display text-[16px] font-semibold mb-3">{tr(lang, 'ws_tab_members')}</h3>

      {isOwner && (
        <div className="flex flex-col gap-2 mb-4 p-3 border border-border-soft rounded-lg bg-surface">
          <div className="flex gap-2">
            <input
              value={pid}
              onChange={(e) => setPid(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void submitAdd(); }}
              placeholder={tr(lang, 'ws_members_tfid_placeholder')}
              className="flex-1 bg-surface-alt border border-border-soft rounded-lg px-3 py-2 text-[13px] font-mono outline-none focus:border-accent"
            />
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as AddRole)}
              className="bg-surface-alt border border-border-soft rounded-lg px-2.5 py-2 text-[13px]"
            >
              <option value="editor">{tr(lang, 'ws_members_role_editor')}</option>
              <option value="viewer">{tr(lang, 'ws_members_role_viewer')}</option>
            </select>
            <button
              onClick={() => void submitAdd()}
              disabled={busy}
              className={
                'flex items-center gap-1.5 px-3 py-2 text-[13px] rounded-lg font-medium text-white transition-colors ' +
                (busy ? 'bg-accent/40 cursor-not-allowed' : 'bg-accent hover:bg-accent-hover')
              }
            >
              <UserPlus size={15} />
              {tr(lang, 'ws_members_add')}
            </button>
          </div>
        </div>
      )}

      <div className="border border-border-soft rounded-lg overflow-hidden bg-surface">
        {rows.map(m => {
          const isSelf = !!m.user_id && m.user_id === boundUserId;
          return (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 border-b border-border-soft last:border-b-0">
              <Avatar variant={avatarVariant(m)} size={32} />
              <span className="flex-1 text-[13px] truncate">{displayName(m)}</span>
              {isOwner && !isSelf ? (
                <select
                  value={m.role}
                  onChange={(e) => updateWorkspaceMemberRole(m.id, e.target.value as 'owner' | 'editor' | 'viewer')}
                  className="bg-surface-alt border border-border-soft rounded px-2 py-1 text-[12px]"
                >
                  <option value="owner">{tr(lang, 'ws_members_role_owner')}</option>
                  <option value="editor">{tr(lang, 'ws_members_role_editor')}</option>
                  <option value="viewer">{tr(lang, 'ws_members_role_viewer')}</option>
                </select>
              ) : (
                <span className="text-[12px] text-muted px-2 py-1">{roleLabel(m.role)}</span>
              )}
              {isOwner && !isSelf && (
                <button
                  onClick={() => setConfirmId(m.id)}
                  title={tr(lang, 'ws_members_remove')}
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

      <ConfirmDialog
        open={confirmId !== null}
        title={tr(lang, 'ws_members_remove')}
        message={tr(lang, 'ws_members_remove')}
        confirmLabel={tr(lang, 'ws_members_remove')}
        cancelLabel={tr(lang, 'cancel')}
        danger
        onConfirm={() => { if (confirmId !== null) removeWorkspaceMember(confirmId); setConfirmId(null); }}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}
