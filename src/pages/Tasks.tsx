import { useMemo, useState, useEffect, useRef } from 'react';
import { useStore, Task } from '../store/useStore';
import { tr } from '../lib/i18n';
import { StatusGroup } from '../components/StatusGroup';
import { TaskModal } from '../components/TaskModal';
import { NewTaskModal } from '../components/NewTaskModal';
import {
  Search, Filter, ChevronsDownUp, ChevronsUpDown, ChevronDown, FileText,
  List, LayoutGrid,
} from 'lucide-react';
import { KanbanBoard } from '../components/KanbanBoard';
import { useNavigate } from 'react-router-dom';
import {
  DndContext, closestCorners, PointerSensor, useSensor, useSensors,
  DragEndEvent, DragOverlay, DragStartEvent,
} from '@dnd-kit/core';

const COLLAPSE_KEY = 'taskflow.collapse.v1';

function readCollapseState(): Record<number, boolean> {
  try { return JSON.parse(sessionStorage.getItem(COLLAPSE_KEY) || '{}'); } catch { return {}; }
}
function writeCollapseState(s: Record<number, boolean>) {
  try { sessionStorage.setItem(COLLAPSE_KEY, JSON.stringify(s)); } catch {}
}

export function TasksPage() {
  const lang = useStore(s => s.language);
  const allTasks = useStore(s => s.tasks);
  const allStatuses = useStore(s => s.statuses);
  const tags = useStore(s => s.tags);
  const updateTask = useStore(s => s.updateTask);
  const reorderTasks = useStore(s => s.reorderTasks);
  const pushToast = useStore(s => s.pushToast);
  const taskTemplates = useStore(s => s.taskTemplates);
  const createTaskFromTemplate = useStore(s => s.createTaskFromTemplate);
  const tasksView = useStore(s => s.tasksView);
  const setTasksView = useStore(s => s.setTasksView);

  const techIds = useMemo(() => new Set(allStatuses.filter(s => s.is_technical === 1).map(s => s.id)), [allStatuses]);

  // Task 8: filter by hidden flag (not technical, not hidden)
  const statuses = useMemo(() =>
    allStatuses.filter(s => s.is_technical !== 1 && !s.hidden),
    [allStatuses]
  );

  // Task 6: tasks visible on the board — NOT archived, NOT technical status, NOT hidden status
  const tasks = useMemo(() => {
    const hiddenIds = new Set(allStatuses.filter(s => s.hidden || s.is_technical === 1).map(s => s.id));
    return allTasks.filter(t => !t.archived && !hiddenIds.has(t.status_id));
  }, [allTasks, allStatuses, techIds]);

  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<number | null>(null);
  const statusFilter = useStore(s => s.taskStatusFilter);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  // v0.8.6: модалка «+ Новая задача» вместо вкладки /add
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  // v0.8.13: выпадающее меню шаблонов (split-button)
  const [templatesMenuOpen, setTemplatesMenuOpen] = useState(false);
  const templatesMenuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  // Task 8: initialize collapse state from defaultCollapsed (first render only)
  const defaultCollapseInit = useMemo(() => {
    const saved = readCollapseState();
    const result: Record<number, boolean> = {};
    for (const s of statuses) {
      if (s.id in saved) {
        result[s.id] = saved[s.id];
      } else {
        // Apply defaultCollapsed on first render
        result[s.id] = !!s.default_collapsed;
      }
    }
    return result;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [manualCollapsed, setManualCollapsed] = useState<Record<number, boolean>>(defaultCollapseInit);
  useEffect(() => { writeCollapseState(manualCollapsed); }, [manualCollapsed]);

  // Keyboard shortcuts
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName.match(/INPUT|TEXTAREA|SELECT/)) return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key.toLowerCase() === 'n') setNewTaskOpen(true);
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [navigate]);

  // v0.8.13: клик вне split-меню шаблонов закрывает его.
  useEffect(() => {
    if (!templatesMenuOpen) return;
    const onDocDown = (e: MouseEvent) => {
      if (!templatesMenuRef.current) return;
      if (templatesMenuRef.current.contains(e.target as Node)) return;
      setTemplatesMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [templatesMenuOpen]);

  const archiveStatusIds = useMemo(
    () => new Set(allStatuses.filter(s => s.behavior === 'archive' && s.is_technical !== 1).map(s => s.id)),
    [allStatuses]
  );
  const pausedStatusIds = useMemo(
    () => new Set(allStatuses.filter(s => s.behavior === 'bottom' || s.behavior === 'paused').map(s => s.id)),
    [allStatuses]
  );

  const filterActive = !!query || tagFilter != null || statusFilter != null;

  // v0.9.0: вынесли фильтрацию в отдельный useMemo — и Список, и Канбан работают с одними и теми же задачами.
  const filtered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return tasks.filter(t => {
      if (query && !(t.title.toLowerCase().includes(query.toLowerCase()) ||
        (t.comment || '').toLowerCase().includes(query.toLowerCase()))) return false;
      if (tagFilter && t.tag_id !== tagFilter) return false;
      if (statusFilter === 'inprogress' && (archiveStatusIds.has(t.status_id) || pausedStatusIds.has(t.status_id))) return false;
      if (statusFilter === 'overdue') {
        if (!t.deadline || t.deadline >= today || archiveStatusIds.has(t.status_id) || pausedStatusIds.has(t.status_id)) return false;
      }
      // v0.8.6: «внимание» — дедлайн в [today, today+3], исключая архив/паузу/просрочку
      if (statusFilter === 'attention') {
        if (!t.deadline || t.deadline < today || archiveStatusIds.has(t.status_id) || pausedStatusIds.has(t.status_id)) return false;
        const dToday = new Date(today + 'T00:00:00');
        const dDL = new Date(t.deadline + 'T00:00:00');
        const diffDays = Math.round((dDL.getTime() - dToday.getTime()) / 86400000);
        if (diffDays < 0 || diffDays > 3) return false;
      }
      if (statusFilter === 'paused' && !pausedStatusIds.has(t.status_id)) return false;
      if (statusFilter === 'done' && !archiveStatusIds.has(t.status_id)) return false;
      return true;
    });
  }, [tasks, query, tagFilter, statusFilter, archiveStatusIds, pausedStatusIds]);

  const grouped = useMemo(() => {
    return statuses.map(s => ({
      status: s,
      tasks: filtered.filter(t => t.status_id === s.id).sort((a, b) => a.sort_order - b.sort_order),
    }));
  }, [filtered, statuses]);

  const effectiveCollapsed = useMemo(() => {
    const eff: Record<number, boolean> = {};
    if (filterActive) {
      grouped.forEach(g => { eff[g.status.id] = g.tasks.length === 0; });
    } else {
      statuses.forEach(s => { eff[s.id] = !!manualCollapsed[s.id]; });
    }
    return eff;
  }, [filterActive, grouped, manualCollapsed, statuses]);

  const allCollapsed = statuses.length > 0 && statuses.every(s => manualCollapsed[s.id]);

  const toggleAll = () => {
    if (allCollapsed) {
      const next: Record<number, boolean> = {};
      statuses.forEach(s => { next[s.id] = false; });
      setManualCollapsed(next);
    } else {
      const next: Record<number, boolean> = {};
      statuses.forEach(s => { next[s.id] = true; });
      setManualCollapsed(next);
    }
  };

  const toggleOne = (id: number) => {
    setManualCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // ─── DnD ────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeId, setActiveId] = useState<string | null>(null);

  const findTaskById = (idStr: string): Task | null => {
    const num = parseInt(idStr.replace('task-', ''), 10);
    return tasks.find(t => t.id === num) ?? null;
  };

  const onDragStart = (e: DragStartEvent) => { setActiveId(String(e.active.id)); };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const activeData = active.data.current as any;
    const overData = over.data.current as any;
    if (!activeData || activeData.type !== 'task') return;

    const sourceStatusId: number = activeData.statusId;
    let targetStatusId: number;
    if (overData?.type === 'task') targetStatusId = overData.statusId;
    else if (overData?.type === 'group') targetStatusId = overData.statusId;
    else return;

    const taskId: number = activeData.taskId;

    if (sourceStatusId === targetStatusId) {
      const groupTasks = grouped.find(g => g.status.id === sourceStatusId)?.tasks ?? [];
      const ids = groupTasks.map(t => t.id);
      const oldIdx = ids.indexOf(taskId);
      let newIdx: number;
      if (overData.type === 'task') { newIdx = ids.indexOf(overData.taskId); }
      else { newIdx = ids.length - 1; }
      if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return;
      const next = [...ids];
      next.splice(oldIdx, 1);
      next.splice(newIdx, 0, taskId);
      reorderTasks(sourceStatusId, next);
      return;
    }

    const targetGroup = grouped.find(g => g.status.id === targetStatusId);
    if (!targetGroup) return;
    const targetIds = targetGroup.tasks.map(t => t.id);
    let insertAt = targetIds.length;
    if (overData.type === 'task') {
      insertAt = targetIds.indexOf(overData.taskId);
      if (insertAt < 0) insertAt = targetIds.length;
    }
    // v0.8.12: undo для drag-and-drop — если перенесли в «Выполнено» (archive), предлагаем откат
    const movingTask = tasks.find(t => t.id === taskId);
    const prevFinish = movingTask?.finish_date ?? null;
    updateTask(taskId, { status_id: targetStatusId });
    if (archiveStatusIds.has(targetStatusId) && !archiveStatusIds.has(sourceStatusId)) {
      pushToast(
        lang === 'ru' ? 'Задача завершена' : 'Task completed',
        {
          label: lang === 'ru' ? 'Отменить' : 'Undo',
          onClick: () => updateTask(taskId, { status_id: sourceStatusId, finish_date: prevFinish }),
        },
      );
    }
    const newOrder = [...targetIds.slice(0, insertAt), taskId, ...targetIds.slice(insertAt)];
    reorderTasks(targetStatusId, newOrder);
    const sourceGroup = grouped.find(g => g.status.id === sourceStatusId);
    if (sourceGroup) {
      const sourceOrder = sourceGroup.tasks.map(t => t.id).filter(id => id !== taskId);
      reorderTasks(sourceStatusId, sourceOrder);
    }
  };

  const draggedTask = activeId ? findTaskById(activeId) : null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative z-10">
      {/* Toolbar — search + tag filters (scrollable) + fixed action buttons */}
      <div className="px-6 pt-4 pb-2 shrink-0 flex flex-col gap-2">
        {/* Row 1: search */}
        <div className="relative max-w-md">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            placeholder={tr(lang, 'search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-surface border border-border-soft rounded-md pl-8 pr-3 py-1.5 text-[13px] outline-none focus:border-accent"
          />
        </div>
        {/* Row 2: tag filters (horizontal scroll) + fixed action buttons */}
        <div className="flex items-center gap-3">
          <div
            className="flex-1 min-w-0 overflow-x-auto"
            style={{ scrollbarWidth: 'thin' }}
          >
            <div className="flex items-center gap-1.5 flex-nowrap pr-1" style={{ WebkitOverflowScrolling: 'touch' }}>
              <Filter size={13} className="text-muted shrink-0" />
              <button
                onClick={() => setTagFilter(null)}
                className={'px-2.5 py-1 rounded-full text-[11px] border shrink-0 ' +
                  (!tagFilter ? 'bg-accent-soft text-accent border-accent' : 'border-border-soft hover:bg-surface-alt')}
              >{tr(lang, 'all')}</button>
              {tags.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTagFilter(tagFilter === t.id ? null : t.id)}
                  className={'px-2.5 py-1 rounded-full text-[11px] border mono uppercase shrink-0 ' +
                    (tagFilter === t.id ? 'bg-accent-soft text-accent border-accent' : 'border-border-soft hover:bg-surface-alt')}
                >{t.name}</button>
              ))}
            </div>
          </div>
          {/* Fixed right: view-toggle + collapse-all + new-task */}
          <div className="flex items-center gap-2 shrink-0">
            {/* v0.9.0: переключатель Список / Канбан */}
            <div
              className="flex items-center bg-surface-alt rounded-md p-0.5 border border-border-soft"
              role="tablist"
              aria-label={lang === 'ru' ? 'Режим просмотра' : 'View mode'}
            >
              <button
                type="button"
                role="tab"
                aria-selected={tasksView === 'list'}
                onClick={() => setTasksView('list')}
                title={lang === 'ru' ? 'Список' : 'List'}
                className={
                  'flex items-center gap-1 px-2 py-1 text-[12px] rounded-[5px] transition-colors ' +
                  (tasksView === 'list'
                    ? 'bg-surface text-text shadow-sm'
                    : 'text-muted hover:text-text')
                }
              >
                <List size={13} />
                <span>{lang === 'ru' ? 'Список' : 'List'}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tasksView === 'kanban'}
                onClick={() => setTasksView('kanban')}
                title={lang === 'ru' ? 'Канбан' : 'Kanban'}
                className={
                  'flex items-center gap-1 px-2 py-1 text-[12px] rounded-[5px] transition-colors ' +
                  (tasksView === 'kanban'
                    ? 'bg-surface text-text shadow-sm'
                    : 'text-muted hover:text-text')
                }
              >
                <LayoutGrid size={13} />
                <span>{lang === 'ru' ? 'Канбан' : 'Kanban'}</span>
              </button>
            </div>
            {tasksView === 'list' && (
              <button
                onClick={toggleAll}
                title={allCollapsed ? tr(lang, 'expand_all') : tr(lang, 'collapse_all')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
              >
                {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
                <span>{allCollapsed ? tr(lang, 'expand_all') : tr(lang, 'collapse_all')}</span>
              </button>
            )}
            {/* v0.8.13: split-кнопка «+ Новая задача» │ ▾. Основная часть
                открывает пустую модалку (поведение как раньше), стрелка — меню со списком
                шаблонов. Если шаблонов нет — меню прячется, остаётся обычная кнопка. */}
            <div ref={templatesMenuRef} className="relative inline-flex items-stretch">
              <button
                onClick={() => setNewTaskOpen(true)}
                className={
                  'px-3 py-1.5 text-[13px] bg-accent hover:bg-accent-hover text-white font-medium ' +
                  (taskTemplates.length > 0
                    ? 'rounded-l-md border-r border-white/20'
                    : 'rounded-md')
                }
              >{tr(lang, 'new_task')}</button>
              {taskTemplates.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setTemplatesMenuOpen(v => !v)}
                    title={lang === 'ru' ? 'Из шаблона' : 'From template'}
                    aria-label={lang === 'ru' ? 'Из шаблона' : 'From template'}
                    aria-haspopup="menu"
                    aria-expanded={templatesMenuOpen}
                    className="px-1.5 bg-accent hover:bg-accent-hover text-white rounded-r-md flex items-center justify-center"
                  >
                    <ChevronDown size={14} />
                  </button>
                  {templatesMenuOpen && (
                    <div
                      role="menu"
                      className="absolute top-full right-0 mt-1 z-40 min-w-[220px] max-w-[320px] bg-surface border border-border rounded-md shadow-lg py-1 text-[13px]"
                    >
                      <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-muted">
                        {lang === 'ru' ? 'Из шаблона' : 'From template'}
                      </div>
                      {taskTemplates.map(tpl => (
                        <button
                          key={tpl.id}
                          role="menuitem"
                          onClick={() => {
                            setTemplatesMenuOpen(false);
                            const id = createTaskFromTemplate(tpl.id);
                            if (id != null) {
                              pushToast(
                                lang === 'ru' ? `Создано из шаблона: ${tpl.name}` : `Created from template: ${tpl.name}`
                              );
                            }
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-surface-alt flex items-start gap-2"
                        >
                          <FileText size={13} className="mt-[2px] shrink-0 text-muted" />
                          <span className="flex-1 min-w-0">
                            <span className="block truncate font-medium">{tpl.name}</span>
                            {tpl.title && (
                              <span className="block truncate text-[11px] text-muted">{tpl.title}</span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable task list (Список) или Канбан */}
      {tasksView === 'list' && (
        <div className="flex-1 overflow-y-auto px-6 pb-8 pt-2">
          {grouped.every(g => g.tasks.length === 0) && (
            <div className="text-center text-muted text-[13px] py-12">{tr(lang, 'no_tasks')}</div>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            {grouped.map(g => (
              <StatusGroup
                key={g.status.id}
                status={g.status}
                tasks={g.tasks}
                onOpenTask={setOpenTask}
                open={!effectiveCollapsed[g.status.id]}
                onToggle={() => toggleOne(g.status.id)}
              />
            ))}
            <DragOverlay dropAnimation={null}>
              {draggedTask ? (
                <div className="bg-surface border border-accent rounded-lg px-4 py-2.5 shadow-lg opacity-90 text-[13.5px] font-semibold">
                  {draggedTask.title}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}
      {tasksView === 'kanban' && (
        <KanbanBoard
          tasks={filtered}
          statuses={statuses}
          onOpenTask={setOpenTask}
        />
      )}

      <TaskModal task={openTask} onClose={() => setOpenTask(null)} />
      <NewTaskModal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
    </div>
  );
}
