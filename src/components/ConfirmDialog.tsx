import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Additional content below the message (e.g. radio group for restore action) */
  children?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Отмена',
  danger = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl p-5 max-w-sm w-full mx-4 flex flex-col gap-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="text-[15px] font-semibold font-display">{title}</div>
        )}
        <div className="text-[13.5px] text-muted leading-relaxed">{message}</div>
        {children}
        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-[13px] border border-border-soft rounded-lg hover:bg-surface-alt transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={
              'px-4 py-2 text-[13px] rounded-lg font-medium transition-colors text-white ' +
              (danger
                ? 'bg-[var(--status-important)] hover:opacity-90'
                : 'bg-accent hover:bg-accent-hover')
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
