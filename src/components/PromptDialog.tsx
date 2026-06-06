import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * PromptDialog — простая встроенная модалка для одного текстового поля.
 *
 * Зачем нужно: `window.prompt` в Tauri (WebView2 / WebKit) ведёт себя по-разному
 * — на Windows показывает уродливый «Сообщение с tauri.localhost», на macOS
 * вообще может быть отключён. Эта модалка стилизована в общем UI приложения
 * и поддерживает Enter/Esc.
 *
 * API намеренно «императивный»: вместо состояния `open`/`onConfirm` отдаём
 * хук `usePrompt()` с асинхронной функцией `prompt(opts)`, чтобы вызов был
 * похож на родной `window.prompt`. Это удобно в обработчиках кнопок:
 *
 *   const { prompt, PromptUI } = usePrompt();
 *   const name = await prompt({ title: 'Имя шаблона', defaultValue: task.title });
 *   if (!name) return;
 *
 * Не забудьте отрендерить `<PromptUI />` где-нибудь внутри компонента.
 */
export interface PromptOptions {
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Опциональная валидация. Вернуть строку-ошибку или null если ок. */
  validate?: (value: string) => string | null;
}

export function usePrompt() {
  const [opts, setOpts] = useState<PromptOptions | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const resolverRef = useRef<((v: string | null) => void) | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const prompt = (o: PromptOptions): Promise<string | null> => {
    setOpts(o);
    setValue(o.defaultValue ?? '');
    setError(null);
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve;
    });
  };

  const close = (result: string | null) => {
    setOpts(null);
    setError(null);
    const r = resolverRef.current;
    resolverRef.current = null;
    if (r) r(result);
  };

  // Автофокус при открытии
  useEffect(() => {
    if (opts && inputRef.current) {
      // следующий тик — после монтирования
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
      return () => clearTimeout(t);
    }
  }, [opts]);

  // Esc закрывает
  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [opts]);

  const PromptUI = () => {
    if (!opts) return null;
    const onSubmit = (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = value.trim();
      if (opts.validate) {
        const err = opts.validate(trimmed);
        if (err) {
          setError(err);
          return;
        }
      }
      close(trimmed || null);
    };
    // v0.8.17: createPortal в document.body. Без портала этот div рендерится
    // внутри TaskModal/NewTaskModal, родитель которых имеет .scale-in с
    // transform: scale(…). transform создаёт новый containing block, и fixed inset-0
    // теряет привязку к viewport — модалка вписывается в размеры
    // родительской карточки и оказывается «под» TaskModal.
    return createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40"
        onMouseDown={(e) => {
          // клик по бэкдропу = отмена
          if (e.target === e.currentTarget) close(null);
        }}
      >
        <form
          onSubmit={onSubmit}
          className="bg-surface border border-border-soft rounded-xl shadow-xl w-[420px] max-w-[90vw] p-5"
        >
          <div className="text-[14px] font-semibold mb-3">{opts.title}</div>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
            placeholder={opts.placeholder}
            className="w-full bg-surface-alt border border-border-soft rounded-md px-3 py-2 text-[13px] outline-none focus:border-accent"
          />
          {error && (
            <div className="mt-1.5 text-[11px] text-[var(--status-important)]">{error}</div>
          )}
          <div className="flex items-center justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={() => close(null)}
              className="px-3 py-1.5 text-[13px] border border-border-soft rounded-md hover:bg-surface-alt"
            >
              {opts.cancelLabel ?? 'Отмена'}
            </button>
            <button
              type="submit"
              className="px-3 py-1.5 text-[13px] bg-accent text-white rounded-md hover:opacity-90"
            >
              {opts.confirmLabel ?? 'OK'}
            </button>
          </div>
        </form>
      </div>,
      document.body
    );
  };

  return { prompt, PromptUI };
}
