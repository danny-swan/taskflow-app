// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// PresenceIndicator — ряд аватарок «кто сейчас онлайн» в shared-пространстве
// (Wave C, PR-c-01).
//
// Чисто презентационный: читает эфемерный usePresenceStore (его наполняет
// presence.ts через Realtime Presence). Жизненный цикл канала висит на
// useWorkspacePresence() в Dashboard — здесь только отрисовка.
//
// Правила показа:
//   • только shared (kind === 'shared'); на personal — null;
//   • пустой список (я один) → null, пустого ряда не рисуем;
//   • максимум MAX_VISIBLE чипов, дальше — «+N»;
//   • подпись: nickname, если задан и непустой; иначе public_user_id (TF-XXXXXX).
//     EMAIL не показываем никогда.
import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { useCurrentWorkspace } from '../store/workspaceScope';
import { usePresenceStore, type PresenceMember } from '../store/usePresenceStore';
import { Avatar } from './Avatar';
import { tr } from '../lib/i18n';

/** Сколько аватарок показываем «в лицо» до сворачивания в «+N». */
const MAX_VISIBLE = 5;

/** Подпись участника: непустой nickname, иначе публичный TF-ID (без email). */
function memberLabel(m: PresenceMember): string {
  const nick = m.nickname?.trim();
  return nick ? nick : m.publicUserId;
}

export function PresenceIndicator() {
  const lang = useStore((s) => s.language);
  const workspace = useCurrentWorkspace();
  // Селектим стабильную ссылку byId и деривим массив через useMemo — иначе
  // Object.values(...) на каждый рендер даёт новую ссылку и зациклит zustand.
  const byId = usePresenceStore((s) => s.byId);
  const members = useMemo<PresenceMember[]>(() => Object.values(byId), [byId]);

  if (workspace?.kind !== 'shared' || members.length === 0) return null;

  const overflow = members.length > MAX_VISIBLE;
  // При переполнении показываем MAX_VISIBLE-1 лиц + бейдж «+N».
  const visible = overflow ? members.slice(0, MAX_VISIBLE - 1) : members;
  const hiddenCount = members.length - visible.length;

  return (
    <div
      className="flex items-center"
      aria-label={tr(lang, 'ws_presence_aria')}
      data-testid="presence-indicator"
    >
      {visible.map((m, i) => {
        const label = memberLabel(m);
        return (
          <span
            key={m.userId}
            title={label}
            data-testid="presence-avatar"
            className={'rounded-full ring-2 ring-surface bg-surface' + (i > 0 ? ' -ml-2' : '')}
          >
            <Avatar variant={m.avatarVariant} size={26} />
          </span>
        );
      })}
      {overflow && (
        <span
          data-testid="presence-overflow"
          className="-ml-2 inline-flex items-center justify-center rounded-full ring-2 ring-surface bg-surface-alt border border-border-soft text-[11px] font-medium text-muted"
          style={{ width: 26, height: 26 }}
        >
          +{hiddenCount}
        </span>
      )}
    </div>
  );
}
