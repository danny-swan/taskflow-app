// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// MyInvitesSection — «Мои приглашения» в сайдбаре (Wave B, PR-b-04).
//
// Показывает входящие pending-инвайты текущего пользователя (useInvitesStore.
// myPending) с бейджем-счётчиком. Секция рендерится только для привязанного к
// облаку пользователя (boundUserId) — у локального аккаунта серверных инвайтов
// нет. Имя пространства с бэкенда нам недоступно (приглашённый ещё не член ws),
// поэтому показываем нейтральный заголовок «Приглашение в общее пространство»
// (без backend-правок — approach 5.b брифа).
//
// Accept защищён от тарифного лимита: RPC accept_invite бросает limit_exceeded,
// если у пользователя уже максимум пространств — показываем тарифный тост, а не
// сырую ошибку.
import { useEffect, useState } from 'react';
import { Mail, Check, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useInvitesStore } from '../store/useInvitesStore';
import { InvitePinBadge } from './InvitePinBadge';
import { tr } from '../lib/i18n';
import { InviteRpcError, type WorkspaceInvite } from '../lib/invites';

/** Целых дней до истечения (0 → сегодня, отрицательное клипуется к 0). */
function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function MyInvitesSection() {
  const lang = useStore(s => s.language);
  const boundUserId = useStore(s => s.boundUserId);
  const pushToast = useStore(s => s.pushToast);
  const switchWorkspace = useStore(s => s.switchWorkspace);

  const myPending = useInvitesStore(s => s.myPending);
  const loadMyPending = useInvitesStore(s => s.loadMyPending);
  const accept = useInvitesStore(s => s.accept);
  const reject = useInvitesStore(s => s.reject);

  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (boundUserId) void loadMyPending();
  }, [boundUserId, loadMyPending]);

  // Только для привязанного пользователя и только при наличии инвайтов.
  if (!boundUserId || myPending.length === 0) return null;

  const onAccept = async (inv: WorkspaceInvite) => {
    setBusyId(inv.id);
    try {
      const { workspaceId } = await accept(inv.id);
      pushToast(tr(lang, 'ws_my_invites_accepted'));
      if (workspaceId) switchWorkspace(workspaceId);
    } catch (e) {
      const code = e instanceof InviteRpcError ? e.code : 'unknown';
      pushToast(tr(lang, code === 'limit_exceeded' ? 'ws_my_invites_limit_exceeded' : 'ws_my_invites_error'));
      // Устаревший/не-pending инвайт — перечитаем список, чтобы убрать его.
      if (code === 'invite_not_pending' || code === 'invite_expired') void loadMyPending();
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async (inv: WorkspaceInvite) => {
    setBusyId(inv.id);
    try {
      await reject(inv.id);
      pushToast(tr(lang, 'ws_my_invites_rejected'));
    } catch {
      pushToast(tr(lang, 'ws_my_invites_error'));
    } finally {
      setBusyId(null);
    }
  };

  const expiresLabel = (iso: string): string => {
    const n = daysUntil(iso);
    return n <= 0
      ? tr(lang, 'ws_my_invites_expires_today')
      : tr(lang, 'ws_my_invites_expires_in').replace('{n}', String(n));
  };

  const roleLabel = (role: string) =>
    role === 'viewer' ? tr(lang, 'ws_members_role_viewer') : tr(lang, 'ws_members_role_editor');

  return (
    <div className="px-3 pb-2" data-testid="my-invites">
      <div className="flex items-center gap-1.5 px-1 mb-1">
        <span className="relative inline-flex">
          <Mail size={13} className="text-accent" />
          <InvitePinBadge count={myPending.length} />
        </span>
        <span className="text-[11px] uppercase tracking-wider text-faint flex-1">{tr(lang, 'ws_my_invites_title')}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        {myPending.map(inv => {
          const busy = busyId === inv.id;
          return (
            <div key={inv.id} className="rounded-md border border-border-soft bg-[var(--surface-alt)]/40 px-2.5 py-2 flex flex-col gap-1.5">
              <div className="text-[12px] font-medium leading-tight">{tr(lang, 'ws_my_invites_space')}</div>
              <div className="text-[10.5px] text-muted leading-tight">
                {tr(lang, 'ws_my_invites_role_prefix')}: {roleLabel(inv.role)} · {expiresLabel(inv.expires_at)}
              </div>
              <div className="flex gap-1.5 pt-0.5">
                <button
                  onClick={() => void onAccept(inv)}
                  disabled={busy}
                  className={
                    'flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-white transition-colors ' +
                    (busy ? 'bg-accent/40 cursor-not-allowed' : 'bg-accent hover:bg-accent-hover')
                  }
                >
                  <Check size={12} />
                  {tr(lang, 'ws_my_invites_accept')}
                </button>
                <button
                  onClick={() => void onReject(inv)}
                  disabled={busy}
                  className="flex items-center justify-center gap-1 px-2 py-1 rounded text-[11px] border border-border-soft text-muted hover:text-text hover:bg-surface-alt transition-colors disabled:opacity-40"
                >
                  <X size={12} />
                  {tr(lang, 'ws_my_invites_reject')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
