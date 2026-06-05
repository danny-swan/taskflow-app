import { useMemo, useState, useEffect, useRef } from 'react';
import { useStore, Task } from '../store/useStore';
import { tr } from '../lib/i18n';
import { StatusGroup } from '../components/StatusGroup';
import { TaskModal } from '../components/TaskModal';
import { NewTaskModal } from '../components/NewTaskModal';
import {
  Search, Filter, ChevronsDownUp, ChevronsUpDown,
} from 'lucide-react';
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

  const archiveStatusIds = useMemo(
    () => new Set(allStatuses.filter(s => s.behavior === 'archive' && s.is_technical !== 1).map(s => s.id)),
    [allStatuses]
  );
  const pausedStatusIds = useMemo(
    () => new Set(allStatuses.filter(s => s.behavior === 'bottom' || s.behavior === 'paused').map(s => s.id)),
    [allStatuses]
  );

  const filterActive = !!query || tagFilter != null || statusFilter != null;

  const grouped = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const filtered = tasks.filter(t => {
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
    return statuses.map(s => ({
      status: s,
      tasks: filtered.filter(t => t.status_id === s.id).sort((a, b) => a.sort_order - b.sort_order),
    }));
  }, [tasks, statuses, query, tagFilter, statusFilter, archiveStatusIds, pausedStatusIds]);

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
    updateTask(taskId, { status_id: targetStatusId });
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
          {/* Fixed right: collapse-all + new-task */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={toggleAll}
              title={allCollapsed ? tr(lang, 'expand_all') : tr(lang, 'collapse_all')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
            >
              {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
              <span>{allCollapsed ? tr(lang, 'expand_all') : tr(lang, 'collapse_all')}</span>
            </button>
            <button
              onClick={() => setNewTaskOpen(true)}
              className="px-3 py-1.5 text-[13px] bg-accent hover:bg-accent-hover text-white rounded-md font-medium"
            >{tr(lang, 'new_task')}</button>
          </div>
        </div>
      </div>

      {/* Scrollable task list */}
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

      <TaskModal task={openTask} onClose={() => setOpenTask(null)} />
      <NewTaskModal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
    </div>
  );
}
