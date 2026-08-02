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
// Render-логика одной записи (аватар/имя/действие/время) вынесена в общий
// ActivityEntry.tsx и переиспользуется в WorkspaceHistoryTab (PR-c-04).
import { useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { ActivityAuthorRow } from './ActivityEntry';
import { useStore } from '../store/useStore';
import { useTaskActivity } from '../store/useTaskActivityStore';
import { tr } from '../lib/i18n';
import { syncNow } from '../lib/sync';

/**
 * Секция истории. Рендерится вызывающим (TaskModal) ТОЛЬКО когда задача в
 * shared-пространстве. taskUuid=null (задача без uuid — ещё не синхронизирована)
 * → пустой журнал.
 */
export function TaskActivityLog({ taskUuid }: { taskUuid: string | null | undefined }) {
  const lang = useStore((s) => s.language);
  const [open, setOpen] = useState(false);
  const { records, hasMore, loadMore, reload } = useTaskActivity(open ? taskUuid : null);
  const [refreshing, setRefreshing] = useState(false);

  // Обновить журнал. v0.9.26: раньше reload() перечитывал ТОЛЬКО локальное
  // зеркало — если свежие записи ещё не приехали через фоновый realtime-pull,
  // кнопка казалась «не работающей». Теперь сначала syncNow() (полный pull с
  // сервера → наполняет зеркало), потом reload(). syncNow защищён мьютексом.
  // Ошибка сети не ломает обновление — локальный reload() выполняется в finally.
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await syncNow();
    } catch {
      // Офлайн/ошибка сети — показываем то, что есть в зеркале (reload ниже).
    } finally {
      reload();
      setRefreshing(false);
    }
  };

  return (
    <div className="mt-4 border-t border-border-soft pt-3">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] text-muted uppercase tracking-wider hover:text-text transition-colors"
          aria-expanded={open}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          {tr(lang, 'ws_activity_log_title')}
        </button>

        {/* Обновить — только иконка (без подписи), доступное имя из aria-label. */}
        {open && (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label={tr(lang, 'ws_activity_refresh')}
            title={tr(lang, 'ws_activity_refresh')}
            className="p-1 rounded text-muted hover:text-text hover:bg-surface-alt transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {open && (
        <div className="mt-2">
          {records.length === 0 ? (
            <div className="text-[12px] text-muted py-2">{tr(lang, 'ws_activity_log_empty')}</div>
          ) : (
            <>
              <ul className="list-none m-0 p-0">
                {records.map((r) => (
                  <ActivityAuthorRow key={r.id} record={r} lang={lang} />
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
