import { useState, useEffect } from 'react';
import { Task, useStore } from '../store/useStore';
import { TagChip } from './TagChip';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { Check, Undo2, Maximize2, Trash2, GripVertical, CheckSquare } from 'lucide-react';
import { tr } from '../lib/i18n';
import { todayISO } from '../lib/utils';
import { MarkdownComment } from './MarkdownComment';
import { getCheckboxStats, toggleCheckbox } from '../lib/checkboxes';

export function TaskCard({
  task, onOpenModal, dragHandleProps, dragging,
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

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [editingComment, setEditingComment] = useState(false);
  const [commentDraft, setCommentDraft] = useState(task.comment || '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isEditing = editingTitle || editingComment;

  useEffect(() => { if (!editingTitle) setTitleDraft(task.title); }, [task.title, editingTitle]);
  useEffect(() => { if (!editingComment) setCommentDraft(task.comment || ''); }, [task.comment, editingComment]);

  const isDone = status?.behavior === 'archive' && status?.is_technical !== 1;

  const reopenStatusId =
    statuses.find(s => s.behavior === 'middle' && s.is_technical !== 1)?.id
    ?? statuses.find(s => s.behavior !== 'archive' && s.is_technical !== 1)?.id
    ?? task.status_id;

  const doneStatusId = statuses.find(s => s.behavior === 'archive' && s.is_technical !== 1)?.id;

  const onToggleDone = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDone) {
      updateTask(task.id, { status_id: reopenStatusId });
    } else if (doneStatusId) {
      // v0.8.12: undo «завершения» — запоминаем прежний статус/финиш и предлагаем откат
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
    // v0.8.12: undo для удаления — запоминаем статус дотого как softDelete
    // перенесёт задачу в «Удалено» / поставит archived=1.
    const prevStatusId = task.status_id;
    const tid = task.id;
    softDeleteTask(tid);
    pushToast(
      tr(lang, 'deleted'),
      {
        label: lang === 'ru' ? 'Отменить' : 'Undo',
        // updateTask сам сбросит archived=0 при возврате в не-technical статус (см. useStore.updateTask).
        onClick: () => updateTask(tid, { status_id: prevStatusId }),
      },
    );
    setConfirmDelete(false);
  };

  const onCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  };

  const onOpenModalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenModal();
  };

  const stopBubble = (e: React.SyntheticEvent) => { e.stopPropagation(); };

  const saveTitle = () => {
    const next = titleDraft.trim();
    if (next && next !== task.title) {
      updateTask(task.id, { title: next });
      pushToast(tr(lang, 'saved'));
    } else if (!next) {
      setTitleDraft(task.title);
    }
    setEditingTitle(false);
  };

  const cancelTitle = () => {
    setTitleDraft(task.title);
    setEditingTitle(false);
  };

  const saveComment = () => {
    const next = commentDraft;
    if (next !== (task.comment || '')) {
      updateTask(task.id, { comment: next });
      pushToast(tr(lang, 'saved'));
    }
    setEditingComment(false);
  };

  const cancelComment = () => {
    setCommentDraft(task.comment || '');
    setEditingComment(false);
  };

  const onCardClick = (e: React.MouseEvent) => {
    if (editingTitle || editingComment || confirmDelete) return;
    onOpenModal();
  };

  const barColor = status?.color || 'var(--border)';
  const barIsWhite = barColor.toUpperCase() === '#FFFFFF';

  // v0.8.6: НЕ навешиваем dragHandleProps на всю карточку — это ломало клик по карточке (открытие модалки)
  // и конфликтовало с inline-редактированием полей. dragHandleProps теперь идёт ТОЛЬКО на кнопку-ручку ··.
  const handleProps = isEditing ? {} : (dragHandleProps ?? {});

  return (
    <div
      onClick={onCardClick}
      className={
        'fade-up group relative bg-surface border border-border-soft hover:border-border rounded-lg ' +
        'cursor-pointer transition-shadow hover:shadow-sm overflow-hidden ' + (dragging ? 'opacity-40' : '')
      }
    >
      {/* Vertical color bar */}
      <div
        aria-hidden
        className="absolute left-0 top-0 bottom-0"
        style={{
          width: 4,
          background: barColor,
          borderRight: barIsWhite ? '1px solid var(--text)' : 'none',
        }}
      />

      {/* Delete button — top right corner, appears on hover */}
      <button
        type="button"
        onClick={onDeleteClick}
        onMouseDown={stopBubble}
        onPointerDown={(e) => e.stopPropagation()}
        title={tr(lang, 'delete_task_q')}
        aria-label={tr(lang, 'delete')}
        className="absolute top-1.5 right-1.5 w-6 h-6 rounded flex items-center justify-center text-muted opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-[var(--status-important)] transition-opacity z-10"
      >
        <Trash2 size={12} />
      </button>

      {/* Task 7: Delete confirmation overlay — buttons centered, medium size, NOT full-width */}
      {confirmDelete && (
        <div
          className="absolute inset-0 backdrop-blur-sm bg-black/30 flex items-center justify-center gap-3 z-20 rounded-lg"
          onClick={stopBubble}
        >
          <button
            onClick={onConfirmDelete}
            className="px-4 py-1.5 text-sm rounded-md bg-red-500 text-white hover:bg-red-600 font-medium"
          >
            {tr(lang, 'delete')}
          </button>
          <button
            onClick={onCancelDelete}
            className="px-4 py-1.5 text-sm rounded-md bg-zinc-200 dark:bg-zinc-700 hover:opacity-90 font-medium"
          >
            {lang === 'ru' ? 'Оставить' : 'Keep'}
          </button>
        </div>
      )}

      <div className="flex items-stretch gap-2 pl-4 pr-2 py-2.5">
        {/* Main content */}
        <div className="flex-1 min-w-0 pr-6">
          {tag && (
            <div className="mb-1">
              <TagChip tag={tag} />
            </div>
          )}

          {!editingTitle ? (
            <div
              className="block w-full text-[13.5px] font-semibold text-text leading-snug inline-edit-target cursor-text rounded px-2 -mx-2 py-1 -my-1 hover:bg-surface-alt/40"
              onMouseDown={stopBubble}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
              title={lang === 'ru' ? 'Нажмите, чтобы изменить' : 'Click to edit'}
              style={{ wordBreak: 'break-word' }}
            >
              {task.title}
            </div>
          ) : (
            <div onMouseDown={stopBubble} onPointerDown={(e) => e.stopPropagation()} onClick={stopBubble} className="-mx-2">
              <AutoGrowTextarea
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onFocus={() => setEditingTitle(true)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).blur(); }
                  if (e.key === 'Escape') { e.preventDefault(); cancelTitle(); }
                }}
                className="text-[13.5px] font-semibold text-text leading-snug bg-surface-alt rounded px-2"
                rows={1}
              />
            </div>
          )}

          {!editingComment ? (
            task.comment ? (
              <div
                className="block w-full text-[12px] text-muted mt-1 inline-edit-target inline-edit-comment cursor-text rounded px-2 -mx-2 py-0.5 hover:bg-surface-alt/40"
                onMouseDown={stopBubble}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setEditingComment(true); }}
                title={lang === 'ru' ? 'Нажмите, чтобы изменить' : 'Click to edit'}
              >
                {/* v0.8.13: рендер комментария поддерживает markdown-чекбоксы.
                    Если в тексте нет «- [ ]» / «- [x]», MarkdownComment рендерит
                    его как обычный whitespace-pre-wrap блок — поведение не меняется. */}
                <MarkdownComment
                  text={task.comment}
                  onToggle={(idx) => {
                    const next = toggleCheckbox(task.comment || '', idx);
                    if (next !== task.comment) updateTask(task.id, { comment: next });
                  }}
                />
              </div>
            ) : null
          ) : (
            <div onMouseDown={stopBubble} onPointerDown={(e) => e.stopPropagation()} onClick={stopBubble} className="mt-1 -mx-2">
              <AutoGrowTextarea
                autoFocus
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                onFocus={() => setEditingComment(true)}
                onBlur={saveComment}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).blur(); }
                  if (e.key === 'Escape') { e.preventDefault(); cancelComment(); }
                }}
                className="text-[12px] text-muted bg-surface-alt rounded px-2"
                rows={1}
              />
            </div>
          )}
        </div>

        {/* Right rail: checklist + deadline + maximize + drag handle + done button */}
        {/* Task 12: GripVertical drag handle between maximize and done, gap-3 */}
        <div className="flex items-center gap-2.5 shrink-0 self-center mr-5">
          {/* v0.8.13: прогресс markdown-чеклиста «2/5». Показываем только
              если в комментарии есть хотя бы один «- [ ]» / «- [x]» — обычные
              карточки выглядят идентично версии v0.8.12. */}
          {(() => {
            const stats = getCheckboxStats(task.comment);
            if (!stats) return null;
            const allDone = stats.done === stats.total;
            return (
              <span
                title={lang === 'ru' ? 'Чек-лист в комментарии' : 'Checklist in comment'}
                className={
                  'inline-flex items-center gap-1 text-[11px] tabular-nums px-1.5 py-0.5 rounded ' +
                  (allDone
                    ? 'text-[var(--status-done,#10b981)] bg-[color-mix(in_srgb,var(--status-done,#10b981)_12%,transparent)]'
                    : 'text-muted bg-surface-alt/60')
                }
              >
                <CheckSquare size={11} />
                {stats.done}/{stats.total}
              </span>
            );
          })()}
          <DeadlineBadge deadline={task.deadline} isDone={isDone} />
          <button
            type="button"
            onClick={onOpenModalClick}
            onMouseDown={stopBubble}
            onPointerDown={(e) => e.stopPropagation()}
            title={lang === 'ru' ? 'Открыть полностью' : 'Open full editor'}
            aria-label={lang === 'ru' ? 'Открыть полностью' : 'Open full editor'}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-alt hover:text-text transition-opacity"
          >
            <Maximize2 size={12} />
          </button>
          {/* v0.8.6: drag handle — единственный элемент с dnd-kit listeners. НЕ гасим pointerdown,
              иначе dnd-kit не увидит начало drag-жеста. Остальная карточка обрабатывает click в модалку. */}
          <button
            type="button"
            {...handleProps}
            title={lang === 'ru' ? 'Перетащить' : 'Drag'}
            aria-label={lang === 'ru' ? 'Перетащить' : 'Drag'}
            className="w-7 h-7 rounded-md flex items-center justify-center text-zinc-400 opacity-0 group-hover:opacity-100 hover:bg-surface-alt cursor-grab active:cursor-grabbing transition-opacity touch-none select-none"
          >
            <GripVertical size={14} />
          </button>
          <button
            type="button"
            onClick={onToggleDone}
            onMouseDown={stopBubble}
            onPointerDown={(e) => e.stopPropagation()}
            title={isDone ? tr(lang, 'mark_reopen') : tr(lang, 'mark_done')}
            aria-label={isDone ? tr(lang, 'mark_reopen') : tr(lang, 'mark_done')}
            className={
              'w-7 h-7 rounded-full flex items-center justify-center border transition-colors ' +
              (isDone
                ? 'border-border-soft text-muted hover:bg-surface-alt'
                : 'border-border-soft text-muted hover:border-[var(--status-done)] hover:text-[var(--status-done)]')
            }
          >
            {isDone ? <Undo2 size={13} /> : <Check size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DeadlineBadge({ deadline, isDone }: { deadline: string | null; isDone: boolean }) {
  const lang = useStore(s => s.language);
  if (!deadline || isDone) return null;
  const today = todayISO();
  const t = today.slice(0, 10);
  const dStart = new Date(t + 'T00:00:00');
  const dEnd = new Date(deadline + 'T00:00:00');
  const diff = Math.round((dEnd.getTime() - dStart.getTime()) / 86400000);

  if (diff === 0) {
    // v0.8.6: сегодня — синий
    return (
      <span className="text-[11px] font-medium whitespace-nowrap" style={{ color: 'var(--accent)' }}>
        {tr(lang, 'today_word')}
      </span>
    );
  }
  if (diff < 0) {
    // Просрочено — красный
    return (
      <span
        className="text-[11px] font-bold whitespace-nowrap"
        style={{ color: 'var(--status-overdue)' }}
        title={`${tr(lang, 'overdue_word')} ${Math.abs(diff)} ${tr(lang, 'days_short')}`}
      >
        ⚠ {tr(lang, 'overdue_word')} {Math.abs(diff)} {tr(lang, 'days_short')}
      </span>
    );
  }
  // v0.8.7: 1–3 дня осталось — оранжевый; 4+ — серый по умолчанию
  let color: string | undefined;
  let bold = false;
  if (diff >= 1 && diff <= 3) {
    color = 'var(--status-progress)';
    bold = true;
  }
  return (
    <span
      className={'text-[11px] whitespace-nowrap ' + (bold ? 'font-semibold' : 'text-muted')}
      style={color ? { color } : undefined}
    >
      {tr(lang, 'days_left')} {diff} {tr(lang, 'days_short')}
    </span>
  );
}
