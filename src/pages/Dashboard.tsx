import { useMemo, useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';
import { formatDate, formatMonthDay } from '../lib/format';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';

type Period = 'week' | 'month' | 'quarter' | 'year' | 'custom';

interface CustomRange { from: string; to: string }

/**
 * Parse a YYYY-MM-DD string as a LOCAL midnight date (avoids UTC offset shift).
 */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Return a YYYY-MM-DD key using LOCAL calendar fields (avoids toISOString UTC shift).
 */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DashboardPage() {
  const lang = useStore(s => s.language);
  const allTasks = useStore(s => s.tasks);
  const allStatuses = useStore(s => s.statuses);
  const tags = useStore(s => s.tags);
  const [period, setPeriod] = useState<Period>('week');
  const [customRange, setCustomRange] = useState<CustomRange>({
    from: (() => { const d = new Date(); d.setDate(d.getDate() - 6); return localDayKey(d); })(),
    to: localDayKey(new Date()),
  });
  const [customOpen, setCustomOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(customRange.from);
  const [draftTo, setDraftTo] = useState(customRange.to);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);

  // Close custom popover on outside click
  useEffect(() => {
    if (!customOpen) return;
    const fn = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setCustomOpen(false);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', fn), 0);
    return () => document.removeEventListener('mousedown', fn);
  }, [customOpen]);

  const periodDays = period === 'week' ? 7 : period === 'month' ? 30 : period === 'quarter' ? 90 : period === 'year' ? 365 : 0;

  const techIds = useMemo(() => new Set(allStatuses.filter(s => s.is_technical === 1).map(s => s.id)), [allStatuses]);
  const deletedStatusIds = useMemo(
    () => new Set(allStatuses.filter(s => s.is_technical === 1 && s.name === 'Удалено').map(s => s.id)),
    [allStatuses],
  );
  const dashTasks = useMemo(
    () => allTasks.filter(t => !deletedStatusIds.has(t.status_id)),
    [allTasks, deletedStatusIds],
  );

  const dateRange = useMemo<{ from: string; to: string } | null>(() => {
    if (period !== 'custom') return null;
    return customRange;
  }, [period, customRange]);

  const activityDates = useMemo(() => {
    if (period === 'custom' && dateRange) {
      const result: { date: string; count: number; isoDate: string }[] = [];
      // Use parseLocalDate to avoid UTC shift
      const from = parseLocalDate(dateRange.from);
      const to = parseLocalDate(dateRange.to);
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const key = localDayKey(d); // LOCAL key — no UTC shift
        const count = dashTasks.filter(t => {
          const taskDay = t.created_at ? t.created_at.slice(0, 10) : '';
          return taskDay === key;
        }).length;
        result.push({ date: formatMonthDay(key.slice(5), lang), count, isoDate: key });
      }
      return result;
    }
    const days: { date: string; count: number; isoDate: string }[] = [];
    const now = new Date();
    for (let i = periodDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = localDayKey(d);
      const count = dashTasks.filter(t => {
        const taskDay = t.created_at ? t.created_at.slice(0, 10) : '';
        return taskDay === key;
      }).length;
      days.push({ date: formatMonthDay(key.slice(5), lang), count, isoDate: key });
    }
    return days;
  }, [dashTasks, periodDays, period, dateRange, lang]);

  const kpis = useMemo(() => {
    const total = dashTasks.length;
    const archiveStatusIds = new Set(
      allStatuses.filter(s => s.behavior === 'archive' && s.is_technical !== 1).map(s => s.id)
    );
    const inProgress = dashTasks.filter(t =>
      !t.archived && !techIds.has(t.status_id) && !archiveStatusIds.has(t.status_id)
    ).length;
    const completed = dashTasks.filter(t => archiveStatusIds.has(t.status_id)).length;
    const today = localDayKey(new Date());
    const overdue = dashTasks.filter(t =>
      t.deadline && t.deadline < today &&
      !archiveStatusIds.has(t.status_id) && !techIds.has(t.status_id) && !t.archived
    ).length;
    return { total, inProgress, completed, overdue };
  }, [dashTasks, allStatuses, techIds]);

  const byStatus = useMemo(() =>
    allStatuses
      .filter(s => !deletedStatusIds.has(s.id))
      .map(s => ({
        name: s.name,
        value: dashTasks.filter(t => t.status_id === s.id).length,
        color: s.color,
        isTechnical: s.is_technical === 1,
      }))
      .filter(x => x.value > 0),
    [dashTasks, allStatuses, deletedStatusIds]);

  // Task 5: filter tags with count > 0
  const byTag = useMemo(() => {
    const all = tags.map(t => ({
      name: t.name,
      value: dashTasks.filter(ts => ts.tag_id === t.id).length,
      color: t.color,
    }));
    return all.filter(x => x.value > 0);
  }, [dashTasks, tags]);

  const heatmap = useMemo(() => {
    const weeks: { date: string; count: number }[][] = [];
    const now = new Date();
    const start = new Date(now);
    start.setDate(start.getDate() - 12 * 7 + 1);
    for (let w = 0; w < 12; w++) {
      const days: { date: string; count: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        const key = localDayKey(date); // LOCAL key
        const count = dashTasks.filter(t => {
          const cr = t.created_at ? t.created_at.slice(0, 10) : '';
          const up = t.updated_at ? t.updated_at.slice(0, 10) : '';
          return cr === key || up === key;
        }).length;
        days.push({ date: key, count });
      }
      weeks.push(days);
    }
    return weeks;
  }, [dashTasks]);

  const recentDone = useMemo(() => {
    const archiveIds = new Set(allStatuses.filter(s => s.behavior === 'archive' && s.is_technical !== 1).map(s => s.id));
    return dashTasks.filter(t => archiveIds.has(t.status_id))
      .sort((a, b) => (b.finish_date || b.updated_at || '').localeCompare(a.finish_date || a.updated_at || ''))
      .slice(0, 6);
  }, [dashTasks, allStatuses]);

  const periods: { key: Period; label: string }[] = [
    { key: 'week', label: tr(lang, 'week') },
    { key: 'month', label: tr(lang, 'month') },
    { key: 'quarter', label: tr(lang, 'quarter') },
    { key: 'year', label: tr(lang, 'year') },
    { key: 'custom', label: tr(lang, 'dash_custom') },
  ];

  const applyCustom = () => {
    setCustomRange({ from: draftFrom, to: draftTo });
    setCustomOpen(false);
  };

  // Task 3: custom tooltip label formatter using formatDate
  const activityTooltipLabelFormatter = (label: string, payload: any[]) => {
    // Try to find the isoDate from payload entry
    if (payload && payload.length > 0) {
      const entry = payload[0]?.payload;
      if (entry?.isoDate) {
        return formatDate(entry.isoDate);
      }
    }
    return label;
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 relative z-10">
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <h2 className="font-display text-[18px] font-semibold">{tr(lang, 'nav_dashboard')}</h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-surface-alt rounded-md p-0.5 border border-border-soft">
            {periods.map(p => (
              <button
                key={p.key}
                onClick={() => {
                  if (p.key === 'custom') {
                    setDraftFrom(customRange.from);
                    setDraftTo(customRange.to);
                    setCustomOpen(o => !o);
                    setPeriod('custom');
                  } else {
                    setPeriod(p.key);
                    setCustomOpen(false);
                  }
                }}
                className={'px-2.5 py-1 text-[12px] rounded ' +
                  (period === p.key ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text')}
              >{p.label}</button>
            ))}
          </div>

          {/* Custom period popover — positioned relative to the trigger wrapper */}
          <div ref={triggerRef} className="relative">
            {period === 'custom' && customOpen && (
              <div
                ref={popoverRef}
                className="absolute right-0 z-50 bg-surface border border-border rounded-xl shadow-xl p-4 flex flex-col gap-3 min-w-[220px]"
                style={{ top: 'calc(100% + 8px)' }}
              >
                <div className="text-[12px] font-medium">{tr(lang, 'dash_custom')}</div>
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] text-muted">{tr(lang, 'dash_from')}</label>
                  <input
                    type="date"
                    value={draftFrom}
                    onChange={(e) => setDraftFrom(e.target.value)}
                    className="bg-surface-alt border border-border-soft rounded px-2 py-1 text-[12px] outline-none focus:border-accent"
                  />
                  <label className="text-[11px] text-muted">{tr(lang, 'dash_to')}</label>
                  <input
                    type="date"
                    value={draftTo}
                    onChange={(e) => setDraftTo(e.target.value)}
                    className="bg-surface-alt border border-border-soft rounded px-2 py-1 text-[12px] outline-none focus:border-accent"
                  />
                </div>
                <button
                  onClick={applyCustom}
                  className="px-3 py-1.5 text-[12px] bg-accent text-white rounded-md hover:bg-accent-hover font-medium"
                >{tr(lang, 'dash_apply')}</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Custom range label — formatted as dd.MM.yyyy */}
      {period === 'custom' && (
        <div className="text-[11px] text-muted mb-3">
          {formatDate(customRange.from)} → {formatDate(customRange.to)}
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KPI label={tr(lang, 'total_tasks')} value={kpis.total} />
        <KPI label={tr(lang, 'in_progress')} value={kpis.inProgress} />
        <KPI label={tr(lang, 'completed')} value={kpis.completed} success />
        <KPI label={tr(lang, 'overdue')} value={kpis.overdue} danger />
      </div>

      {/* 2x2 chart grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 auto-rows-fr gap-3 mb-4">
        <div className="bg-surface border border-border-soft rounded-xl p-4 min-h-[280px] flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[12px] text-muted uppercase tracking-wider">{tr(lang, 'activity')}</div>
          </div>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={activityDates}>
                <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                {/* Task 3: custom labelFormatter showing dd.mm.yyyy */}
                <Tooltip
                  contentStyle={{
                    background: 'var(--surface)', border: '1px solid var(--border)',
                    borderRadius: 8, fontSize: 12,
                  }}
                  labelFormatter={activityTooltipLabelFormatter}
                />
                <Line type="monotone" dataKey="count" stroke="var(--accent)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-surface border border-border-soft rounded-xl p-4 min-h-[280px] flex flex-col">
          <div className="text-[12px] text-muted uppercase tracking-wider mb-2">{tr(lang, 'by_status')}</div>
          <div className="flex-1 flex items-center gap-4 min-h-0">
            <div className="flex-1 h-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={byStatus}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="58%"
                    outerRadius="95%"
                    paddingAngle={2}
                    label={renderSliceCount}
                    labelLine={false}
                    isAnimationActive={false}
                  >
                    {byStatus.map((e, i) => <Cell key={i} fill={e.color} stroke="var(--surface)" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col justify-center gap-2 shrink-0 max-w-[44%]">
              {byStatus.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px]">
                  <span
                    className="inline-block rounded-full shrink-0"
                    style={{ width: 9, height: 9, background: s.color, border: s.color.toUpperCase() === '#FFFFFF' ? '1px solid var(--text)' : 'none' }}
                  />
                  <span className="truncate">{s.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-surface border border-border-soft rounded-xl p-4 min-h-[280px] flex flex-col">
          <div className="text-[12px] text-muted uppercase tracking-wider mb-2">{tr(lang, 'by_tag')}</div>
          <div className="flex-1 min-h-0">
            {byTag.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted text-[13px]">
                {lang === 'ru' ? 'Нет данных за выбранный период' : 'No data for the selected period'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byTag}>
                  <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {byTag.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-surface border border-border-soft rounded-xl p-4 min-h-[280px] flex flex-col overflow-hidden">
          <div className="text-[12px] text-muted uppercase tracking-wider mb-3">{tr(lang, 'activity')} · 12w</div>
          <Heatmap weeks={heatmap} lang={lang} />
        </div>
      </div>

      <div className="bg-surface border border-border-soft rounded-xl p-4">
        <div className="text-[12px] text-muted uppercase tracking-wider mb-3">{tr(lang, 'recent')}</div>
        {recentDone.length === 0 ? (
          <div className="text-faint text-[13px]">—</div>
        ) : (
          <ul className="space-y-2">
            {recentDone.map(t => (
              <li key={t.id} className="flex items-center gap-2.5 text-[13px]">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--status-done)' }} />
                <span className="flex-1 truncate">{t.title}</span>
                <span className="text-muted text-[11px] mono">
                  {formatDate(t.finish_date || t.updated_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function KPI({ label, value, success, danger }: { label: string; value: number; success?: boolean; danger?: boolean }) {
  return (
    <div className="bg-surface border border-border-soft rounded-xl px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div
        className={'mt-1 text-[26px] font-display font-bold tabular leading-none '}
        style={{
          color: danger ? 'var(--status-important)' : success ? '#437A22' : undefined,
        }}
      >{value}</div>
    </div>
  );
}

function renderSliceCount(props: any) {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent, value } = props;
  if (!percent || percent < 0.06) return null;
  const RAD = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
  const fill = props.fill || '#000';
  const txtFill = isLight(fill) ? '#1a1a1a' : '#ffffff';
  return (
    <text
      x={x}
      y={y}
      fill={txtFill}
      textAnchor="middle"
      dominantBaseline="central"
      style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', pointerEvents: 'none' }}
    >
      {value}
    </text>
  );
}

function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62;
}

function Heatmap({ weeks, lang }: { weeks: { date: string; count: number }[][]; lang: 'ru' | 'en' }) {
  const max = Math.max(1, ...weeks.flat().map(d => d.count));
  const dayLabelsRu = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const dayLabelsEn = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const labels = lang === 'ru' ? dayLabelsRu : dayLabelsEn;

  return (
    <div className="flex-1 flex gap-2 min-h-0 min-w-0">
      <div className="flex flex-col justify-between text-[10px] text-faint mono py-[1px] shrink-0">
        {labels.map(l => (<span key={l} style={{ lineHeight: 1 }}>{l}</span>))}
      </div>
      <div className="flex-1 grid gap-1 min-w-0" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
        {weeks.map((w, i) => (
          <div key={i} className="grid gap-1" style={{ gridTemplateRows: `repeat(7, minmax(0, 1fr))` }}>
            {w.map((d, j) => {
              const intensity = d.count / max;
              const bg = d.count === 0
                ? 'var(--surface-alt)'
                : `color-mix(in srgb, var(--accent) ${20 + intensity * 70}%, transparent)`;
              return (
                <div
                  key={j}
                  title={`${d.date}: ${d.count}`}
                  className="rounded-sm w-full h-full"
                  style={{ background: bg, minHeight: 6 }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
