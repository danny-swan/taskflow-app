import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';
import { ChevronDown, ChevronUp, Search, Download, Eye, EyeOff, Trash2, RotateCcw } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import * as db from '../lib/db';
import { exportCsv, exportJson } from '../lib/db';
import { downloadFile, daysBetween, formatDate } from '../lib/utils';
import { StatusDot } from '../components/StatusPill';
// Modal component no longer used in Stats — replaced by ConfirmDialog

type SortKey = 'title' | 'tag' | 'start' | 'deadline' | 'finish' | 'days' | 'hold' | 'comment' | 'status';

interface ColumnDef {
  key: SortKey;
  labelKey: string;
  defaultWidth: number;
  numeric?: boolean;
  align?: 'left' | 'center';
}

const COLUMNS: ColumnDef[] = [
  { key: 'title',    labelKey: 'title',    defaultWidth: 240, align: 'left' },
  { key: 'tag',      labelKey: 'tag',      defaultWidth: 96,  align: 'center' },
  { key: 'start',    labelKey: 'start',    defaultWidth: 100, align: 'center' },
  { key: 'deadline', labelKey: 'deadline', defaultWidth: 100, align: 'center' },
  { key: 'finish',   labelKey: 'finish',   defaultWidth: 100, align: 'center' },
  { key: 'days',     labelKey: 'days',     defaultWidth: 64,  numeric: true, align: 'center' },
  { key: 'hold',     labelKey: 'hold',     defaultWidth: 64,  numeric: true, align: 'center' },
  { key: 'comment',  labelKey: 'comment',  defaultWidth: 280, align: 'left' },
  { key: 'status',   labelKey: 'status',   defaultWidth: 140, align: 'center' },
];

