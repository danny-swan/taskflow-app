import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useStore, Task } from '../store/useStore';
import { useCurrentWorkspaceStatuses, useCurrentWorkspaceTags } from '../store/workspaceScope';
import { tr } from '../lib/i18n';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { Trash2, X, AlertTriangle, Smile, FilePlus } from 'lucide-react';
import { EmojiPicker, useEmojiPicker } from './EmojiPicker';
import { usePrompt } from './PromptDialog';
import { insertCheckboxLines } from '../lib/checkboxes';
import { DatePicker } from './DatePicker';
import { TaskActivityLog } from './TaskActivityLog';

export function TaskModal({
  task, onClose,
}: {
  task: Task | null;
  onClose: () => void;
}) {
  const lang = useStore(s => s.language);
  const workspaces = useStore(s => s.workspaces);
  const currentWorkspaceId = useStore(s => s.currentWorkspaceId);
  const statuses = useCurrentWorkspaceStatuses();
  const tags = useCurrentWorkspaceTags();
  const updateTask = useStore(s => s.updateTask);
  const softDeleteTask = useStore(s => s.softDeleteTask);
  const addTag = useStore(s => s.addTag);
  const pushToast = useStore(s => s.pushToast);
  // v0.8.13: «Сохранить как шаблон» в подвале модалки
  const addTemplate = useStore(s => s.addTemplate);

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

  // v0.8.14: собственная PromptDialog вместо window.prompt — в Tauri системный prompt
  // показывается с уродливым заголовком «Сообщение с tauri.localhost» и может не
  // возвращать значение корректно.
  // ВАЖНО: хук должен быть ДО `if (!draft) return null;` — иначе при первом
  // открытии модалки (draft переходит null→task) порядок хуков меняется
  // и React ломается с белым экраном (Rules of Hooks).
  const { prompt: askPrompt, PromptUI } = usePrompt();

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

  const saveAsTemplate = async () => {
    const defaultName = (draft.title || (lang === 'ru' ? 'Шаблон' : 'Template')).slice(0, 60);
    const trimmed = await askPrompt({
      title: lang === 'ru' ? 'Название шаблона' : 'Template name',
      defaultValue: defaultName,
      placeholder: lang === 'ru' ? 'Например: Спринт-ретро' : 'e.g. Sprint retro',
      confirmLabel: lang === 'ru' ? 'Сохранить' : 'Save',
      cancelLabel: lang === 'ru' ? 'Отмена' : 'Cancel',
      validate: (v) => v.trim() ? null : (lang === 'ru' ? 'Имя не может быть пустым' : 'Name cannot be empty'),
    });
    if (!trimmed) return;
    const id = addTemplate({
      name: trimmed,
      title: draft.title,
      comment: draft.comment,
      status_id: draft.status_id,
      tag_id: draft.tag_id,
    });
    pushToast(
      id
        ? (lang === 'ru' ? `Шаблон «${trimmed}» сохранён` : `Template "${trimmed}" saved`)
        : (lang === 'ru' ? 'Не удалось сохранить шаблон' : 'Failed to save template')
    );
  };

  // v0.8.14: вставка markdown-чекбокса в поле комментария одним кликом.
  // Берём текущую позицию каретки из commentRef и вставляем '- [ ] '
  // с переводом строки, если курсор не в начале строки. После вставки
  // ставим каретку в конец вставленного фрагмента.
  const insertCheckbox = (kind: 'unchecked' | 'checked' | 'bullet') => {
    const el = commentRef.current;
    const current = draft.comment ?? '';
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const { next, caretAt } = insertCheckboxLines(current, start, end, kind);
    setDraft(d => (d ? { ...d, comment: next } : d));
    // восстанавливаем фокус и позицию каретки после рендера
    requestAnimationFrame(() => {
      const e2 = commentRef.current;
      if (!e2) return;
      e2.focus();
      e2.setSelectionRange(caretAt, caretAt);
    });
  };
  const confirmDelete = () => {
    // v0.8.12: удаление из модалки тоже предлагает undo (возврат в прежний статус)
    const prevStatusId = draft.status_id;
    const tid = draft.id;
    softDeleteTask(tid);
    setConfirmOpen(false);
    pushToast(
      tr(lang, 'deleted'),
      {
        label: lang === 'ru' ? 'Отменить' : 'Undo',
        onClick: () => updateTask(tid, { status_id: prevStatusId }),
      },
    );
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
              value={draft.comment || ''}
              onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
              className="bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px]"
              style={{ maxHeight: '50vh', overflowY: 'auto' }}
              rows={3}
            />
          </FieldWithEmoji>

          <div className="grid grid-cols-2 gap-4">
            <Field label={tr(lang, 'start')}>
              <DatePicker
                value={draft.start_date || null}
                onChange={(v) => setDraft({ ...draft, start_date: v })}
              />
            </Field>
            <Field label={tr(lang, 'deadline')}>
              <DatePicker
                value={draft.deadline || null}
                onChange={(v) => setDraft({ ...draft, deadline: v })}
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

          {/* Wave C PR-c-03: история изменений — только для shared-пространств. */}
          {(() => {
            const wsId = draft.workspace_id ?? currentWorkspaceId;
            const isShared = workspaces.some(w => w.id === wsId && w.kind === 'shared');
            return isShared ? <TaskActivityLog taskUuid={draft.uuid} /> : null;
          })()}

        </div>

        <div className="px-5 py-3 border-t border-border-soft flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <button
              onClick={remove}
              className="flex items-center gap-1.5 text-[13px] text-[var(--status-important)] hover:underline"
            >
              <Trash2 size={14} /> {tr(lang, 'delete')}
            </button>
            {/* v0.8.13: кнопка сохранения текущей задачи как шаблона — важно: не закрывает модалку. */}
            <button
              onClick={saveAsTemplate}
              title={lang === 'ru' ? 'Сохранить текущие поля как шаблон для будущих задач' : 'Save current fields as a reusable template'}
              className="flex items-center gap-1.5 text-[13px] text-muted hover:text-text hover:underline"
            >
              <FilePlus size={14} /> {lang === 'ru' ? 'Сохранить как шаблон' : 'Save as template'}
            </button>
          </div>
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

      {/* v0.8.14: своя PromptDialog вместо window.prompt */}
      <PromptUI />
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
  extraToolbar,
}: {
  label: string;
  children: React.ReactNode;
  onEmojiClick: () => void;
  emojiRef: React.Ref<HTMLButtonElement>;
  /** v0.8.14: дополнительные кнопки слева от emoji — например, «вставить чекбокс» */
  extraToolbar?: React.ReactNode;
}) {
  return (
    <div className="block mb-3.5">
      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="text-[11px] text-muted uppercase tracking-wider">{label}</div>
        <div className="flex items-center gap-1.5">
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
