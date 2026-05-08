import { useState } from 'react';
import {
  useFloating, useClick, useDismiss, useInteractions,
  offset, flip, shift, autoUpdate, FloatingPortal,
} from '@floating-ui/react';
import type { Status } from '../store/useStore';
import { readableTextColor } from '../lib/utils';

export function StatusDot({ color }: { color: string }) {
  const isWhite = color.toUpperCase() === '#FFFFFF';
  return (
    <span
      className="status-dot inline-block rounded-full shrink-0"
      style={{
        width: 9, height: 9,
        background: color,
        border: isWhite ? '1.5px solid var(--text)' : 'none',
      }}
    />
  );
}

/**
 * Status pill with portal-rendered popover.
 * Uses @floating-ui/react with flip + shift middleware so the dropdown
 * never gets clipped by surrounding cards.
 */
export function StatusPill({
  status, statuses, onChange, size = 'sm',
}: {
  status: Status | undefined;
  statuses: Status[];
  onChange?: (id: number) => void;
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    middleware: [offset(4), flip({ fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const click = useClick(context, { enabled: !!onChange });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  if (!status) return null;
  const isWhite = status.color.toUpperCase() === '#FFFFFF';
  const fg = isWhite ? 'var(--text)' : readableTextColor(status.color);
  const bg = isWhite ? 'transparent' : status.color;
  // Filter out technical statuses from the menu
  const visibleStatuses = statuses.filter(s => s.is_technical !== 1);

  return (
    <>
      <button
        ref={refs.setReference as any}
        type="button"
        {...getReferenceProps({ onClick: (e) => e.stopPropagation() })}
        className="status-pill inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap"
        style={{
          background: bg,
          color: fg,
          border: isWhite ? '1px solid var(--text)' : '1px solid transparent',
          padding: size === 'md' ? '3px 10px' : '2px 8px',
          fontSize: size === 'md' ? 12 : 11,
          cursor: onChange ? 'pointer' : 'default',
        }}
      >
        {status.name}
      </button>
      {open && onChange && (
        <FloatingPortal>
          <div
            ref={refs.setFloating as any}
            style={{ ...floatingStyles, zIndex: 9999 }}
            {...getFloatingProps()}
            className="bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[180px] scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {visibleStatuses.map(s => (
              <button
                key={s.id}
                onClick={(e) => { e.stopPropagation(); onChange(s.id); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-alt text-[13px]"
              >
                <StatusDot color={s.color} />
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
