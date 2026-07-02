import { Task, useStore } from '../store/useStore';
import { TagChip } from './TagChip';
import { MarkdownComment } from './MarkdownComment';
import { DeadlineBadge } from './TaskCard';
import { getCheckboxStats, toggleCheckbox } from '../lib/checkboxes';
import { Check, Undo2, Trash2, GripVertical, CheckSquare, Maximize2 } from 'lucide-react';
import { tr } from '../lib/i18n';
import { useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * KanbanCard — компактная карточка задачи для канбан-доски (v0.9.1).
 *
 * Структура (сверху вниз):
 *   1) Эмодзи + название (line-clamp-2, font-medium)
 *   2) Тег + прогресс чек-листа (одна строка: тег слева, значок «☐ 2/5» справа от него)
 *   3) Комментарий (1–3 строки, line-clamp-3, plain text/markdown)
 *   4) Футер: дедлайн (слева) + действия [⛶][⠿][✓][🗑] (справа, hover-visible)
 *
 * Боковая полоска (border-left 3px) окрашена в цвет статуса.
 *
 * Клик по карточке НЕ открывает модалку целиком: модалка открывается
 * только по клику на комментарий или по кнопке-иконке «⛶ Открыть»
 * в футере (Maximize2). Это позволяет спокойно тянуть карточку за любую
 * зону, не рискуя случайно открыть модалку.
 */
