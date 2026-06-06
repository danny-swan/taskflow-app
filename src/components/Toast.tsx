import { useStore } from '../store/useStore';

/**
 * v0.8.12: Toast умеет показывать кнопку «Отменить» (action).
 *   Если у тоста есть action — таймаут увеличен (управляется в store/pushToast),
 *   кнопка ловит клик и закрывает тост.
 * v0.8.13: позиция изменена с top-right на bottom-center —
 *   удобнее видеть сразу после клика и тянуться рукой к кнопке Undo.
 *   Стек тостов растёт вверх (column-reverse), новые появляются ниже.
 */
export function ToastStack() {
  const toasts = useStore(s => s.toasts);
  const dismiss = useStore(s => s.dismissToast);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-col-reverse items-center gap-2 pointer-events-none w-max max-w-[92vw]">
      {toasts.map(t => (
        <div
          key={t.id}
          className="scale-in pointer-events-auto bg-surface border border-border rounded-lg px-3.5 py-2 shadow-lg text-[13px] flex items-center gap-3"
        >
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => { t.action!.onClick(); dismiss(t.id); }}
              className="text-[12px] font-semibold text-[var(--accent,#6366f1)] hover:underline whitespace-nowrap"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
