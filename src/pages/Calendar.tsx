/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.4 — Вкладка «Календарь».
 * v0.9.5 — Режимы «Неделя» / «Месяц» (Неделя по умолчанию), стрелки в рамках,
 *          «Сегодня» вынесена вправо, полные названия в панели «Без дедлайна»
 *          с вертикальным скроллом. В недельном режиме карточка задачи
 *          показывает полный заголовок с переносом строк (высота адаптивная).
 * Docked-панель «Без дедлайна» — единая для обоих режимов.
 */
import { useMemo, useState } from 'react';
import {
  DndContext, DragEndEvent, DragStartEvent,
  PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  DragOverlay,
} from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, CalendarDays, ChevronUp, ChevronDown } from 'lucide-react';
import { useStore, Task, Status, Tag } from '../store/useStore';
import { tr, Lang, Dict } from '../lib/i18n';
import { TaskModal } from '../components/TaskModal';

// ─── helpers ─────────────────────────────────────────────────────────────────
const MS_DAY = 86400_000;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayYmd(): string { return ymd(new Date()); }

const MONTH_KEYS: (keyof Dict)[] = [
  'month_january', 'month_february', 'month_march', 'month_april',
  'month_may', 'month_june', 'month_july', 'month_august',
  'month_september', 'month_october', 'month_november', 'month_december',
];

/** Заголовок «Июль 2026» — именительный падеж. */
function monthTitle(lang: Lang, y: number, m: number): string {
  const monthName = tr(lang, MONTH_KEYS[m]);
  return monthName.charAt(0).toUpperCase() + monthName.slice(1) + ' ' + y;
}

/** Заголовок для недели, например «1–7 июля 2026» / «29 июня — 5 июля 2026». */
function weekTitle(lang: Lang, start: Date): string {
  const end = new Date(start.getTime() + 6 * MS_DAY);
  const startMonth = tr(lang, MONTH_KEYS[start.getMonth()]);
  const endMonth = tr(lang, MONTH_KEYS[end.getMonth()]);
  const startDay = start.getDate();
  const endDay = end.getDate();
  const y = end.getFullYear();
  if (start.getMonth() === end.getMonth()) {
    return `${startDay}–${endDay} ${startMonth} ${y}`;
  }
  return `${startDay} ${startMonth} — ${endDay} ${endMonth} ${y}`;
}

/**
 * Возвращает 6-недельную сетку (42 дня), начинающуюся с понедельника той недели,
 * куда попадает 1-е число месяца. Всегда 6 строк — чтобы сетка не «прыгала».
 */
function monthGrid(year: number, monthIdx: number): Date[] {
  const first = new Date(year, monthIdx, 1);
  const dow = first.getDay();
  const offset = (dow + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - offset);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(start.getTime() + i * MS_DAY));
  }
  return cells;
}

