// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// WorkspaceHistoryTab — вкладка «История» ws-настроек (Wave C, PR-c-04).
//
// Общий лог активности по всему пространству: переиспользует локальное зеркало
// task_activity_log (PR-c-03) через useWorkspaceActivity (workspace-scope выборка,
// клиентские фильтры, пагинация по 50). Read-only для всех ролей (RLS разрешает
// SELECT любому участнику). Рендерится вызывающим ТОЛЬКО для shared-пространств.
//
// Фильтры (клиентские): по типу действия (мультивыбор), по участнику, по задаче
// (поиск по заголовку). Ссылка на живую задачу открывает её модалку через
// навигацию на /tasks; удалённая задача помечается «(удалена)» без ссылки.
// Email нигде не показывается (см. ActivityEntry).
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ListFilter } from 'lucide-react';
import { ActivityAuthorRow, eventText } from './ActivityEntry';
import { useStore } from '../store/useStore';
import { usePresenceStore } from '../store/usePresenceStore';
import {
  useWorkspaceActivity,
  type ActivityKind,
  type ActivityRecord,
} from '../store/useTaskActivityStore';
import { tr } from '../lib/i18n';

const ORDERED_KINDS: ActivityKind[] = [
  'created',
  'status_changed',
  'deadline_changed',
  'title_changed',
  'description_changed',
  'tag_added',
  'tag_removed',
  'deleted',
  'restored',
];

/** Закрытие поповера по клику вне его границ. */
function useCloseOnOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  return {
    ref,
    onBlur: (e: React.FocusEvent<HTMLDivElement>) => {
      if (!ref.current?.contains(e.relatedTarget as Node)) onClose();
    },
  };
}

