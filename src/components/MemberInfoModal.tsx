/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v1.1.x — карточка участника пространства. F40, ADR 0031.
 *
 * Открывается кликом по имени участника во вкладке «Участники». Показывает
 * ПУБЛИЧНЫЙ минимум профиля, который отдаёт RPC get_workspace_member_profiles
 * (миграция 0043): аватар (форма + явный цвет), ник, «о себе», TF-id. Email и
 * прочие приватные поля сюда не приходят и не показываются. Роль в пространстве
 * берётся из локального зеркала членства — модалка её только отображает.
 */
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { tr, type Lang } from '../lib/i18n';
import type { MemberProfile } from '../lib/memberProfiles';

export interface MemberInfoModalProps {
  open: boolean;
  lang: Lang;
  profile: MemberProfile | null;
  /** Подпись роли (owner/editor/viewer) — уже локализованная вызывающим. */
  roleLabel?: string;
  onClose: () => void;
}

export function MemberInfoModal({ open, lang, profile, roleLabel, onClose }: MemberInfoModalProps) {
  if (!open || !profile) return null;
  const nickname = profile.nickname?.trim() || null;
  const bio = profile.bio?.trim() || null;

  return (
    <Modal open={open} onClose={onClose} width={420} label={tr(lang, 'ws_member_info_title')}>
      <div className="px-5 py-4 border-b border-border-soft">
        <h3 className="font-display text-[15px] font-semibold">
          {tr(lang, 'ws_member_info_title')}
        </h3>
      </div>

      <div className="px-5 py-4 space-y-4">
        <div className="flex items-center gap-3">
          <Avatar variant={profile.avatar_variant} color={profile.avatar_color} size={56} />
          <div className="min-w-0">
            <div className="text-[14px] font-medium truncate">
              {nickname ?? profile.public_user_id}
            </div>
            {roleLabel && <div className="text-[12px] text-muted">{roleLabel}</div>}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[12px] text-muted uppercase tracking-wide">
            {tr(lang, 'ws_member_info_nickname')}
          </div>
          <div className={'text-[13px] ' + (nickname ? '' : 'text-muted')}>
            {nickname ?? tr(lang, 'ws_member_info_no_nickname')}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[12px] text-muted uppercase tracking-wide">
            {tr(lang, 'ws_member_info_bio')}
          </div>
          <div className={'text-[13px] whitespace-pre-wrap break-words ' + (bio ? '' : 'text-muted')}>
            {bio ?? tr(lang, 'ws_member_info_no_bio')}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-[12px] text-muted uppercase tracking-wide">
            {tr(lang, 'ws_member_info_id')}
          </div>
          <code className="text-[13px] font-mono">{profile.public_user_id}</code>
        </div>
      </div>

      <div className="px-5 py-3 border-t border-border-soft flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-[13px] border border-border-soft rounded-md hover:bg-surface-alt"
        >
          {tr(lang, 'palette_close')}
        </button>
      </div>
    </Modal>
  );
}