/** Понедельник недели, содержащей data. */
function weekStart(d: Date): Date {
  const dow = d.getDay();
  const offset = (dow + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
}

function weekGrid(start: Date): Date[] {
  const cells: Date[] = [];
  for (let i = 0; i < 7; i++) cells.push(new Date(start.getTime() + i * MS_DAY));
  return cells;
}

type CalView = 'week' | 'month';

// ─── компоненты ──────────────────────────────────────────────────────────────

export function CalendarPage() {
  const lang = useStore(s => s.language);
  const tasks = useStore(s => s.tasks);
  const statuses = useStore(s => s.statuses);
  const tags = useStore(s => s.tags);
  const updateTask = useStore(s => s.updateTask);

  const [view, setView] = useState<CalView>('week'); // v0.9.5: по умолчанию неделя
  // Для month-режима — курсор на 1-е число месяца.
  // Для week-режима — курсор на понедельник видимой недели.
  const [cursor, setCursor] = useState<Date>(() => weekStart(new Date()));
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Индексы для быстрого доступа
  const statusById = useMemo(() => {
    const m = new Map<number, Status>();
    for (const s of statuses) m.set(s.id, s);
    return m;
  }, [statuses]);
  const tagById = useMemo(() => {
    const m = new Map<number, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  /** Активная задача: не в архивном/техническом статусе, не archived=1. */
  const isActive = (task: Task): boolean => {
    if (task.archived) return false;
    const st = statusById.get(task.status_id);
    if (!st) return false;
    if (st.is_technical === 1) return false;
    if (st.behavior === 'archive') return false;
    return true;
  };

  // Активные задачи с дедлайном → по дате
  const tasksByDate = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.deadline) continue;
      if (!isActive(t)) continue;
      const arr = m.get(t.deadline) ?? [];
      arr.push(t);
      m.set(t.deadline, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    return m;
  }, [tasks, statuses]);

  // Активные задачи без дедлайна — панель снизу
  const noDeadlineTasks = useMemo(() => {
    return tasks
      .filter(t => !t.deadline && isActive(t))
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [tasks, statuses]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const activeData = active.data.current as any;
    const overData = over.data.current as any;
    if (!activeData || activeData.type !== 'cal-task') return;
    if (!overData || overData.type !== 'cal-day') return;

    const taskId: number = activeData.taskId;
    const currentDeadline: string | null = activeData.deadline ?? null;
    const targetDate: string = overData.date;

    if (currentDeadline === targetDate) return;
    updateTask(taskId, { deadline: targetDate });
  };

  const today = todayYmd();

  // Навигация зависит от режима
  const goPrev = () => {
    if (view === 'week') {
      setCursor(new Date(cursor.getTime() - 7 * MS_DAY));
    } else {
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
    }
  };
  const goNext = () => {
    if (view === 'week') {
      setCursor(new Date(cursor.getTime() + 7 * MS_DAY));
    } else {
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
    }
  };
  const goToday = () => {
    if (view === 'week') {
      setCursor(weekStart(new Date()));
    } else {
      const n = new Date();
      setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
    }
  };

  // При переключении вида — нормализуем курсор, чтобы попадал в текущий отрезок
  const switchView = (v: CalView) => {
    if (v === view) return;
    if (v === 'week') {
      // Из «месяц» — переходим на понедельник недели, куда попадает cursor.
      setCursor(weekStart(cursor));
    } else {
      // Из «неделя» — переходим на 1-е число месяца этой недели.
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    }
    setView(v);
  };

  const activeTask = activeId
    ? [...tasks].find(t => `cal-task-${t.id}` === activeId) ?? null
    : null;

  // Заголовок
  const headerTitle = view === 'week'
    ? weekTitle(lang, cursor)
    : monthTitle(lang, cursor.getFullYear(), cursor.getMonth());

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {/* Header с навигацией и переключателем вида */}
        <div className="px-5 py-3 flex items-center gap-3 border-b border-border-soft shrink-0">
          <div className="flex items-center gap-2">
            <CalendarDays size={16} className="text-muted" />
            <div className="font-display text-[16px] font-semibold tabular">
              {headerTitle}
            </div>
          </div>

          {/* View toggle: Неделя / Месяц (как Список / Канбан) */}
          <div className="ml-2 inline-flex rounded border border-border-soft overflow-hidden">
            <button
              onClick={() => switchView('week')}
              className={
                'px-2.5 py-1 text-[12px] transition-colors ' +
                (view === 'week'
                  ? 'bg-surface-alt text-text'
                  : 'text-muted hover:bg-surface-alt/60')
              }
            >
              {tr(lang, 'cal_view_week')}
            </button>
            <button
              onClick={() => switchView('month')}
              className={
                'px-2.5 py-1 text-[12px] transition-colors border-l border-border-soft ' +
                (view === 'month'
                  ? 'bg-surface-alt text-text'
                  : 'text-muted hover:bg-surface-alt/60')
              }
            >
              {tr(lang, 'cal_view_month')}
            </button>
          </div>

          {/* Стрелки навигации — теперь с рамкой */}
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={goPrev}
              className="px-2 py-1 rounded text-[12px] hover:bg-surface-alt text-muted border border-border-soft inline-flex items-center"
              aria-label={tr(lang, view === 'week' ? 'cal_prev_week' : 'cal_prev_month')}
              title={tr(lang, view === 'week' ? 'cal_prev_week' : 'cal_prev_month')}
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={goNext}
              className="px-2 py-1 rounded text-[12px] hover:bg-surface-alt text-muted border border-border-soft inline-flex items-center"
              aria-label={tr(lang, view === 'week' ? 'cal_next_week' : 'cal_next_month')}
              title={tr(lang, view === 'week' ? 'cal_next_week' : 'cal_next_month')}
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* «Сегодня» — вынесена вправо, отдельная группа */}
          <div className="ml-auto">
            <button
              onClick={goToday}
              className="px-2.5 py-1 rounded text-[12px] hover:bg-surface-alt text-muted border border-border-soft"
            >
              {tr(lang, 'cal_today')}
            </button>
          </div>
        </div>

        {/* Сетка — Week или Month */}
        {view === 'month' ? (
          <MonthGrid
            cursor={cursor}
            today={today}
            tasksByDate={tasksByDate}
            statusById={statusById}
            tagById={tagById}
            onOpenTask={setOpenTask}
            lang={lang}
          />
        ) : (
          <WeekGrid
            cursor={cursor}
            today={today}
            tasksByDate={tasksByDate}
            statusById={statusById}
            tagById={tagById}
            onOpenTask={setOpenTask}
            lang={lang}
          />
        )}

        {/* Docked-панель «Без дедлайна» — единая для обоих режимов */}
        <div
          className="shrink-0 border-t border-border-soft"
          style={{ background: 'var(--surface)' }}
        >
          <button
            onClick={() => setPanelOpen(o => !o)}
            className="w-full px-5 py-2 flex items-center gap-2 text-[13px] text-muted hover:bg-surface-alt transition-colors"
            aria-label={tr(lang, 'cal_toggle_panel')}
          >
            {panelOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            <span className="font-medium">{tr(lang, 'cal_no_deadline')}</span>
            <span className="text-faint tabular">· {noDeadlineTasks.length}</span>
            {noDeadlineTasks.length > 0 && (
              <span className="ml-2 text-[11px] text-faint italic hidden md:inline">
                {tr(lang, 'cal_no_deadline_hint')}
              </span>
            )}
          </button>
          {panelOpen && (
            <div
              className="px-5 pb-3 pt-1 overflow-y-auto"
              style={{ maxHeight: 140 }}
            >
              {noDeadlineTasks.length === 0 ? (
                <div className="text-[12px] text-faint italic py-4">
                  {tr(lang, 'no_tasks')}
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {noDeadlineTasks.map(t => (
                    <DraggableTaskChip
                      key={t.id}
                      task={t}
                      status={statusById.get(t.status_id)}
                      tag={t.tag_id ? tagById.get(t.tag_id) : undefined}
                      onOpen={() => setOpenTask(t)}
                      variant="panel"
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            <DraggableTaskChip
              task={activeTask}
              status={statusById.get(activeTask.status_id)}
              tag={activeTask.tag_id ? tagById.get(activeTask.tag_id) : undefined}
              onOpen={() => {}}
              variant="overlay"
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <TaskModal task={openTask} onClose={() => setOpenTask(null)} />
    </div>
  );
}

// ─── Month grid (7×6) ────────────────────────────────────────────────────────

function MonthGrid({
  cursor, today, tasksByDate, statusById, tagById, onOpenTask, lang,
}: {
  cursor: Date;
  today: string;
  tasksByDate: Map<string, Task[]>;
  statusById: Map<number, Status>;
  tagById: Map<number, Tag>;
  onOpenTask: (t: Task) => void;
  lang: Lang;
}) {
  const year = cursor.getFullYear();
  const monthIdx = cursor.getMonth();
  const cells = useMemo(() => monthGrid(year, monthIdx), [year, monthIdx]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden px-5 pt-3 pb-2 min-h-0">
      {/* Дни недели */}
      <div className="grid grid-cols-7 gap-[6px] mb-1 shrink-0">
        {(['dow_mon', 'dow_tue', 'dow_wed', 'dow_thu', 'dow_fri', 'dow_sat', 'dow_sun'] as (keyof Dict)[])
          .map((k, i) => (
            <div
              key={k}
              className={
                'text-center text-[11px] font-mono uppercase tracking-wider py-1 ' +
                (i >= 5 ? 'text-muted/60' : 'text-muted')
              }
            >
              {tr(lang, k)}
            </div>
          ))}
      </div>

      <div
        className="grid grid-cols-7 gap-[6px] flex-1 min-h-0"
        style={{ gridTemplateRows: 'repeat(6, minmax(0, 1fr))' }}
      >
        {cells.map((d, i) => {
          const dateStr = ymd(d);
          const inMonth = d.getMonth() === monthIdx;
          const isToday = dateStr === today;
          const dow = d.getDay();
          const isWeekend = dow === 0 || dow === 6;
          const dayTasks = tasksByDate.get(dateStr) ?? [];
          const isPast = dateStr < today;
          const hasOverdue = isPast && dayTasks.length > 0;
          return (
            <CalendarCell
              key={i}
              date={d}
              dateStr={dateStr}
              inMonth={inMonth}
              isToday={isToday}
              isWeekend={isWeekend}
              hasOverdue={hasOverdue}
              tasks={dayTasks}
              statusById={statusById}
              tagById={tagById}
              onOpenTask={onOpenTask}
              variant="month"
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Week grid (7 колонок) ───────────────────────────────────────────────────

function WeekGrid({
  cursor, today, tasksByDate, statusById, tagById, onOpenTask, lang,
}: {
  cursor: Date;
  today: string;
  tasksByDate: Map<string, Task[]>;
  statusById: Map<number, Status>;
  tagById: Map<number, Tag>;
  onOpenTask: (t: Task) => void;
  lang: Lang;
}) {
  const cells = useMemo(() => weekGrid(cursor), [cursor]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden px-5 pt-3 pb-2 min-h-0">
      {/* Дни недели */}
      <div className="grid grid-cols-7 gap-[6px] mb-1 shrink-0">
        {(['dow_mon', 'dow_tue', 'dow_wed', 'dow_thu', 'dow_fri', 'dow_sat', 'dow_sun'] as (keyof Dict)[])
          .map((k, i) => (
            <div
              key={k}
              className={
                'text-center text-[11px] font-mono uppercase tracking-wider py-1 ' +
                (i >= 5 ? 'text-muted/60' : 'text-muted')
              }
            >
              {tr(lang, k)}
            </div>
          ))}
      </div>

      <div className="grid grid-cols-7 gap-[6px] flex-1 min-h-0">
        {cells.map((d, i) => {
          const dateStr = ymd(d);
          const isToday = dateStr === today;
          const dow = d.getDay();
          const isWeekend = dow === 0 || dow === 6;
          const dayTasks = tasksByDate.get(dateStr) ?? [];
          const isPast = dateStr < today;
          const hasOverdue = isPast && dayTasks.length > 0;
          return (
            <CalendarCell
              key={i}
              date={d}
              dateStr={dateStr}
              inMonth={true}
              isToday={isToday}
              isWeekend={isWeekend}
              hasOverdue={hasOverdue}
              tasks={dayTasks}
              statusById={statusById}
              tagById={tagById}
              onOpenTask={onOpenTask}
              variant="week"
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Ячейка дня (droppable) ──────────────────────────────────────────────────

function CalendarCell({
  date, dateStr, inMonth, isToday, isWeekend, hasOverdue,
  tasks, statusById, tagById, onOpenTask, variant,
}: {
  date: Date;
  dateStr: string;
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  hasOverdue: boolean;
  tasks: Task[];
  statusById: Map<number, Status>;
  tagById: Map<number, Tag>;
  onOpenTask: (t: Task) => void;
  variant: 'week' | 'month';
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cal-day-${dateStr}`,
    data: { type: 'cal-day', date: dateStr },
  });

  const bg = isWeekend ? 'var(--surface-alt)' : 'var(--surface)';
  const borderColor = hasOverdue
    ? 'rgb(239, 68, 68)'
    : isToday
      ? 'var(--accent)'
      : 'var(--border-soft)';
  const borderWidth = (hasOverdue || isToday) ? 1.5 : 1;
  const outline = isOver ? '2px solid var(--accent)' : 'none';

  return (
    <div
      ref={setNodeRef}
      className="flex flex-col rounded-md overflow-hidden min-h-0 transition-colors"
      style={{
        background: bg,
        border: `${borderWidth}px solid ${borderColor}`,
        outline,
        outlineOffset: -2,
        opacity: inMonth ? 1 : 0.45,
      }}
    >
      <div
        className={
          'px-2 py-1 flex items-center justify-between shrink-0 ' +
          (isWeekend ? 'text-muted' : 'text-text')
        }
      >
        <span
          className={
            'text-[12px] tabular ' +
            (isToday ? 'font-bold text-accent' : 'font-medium')
          }
        >
          {date.getDate()}
        </span>
        {tasks.length > 0 && (
          <span className="text-[10px] text-faint tabular">{tasks.length}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-1 space-y-1 min-h-0">
        {tasks.map(t => (
          <DraggableTaskChip
            key={t.id}
            task={t}
            status={statusById.get(t.status_id)}
            tag={t.tag_id ? tagById.get(t.tag_id) : undefined}
            onOpen={() => onOpenTask(t)}
            variant={variant === 'week' ? 'week-cell' : 'cell'}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Карточка задачи (draggable) ─────────────────────────────────────────────

function DraggableTaskChip({
  task, status, tag, onOpen, variant,
}: {
  task: Task;
  status: Status | undefined;
  tag: Tag | undefined;
  onOpen: () => void;
  variant: 'cell' | 'week-cell' | 'panel' | 'overlay';
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `cal-task-${task.id}`,
    data: { type: 'cal-task', taskId: task.id, deadline: task.deadline },
  });

  const dot = status?.color ?? '#888';
  const isPanel = variant === 'panel';
  const isMonthCell = variant === 'cell';
  const isWeekCell = variant === 'week-cell';

  const baseStyle: React.CSSProperties = {
    background: 'var(--bg)',
    border: '1px solid var(--border-soft)',
    opacity: isDragging && variant !== 'overlay' ? 0.4 : 1,
    cursor: 'grab',
  };

  // Панель и week-cell — полное название с переносами.
  // Month cell — компакт с truncate.
  const wrap = isPanel || isWeekCell;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (isDragging) return;
        e.stopPropagation();
        onOpen();
      }}
      className={
        'rounded flex items-start gap-1.5 select-none transition-colors ' +
        (isMonthCell ? 'px-1.5 py-1 text-[11px]' : 'px-2 py-1 text-[12px]') +
        ' hover:border-accent/60'
      }
      style={{
        ...baseStyle,
        // Панель — задаём минимальную ширину, чтобы длинные названия
        // читались, но не «съедали» весь ряд. maxWidth не ограничиваем.
        minWidth: isPanel ? 220 : undefined,
        maxWidth: isPanel ? 320 : undefined,
      }}
      title={task.title}
    >
      {/* Точка статуса */}
      <span
        aria-hidden
        style={{
          background: dot,
          width: 8,
          height: 8,
          borderRadius: 999,
          flexShrink: 0,
          border: dot.toLowerCase() === '#ffffff' ? '1px solid var(--border-soft)' : 'none',
          marginTop: wrap ? 5 : 0, // выравниваем с первой строкой
        }}
      />
      <span
        className={
          'flex-1 min-w-0 ' +
          (wrap ? 'whitespace-normal break-words leading-snug' : 'truncate')
        }
      >
        {task.title}
      </span>
      {tag && (
        <span
          className="inline-flex items-center px-1 rounded text-[9px] font-mono font-medium uppercase tracking-wide shrink-0"
          style={{
            color: tag.color,
            border: `1px solid ${tag.color}55`,
            lineHeight: 1.4,
            marginTop: wrap ? 3 : 0,
          }}
        >
          {tag.name}
        </span>
      )}
    </div>
  );
}
