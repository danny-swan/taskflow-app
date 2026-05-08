import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export function Modal({
  open, onClose, children, width = 560, label,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Focus first focusable
    setTimeout(() => {
      const first = ref.current?.querySelector<HTMLElement>(
        'input, textarea, select, button, [tabindex]:not([tabindex="-1"])'
      );
      first?.focus();
    }, 50);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 modal-backdrop flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        className="scale-in bg-surface border border-border rounded-xl shadow-2xl flex flex-col max-h-[88vh]"
        style={{ width: '100%', maxWidth: width }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
