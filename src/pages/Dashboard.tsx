import { useMemo, useState, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import {
  useCurrentWorkspaceTasks, useCurrentWorkspaceStatuses,
  useCurrentWorkspaceTags, useCurrentWorkspaceId,
} from '../store/workspaceScope';
import { tr } from '../lib/i18n';
import { formatDate, formatMonthDay } from '../lib/format';
import { overdueEventsByDate } from '../lib/overdue';
import { currentSnapshotTasks } from '../lib/dashboard';
import { DatePicker } from '../components/DatePicker';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts';

type Period = 'week' | 'month' | 'quarter' | 'year' | 'custom';

interface CustomRange { from: string; to: string }

/** Parse a YYYY-MM-DD string as a LOCAL midnight date (avoids UTC offset shift). */
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Return a YYYY-MM-DD key using LOCAL calendar fields (avoids toISOString UTC shift). */
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DashboardPage() {
  const lang = useStore(s => s.language);
  const allTasks = useCurrentWorkspaceTasks();
  const allStatuses = useCurrentWorkspaceStatuses();
  const tags = useCurrentWorkspaceTags();
  const currentWorkspaceId = useCurrentWorkspaceId();
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

  const techIds = useMemo(
    () => new Set(allStatuses.filter(s => s.is_technical === 1).map(s => s.id)),
    [allStatuses],
  );
  const deletedStatusIds = useMemo(
    () => new Set(allStatuses.filter(s => s.is_technical === 1 && s.name === 'Удалено').map(s => s.id)),
    [allStatuses],
  );
  const archiveStatusIds = useMemo(
    () => new Set(allStatuses.filter(s => s.behavior === 'archive' && s.is_technical !== 1).map(s => s.id)),
    [allStatuses],
  );
  // v0.8.9: статусы «Приостановлено» — все non-archive non-technical статусы, помеченные behavior='hold'? нет —
  // используем имя «Приостановлено»/«On hold», т.к. в схеме нет отдельного флага.
  const pausedStatusIds = useMemo(
    () => new Set(
      allStatuses
        .filter(s => s.is_technical !== 1 && /приостановл|on\s*hold|paused/i.test(s.name))
        .map(s => s.id),
    ),
    [allStatuses],
  );

  // Без «Удалено» — общий набор для ИСТОРИЧЕСКИХ расчётов «За период»
  // (Активность, тепловая карта, недавно выполненные) — им нужны все задачи.
  const dashTasks = useMemo(
    () => allTasks.filter(t => !deletedStatusIds.has(t.status_id)),
    [allTasks, deletedStatusIds],
  );

  // v0.9.35-dev.6.10.5: «Текущий срез» считаем по живому набору задач —
  // тому же, что показан на вкладке «Задачи» (не архивные, не скрытые/технические).
  const currentTasks = useMemo(
    () => currentSnapshotTasks(allTasks, allStatuses),
    [allTasks, allStatuses],
  );

  // ─── Период (для Активности) ─────────────────────────────────────────────
  const dateRange = useMemo<{ from: string; to: string } | null>(() => {
    if (period !== 'custom') return null;
    return customRange;
  }, [period, customRange]);

  // v0.8.9: серии «новые / выполненные / просроченные» по дню за период.
  // v0.9.2: «Просрочено» теперь читается из таблицы overdue_events —
  // фиксируется КАЖДЫЙ раз, когда задача перешла в состояние просрочки
  // (даже если потом сдвинули дедлайн вперёд и она снова просрочилась —
  // это новое событие). Без бэкфилла: события считаются только с v0.9.2.
  const overdueTick = useStore(s => s.overdueTick);
  const activityDates = useMemo(() => {
    const buildPoints = (from: Date, to: Date) => {
      const fromKey = localDayKey(from);
      const toKey = localDayKey(to);
      // Один SQL-запрос на весь период вместо N перебираемых задач за каждый день.
      const overdueMap = overdueEventsByDate(fromKey, toKey, currentWorkspaceId);
      const result: { date: string; created: number; completed: number; overdue: number; isoDate: string }[] = [];
      for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
        const key = localDayKey(d);
        let created = 0;
        let completed = 0;
        for (const t of dashTasks) {
          // v0.8.11: для серии «Новые» используем дату Старта (start_date), а не created_at —
          // это позволяет корректно отображать ретроспективно внесённые задачи.
          // Fallback на created_at для задач без start_date (старые/импортированные).
          const startKey = t.start_date ? t.start_date.slice(0, 10) : (t.created_at ? t.created_at.slice(0, 10) : '');
          if (startKey === key) created++;
          const fin = t.finish_date ? t.finish_date.slice(0, 10) : '';
          if (fin === key && archiveStatusIds.has(t.status_id)) completed++;
        }
        result.push({
          date: formatMonthDay(key.slice(5), lang),
          created, completed,
          overdue: overdueMap.get(key) ?? 0,
          isoDate: key,
        });
      }
      return result;
    };

    if (period === 'custom' && dateRange) {
      return buildPoints(parseLocalDate(dateRange.from), parseLocalDate(dateRange.to));
    }
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (periodDays - 1));
    return buildPoints(from, to);
    // overdueTick подписывается на счётчик из стора: как только детектор создал
    // новое событие (например, в updateTask), useMemo пересчитается и график
    // обновится без ручного refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashTasks, periodDays, period, dateRange, lang, archiveStatusIds, overdueTick, currentWorkspaceId]);

  // ─── Текущий срез (не зависит от периода) ────────────────────────────────
  const snapshot = useMemo(() => {
    const total = currentTasks.length;
    const inProgress = currentTasks.filter(t =>
      !t.archived && !techIds.has(t.status_id) && !archiveStatusIds.has(t.status_id) && !pausedStatusIds.has(t.status_id)
    ).length;
    const paused = currentTasks.filter(t => pausedStatusIds.has(t.status_id) && !t.archived).length;
    const completed = currentTasks.filter(t => archiveStatusIds.has(t.status_id)).length;
    const today = localDayKey(new Date());
    const overdue = currentTasks.filter(t =>
      t.deadline && t.deadline < today &&
      !archiveStatusIds.has(t.status_id) && !techIds.has(t.status_id) && !t.archived
    ).length;

    // Самый частый тэг (по количеству живых задач)
    let topTag: { name: string; count: number; color: string } | null = null;
    for (const tag of tags) {
      const count = currentTasks.filter(t => t.tag_id === tag.id).length;
      if (count > 0 && (!topTag || count > topTag.count)) {
        topTag = { name: tag.name, count, color: tag.color };
      }
    }

    return { total, inProgress, paused, completed, overdue, topTag };
  }, [currentTasks, techIds, archiveStatusIds, pausedStatusIds, tags]);

  const byStatus = useMemo(() =>
    allStatuses
      .filter(s => !deletedStatusIds.has(s.id))
      .map(s => ({
        name: s.name,
        value: currentTasks.filter(t => t.status_id === s.id).length,
        color: s.color,
        isTechnical: s.is_technical === 1,
      }))
      .filter(x => x.value > 0),
    [currentTasks, allStatuses, deletedStatusIds]);

  const byTag = useMemo(() => {
    const all = tags.map(t => ({
      name: t.name,
      value: currentTasks.filter(ts => ts.tag_id === t.id).length,
      color: t.color,
    }));
    return all.filter(x => x.value > 0);
  }, [currentTasks, tags]);

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
        const key = localDayKey(date);
        const count = dashTasks.filter(t => {
          // v0.8.11: используем start_date (с fallback на created_at) — синхронизировано с
          // графиком Активность; updated_at оставляем как доп. сигнал «активности по задаче».
          const startKey = t.start_date ? t.start_date.slice(0, 10) : (t.created_at ? t.created_at.slice(0, 10) : '');
          const up = t.updated_at ? t.updated_at.slice(0, 10) : '';
          return startKey === key || up === key;
        }).length;
        days.push({ date: key, count });
      }
      weeks.push(days);
    }
    return weeks;
  }, [dashTasks]);

  const recentDone = useMemo(() => {
    return dashTasks.filter(t => archiveStatusIds.has(t.status_id))
      .sort((a, b) => (b.finish_date || b.updated_at || '').localeCompare(a.finish_date || a.updated_at || ''));
  }, [dashTasks, archiveStatusIds]);

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

  const activityTooltipLabelFormatter = (label: string, payload: any[]) => {
    if (payload && payload.length > 0) {
      const entry = payload[0]?.payload;
      if (entry?.isoDate) return formatDate(entry.isoDate);
    }
    return label;
  };

  // Подписи на русском/английском (без расширения i18n)
  const L = {
    snapshotCaption: lang === 'ru' ? 'Текущий срез' : 'Current snapshot',
    periodCaption: lang === 'ru' ? 'За период' : 'For the selected period',
    paused: lang === 'ru' ? 'Приостановлено' : 'On hold',
    topTag: lang === 'ru' ? 'Самый частый тэг' : 'Top tag',
    noTag: lang === 'ru' ? 'нет' : 'none',
    series_created: lang === 'ru' ? 'Новые' : 'Created',
    series_completed: lang === 'ru' ? 'Выполнено' : 'Completed',
    series_overdue: lang === 'ru' ? 'Просрочено' : 'Overdue',
    noTagData: lang === 'ru' ? 'Нет задач с тэгами' : 'No tagged tasks',
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 relative z-10">
      {/* Заголовок (без переключателя периода — он переехал в «За период») */}
      <div className="mb-4">
        <h2 className="font-display text-[18px] font-semibold">{tr(lang, 'nav_dashboard')}</h2>
      </div>

      {/* ─── ТЕКУЩИЙ СРЕЗ ───────────────────────────────────────────────── */}
      <SectionCaption text={L.snapshotCaption} />

      {/* KPI row: 6 metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <KPI label={tr(lang, 'total_tasks')} value={snapshot.total} />
        <KPI label={tr(lang, 'in_progress')} value={snapshot.inProgress} />
        <KPI label={L.paused} value={snapshot.paused} muted />
        <KPI label={tr(lang, 'completed')} value={snapshot.completed} success />
        <KPI label={tr(lang, 'overdue')} value={snapshot.overdue} danger />
        <KPI
          label={L.topTag}
          textValue={snapshot.topTag ? snapshot.topTag.name : L.noTag}
          textColor={snapshot.topTag?.color}
        />
      </div>

      {/* По статусу + По тэгам — статичные */}
      <div className="grid grid-cols-1 lg:grid-cols-2 auto-rows-fr gap-3 mb-6">
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
                {L.noTagData}
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
      </div>

      {/* ─── ЗА ПЕРИОД ──────────────────────────────────────────────────── */}
      <SectionCaption text={L.periodCaption} />

      {/* v0.8.10: Переключатель периода — над графиком Активность */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div className="text-[12px] text-muted uppercase tracking-wider">{tr(lang, 'activity')}</div>
        <div className="flex items-center gap-2 relative">
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
                  <DatePicker
                    value={draftFrom || null}
                    onChange={(v) => setDraftFrom(v ?? '')}
                    className="bg-surface-alt border border-border-soft rounded px-2 py-1 text-[12px]"
                  />
                  <label className="text-[11px] text-muted">{tr(lang, 'dash_to')}</label>
                  <DatePicker
                    value={draftTo || null}
                    onChange={(v) => setDraftTo(v ?? '')}
                    className="bg-surface-alt border border-border-soft rounded px-2 py-1 text-[12px]"
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

      {period === 'custom' && (
        <div className="text-[11px] text-muted mb-2 text-right">
          {formatDate(customRange.from)} → {formatDate(customRange.to)}
        </div>
      )}

      {/* Activity — full width, 3 series. Фиксированная высота (без flex-1 — иначе ResponsiveContainer схлопывается в 0px) */}
      <div className="bg-surface border border-border-soft rounded-xl p-4 mb-3">
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={activityDates} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border-soft)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="var(--muted)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 12,
                }}
                labelFormatter={activityTooltipLabelFormatter}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
              {/* v0.9.1: цвет линии «Новые» жёстко зафиксирован как синий
                  и не зависит от темы (раньше var(--accent) менялся с темой). */}
              <Line type="monotone" dataKey="created" name={L.series_created} stroke="#3B82F6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="completed" name={L.series_completed} stroke="#22A06B" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="overdue" name={L.series_overdue} stroke="var(--status-important)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 12W heatmap + Recently completed in a row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 auto-rows-fr gap-3">
        <div className="bg-surface border border-border-soft rounded-xl p-4 min-h-[200px] flex flex-col overflow-hidden">
          <div className="text-[12px] text-muted uppercase tracking-wider mb-3">{tr(lang, 'activity')} · 12w</div>
          <Heatmap weeks={heatmap} lang={lang} />
        </div>

        <div className="bg-surface border border-border-soft rounded-xl p-4 min-h-[200px] flex flex-col">
          <div className="text-[12px] text-muted uppercase tracking-wider mb-3">{tr(lang, 'recent')}</div>
          {recentDone.length === 0 ? (
            <div className="text-faint text-[13px]">—</div>
          ) : (
            <ul className="space-y-2 overflow-y-auto pr-1 flex-1" style={{ maxHeight: 200 }}>
              {recentDone.map(t => (
                <li key={t.id} className="flex items-center gap-2.5 text-[13px]">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--status-done)' }} />
                  <span className="flex-1 truncate">{t.title}</span>
                  <span className="text-muted text-[11px] mono shrink-0">
                    {formatDate(t.finish_date || t.updated_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── small components ────────────────────────────────────────────────────────

function SectionCaption({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="h-px flex-1 bg-border-soft" />
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-muted font-medium">{text}</div>
      <div className="h-px flex-1 bg-border-soft" />
    </div>
  );
}

function KPI({
  label, value, textValue, textColor, success, danger, muted,
}: {
  label: string;
  value?: number;
  textValue?: string;   // v0.8.10: альтернатива числу — текстовое значение (имя тэга)
  textColor?: string;
  success?: boolean;
  danger?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="bg-surface border border-border-soft rounded-xl px-4 py-3 min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-muted truncate">{label}</div>
      {textValue !== undefined ? (
        <div className="mt-1 flex items-center gap-2 min-w-0">
          {textColor && (
            <span
              className="inline-block rounded-full shrink-0"
              style={{ width: 10, height: 10, background: textColor }}
            />
          )}
          <span className="text-[18px] font-display font-bold leading-none truncate" title={textValue}>{textValue}</span>
        </div>
      ) : (
        <div
          className="mt-1 text-[22px] font-display font-bold tabular leading-none"
          style={{
            color: danger ? 'var(--status-important)'
              : success ? '#437A22'
              : muted ? 'var(--muted)'
              : undefined,
          }}
        >{value ?? 0}</div>
      )}
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