export function KanbanCard({
  task,
  onOpenModal,
  dragHandleProps,
  dragging,
}: {
  task: Task;
  onOpenModal: () => void;
  dragHandleProps?: any;
  dragging?: boolean;
}) {
  const lang = useStore(s => s.language);
  const statuses = useStore(s => s.statuses);
  const tags = useStore(s => s.tags);
  const updateTask = useStore(s => s.updateTask);
  const softDeleteTask = useStore(s => s.softDeleteTask);
  const pushToast = useStore(s => s.pushToast);

  const status = statuses.find(s => s.id === task.status_id);
  const tag = tags.find(t => t.id === task.tag_id);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenPickId, setReopenPickId] = useState<number | null>(null);

  const isDone = status?.behavior === 'archive' && status?.is_technical !== 1;

  const reopenStatusId =
    statuses.find(s => s.behavior === 'middle' && s.is_technical !== 1)?.id
    ?? statuses.find(s => s.behavior !== 'archive' && s.is_technical !== 1)?.id
    ?? task.status_id;

  const doneStatusId = statuses.find(s => s.behavior === 'archive' && s.is_technical !== 1)?.id;

  const checkboxStats = getCheckboxStats(task.comment);

  const stopBubble = (e: React.SyntheticEvent) => { e.stopPropagation(); };

  const onOpenClick = (e: React.MouseEvent) => {
    if (confirmDelete) return;
    e.stopPropagation();
    onOpenModal();
  };

  const onToggleDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDone) {
      // v0.9.1 (№9): диалог выбора статуса при возврате из «Выполнено».
      setReopenPickId(reopenStatusId);
      setReopenOpen(true);
    } else if (doneStatusId) {
      const prevStatusId = task.status_id;
      const prevFinish = task.finish_date;
      const tid = task.id;
      updateTask(tid, { status_id: doneStatusId });
      pushToast(
        lang === 'ru' ? 'Задача завершена' : 'Task completed',
        {
          label: lang === 'ru' ? 'Отменить' : 'Undo',
          onClick: () => updateTask(tid, { status_id: prevStatusId, finish_date: prevFinish }),
        },
      );
    }
  };

  const onDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  };

  const onConfirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    const prevStatusId = task.status_id;
    const tid = task.id;
    softDeleteTask(tid);
    pushToast(
      tr(lang, 'deleted'),
      {
        label: lang === 'ru' ? 'Отменить' : 'Undo',
        onClick: () => updateTask(tid, { status_id: prevStatusId }),
      },
    );
    setConfirmDelete(false);
  };

  const onCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  };

  const barColor = status?.color || 'var(--border)';
  const barIsWhite = barColor.toUpperCase() === '#FFFFFF';

  return (
    <div
      className={
        'fade-up group relative bg-surface border border-border-soft hover:border-border rounded-lg ' +
        'transition-shadow hover:shadow-sm overflow-hidden ' +
        (dragging ? 'opacity-40' : '')
      }
    >
      {/* Боковая полоска статуса */}
      <div
        aria-hidden
        className="absolute left-0 top-0 bottom-0"
        style={{
          width: 3,
          background: barColor,
          borderRight: barIsWhite ? '1px solid var(--text)' : 'none',
        }}
      />

      {/* Confirm-overlay удаления */}
      {confirmDelete && (
        <div
          className="absolute inset-0 backdrop-blur-sm bg-black/30 flex items-center justify-center gap-2 z-20 rounded-lg"
          onClick={stopBubble}
        >
          <button
            onClick={onConfirmDelete}
            className="px-3 py-1 text-[12px] rounded-md bg-red-500 text-white hover:bg-red-600 font-medium"
          >
            {tr(lang, 'delete')}
          </button>
          <button
            onClick={onCancelDelete}
            className="px-3 py-1 text-[12px] rounded-md bg-zinc-200 dark:bg-zinc-700 hover:opacity-90 font-medium"
          >
            {lang === 'ru' ? 'Оставить' : 'Keep'}
          </button>
        </div>
      )}

      <div className="pl-3 pr-2 py-2">
        {/* 1) Название */}
        <div
          className="text-[13px] font-medium text-text leading-snug line-clamp-2"
          style={{ wordBreak: 'break-word' }}
        >
          {task.title}
        </div>

        {/* 2) Тег + прогресс чек-листа (между названием и комментарием) */}
        {(tag || checkboxStats) && (
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {tag && <TagChip tag={tag} />}
            {checkboxStats && (
              <span
                title={lang === 'ru' ? 'Чек-лист в комментарии' : 'Checklist in comment'}
                className={
                  'inline-flex items-center gap-1 text-[10px] tabular-nums px-1.5 py-0.5 rounded ' +
                  (checkboxStats.done === checkboxStats.total
                    ? 'text-[var(--status-done,#10b981)] bg-[color-mix(in_srgb,var(--status-done,#10b981)_12%,transparent)]'
                    : 'text-muted bg-surface-alt/60')
                }
              >
                <CheckSquare size={10} />
                {checkboxStats.done}/{checkboxStats.total}
              </span>
            )}
          </div>
        )}

        {/* 3) Комментарий — 1..3 строки. Клик по комментарию открывает модалку. */}
        {task.comment && task.comment.trim() && (
          <div
            className="mt-1.5 text-[11.5px] text-muted leading-snug line-clamp-3 cursor-pointer"
            onMouseDown={stopBubble}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onOpenClick}
            title={lang === 'ru' ? 'Открыть задачу' : 'Open task'}
          >
            <MarkdownComment
              text={task.comment}
              onToggle={(idx) => {
                const next = toggleCheckbox(task.comment || '', idx);
                if (next !== task.comment) updateTask(task.id, { comment: next });
              }}
            />
          </div>
        )}

        {/* 4) Футер: дедлайн слева, действия справа */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <DeadlineBadge deadline={task.deadline} isDone={isDone} />
          </div>
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Открыть модалку */}
            <button
              type="button"
              onClick={onOpenClick}
              onMouseDown={stopBubble}
              onPointerDown={(e) => e.stopPropagation()}
              title={lang === 'ru' ? 'Открыть задачу' : 'Open task'}
              aria-label={lang === 'ru' ? 'Открыть задачу' : 'Open task'}
              className="w-6 h-6 rounded flex items-center justify-center text-muted hover:text-text hover:bg-surface-alt"
            >
              <Maximize2 size={11} />
            </button>
            {/* Drag-handle */}
            <button
              type="button"
              {...(dragHandleProps ?? {})}
              title={lang === 'ru' ? 'Перетащить' : 'Drag'}
              aria-label={lang === 'ru' ? 'Перетащить' : 'Drag'}
              className="w-6 h-6 rounded flex items-center justify-center text-zinc-400 hover:bg-surface-alt cursor-grab active:cursor-grabbing touch-none select-none"
            >
              <GripVertical size={12} />
            </button>
            {/* Done / Reopen */}
            <button
              type="button"
              onClick={onToggleDone}
              onMouseDown={stopBubble}
              onPointerDown={(e) => e.stopPropagation()}
              title={isDone ? tr(lang, 'mark_reopen') : tr(lang, 'mark_done')}
              aria-label={isDone ? tr(lang, 'mark_reopen') : tr(lang, 'mark_done')}
              className={
                'w-6 h-6 rounded-full flex items-center justify-center border transition-colors ' +
                (isDone
                  ? 'border-border-soft text-muted hover:bg-surface-alt'
                  : 'border-border-soft text-muted hover:border-[var(--status-done)] hover:text-[var(--status-done)]')
              }
            >
              {isDone ? <Undo2 size={11} /> : <Check size={12} />}
            </button>
            {/* Delete */}
            <button
              type="button"
              onClick={onDeleteClick}
              onMouseDown={stopBubble}
              onPointerDown={(e) => e.stopPropagation()}
              title={tr(lang, 'delete_task_q')}
              aria-label={tr(lang, 'delete')}
              className="w-6 h-6 rounded flex items-center justify-center text-muted hover:text-[var(--status-important)] hover:bg-surface-alt"
            >
              <Trash2 size={11} />
            </button>
          </div>
        </div>
      </div>

      {/* v0.9.1 (№9): диалог выбора статуса при возврате из «Выполнено» */}
      <ConfirmDialog
        open={reopenOpen}
        title={lang === 'ru' ? 'Вернуть в работу' : 'Reopen task'}
        message={lang === 'ru' ? 'Выберите статус:' : 'Choose the status:'}
        confirmLabel={lang === 'ru' ? 'Вернуть' : 'Reopen'}
        cancelLabel={tr(lang, 'cancel')}
        onConfirm={() => {
          const targetId = reopenPickId ?? reopenStatusId;
          if (targetId) {
            updateTask(task.id, { status_id: targetId });
            pushToast(lang === 'ru' ? 'Задача возвращена в работу' : 'Task reopened');
          }
          setReopenOpen(false);
          setReopenPickId(null);
        }}
        onCancel={() => { setReopenOpen(false); setReopenPickId(null); }}
      >
        <div className="flex flex-col gap-1.5 mt-1" onMouseDown={stopBubble} onPointerDown={(e) => e.stopPropagation()} onClick={stopBubble}>
          {statuses
            .filter(s => s.is_technical !== 1 && s.behavior !== 'archive')
            .map(s => (
              <label key={s.id} className="flex items-center gap-2.5 cursor-pointer text-[13px]">
                <input
                  type="radio"
                  name={`reopen-status-kc-${task.id}`}
                  value={s.id}
                  checked={reopenPickId === s.id}
                  onChange={() => setReopenPickId(s.id)}
                  className="accent-[var(--accent)]"
                />
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: s.color }}
                />
                {s.name}
              </label>
            ))}
        </div>
      </ConfirmDialog>
    </div>
  );
}
