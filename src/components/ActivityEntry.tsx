// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// ActivityEntry — общая render-логика одной записи журнала активности (Wave C).
//
// Выделено из TaskActivityLog.tsx (PR-c-03), чтобы переиспользовать в двух местах:
//   • TaskActivityLog — история одной задачи внизу модалки;
//   • WorkspaceHistoryTab (PR-c-04) — общий лог по всему пространству.
//
// Приватность авторства: own-row RLS на profiles не даёт клиенту читать чужие ники
// по uuid, поэтому автор резолвится так:
//   • это я (boundUserId) → «вы»;
//   • онлайн-участник (presence) → ник или публичный TF-ID + его аватар;
//   • F40 (ADR 0031): офлайн-участник → кэш публичных профилей пространства
//     (get_workspace_member_profiles), то есть ник либо TF-id вместо куска uuid;
//   • если и в кэше нет — нейтральная подпись «Участник» (внутренний uuid в UI
//     не показываем никогда).
// Email НЕ показывается никогда.
import type { ReactNode } from 'react';
import { Avatar } from './Avatar';
import { lookupCachedMemberProfile } from '../lib/memberProfiles';
import { useStore } from '../store/useStore';
import { usePresenceStore } from '../store/usePresenceStore';
import type { ActivityRecord, ActivityKind } from '../store/useTaskActivityStore';
import { tr, type Lang } from '../lib/i18n';

const KIND_KEYS: Record<ActivityKind, Parameters<typeof tr>[1]> = {
  created: 'ws_activity_created',
  status_changed: 'ws_activity_status_changed',
  deadline_changed: 'ws_activity_deadline_changed',
  title_changed: 'ws_activity_title_changed',
  description_changed: 'ws_activity_description_changed',
  deleted: 'ws_activity_deleted',
  restored: 'ws_activity_restored',
  tag_added: 'ws_activity_tag_added',
  tag_removed: 'ws_activity_tag_removed',
};

/** Локализованный текст действия по типу события. */
export function eventText(lang: Lang, kind: ActivityKind): string {
  const key = KIND_KEYS[kind];
  return key ? tr(lang, key) : kind;
}

/** Локальный относительный формат времени (без внешних зависимостей). */
export function relativeTime(iso: string, lang: Lang): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const ru = lang === 'ru';
  if (diffSec < 60) return ru ? 'только что' : 'just now';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return ru ? `${min} мин назад` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return ru ? `${hr} ч назад` : `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return ru ? `${days} дн назад` : `${days}d ago`;
  // Старше недели — абсолютная дата (локаль).
  return new Date(iso).toLocaleDateString(ru ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Строка записи журнала: аватар + имя автора + локализованное действие +
 * relative-время (tooltip с абсолютным). `extra` — опциональный слот после
 * действия (в workspace-логе туда кладётся ссылка на задачу).
 */
export function ActivityAuthorRow({
  record,
  lang,
  extra,
}: {
  record: ActivityRecord;
  lang: Lang;
  extra?: ReactNode;
}) {
  const boundUserId = useStore((s) => s.boundUserId);
  const presence = usePresenceStore((s) => s.byId[record.userId]);

  let name: string;
  let variant = 1;
  let color: string | null = null;
  const cached = lookupCachedMemberProfile(record.userId);
  if (boundUserId && record.userId === boundUserId) {
    // F51: своя строка — подпись «вы», НО аватар всё равно свой.
    // Раньше в этой ветке задавалось только имя, а variant/color оставались
    // дефолтными 1/null — поэтому в истории у себя была заглушка, хотя на
    // «Участниках» аватар рисовался верно. Presence тут не помогает по умыслу:
    // `usePresenceStore.byId` сознательно не содержит самого себя (lib/presence.ts),
    // так что единственный источник — кэш публичных профилей (F40, ADR 0031),
    // куда свой профиль кладёт ProfileBlock и RPC участников (он возвращает
    // вызывающего тоже). Нет кэша — остаётся старое поведение (вариант 1).
    name = tr(lang, 'ws_activity_you');
    variant = cached?.avatar_variant || 1;
    color = cached?.avatar_color ?? null;
  } else if (presence) {
    name = presence.nickname || presence.publicUserId;
    variant = presence.avatarVariant || 1;
    color = presence.avatarColor ?? cached?.avatar_color ?? null;
  } else if (cached) {
    name = cached.nickname?.trim() || cached.public_user_id;
    variant = cached.avatar_variant || 1;
    color = cached.avatar_color ?? null;
  } else {
    name = record.userId ? tr(lang, 'ws_members_unknown') : '—';
  }

  return (
    <li className="flex items-start gap-2.5 py-2 border-b border-border-soft last:border-b-0">
      <Avatar variant={variant} color={color} size={26} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 text-[12.5px] leading-snug">
        <span className="font-medium">{name}</span>{' '}
        <span className="text-muted">{eventText(lang, record.kind)}</span>
        {extra ? <> {extra}</> : null}
      </div>
      <span className="text-[11px] text-muted shrink-0 mt-0.5" title={new Date(record.createdAt).toLocaleString()}>
        {relativeTime(record.createdAt, lang)}
      </span>
    </li>
  );
}
