import { useMemo } from 'react';
import { CheckSquare, Loader2, PauseCircle, CheckCircle2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';

/**
 * Compact metric chips shown in the Topbar on the Tasks screen.
 * Click toggles a status filter that lives in the global store
 * and is consumed by the Tasks page.
 */
export function MetricChips() {
  const lang = useStore(s => s.language);
  const allTasks = useStore(s => s.tasks);
  const statuses = useStore(s => s.statuses);
  const activeFilter = useStore(s => s.taskStatusFilter);
  const setFilter = useStore(s => s.setTaskStatusFilter);

  const metrics = useMemo(() => {
    const techIds = new Set(
      statuses.filter(s => s.is_technical === 1).map(s => s.id),
    );
    const archiveStatusIds = new Set(
      statuses.filter(s => s.behavior === 'archive' && s.is_technical !== 1).map(s => s.id),
    );
    const pausedStatusIds = new Set(
      statuses.filter(s => s.behavior === 'bottom' || s.behavior === 'paused').map(s => s.id),
    );
    let total = 0, inProgress = 0, paused = 0, done = 0;
    for (const t of allTasks) {
      if (t.archived || techIds.has(t.status_id)) continue;
      total++;
      if (archiveStatusIds.has(t.status_id)) done++;
      else if (pausedStatusIds.has(t.status_id)) paused++;
      else inProgress++;
    }
    // “done” should also include archived completions even if soft-archived?
    // Keeping current visible-only semantics for symmetry with Tasks list.
    return { total, inProgress, paused, done };
  }, [allTasks, statuses]);

  const onToggle = (key: string) => {
    setFilter(activeFilter === key ? null : key);
  };

  const chips = [
    { key: 'total',      icon: CheckSquare,  value: metrics.total,      label: tr(lang, 'chip_total'),      color: 'var(--accent)' },
    { key: 'inprogress', icon: Loader2,      value: metrics.inProgress, label: tr(lang, 'chip_inprogress'), color: '#D98F2B' },
    { key: 'paused',     icon: PauseCircle,  value: metrics.paused,     label: tr(lang, 'chip_paused'),     color: 'var(--muted)' },
    { key: 'done',       icon: CheckCircle2, value: metrics.done,       label: tr(lang, 'chip_done'),       color: '#437A22' },
  ] as const;

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {chips.map(({ key, icon: Icon, value, label, color }) => {
        const isActive = activeFilter === key;
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            title={label}
            className={
              'flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] transition-colors ' +
              (isActive
                ? 'border-accent bg-accent-soft'
                : 'border-border-soft hover:bg-surface-alt')
            }
          >
            <Icon size={11} style={{ color }} />
            <span
              className="tabular font-medium"
              style={{ color: isActive ? 'var(--accent)' : 'var(--text)' }}
            >
              {value}
            </span>
            <span className="chip-label hidden-narrow text-muted">{label}</span>
          </button>
        );
      })}
      <style>{`
        @media (min-width: 1280px) { .hidden-narrow { display: inline; } }
        @media (max-width: 1279px) { .hidden-narrow { display: none; } }
      `}</style>
    </div>
  );
}
