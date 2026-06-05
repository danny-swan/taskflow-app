import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useStore, Task } from '../store/useStore';
import { tr } from '../lib/i18n';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { Trash2, X, AlertTriangle, Smile } from 'lucide-react';
import { EmojiPicker, useEmojiPicker } from './EmojiPicker';

export function TaskModal({
  task, onClose,
}: {
  task: Task | null;
  onClose: () => void;
}) {
  const lang = useStore(s => s.language);
  const statuses = useStore(s => s.statuses);
  const tags = useStore(s => s.tags);
  const updateTask = useStore(s => s.updateTask);
  const softDeleteTask = useStore(s => s.softDeleteTask);
  const addTag = useStore(s => s.addTag);
  const pushToast = useStore(s => s.pushToast);

  const [draft, setDraft] = useState<Task | null>(task);
  const [newTagName, setNewTagName] = useState('');
  const [showNewTag, setShowNewTag] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // v0.8.8: emoji-picker для Название/Комментарий
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const titleEmoji = useEmojiPicker(
    titleRef,
    draft?.title ?? '',
    (next) => setDraft(d => (d ? { ...d, title: next } : d)),
  );
  const commentEmoji = useEmojiPicker(
    commentRef,
    draft?.comment ?? '',
    (next) => setDraft(d => (d ? { ...d, comment: next } : d)),
  );

  useEffect(() => { setDraft(task); }, [task]);

  if (!draft) return null;

  const save = () => {
    updateTask(draft.id, {
      title: draft.title,
      comment: draft.comment,
      tag_id: draft.tag_id,
      status_id: draft.status_id,
      start_date: draft.start_date,
      deadline: draft.deadline,
      // finish_date is system-managed by status logic; pass through if user touched it
      finish_date: draft.finish_date,
    });
    pushToast(tr(lang, 'saved'));
    onClose();
  };
  const remove = () => setConfirmOpen(true);
  const confirmDelete = () => {
    softDeleteTask(draft.id);
    setConfirmOpen(false);
    pushToast(tr(lang, 'deleted'));
    onClose();
  };

  return (
    <>
      <Modal open={!!task} onClose={onClose} width={600} label="Edit task">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-soft">
          <h3 className="font-display font-semibold text-[15px]">Задача</h3>
          <button onClick={onClose} className="p-1 hover:bg-surface-alt rounded" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {/* Status + Tag row */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Field label={tr(lang, 'status')}>
              <select
                value={draft.status_id}
                onChange={(e) => setDraft({ ...draft, status_id: parseInt(e.target.value, 10) })}
                className="w-full bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
              >
                {statuses.filter(s => s.is_technical !== 1).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label={tr(lang, 'tag')}>
              {!showNewTag ? (
                <div className="flex gap-1.5">
                  <select
                    value={draft.tag_id ?? ''}
                    onChange={(e) => setDraft({ ...draft, tag_id: e.target.value ? parseInt(e.target.value, 10) : null })}
                    className="flex-1 bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
                  >
                    <option value="">—</option>
                    {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowNewTag(true)}
                    className="px-2 text-[13px] border border-border-soft rounded hover:bg-surface-alt"
                  >+</button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <input
                    autoFocus
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Новый тэг"
                    className="flex-1 bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newTagName.trim()) {
                        const id = addTag(newTagName.trim().toUpperCase(), '#5B7FB8');
                        setDraft({ ...draft, tag_id: id });
                        setNewTagName(''); setShowNewTag(false);
                      }
                    }}
                    className="px-2 text-[13px] bg-accent text-white rounded"
                  >ОК</button>
                </div>
              )}
            </Field>
          </div>

          <FieldWithEmoji
            label={tr(lang, 'title')}
            onEmojiClick={titleEmoji.emojiButtonProps.onClick}
            emojiRef={titleEmoji.buttonRef}
          >
            <AutoGrowTextarea
              ref={titleRef}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13.5px] font-semibold"
              rows={1}
            />
          </FieldWithEmoji>

          <FieldWithEmoji
            label={tr(lang, 'comment')}
            onEmojiClick={commentEmoji.emojiButtonProps.onClick}
            emojiRef={commentEmoji.buttonRef}
          >
            <AutoGrowTextarea
              ref={commentRef}
              value={draft.comment || ''}
              onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
              className="bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
              style={{ maxHeight: '50vh', overflowY: 'auto' }}
              rows={3}
            />
          </FieldWithEmoji>

          <div className="grid grid-cols-2 gap-4">
            <Field label={tr(lang, 'start')}>
              <input
                type="date"
                value={draft.start_date || ''}
                onChange={(e) => setDraft({ ...draft, start_date: e.target.value || null })}
                className="w-full bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
              />
            </Field>
            <Field label={tr(lang, 'deadline')}>
              <input
                type="date"
                value={draft.deadline || ''}
                onChange={(e) => setDraft({ ...draft, deadline: e.target.value || null })}
                className="w-full bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
              />
            </Field>
          </div>

          {/* Finish date is system-managed (auto on completion) */}
          {draft.finish_date && (
            <div className="mt-3 text-[11px] text-muted">
              <span className="uppercase tracking-wider">{tr(lang, 'finish')}</span>
              <span className="ml-2 mono">{draft.finish_date}</span>
            </div>
          )}

        </div>

        <div className="px-5 py-3 border-t border-border-soft flex items-center justify-between">
          <button
            onClick={remove}
            className="flex items-center gap-1.5 text-[13px] text-[var(--status-important)] hover:underline"
          >
            <Trash2 size={14} /> {tr(lang, 'delete')}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 text-[13px] border border-border-soft rounded-md hover:bg-surface-alt"
            >{tr(lang, 'cancel')}</button>
            <button
              onClick={save}
              className="px-3.5 py-1.5 text-[13px] bg-accent hover:bg-accent-hover text-white rounded-md font-medium"
            >{tr(lang, 'save')}</button>
          </div>
        </div>

        {/* v0.8.8: emoji-pickers */}
        <EmojiPicker {...titleEmoji.emojiPickerProps} />
        <EmojiPicker {...commentEmoji.emojiPickerProps} />
      </Modal>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} width={420} label="Confirm delete">
        <div className="px-5 py-5">
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{ background: 'color-mix(in srgb, var(--status-important) 15%, transparent)' }}
            >
              <AlertTriangle size={18} style={{ color: 'var(--status-important)' }} />
            </div>
            <div className="flex-1">
              <div className="font-display font-semibold text-[15px] mb-1">{tr(lang, 'confirm_delete_q')}</div>
              <div className="text-[12.5px] text-muted">
                {lang === 'ru'
                  ? 'Задача останется в статистике, но исчезнет из списка задач.'
                  : 'The task will remain in statistics but disappear from your task list.'}
              </div>
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-border-soft flex justify-end gap-2">
          <button
            onClick={() => setConfirmOpen(false)}
            className="px-3.5 py-1.5 text-[13px] border border-border-soft rounded-md hover:bg-surface-alt"
          >{tr(lang, 'cancel')}</button>
          <button
            onClick={confirmDelete}
            className="px-3.5 py-1.5 text-[13px] bg-[var(--status-important)] text-white rounded-md font-medium hover:opacity-90"
          >{tr(lang, 'delete')}</button>
        </div>
      </Modal>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3.5">
      <div className="text-[11px] text-muted uppercase tracking-wider mb-1">{label}</div>
      {children}
    </label>
  );
}

function FieldWithEmoji({
  label,
  children,
  onEmojiClick,
  emojiRef,
}: {
  label: string;
  children: React.ReactNode;
  onEmojiClick: () => void;
  emojiRef: React.Ref<HTMLButtonElement>;
}) {
  return (
    <div className="block mb-3.5">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-muted uppercase tracking-wider">{label}</div>
        <button
          ref={emojiRef}
          type="button"
          onClick={onEmojiClick}
          className="text-muted hover:text-text p-0.5 rounded transition-colors"
          title="Emoji"
        >
          <Smile size={14} />
        </button>
      </div>
      {children}
    </div>
  );
}
