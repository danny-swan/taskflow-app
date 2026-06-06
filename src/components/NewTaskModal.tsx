// v0.8.6: модалка «Новая задача» — заменяет старую вкладку «Добавить».
// Вызывается с вкладки «Задачи» при клике на «+ Новая задача».
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { StatusPill } from './StatusPill';
import { TagChip } from './TagChip';
import { Modal } from './Modal';
import { EmojiPicker, useEmojiPicker } from './EmojiPicker';
import { Smile } from 'lucide-react';
import { insertCheckboxLines } from '../lib/checkboxes';

export function NewTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lang = useStore(s => s.language);
  const statuses = useStore(s => s.statuses);
  const tags = useStore(s => s.tags);
  const addTask = useStore(s => s.addTask);
  const addTagFn = useStore(s => s.addTag);
  const pushToast = useStore(s => s.pushToast);

  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  // v0.8.8: emoji-picker для Название/Комментарий
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const commentRef = useRef<HTMLTextAreaElement | null>(null);
  const titleEmoji = useEmojiPicker(titleRef, title, setTitle);
  const commentEmoji = useEmojiPicker(commentRef, comment, setComment);
  // По умолчанию — «Взять в работу» (третий статус), как в старой странице
  const defaultStatusId = statuses.filter(s => s.is_technical !== 1)[2]?.id
    ?? statuses.filter(s => s.is_technical !== 1)[0]?.id
    ?? 1;
  const [statusId, setStatusId] = useState(defaultStatusId);
  const [tagId, setTagId] = useState<number | null>(null);
  const [start, setStart] = useState('');
  const [deadline, setDeadline] = useState('');
  const [showNewTag, setShowNewTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');

  // Сброс полей при каждом открытии — чтобы не оставалось мусора от прошлого клика
  useEffect(() => {
    if (open) {
      setTitle('');
      setComment('');
      setStatusId(defaultStatusId);
      setTagId(null);
      setStart('');
      setDeadline('');
      setShowNewTag(false);
      setNewTagName('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const status = statuses.find(s => s.id === statusId);
  const tag = tags.find(t => t.id === tagId);

  // v0.8.16: вставка markdown-чекбокса в поле комментария одним кликом
  // (так же как в TaskModal). Раньше кнопки были только в модалке редактирования.
  const insertCheckbox = (kind: 'unchecked' | 'checked' | 'bullet') => {
    const el = commentRef.current;
    const current = comment;
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const { next, caretAt } = insertCheckboxLines(current, start, end, kind);
    setComment(next);
    requestAnimationFrame(() => {
      const e2 = commentRef.current;
      if (!e2) return;
      e2.focus();
      e2.setSelectionRange(caretAt, caretAt);
    });
  };

  const submit = () => {
    if (!title.trim()) return;
    addTask({
      title: title.trim(), comment, status_id: statusId, tag_id: tagId,
      start_date: start || null, deadline: deadline || null,
    });
    pushToast(tr(lang, 'added'));
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} width={640} label="New task">
      <div className="px-5 pt-4 pb-3 border-b border-border-soft">
        <h2 className="font-display text-[16px] font-semibold">{tr(lang, 'add_task')}</h2>
      </div>

      <div className="px-5 py-4 space-y-4 overflow-y-auto">
        <div className="grid grid-cols-2 gap-4">
          <Field label={tr(lang, 'status')}>
            <select
              value={statusId}
              onChange={(e) => setStatusId(parseInt(e.target.value, 10))}
              className="w-full bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
            >
              {statuses.filter(s => s.is_technical !== 1).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label={tr(lang, 'tag')}>
            {!showNewTag ? (
              <div className="flex gap-1.5">
                <select
                  value={tagId ?? ''}
                  onChange={(e) => setTagId(e.target.value ? parseInt(e.target.value, 10) : null)}
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
                  placeholder={lang === 'ru' ? 'Новый тэг' : 'New tag'}
                  className="flex-1 bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newTagName.trim()) {
                      const id = addTagFn(newTagName.trim().toUpperCase(), '#5B7FB8');
                      setTagId(id); setNewTagName(''); setShowNewTag(false);
                    }
                  }}
                  className="px-2 text-[13px] bg-accent text-white rounded"
                >ОК</button>
              </div>
            )}
          </Field>
        </div>

        <FieldWithEmoji label={tr(lang, 'title')} onEmojiClick={titleEmoji.emojiButtonProps.onClick} emojiRef={titleEmoji.buttonRef}>
          <AutoGrowTextarea
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={lang === 'ru' ? 'Название задачи' : 'Task title'}
            className="bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[14px] font-semibold"
            rows={1}
          />
        </FieldWithEmoji>

        <FieldWithEmoji
          label={tr(lang, 'comment')}
          onEmojiClick={commentEmoji.emojiButtonProps.onClick}
          emojiRef={commentEmoji.buttonRef}
          extraToolbar={
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => insertCheckbox('unchecked')}
                title={lang === 'ru' ? 'Вставить чекбокс (- [ ])' : 'Insert checkbox (- [ ])'}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-muted hover:text-text hover:bg-surface-alt rounded transition-colors"
              >
                <span className="text-[13px] leading-none">☐</span>
                <span className="hidden sm:inline">{lang === 'ru' ? 'Чекбокс' : 'Checkbox'}</span>
              </button>
              <button
                type="button"
                onClick={() => insertCheckbox('checked')}
                title={lang === 'ru' ? 'Выполненный чекбокс (- [x])' : 'Checked box (- [x])'}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-muted hover:text-text hover:bg-surface-alt rounded transition-colors"
              >
                <span className="text-[13px] leading-none">☑</span>
                <span className="hidden sm:inline">{lang === 'ru' ? 'Готово' : 'Done'}</span>
              </button>
              <button
                type="button"
                onClick={() => insertCheckbox('bullet')}
                title={lang === 'ru' ? 'Пункт списка (-)' : 'Bullet (-)'}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-muted hover:text-text hover:bg-surface-alt rounded transition-colors"
              >
                <span className="text-[14px] leading-none">•</span>
                <span className="hidden sm:inline">{lang === 'ru' ? 'Список' : 'List'}</span>
              </button>
            </div>
          }
        >
          <AutoGrowTextarea
            ref={commentRef}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={lang === 'ru' ? 'Описание, заметки, контекст...' : 'Description, notes, context…'}
            className="bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px] min-h-[60px]"
            rows={3}
          />
        </FieldWithEmoji>

        <div className="grid grid-cols-2 gap-4">
          <Field label={tr(lang, 'start')}>
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="w-full bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
            />
          </Field>
          <Field label={tr(lang, 'deadline')}>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
            />
          </Field>
        </div>

        {/* Preview */}
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted mb-2">{tr(lang, 'preview')}</div>
          <div className="bg-surface-alt border border-border-soft rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <StatusPill status={status} statuses={statuses} />
              {tag && <TagChip tag={tag} />}
            </div>
            <div className="text-[13.5px] font-semibold leading-snug">{title || <span className="text-faint">{lang === 'ru' ? 'Название задачи' : 'Task title'}</span>}</div>
            {comment && <div className="text-[12px] text-muted mt-0.5 truncate" title={comment}>{comment}</div>}
          </div>
        </div>
      </div>

      <div className="px-5 py-3 border-t border-border-soft flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-[13px] border border-border-soft rounded-md hover:bg-surface-alt"
        >{lang === 'ru' ? 'Отмена' : 'Cancel'}</button>
        <button
          onClick={submit}
          disabled={!title.trim()}
          className="px-4 py-1.5 text-[13px] bg-accent hover:bg-accent-hover disabled:opacity-50 text-white rounded-md font-medium"
        >{tr(lang, 'add_task')}</button>
      </div>

      {/* v0.8.8: emoji-pickers */}
      <EmojiPicker {...titleEmoji.emojiPickerProps} />
      <EmojiPicker {...commentEmoji.emojiPickerProps} />
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
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
  extraToolbar,
}: {
  label: string;
  children: React.ReactNode;
  onEmojiClick: () => void;
  emojiRef: React.Ref<HTMLButtonElement>;
  extraToolbar?: React.ReactNode;
}) {
  return (
    <div className="block">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-muted uppercase tracking-wider">{label}</div>
        <div className="flex items-center gap-1">
          {extraToolbar}
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
      </div>
      {children}
    </div>
  );
}
