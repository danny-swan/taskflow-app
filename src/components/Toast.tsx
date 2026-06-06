import { useStore } from '../store/useStore';

/**
 * v0.8.12: Toast теперь умеет показывать кнопку «Отменить» (action).
 * Если у тоста есть action — таймаут увеличен (управляется в store/pushToast),
 * кнопка ловит клик и закрывает тост.
 */
export function ToastStack() {
  const toasts = useStore(s => s.toasts);
  const dismiss = useStore(s => s.dismissToast);
  return (
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
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
