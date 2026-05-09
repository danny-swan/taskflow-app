import { useState, useEffect } from 'react';
import { Task, useStore } from '../store/useStore';
import { TagChip } from './TagChip';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { Check, Undo2, Maximize2, Trash2 } from 'lucide-react';
import { tr } from '../lib/i18n';
import { todayISO } from '../lib/utils';

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
      updateTask(task.id, { status_id: doneStatusId });
    }
  };

  const onDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  };

  const onConfirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    softDeleteTask(task.id);
    pushToast(tr(lang, 'deleted'));
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

  return (
    <div
      onClick={onCardClick}
      {...dragHandleProps}
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
        title={tr(lang, 'delete_task_q')}
        aria-label={tr(lang, 'delete')}
        className="absolute top-1.5 right-1.5 w-6 h-6 rounded flex items-center justify-center text-muted opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:text-[var(--status-important)] transition-opacity z-10"
      >
        <Trash2 size={12} />
      </button>

      {/* Delete confirmation popover */}
      {confirmDelete && (
        <div
          className="absolute inset-0 bg-surface/95 backdrop-blur-sm flex flex-col items-center justify-center gap-2 z-20 rounded-lg"
          onClick={stopBubble}
        >
          <div className="text-[13px] font-medium">{tr(lang, 'delete_task_q')}</div>
          <div className="flex gap-2">
            <button
              onClick={onConfirmDelete}
              className="px-3 py-1 text-[12px] bg-[var(--status-important)] text-white rounded-md hover:opacity-90"
            >{tr(lang, 'delete')}</button>
            <button
              onClick={onCancelDelete}
              className="px-3 py-1 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
            >{tr(lang, 'cancel')}</button>
          </div>
        </div>
      )}

      <div className="flex items-stretch gap-2 pl-4 pr-2 py-2.5">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {tag && (
            <div className="mb-1">
              <TagChip tag={tag} />
            </div>
          )}

          {!editingTitle ? (
            <div
              className="block w-full text-[13.5px] font-semibold text-text leading-snug inline-edit-target cursor-text rounded px-2 -mx-2 py-1 -my-1 hover:bg-surface-alt/40"
              onMouseDown={stopBubble}
              onClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
              title={lang === 'ru' ? 'Нажмите, чтобы изменить' : 'Click to edit'}
              style={{ wordBreak: 'break-word', paddingRight: '1.5rem' }}
            >
              {task.title}
            </div>
          ) : (
            <div onMouseDown={stopBubble} onClick={stopBubble} className="-mx-2">
              <AutoGrowTextarea
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
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
                onClick={(e) => { e.stopPropagation(); setEditingComment(true); }}
                title={lang === 'ru' ? 'Нажмите, чтобы изменить' : 'Click to edit'}
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {task.comment}
              </div>
            ) : null
          ) : (
            <div onMouseDown={stopBubble} onClick={stopBubble} className="mt-1 -mx-2">
              <AutoGrowTextarea
                autoFocus
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
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

        {/* Right rail: deadline + maximize + done button — shifted left to give space for × */}
        <div className="flex items-center gap-1 shrink-0 self-center mr-5">
          <DeadlineBadge deadline={task.deadline} isDone={isDone} />
          <button
            type="button"
            onClick={onOpenModalClick}
            onMouseDown={stopBubble}
            title={lang === 'ru' ? 'Открыть полностью' : 'Open full editor'}
            aria-label={lang === 'ru' ? 'Открыть полностью' : 'Open full editor'}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-alt hover:text-text transition-opacity"
          >
            <Maximize2 size={12} />
          </button>
          <button
            type="button"
            onClick={onToggleDone}
            onMouseDown={stopBubble}
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

function DeadlineBadge({ deadline, isDone }: { deadline: string | null; isDone: boolean }) {
  const lang = useStore(s => s.language);
  if (!deadline || isDone) return null;
  const today = todayISO();
  const t = today.slice(0, 10);
  const dStart = new Date(t + 'T00:00:00');
  const dEnd = new Date(deadline + 'T00:00:00');
  const diff = Math.round((dEnd.getTime() - dStart.getTime()) / 86400000);

  if (diff === 0) {
    return (
      <span className="text-[11px] font-medium" style={{ color: 'var(--accent)' }}>
        {tr(lang, 'today_word')}
      </span>
    );
  }
  if (diff < 0) {
    return (
      <span
        className="text-[11px] font-bold"
        style={{ color: 'var(--status-overdue)' }}
        title={`${tr(lang, 'overdue_word')} ${Math.abs(diff)} ${tr(lang, 'days_short')}`}
      >
        ⚠ {tr(lang, 'overdue_word')} {Math.abs(diff)} {tr(lang, 'days_short')}
      </span>
    );
  }
  return (
    <span className="text-[11px] text-muted whitespace-nowrap">
      {tr(lang, 'days_left')} {diff} {tr(lang, 'days_short')}
    </span>
  );
}
