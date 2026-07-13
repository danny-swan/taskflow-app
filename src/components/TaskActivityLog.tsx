// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// TaskActivityLog — сворачиваемая секция «История изменений» внизу модалки
// задачи (Wave C, PR-c-03). Показывается ТОЛЬКО для shared-пространств (журнал
// пишется серверным триггером лишь для kind='shared', см. миграцию 0034).
//
// Данные — из useTaskActivityStore (локальное зеркало task_activity_log,
// наполняется через pull). По умолчанию свёрнуто. Пагинация «Показать ещё»
// по 20 записей.
//
// Приватность авторства (как в MembersTab): own-row RLS на profiles не даёт
// клиенту читать чужие ники по uuid. Поэтому автор резолвится так:
//   • это я (boundUserId) → «вы»;
//   • онлайн-участник (presence) → ник или публичный TF-ID + его аватар;
//   • иначе (офлайн, историческое действие) → короткий id.
// Email НЕ показывается никогда.
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Avatar } from './Avatar';
import { useStore } from '../store/useStore';
import { usePresenceStore } from '../store/usePresenceStore';
import { useTaskActivity, type ActivityRecord, type ActivityKind } from '../store/useTaskActivityStore';
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

function eventText(lang: Lang, kind: ActivityKind): string {
  const key = KIND_KEYS[kind];
  return key ? tr(lang, key) : kind;
}

/** Локальный относительный формат времени (без внешних зависимостей). */
function relativeTime(iso: string, lang: Lang): string {
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

function AuthorRow({ record, lang }: { record: ActivityRecord; lang: Lang }) {
  const boundUserId = useStore((s) => s.boundUserId);
  const presence = usePresenceStore((s) => s.byId[record.userId]);

  let name: string;
  let variant = 1;
  if (boundUserId && record.userId === boundUserId) {
    name = tr(lang, 'ws_activity_you');
  } else if (presence) {
    name = presence.nickname || presence.publicUserId;
    variant = presence.avatarVariant || 1;
  } else {
    name = record.userId ? record.userId.slice(0, 8) : '—';
  }

  return (
    <li className="flex items-start gap-2.5 py-2 border-b border-border-soft last:border-b-0">
      <Avatar variant={variant} size={26} className="shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 text-[12.5px] leading-snug">
        <span className="font-medium">{name}</span>{' '}
        <span className="text-muted">{eventText(lang, record.kind)}</span>
      </div>
      <span className="text-[11px] text-muted shrink-0 mt-0.5" title={new Date(record.createdAt).toLocaleString()}>
        {relativeTime(record.createdAt, lang)}
      </span>
    </li>
  );
}

/**
 * Секция истории. Рендерится вызывающим (TaskModal) ТОЛЬКО когда задача в
 * shared-пространстве. taskUuid=null (задача без uuid — ещё не синхронизирована)
 * → пустой журнал.
 */
export function TaskActivityLog({ taskUuid }: { taskUuid: string | null | undefined }) {
  const lang = useStore((s) => s.language);
  const [open, setOpen] = useState(false);
  const { records, hasMore, loadMore } = useTaskActivity(open ? taskUuid : null);

  return (
    <div className="mt-4 border-t border-border-soft pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] text-muted uppercase tracking-wider hover:text-text transition-colors"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {tr(lang, 'ws_activity_log_title')}
      </button>

      {open && (
        <div className="mt-2">
          {records.length === 0 ? (
            <div className="text-[12px] text-muted py-2">{tr(lang, 'ws_activity_log_empty')}</div>
          ) : (
            <>
              <ul className="list-none m-0 p-0">
                {records.map((r) => (
                  <AuthorRow key={r.id} record={r} lang={lang} />
                ))}
              </ul>
              {hasMore && (
                <button
                  type="button"
                  onClick={loadMore}
                  className="mt-2 text-[12px] text-accent hover:underline"
                >
                  {tr(lang, 'ws_activity_log_load_more')}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