export function WorkspaceHistoryTab() {
  const lang = useStore((s) => s.language);
  const workspaceId = useStore((s) => s.currentWorkspaceId);
  const boundUserId = useStore((s) => s.boundUserId);
  const members = useStore((s) => s.workspaceMembers);
  const tasks = useStore((s) => s.tasks);
  const presence = usePresenceStore((s) => s.byId);
  const navigate = useNavigate();

  const [kinds, setKinds] = useState<ActivityKind[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [taskQuery, setTaskQuery] = useState('');
  const [kindOpen, setKindOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  const kindPop = useCloseOnOutside(() => setKindOpen(false));
  const userPop = useCloseOnOutside(() => setUserOpen(false));

  // Карта задач по серверному uuid: title + признак «жива».
  const taskByUuid = useMemo(() => {
    const map = new Map<string, { id: number; title: string; deleted: boolean }>();
    for (const t of tasks) {
      if (t.uuid) map.set(t.uuid, { id: t.id, title: t.title, deleted: !!t.deleted_at });
    }
    return map;
  }, [tasks]);

  // Текстовый фильтр по задаче → множество подходящих uuid (клиентский).
  const taskIds = useMemo(() => {
    const q = taskQuery.trim().toLowerCase();
    if (!q) return null;
    const ids: string[] = [];
    for (const [uuid, t] of taskByUuid) {
      if (t.title.toLowerCase().includes(q)) ids.push(uuid);
    }
    return ids;
  }, [taskQuery, taskByUuid]);

  const { records, hasMore, loadMore, total } = useWorkspaceActivity(workspaceId, {
    kinds,
    userId,
    taskIds,
  });

  // Участники текущего пространства — для дропдауна фильтра «Участник».
  const memberOptions = useMemo(
    () => members.filter((m) => m.workspace_id === workspaceId && m.user_id),
    [members, workspaceId],
  );

  const memberLabel = (uid: string | null): string => {
    if (!uid) return tr(lang, 'ws_history_filter_all');
    if (uid === boundUserId) return tr(lang, 'ws_activity_you');
    const p = presence[uid];
    if (p) return p.nickname || p.publicUserId;
    return uid.slice(0, 8);
  };

  const toggleKind = (k: ActivityKind) =>
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  const kindButtonLabel =
    kinds.length === 0 ? tr(lang, 'ws_history_filter_all') : `${kinds.length}`;

  const openTask = (rec: ActivityRecord) => {
    const t = taskByUuid.get(rec.taskId);
    if (t && !t.deleted) navigate(`/tasks?task=${t.id}`);
  };

  const taskExtra = (rec: ActivityRecord) => {
    const t = taskByUuid.get(rec.taskId);
    const payloadTitle = typeof rec.payload.title === 'string' ? (rec.payload.title as string) : null;
    const title = t?.title || payloadTitle || rec.taskId.slice(0, 8);
    const alive = !!t && !t.deleted;
    if (alive) {
      return (
        <button
          type="button"
          onClick={() => openTask(rec)}
          className="text-accent hover:underline break-words text-left"
        >
          «{title}»
        </button>
      );
    }
    return (
      <span className="text-muted break-words">
        «{title}» <span className="text-faint">{tr(lang, 'ws_history_task_deleted')}</span>
      </span>
    );
  };

  return (
    <div className="max-w-2xl">
      <h3 className="font-display text-[16px] font-semibold mb-3">{tr(lang, 'ws_history_tab_title')}</h3>

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Тип действия — мультивыбор */}
        <div className="relative" ref={kindPop.ref} onBlur={kindPop.onBlur}>
          <button
            type="button"
            onClick={() => setKindOpen((v) => !v)}
            aria-expanded={kindOpen}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] rounded-lg border border-border-soft hover:bg-surface-alt"
          >
            <ListFilter size={14} />
            {tr(lang, 'ws_history_filter_kind')}: {kindButtonLabel}
            <ChevronDown size={13} />
          </button>
          {kindOpen && (
            <div className="absolute z-10 mt-1 w-56 max-h-72 overflow-y-auto bg-surface border border-border-soft rounded-lg shadow-lg p-1.5">
              {ORDERED_KINDS.map((k) => (
                <label
                  key={k}
                  className="flex items-center gap-2 px-2 py-1.5 text-[12.5px] rounded hover:bg-surface-alt cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={kinds.includes(k)}
                    onChange={() => toggleKind(k)}
                  />
                  <span>{eventText(lang, k)}</span>
                </label>
              ))}
              {kinds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setKinds([])}
                  className="w-full text-left px-2 py-1.5 mt-1 text-[12px] text-accent hover:bg-surface-alt rounded"
                >
                  {tr(lang, 'ws_history_filter_all')}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Участник */}
        <div className="relative" ref={userPop.ref} onBlur={userPop.onBlur}>
          <button
            type="button"
            onClick={() => setUserOpen((v) => !v)}
            aria-expanded={userOpen}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] rounded-lg border border-border-soft hover:bg-surface-alt"
          >
            {tr(lang, 'ws_history_filter_user')}: {memberLabel(userId)}
            <ChevronDown size={13} />
          </button>
          {userOpen && (
            <div className="absolute z-10 mt-1 w-56 max-h-72 overflow-y-auto bg-surface border border-border-soft rounded-lg shadow-lg p-1.5">
              <button
                type="button"
                onClick={() => { setUserId(null); setUserOpen(false); }}
                className="w-full text-left px-2 py-1.5 text-[12.5px] rounded hover:bg-surface-alt"
              >
                {tr(lang, 'ws_history_filter_all')}
              </button>
              {memberOptions.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { setUserId(m.user_id); setUserOpen(false); }}
                  className={'w-full text-left px-2 py-1.5 text-[12.5px] rounded hover:bg-surface-alt ' +
                    (userId === m.user_id ? 'text-accent font-medium' : '')}
                >
                  {memberLabel(m.user_id)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Задача — текстовый поиск */}
        <input
          type="text"
          value={taskQuery}
          onChange={(e) => setTaskQuery(e.target.value)}
          placeholder={tr(lang, 'ws_history_filter_task')}
          aria-label={tr(lang, 'ws_history_filter_task')}
          className="flex-1 min-w-[140px] px-3 py-1.5 text-[12.5px] rounded-lg border border-border-soft bg-surface-alt outline-none focus:border-accent"
        />
      </div>

      {/* Список */}
      {total === 0 ? (
        <div className="px-3 py-10 text-center text-muted text-[13px]">{tr(lang, 'ws_history_empty')}</div>
      ) : (
        <>
          <ul className="list-none m-0 p-0">
            {records.map((r) => (
              <ActivityAuthorRow key={r.id} record={r} lang={lang} extra={taskExtra(r)} />
            ))}
          </ul>
          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              className="mt-3 text-[12.5px] text-accent hover:underline"
            >
              {tr(lang, 'ws_history_load_more')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
