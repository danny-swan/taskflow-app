import { Task, useStore } from '../store/useStore';
import { TagChip } from './TagChip';
import { MarkdownComment } from './MarkdownComment';
import { DeadlineBadge } from './TaskCard';
import { getCheckboxStats, toggleCheckbox } from '../lib/checkboxes';
import { Check, Undo2, Trash2, GripVertical, CheckSquare } from 'lucide-react';
import { tr } from '../lib/i18n';
import { useState } from 'react';

/**
 * KanbanCard — компактная карточка задачи для канбан-доски (v0.9.0).
 *
 * Структура (сверху вниз):
 *   1) Эмодзи + название (line-clamp-2, font-medium)
 *   2) Комментарий (1–3 строки, line-clamp-3, plain text/markdown,
 *      если есть «- [ ]» / «- [x]» — показываем прогресс «☐ 2/5» внизу)
 *   3) Теги (макс. 3 + «+N»)
 *   4) Футер: дедлайн (слева) + действия [⠿][✓][🗑] (справа, hover-visible)
 *
 * Боковая полоска (border-left 3px) окрашена в цвет статуса.
 *
 * Клик по карточке (мимо иконок) открывает существующую TaskModal.
 * Сама сортировка/перенос между колонками обрабатывается родительским
 * <SortableContext> + <DndContext> в KanbanBoard / Tasks.
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

  const isDone = status?.behavior === 'archive' && status?.is_technical !== 1;

  const reopenStatusId =
    statuses.find(s => s.behavior === 'middle' && s.is_technical !== 1)?.id
    ?? statuses.find(s => s.behavior !== 'archive' && s.is_technical !== 1)?.id
    ?? task.status_id;

  const doneStatusId = statuses.find(s => s.behavior === 'archive' && s.is_technical !== 1)?.id;

  const checkboxStats = getCheckboxStats(task.comment);

  const stopBubble = (e: React.SyntheticEvent) => { e.stopPropagation(); };

  const onCardClick = (e: React.MouseEvent) => {
    if (confirmDelete) return;
    e.stopPropagation();
    onOpenModal();
  };

  const onToggleDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDone) {
      updateTask(task.id, { status_id: reopenStatusId });
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

  // v0.9.0: эмодзи из начала title рендерим отдельным span (как делает Sidebar/StatusPill),
  // но title уже может содержать эмодзи внутри текста — здесь просто показываем весь title.
  // Спецификация говорила «эмодзи + название» — на самом деле эмодзи задаётся пользователем
  // в начале названия, отдельного поля под эмодзи нет, поэтому просто берём title.

  const barColor = status?.color || 'var(--border)';
  const barIsWhite = barColor.toUpperCase() === '#FFFFFF';

  return (
    <div
      onClick={onCardClick}
      className={
        'fade-up group relative bg-surface border border-border-soft hover:border-border rounded-lg ' +
        'cursor-pointer transition-shadow hover:shadow-sm overflow-hidden ' +
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

        {/* 2) Комментарий — 1..3 строки (line-clamp-3) */}
        {task.comment && task.comment.trim() && (
          <div
            className="mt-1 text-[11.5px] text-muted leading-snug line-clamp-3"
            onMouseDown={stopBubble}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={stopBubble}
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

        {/* 3) Тег + прогресс чек-листа */}
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

        {/* 4) Футер: дедлайн слева, действия справа */}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <DeadlineBadge deadline={task.deadline} isDone={isDone} />
          </div>
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
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
    </div>
  );
}
