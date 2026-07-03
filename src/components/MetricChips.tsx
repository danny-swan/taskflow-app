import { useMemo } from 'react';
import { CheckSquare, Loader2, PauseCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';
import { daysUntilDeadline } from '../lib/utils';

/**
 * Compact metric chips shown in the Topbar on the Tasks screen.
 * Click toggles a status filter that lives in the global store
 * and is consumed by the Tasks page.
 * v0.8.2: Icon + count only; text label moved to native tooltip (title).
 *         Total chip icon is hard-coded blue (#3b82f6) — not var(--accent).
 */
export function MetricChips() {
  const lang = useStore(s => s.language);
  const allTasks = useStore(s => s.tasks);
  const statuses = useStore(s => s.statuses);
  const activeFilter = useStore(s => s.taskStatusFilter);
  const setFilter = useStore(s => s.setTaskStatusFilter);
  const overdueMode = useStore(s => s.overdueMode); // v0.9.2 (№1)

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
    const today = new Date().toISOString().slice(0, 10);
    // v0.8.6: «внимание» — дедлайн в [today; today+3], не просрочен, активная задача.
    // v0.9.2 (№1): в business-режиме «3 дня» = 3 будних дня, в calendar = 3 календарных.
    let total = 0, inProgress = 0, paused = 0, done = 0, overdue = 0, attention = 0;
    for (const t of allTasks) {
      if (t.archived || techIds.has(t.status_id)) continue;
      total++;
      if (archiveStatusIds.has(t.status_id)) {
        done++;
      } else if (pausedStatusIds.has(t.status_id)) {
        paused++;
      } else {
        inProgress++;
        // Overdue: due_date < today, not archived/done/deleted
        if (t.deadline && t.deadline < today) {
          overdue++;
        } else if (t.deadline) {
          const diff = daysUntilDeadline(t.deadline, today, overdueMode);
          if (diff >= 0 && diff <= 3) {
            attention++;
          }
        }
      }
    }
    return { total, inProgress, paused, done, overdue, attention };
  }, [allTasks, statuses, overdueMode]);

  const onToggle = (key: string) => {
    setFilter(activeFilter === key ? null : key);
  };

  // v0.8.6: новый чип «Внимание» между «В работе» и «Просрочено» — треугольник, оранжевый
  const chips = [
    { key: 'total',      icon: CheckSquare,   value: metrics.total,      label: tr(lang, 'chip_total'),                                 color: '#3b82f6' }, // always blue
    { key: 'inprogress', icon: Loader2,       value: metrics.inProgress, label: tr(lang, 'chip_inprogress'),                            color: '#D98F2B' },
    { key: 'attention',  icon: AlertTriangle, value: metrics.attention,  label: lang === 'ru' ? 'Внимание' : 'Attention',             color: 'var(--status-progress)' },
    { key: 'overdue',    icon: AlertTriangle, value: metrics.overdue,    label: lang === 'ru' ? 'Просрочено' : 'Overdue',               color: 'var(--status-important)' },
    { key: 'paused',     icon: PauseCircle,  value: metrics.paused,     label: tr(lang, 'chip_paused'),                                color: 'var(--muted)' },
    { key: 'done',       icon: CheckCircle2, value: metrics.done,       label: tr(lang, 'chip_done'),                                  color: '#437A22' },
  ] as const;

  return (
    <div className="flex items-center gap-1.5 shrink-0" data-onboarding="metric-chips">
      {chips.map(({ key, icon: Icon, value, label, color }) => {
        const isActive = activeFilter === key;
        return (
          <button
            key={key}
            onClick={() => onToggle(key)}
            title={label}
            className={
              'flex items-center gap-1 px-2 py-1 rounded-md hover:bg-surface-alt transition-colors ' +
              (isActive ? 'bg-accent-soft' : '')
            }
          >
            <Icon className="w-4 h-4" style={{ color }} />
            <span
              className="text-sm font-medium tabular"
              style={{ color: isActive ? 'var(--accent)' : 'var(--text)' }}
            >
              {value}
            </span>
          </button>
        );
      })}
    </div>
  );
}
