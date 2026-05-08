import { useState, useEffect } from 'react';
import { Task, useStore } from '../store/useStore';
import { TagChip } from './TagChip';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { Check, Undo2, Maximize2 } from 'lucide-react';
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
  const pushToast = useStore(s => s.pushToast);
  const status = statuses.find(s => s.id === task.status_id);
  const tag = tags.find(t => t.id === task.tag_id);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [editingComment, setEditingComment] = useState(false);
  const [commentDraft, setCommentDraft] = useState(task.comment || '');

  // Sync drafts when underlying task changes (and we're not editing)
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
      // empty — revert
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

  // Card-empty-area click → modal (only if click target is not on an interactive subregion)
  const onCardClick = (e: React.MouseEvent) => {
    // If a click bubbled up from a child that didn't stopPropagation, open modal
    if (editingTitle || editingComment) return;
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

      <div className="flex items-stretch gap-2 pl-4 pr-2 py-2.5">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {tag && (
            <div className="mb-1">
              <TagChip tag={tag} />
            </div>
          )}

          {/* Title — inline editable. Wider click hitbox (py-1 -my-1, horizontal px-2 -mx-2) so the
              clickable region extends ~8px beyond the visible text on each side without affecting
              surrounding layout. */}
          {!editingTitle ? (
            <div
              className="block w-full text-[13.5px] font-semibold text-text leading-snug inline-edit-target cursor-text rounded px-2 -mx-2 py-1 -my-1 hover:bg-surface-alt/40"
              onMouseDown={stopBubble}
              onClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
              title={lang === 'ru' ? 'Нажмите, чтобы изменить' : 'Click to edit'}
              style={{ wordBreak: 'break-word' }}
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

          {/* Comment — inline editable. Slightly wider click zone, smaller than title bonus. */}
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

        {/* Right rail: deadline + maximize + done button */}
        <div className="flex items-center gap-1.5 shrink-0 self-center">
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

