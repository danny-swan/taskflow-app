import { useStore } from '../store/useStore';

export function ToastStack() {
  const toasts = useStore(s => s.toasts);
  return (
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="scale-in pointer-events-auto bg-surface border border-border rounded-lg px-3.5 py-2 shadow-lg text-[13px]"
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
