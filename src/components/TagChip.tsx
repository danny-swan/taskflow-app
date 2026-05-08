import type { Tag } from '../store/useStore';

export function TagChip({ tag }: { tag: Tag | undefined }) {
  if (!tag) return null;
  return (
    <span
      className="inline-flex items-center px-2 rounded text-[10px] font-mono font-medium uppercase tracking-wide"
      style={{
        color: tag.color,
        background: 'transparent',
        border: `1px solid ${tag.color}55`,
        height: 18,
      }}
    >
      {tag.name}
    </span>
  );
}
