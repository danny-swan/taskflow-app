/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.4 — Вкладка «Календарь».
 * Месячная сетка (7×N, старт с Пн) с задачами по дедлайну, docked-панель
 * «Без дедлайна» снизу, DnD между панелью и ячейками — назначает/меняет
 * дедлайн через updateTask({ deadline }).
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

/** Заголовок «Июль 2026» — родительный падеж уже зашит в i18n (для RU). */
function monthTitle(lang: Lang, y: number, m: number): string {
  const monthName = tr(lang, MONTH_KEYS[m]);
  if (lang === 'ru') {
    // «июля 2026» — с прописной первой буквы.
    return monthName.charAt(0).toUpperCase() + monthName.slice(1) + ' ' + y;
  }
  return monthName + ' ' + y;
}

/**
 * Возвращает 6-недельную сетку (42 дня), начинающуюся с понедельника той недели,
 * куда попадает 1-е число месяца. Всегда 6 строк — чтобы сетка не «прыгала»
 * при переключении месяцев.
 */
function monthGrid(year: number, monthIdx: number): Date[] {
  const first = new Date(year, monthIdx, 1);
  const dow = first.getDay(); // 0 = Вс, 1 = Пн, ...
  // Смещаем начало на понедельник этой недели.
  // Пн=1 → offset 0, Вт=2 → 1, ..., Вс=0 → 6.
  const offset = (dow + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - offset);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(start.getTime() + i * MS_DAY));
  }
  return cells;
}

// ─── компоненты ──────────────────────────────────────────────────────────────

export function CalendarPage() {
  const lang = useStore(s => s.language);
  const tasks = useStore(s => s.tasks);
  const statuses = useStore(s => s.statuses);
  const tags = useStore(s => s.tags);
  const updateTask = useStore(s => s.updateTask);

  const [cursor, setCursor] = useState<Date>(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);

  const year = cursor.getFullYear();
  const monthIdx = cursor.getMonth();
  const cells = useMemo(() => monthGrid(year, monthIdx), [year, monthIdx]);

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
    // Сортировка внутри дня по sort_order (стабильная порядковая).
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

    // Тот же день — ничего не делаем.
    if (currentDeadline === targetDate) return;

    updateTask(taskId, { deadline: targetDate });
  };

  const today = todayYmd();

  const goPrev = () => setCursor(new Date(year, monthIdx - 1, 1));
  const goNext = () => setCursor(new Date(year, monthIdx + 1, 1));
  const goToday = () => {
    const n = new Date();
    setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
  };

  const activeTask = activeId
    ? [...tasks].find(t => `cal-task-${t.id}` === activeId) ?? null
    : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {/* Header с навигацией */}
        <div className="px-5 py-3 flex items-center gap-3 border-b border-border-soft shrink-0">
          <div className="flex items-center gap-2">
            <CalendarDays size={16} className="text-muted" />
            <div className="font-display text-[16px] font-semibold tabular">
              {monthTitle(lang, year, monthIdx)}
            </div>
          </div>
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={goPrev}
              className="p-1 rounded hover:bg-surface-alt text-muted"
              aria-label={tr(lang, 'cal_prev_month')}
              title={tr(lang, 'cal_prev_month')}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={goToday}
              className="px-2 py-1 rounded text-[12px] hover:bg-surface-alt text-muted border border-border-soft"
            >
              {tr(lang, 'cal_today')}
            </button>
            <button
              onClick={goNext}
              className="p-1 rounded hover:bg-surface-alt text-muted"
              aria-label={tr(lang, 'cal_next_month')}
              title={tr(lang, 'cal_next_month')}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Сетка */}
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

          {/* Сетка ячеек — заполняет доступную высоту, каждая строка растягивается равномерно */}
          <div
            className="grid grid-cols-7 gap-[6px] flex-1 min-h-0"
            style={{ gridTemplateRows: 'repeat(6, minmax(0, 1fr))' }}
          >
            {cells.map((d, i) => {
              const dateStr = ymd(d);
              const inMonth = d.getMonth() === monthIdx;
              const isToday = dateStr === today;
              const dow = d.getDay(); // 0=Вс, 6=Сб
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
                  onOpenTask={setOpenTask}
                  lang={lang}
                />
              );
            })}
          </div>
        </div>

        {/* Docked-панель «Без дедлайна» */}
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
              className="px-5 pb-3 pt-1 overflow-x-auto"
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

// ─── Ячейка дня (droppable) ──────────────────────────────────────────────────

function CalendarCell({
  date, dateStr, inMonth, isToday, isWeekend, hasOverdue,
  tasks, statusById, tagById, onOpenTask, lang,
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
  lang: Lang;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cal-day-${dateStr}`,
    data: { type: 'cal-day', date: dateStr },
  });

  // Стили ячейки
  const bg = isWeekend ? 'var(--surface-alt)' : 'var(--surface)';
  const borderColor = hasOverdue
    ? 'rgb(239, 68, 68)' // красная рамка для просроченного дня
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
            variant="cell"
          />
        ))}
      </div>
      {/* NB: nav_calendar / cal_more_n сейчас не используются — все задачи видны через скролл. */}
      {/* lang нужен только для будущей локализации aria-label */}
      <span className="sr-only" data-lang={lang} />
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
  variant: 'cell' | 'panel' | 'overlay';
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `cal-task-${task.id}`,
    data: { type: 'cal-task', taskId: task.id, deadline: task.deadline },
  });

  const dot = status?.color ?? '#888';
  const isPanel = variant === 'panel';
  const isCell = variant === 'cell';

  const baseStyle: React.CSSProperties = {
    background: 'var(--bg)',
    border: '1px solid var(--border-soft)',
    opacity: isDragging && variant !== 'overlay' ? 0.4 : 1,
    cursor: 'grab',
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Клик открывает модалку, но НЕ при перетаскивании.
        if (isDragging) return;
        e.stopPropagation();
        onOpen();
      }}
      className={
        'rounded flex items-center gap-1.5 select-none transition-colors ' +
        (isCell ? 'px-1.5 py-1 text-[11px]' : 'px-2 py-1 text-[12px]') +
        ' hover:border-accent/60'
      }
      style={{
        ...baseStyle,
        maxWidth: isPanel ? 220 : undefined,
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
        }}
      />
      <span className="truncate flex-1 min-w-0">{task.title}</span>
      {tag && (
        <span
          className="inline-flex items-center px-1 rounded text-[9px] font-mono font-medium uppercase tracking-wide shrink-0"
          style={{
            color: tag.color,
            border: `1px solid ${tag.color}55`,
            lineHeight: 1.4,
          }}
        >
          {tag.name}
        </span>
      )}
    </div>
  );
}
