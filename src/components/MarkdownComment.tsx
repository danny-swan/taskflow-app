import { parseComment } from '../lib/checkboxes';

/**
 * MarkdownComment — read-only renderer for task comments with clickable
 * checkboxes parsed from "- [ ]" / "- [x]" markdown syntax.
 *
 * Plain text without checkboxes renders exactly as before (whitespace-pre-wrap).
 * Checkboxes become small accessible inputs; clicking them calls `onToggle(index)`
 * which the parent uses to rewrite the comment and persist via the store.
 *
 * We deliberately stop pointerdown/mousedown propagation so the click never
 * starts the card drag and never bubbles up to the "enter edit mode" handler.
 */
export function MarkdownComment({
  text,
  onToggle,
  className,
}: {
  text: string;
  onToggle: (index: number) => void;
  className?: string;
}) {
  const tokens = parseComment(text);

  // No checkboxes at all — render text as-is to keep behaviour identical for
  // legacy comments. parseComment returns a single text token in that case.
  const hasCheckbox = tokens.some(t => t.kind === 'checkbox');
  if (!hasCheckbox) {
    return (
      <div className={className} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {text}
      </div>
    );
  }

  return (
    <div className={className} style={{ wordBreak: 'break-word' }}>
      {tokens.map((t, i) => {
        if (t.kind === 'text') {
          if (!t.text) return null;
          return (
            <div key={i} style={{ whiteSpace: 'pre-wrap' }}>{t.text}</div>
          );
        }
        return (
          <label
            key={i}
            className="flex items-start gap-1.5 cursor-pointer select-none py-[1px]"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(t.index);
            }}
          >
            <input
              type="checkbox"
              checked={t.checked}
              readOnly
              className="mt-[3px] shrink-0 cursor-pointer accent-[var(--accent,#6366f1)]"
              tabIndex={-1}
            />
            <span
              className={t.checked ? 'line-through opacity-60' : ''}
              style={{ whiteSpace: 'pre-wrap' }}
            >
              {t.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
