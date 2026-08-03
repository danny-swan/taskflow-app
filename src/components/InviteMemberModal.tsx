// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// InviteMemberModal — приглашение участника в shared-пространство (Wave B, PR-b-04).
//
// Поле «TF-ID» (валидация формата PUBLIC_ID_RE) + селектор роли (editor/viewer,
// default editor). На «Пригласить» → useInvitesStore.invite (RPC
// invite_to_workspace). Ошибки RPC приходят типизированным InviteRpcError и
// показываются переведённым текстом по коду (см. inviteErrorKey).
import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Modal } from './Modal';
import { useStore } from '../store/useStore';
import { useInvitesStore } from '../store/useInvitesStore';
import { tr, type Dict } from '../lib/i18n';
import { PUBLIC_ID_RE } from '../lib/profile';
import { InviteRpcError, type InviteErrorCode, type InviteRole } from '../lib/invites';

/** InviteErrorCode → i18n-ключ переведённого сообщения. */
export function inviteErrorKey(code: InviteErrorCode): keyof Dict {
  switch (code) {
    case 'target_not_found': return 'ws_invite_err_target_not_found';
    case 'target_free_plan': return 'ws_invite_err_target_free_plan';
    case 'self_invite': return 'ws_invite_err_self_invite';
    case 'already_member': return 'ws_invite_err_already_member';
    case 'not_authorized': return 'ws_invite_err_not_authorized';
    case 'invalid_role': return 'ws_invite_err_invalid_role';
    case 'limit_exceeded': return 'ws_invite_err_limit_exceeded';
    case 'invite_expired': return 'ws_invite_err_invite_expired';
    case 'invite_not_pending': return 'ws_invite_err_invite_not_pending';
    case 'ws_not_synced': return 'ws_invite_err_ws_not_synced';
    case 'ws_sync_failed': return 'ws_invite_err_ws_sync_failed';
    default: return 'ws_invite_err_unknown';
  }
}

export function InviteMemberModal({
  open, workspaceId, onClose,
}: {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
}) {
  const lang = useStore(s => s.language);
  const pushToast = useStore(s => s.pushToast);
  const invite = useInvitesStore(s => s.invite);

  const [pid, setPid] = useState('');
  const [role, setRole] = useState<InviteRole>('editor');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = pid.trim().toUpperCase();
  const formatValid = PUBLIC_ID_RE.test(normalized);

  const reset = () => { setPid(''); setRole('editor'); setError(null); setBusy(false); };
  const handleClose = () => { reset(); onClose(); };

  const submit = async () => {
    setError(null);
    if (!formatValid) {
      setError(tr(lang, 'ws_members_invalid_tfid'));
      return;
    }
    setBusy(true);
    try {
      await invite({ workspaceId, targetPublicId: normalized, role });
      pushToast(tr(lang, 'ws_invite_success'));
      handleClose();
    } catch (e) {
      const code: InviteErrorCode = e instanceof InviteRpcError ? e.code : 'unknown';
      setError(tr(lang, inviteErrorKey(code)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} width={420} label={tr(lang, 'ws_invite_modal_title')}>
      <div className="p-5 flex flex-col gap-4">
        <h2 className="font-display text-[16px] font-semibold">{tr(lang, 'ws_invite_modal_title')}</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted">{tr(lang, 'ws_invite_tfid_label')}</span>
          <input
            autoFocus
            value={pid}
            onChange={(e) => { setPid(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void submit(); }}
            placeholder="TF-ABC12"
            className="bg-surface-alt border border-border-soft rounded-lg px-3 py-2 text-[14px] font-mono outline-none focus:border-accent"
          />
          <span className="text-[11px] text-faint">{tr(lang, 'ws_invite_tfid_hint')}</span>
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-muted">{tr(lang, 'ws_invite_role_label')}</span>
          <div className="flex gap-2">
            {(['editor', 'viewer'] as const).map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                aria-pressed={role === r}
                className={
                  'flex-1 px-3 py-2 rounded-lg border text-[13px] transition-colors ' +
                  (role === r
                    ? 'bg-accent text-white border-accent'
                    : 'border-border-soft hover:bg-surface-alt')
                }
              >
                {r === 'editor' ? tr(lang, 'ws_members_role_editor') : tr(lang, 'ws_members_role_viewer')}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-[var(--status-important)]/30 bg-[var(--status-important)]/10 px-3 py-2.5 text-[12px] text-[var(--status-important)] leading-relaxed"
          >
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-[13px] border border-border-soft rounded-lg hover:bg-surface-alt transition-colors"
          >
            {tr(lang, 'cancel')}
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !formatValid}
            className={
              'flex items-center gap-1.5 px-4 py-2 text-[13px] rounded-lg font-medium transition-colors text-white ' +
              (busy || !formatValid ? 'bg-accent/40 cursor-not-allowed' : 'bg-accent hover:bg-accent-hover')
            }
          >
            <UserPlus size={15} />
            {tr(lang, 'ws_invite_submit')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