export function StatsPage() {
  const lang = useStore(s => s.language);
  const tasks = useStore(s => s.tasks);
  const statuses = useStore(s => s.statuses);
  const tags = useStore(s => s.tags);
  const pushToast = useStore(s => s.pushToast);
  const columnWidths = useStore(s => s.columnWidths);
  const setColumnWidth = useStore(s => s.setColumnWidth);
  const updateTask = useStore(s => s.updateTask);
  const deleteTaskWithUndo = useStore(s => s.deleteTaskWithUndo);

  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [restoreId, setRestoreId] = useState<number | null>(null);
  const [restoreStatusId, setRestoreStatusId] = useState<number | null>(null);

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<number | null>(null);
  const [tagFilter, setTagFilter] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('start');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Column visibility — "Комментарий" can be hidden via toolbar toggle. Persisted in `settings`.
  const [commentHidden, setCommentHidden] = useState<boolean>(() => {
    try {
      const row = db.get<{ value: string }>('SELECT value FROM settings WHERE key=?', ['stats_comment_hidden']);
      return row?.value === '1';
    } catch { return false; }
  });
  const toggleCommentHidden = () => {
    setCommentHidden(prev => {
      const next = !prev;
      try {
        db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['stats_comment_hidden', next ? '1' : '0']);
      } catch {}
      return next;
    });
  };

  // Visible columns + redistribute Comment’s width when hidden — 60% to Title, 40% split among others
  const visibleColumns = useMemo(
    () => commentHidden ? COLUMNS.filter(c => c.key !== 'comment') : COLUMNS,
    [commentHidden],
  );

  // local widths state — synced from store but updated continuously during drag
  const [localWidths, setLocalWidths] = useState<Record<string, number>>(() => {
    const w: Record<string, number> = {};
    COLUMNS.forEach(c => { w[c.key] = columnWidths[`stats.${c.key}`] ?? c.defaultWidth; });
    return w;
  });

  useEffect(() => {
    const w: Record<string, number> = {};
    COLUMNS.forEach(c => { w[c.key] = columnWidths[`stats.${c.key}`] ?? c.defaultWidth; });
    setLocalWidths(w);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnWidths]);

  // drag-resize state
  const dragRef = useRef<{ key: SortKey; startX: number; startW: number } | null>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const next = Math.max(48, d.startW + dx);
      setLocalWidths(prev => ({ ...prev, [d.key]: next }));
    }
    function onUp() {
      const d = dragRef.current;
      if (!d) return;
      // persist
      setLocalWidths(prev => {
        setColumnWidth(`stats.${d.key}`, prev[d.key]);
        return prev;
      });
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setColumnWidth]);

  const startDrag = (key: SortKey) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { key, startX: e.clientX, startW: localWidths[key] ?? 100 };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // Stats screen shows ALL tasks including "Удалено" — strikethrough/opacity styles still applied per-row

  const rows = useMemo(() => {
    return tasks
      .filter(t => {
        if (query && !(t.title.toLowerCase().includes(query.toLowerCase()) ||
          (t.comment || '').toLowerCase().includes(query.toLowerCase()))) return false;
        if (statusFilter && t.status_id !== statusFilter) return false;
        if (tagFilter && t.tag_id !== tagFilter) return false;
        return true;
      })
      .map(t => {
        const status = statuses.find(s => s.id === t.status_id);
        return {
          id: t.id,
          title: t.title,
          tag: tags.find(x => x.id === t.tag_id),
          status,
          isTechnical: status?.is_technical === 1,
          archived: t.archived === 1,
          start: t.start_date,
          deadline: t.deadline,
          finish: t.finish_date,
          days: daysBetween(t.start_date, t.finish_date),
          hold: 0,
          comment: t.comment || '',
        };
      })
      .sort((a, b) => {
        let av: any = (a as any)[sortKey];
        let bv: any = (b as any)[sortKey];
        if (sortKey === 'tag') { av = a.tag?.name || ''; bv = b.tag?.name || ''; }
        if (sortKey === 'status') { av = a.status?.name || ''; bv = b.status?.name || ''; }
        if (av == null) av = '';
        if (bv == null) bv = '';
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
  }, [tasks, tags, statuses, query, statusFilter, tagFilter, sortKey, sortDir]);

  const onSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };

  const exportCsvHandler = () => {
    downloadFile('taskflow.csv', exportCsv(), 'text/csv');
    pushToast(tr(lang, 'exported'));
  };
  const exportJsonHandler = () => {
    downloadFile('taskflow.json', JSON.stringify(exportJson(), null, 2), 'application/json');
    pushToast(tr(lang, 'exported'));
  };

  // Compute effective widths — when comment is hidden, redistribute its width to Title (60%) and the rest (40%)
  const effectiveWidths = useMemo(() => {
    const base: Record<string, number> = {};
    COLUMNS.forEach(c => { base[c.key] = localWidths[c.key] ?? c.defaultWidth; });
    if (!commentHidden) return base;
    const freed = base['comment'] ?? 0;
    const others = COLUMNS.filter(c => c.key !== 'comment' && c.key !== 'title');
    const titleBonus = Math.round(freed * 0.6);
    const otherBonus = others.length ? Math.round((freed * 0.4) / others.length) : 0;
    base['title'] = (base['title'] ?? 0) + titleBonus;
    others.forEach(c => { base[c.key] = (base[c.key] ?? 0) + otherBonus; });
    return base;
  }, [localWidths, commentHidden]);

  const totalWidth = visibleColumns.reduce((a, c) => a + (effectiveWidths[c.key] ?? c.defaultWidth), 0) + 60;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-6 pt-4 pb-2 shrink-0">
        <h2 className="font-display text-[18px] font-semibold mb-3">{tr(lang, 'nav_stats')}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 max-w-md min-w-[220px]">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              type="text"
              placeholder={tr(lang, 'search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-surface border border-border-soft rounded-md pl-8 pr-3 py-1.5 text-[13px] outline-none focus:border-accent"
            />
          </div>
          <select
            value={statusFilter ?? ''}
            onChange={(e) => setStatusFilter(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-surface border border-border-soft rounded-md px-2 py-1.5 text-[13px]"
          >
            <option value="">{tr(lang, 'status')}: {tr(lang, 'all')}</option>
            {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select
            value={tagFilter ?? ''}
            onChange={(e) => setTagFilter(e.target.value ? parseInt(e.target.value, 10) : null)}
            className="bg-surface border border-border-soft rounded-md px-2 py-1.5 text-[13px]"
          >
            <option value="">{tr(lang, 'tag')}: {tr(lang, 'all')}</option>
            {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="flex-1" />
          <button
            onClick={toggleCommentHidden}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
            title={commentHidden ? tr(lang, 'show_comment') : tr(lang, 'hide_comment')}
          >
            {commentHidden ? <Eye size={13} /> : <EyeOff size={13} />}
            {commentHidden ? tr(lang, 'show_comment') : tr(lang, 'hide_comment')}
          </button>
          <button
            onClick={exportCsvHandler}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
          ><Download size={13} /> CSV</button>
          <button
            onClick={exportJsonHandler}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
          ><Download size={13} /> JSON</button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        <div style={{ minWidth: totalWidth }}>
          <table className="w-full text-[13px] border-collapse" style={{ tableLayout: 'fixed', width: totalWidth }}>
            <colgroup>
              {visibleColumns.map(c => (
                <col key={c.key} style={{ width: effectiveWidths[c.key] ?? c.defaultWidth }} />
              ))}
              <col style={{ width: 60 }} />
            </colgroup>
            <thead className="sticky top-0 bg-bg z-10">
              <tr className="text-[11px] uppercase tracking-wider text-muted">
                {visibleColumns.map(c => (
                  <Th
                    key={c.key}
                    onSort={() => onSort(c.key)}
                    active={sortKey === c.key}
                    dir={sortDir}
                    align={c.align ?? 'left'}
                    onResizeStart={startDrag(c.key)}
                  >
                    {tr(lang, c.labelKey as any)}
                  </Th>
                ))}
                <th className="py-2 w-[36px]" aria-label="" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.id}
                  className="group border-t border-border-soft align-top"
                  style={r.isTechnical ? { opacity: 0.55 } : undefined}
                >
                  <td className="py-2 pr-3 text-left" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
                    <span style={r.isTechnical ? { textDecoration: 'line-through' } : undefined}>{r.title}</span>
                  </td>
                  <td className="py-2 pr-3 text-center">
                    {r.tag ? (
                      <span className="mono text-[11px] uppercase tracking-wider" style={{ color: r.tag.color }}>{r.tag.name}</span>
                    ) : tags.length > 0 ? (
                      <TagAssignSelect
                        lang={lang}
                        tags={tags}
                        onAssign={(tagId) => updateTask(r.id, { tag_id: tagId })}
                      />
                    ) : (
                      <span className="mono text-[11px] uppercase tracking-wider text-muted">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 mono text-[12px] text-muted text-center">{formatDate(r.start)}</td>
                  <td className="py-2 pr-3 mono text-[12px] text-muted text-center">{formatDate(r.deadline)}</td>
                  <td className="py-2 pr-3 mono text-[12px] text-muted text-center">{formatDate(r.finish)}</td>
                  <td className="py-2 pr-3 mono text-[12px] tabular text-center">{r.days ?? '—'}</td>
                  <td className="py-2 pr-3 mono text-[12px] tabular text-center">{r.hold || '—'}</td>
                  {!commentHidden && (
                    <td className="py-2 pr-3 text-muted text-left" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
                      {r.comment || '—'}
                    </td>
                  )}
                  <td className="py-2 pr-2 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <StatusDot color={r.status?.color || '#000'} />
                      <span className="text-[12px]" style={r.isTechnical ? { textDecoration: 'line-through' } : undefined}>{r.status?.name || '—'}</span>
                    </div>
                  </td>
                  <td className="py-2 pr-2 w-[60px] text-center align-middle">
                    <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {/* Restore icon — shown for done/deleted tasks */}
                      {(r.isTechnical || r.status?.behavior === 'archive') && (
                        <button
                          type="button"
                          onClick={() => { setRestoreId(r.id); setRestoreStatusId(null); }}
                          title={lang === 'ru' ? 'Восстановить задачу' : 'Restore task'}
                          aria-label={lang === 'ru' ? 'Восстановить' : 'Restore'}
                          className="p-1 rounded hover:bg-surface-alt text-muted hover:text-accent"
                        >
                          <RotateCcw size={13} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(r.id)}
                        title={tr(lang, 'perm_delete')}
                        aria-label={tr(lang, 'perm_delete')}
                        className="p-1 rounded hover:bg-surface-alt text-muted hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={visibleColumns.length + 1} className="py-8 text-center text-muted">{tr(lang, 'no_tasks')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Permanent delete dialog */}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title={tr(lang, 'confirm_perm_delete')}
        message={tr(lang, 'confirm_perm_delete_q')}
        confirmLabel={tr(lang, 'perm_delete')}
        cancelLabel={tr(lang, 'cancel')}
        danger
        onConfirm={() => {
          if (confirmDeleteId !== null) {
            // v0.9.35-dev.6.10.5: не удаляем сразу — окно отмены ~10 c.
            deleteTaskWithUndo(confirmDeleteId, {
              toastText: tr(lang, 'record_deleted'),
              undoLabel: lang === 'ru' ? 'Отменить' : 'Undo',
            });
          }
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />

      {/* Restore task dialog */}
      <ConfirmDialog
        open={restoreId !== null}
        title={lang === 'ru' ? 'Восстановить задачу' : 'Restore task'}
        message={lang === 'ru' ? 'Выберите статус для восстановления:' : 'Choose the status to restore to:'}
        confirmLabel={lang === 'ru' ? 'Восстановить' : 'Restore'}
        cancelLabel={tr(lang, 'cancel')}
        onConfirm={() => {
          const targetId = restoreStatusId ?? statuses.find(s => s.is_technical !== 1 && s.behavior !== 'archive')?.id;
          if (restoreId !== null && targetId) {
            useStore.getState().updateTask(restoreId, { status_id: targetId });
            pushToast(lang === 'ru' ? 'Задача восстановлена' : 'Task restored');
          }
          setRestoreId(null);
          setRestoreStatusId(null);
        }}
        onCancel={() => { setRestoreId(null); setRestoreStatusId(null); }}
      >
        {/* Radio group: non-archived, non-technical statuses */}
        <div className="flex flex-col gap-1.5 mt-1">
          {statuses
            .filter(s => s.is_technical !== 1 && s.behavior !== 'archive')
            .map(s => (
              <label key={s.id} className="flex items-center gap-2.5 cursor-pointer text-[13px]">
                <input
                  type="radio"
                  name="restore-status"
                  value={s.id}
                  checked={restoreStatusId === s.id}
                  onChange={() => setRestoreStatusId(s.id)}
                  className="accent-[var(--accent)]"
                />
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: s.color }}
                />
                {s.name}
              </label>
            ))}
        </div>
      </ConfirmDialog>
    </div>
  );
}

/**
 * v0.9.35-dev.6.10.5: назначение тэга прямо из колонки «Тэг» Статистики, когда
 * тэга ещё нет. Нативный <select> в стиле фильтров тулбара; выбор пишется через
 * обычный updateTask → изменение уходит в sync-outbox как любое другое.
 */
function TagAssignSelect({ tags, lang, onAssign }: {
  tags: { id: number; name: string; color: string }[];
  lang: 'ru' | 'en';
  onAssign: (tagId: number) => void;
}) {
  return (
    <select
      value=""
      onChange={(e) => {
        const v = e.target.value;
        if (v) onAssign(parseInt(v, 10));
      }}
      title={lang === 'ru' ? 'Назначить тэг' : 'Assign tag'}
      aria-label={lang === 'ru' ? 'Назначить тэг' : 'Assign tag'}
      className="mono text-[11px] uppercase tracking-wider bg-transparent border border-border-soft rounded px-1 py-0.5 text-muted hover:border-accent cursor-pointer outline-none focus:border-accent"
    >
      <option value="">{lang === 'ru' ? '+ тэг' : '+ tag'}</option>
      {tags.map(t => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </select>
  );
}

function Th({ children, onSort, active, dir, align, onResizeStart }: {
  children: React.ReactNode;
  onSort: () => void;
  active: boolean;
  dir: 'asc' | 'desc';
  align: 'left' | 'center';
  onResizeStart: (e: React.MouseEvent) => void;
}) {
  const alignClass = align === 'center' ? 'text-center' : 'text-left';
  const justifyClass = align === 'center' ? 'justify-center' : '';
  return (
    <th className={`relative py-2 pr-3 select-none font-medium ${alignClass}`} style={{ position: 'relative' }}>
      <span
        onClick={onSort}
        className={`inline-flex items-center gap-1 cursor-pointer ${justifyClass} ${active ? 'text-text' : ''}`}
      >
        {children}
        {active && (dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
      </span>
      <span
        onMouseDown={onResizeStart}
        className="absolute top-0 right-0 h-full w-[4px] cursor-col-resize hover:bg-accent/40"
        title="Drag to resize"
      />
    </th>
  );
}
