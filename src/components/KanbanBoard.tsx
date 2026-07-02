import { useMemo } from 'react';
import { Status, Task, useStore } from '../store/useStore';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import {
  DndContext, closestCorners, PointerSensor, useSensor, useSensors,
  DragEndEvent, DragOverlay, DragStartEvent, DragOverEvent,
} from '@dnd-kit/core';
import { useState } from 'react';

// v0.9.2: плейсхолдер-подсветка при переносе между колонками.
// { columnId, index } — в какой колонке и перед какой позицией будет вставлена карточка.
export type DropIndicator = { columnId: number; index: number } | null;

/**
 * KanbanBoard — горизонтальный ряд колонок по visible-статусам (v0.9.0).
 *
 * Содержит собственный DndContext: drag происходит внутри доски.
 * Логика перетаскивания повторяет Tasks.tsx onDragEnd — внутри колонки
 * меняется sort_order через reorderTasks, между колонками вызывается
 * updateTask({ status_id }), а тосты «Завершено / Отменить» дублируют
 * поведение списочного представления.
 */
export function KanbanBoard({
  tasks,
  statuses,
  onOpenTask,
}: {
  tasks: Task[];
  statuses: Status[];
  onOpenTask: (t: Task) => void;
}) {
  const lang = useStore(s => s.language);
  const allStatuses = useStore(s => s.statuses);
  const updateTask = useStore(s => s.updateTask);
  const reorderTasks = useStore(s => s.reorderTasks);
  const pushToast = useStore(s => s.pushToast);

  const archiveStatusIds = useMemo(
    () => new Set(allStatuses.filter(s => s.behavior === 'archive').map(s => s.id)),
    [allStatuses],
  );

  // Группируем уже отфильтрованные задачи по visible-статусам, сортируем по sort_order.
  const grouped = useMemo(() => {
    return statuses.map(s => ({
      status: s,
      tasks: tasks
        .filter(t => t.status_id === s.id)
        .sort((a, b) => a.sort_order - b.sort_order),
    }));
  }, [tasks, statuses]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  // v0.9.2: подсветка целевой позиции при переносе между колонками
  const [dropIndicator, setDropIndicator] = useState<DropIndicator>(null);

  const findTaskById = (idStr: string): Task | null => {
    const num = parseInt(idStr.replace('task-', ''), 10);
    return tasks.find(t => t.id === num) ?? null;
  };

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    setDropIndicator(null);
  };

  // v0.9.2: визуальный плейсхолдер при drag между колонками. Внутри колонки
  // SortableContext уже сам двигает карточки — там индикатор не нужен, выключаем его.
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) { setDropIndicator(null); return; }
    const activeData = active.data.current as any;
    const overData = over.data.current as any;
    if (!activeData || activeData.type !== 'task') return;

    const sourceStatusId: number = activeData.statusId;
    let targetStatusId: number | null = null;
    let targetIndex: number = 0;

    if (overData?.type === 'task') {
      targetStatusId = overData.statusId;
      const g = grouped.find(g => g.status.id === targetStatusId);
      if (g) targetIndex = g.tasks.findIndex(t => t.id === overData.taskId);
    } else if (overData?.type === 'group') {
      targetStatusId = overData.statusId;
      const g = grouped.find(g => g.status.id === targetStatusId);
      targetIndex = g ? g.tasks.length : 0;
    }

    if (targetStatusId === null || targetStatusId === sourceStatusId) {
      // Внутри колонки SortableContext сам двигает карточки — индикатор лишний.
      setDropIndicator(null);
      return;
    }
    if (targetIndex < 0) targetIndex = 0;
    setDropIndicator({ columnId: targetStatusId, index: targetIndex });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    setDropIndicator(null);
    const { active, over } = e;
    if (!over) return;

    const aId = String(active.id);
    const oId = String(over.id);
    if (aId === oId) return;

    const activeData = active.data.current as any;
    const overData = over.data.current as any;
    if (!activeData || activeData.type !== 'task') return;

    const sourceStatusId: number = activeData.statusId;
    let targetStatusId: number;
    if (overData?.type === 'task') targetStatusId = overData.statusId;
    else if (overData?.type === 'group') targetStatusId = overData.statusId;
    else return;

    const taskId: number = activeData.taskId;

    // Сортировка внутри колонки
    if (sourceStatusId === targetStatusId) {
      const colTasks = grouped.find(g => g.status.id === sourceStatusId)?.tasks ?? [];
      const ids = colTasks.map(t => t.id);
      const oldIdx = ids.indexOf(taskId);
      let newIdx: number;
      if (overData.type === 'task') newIdx = ids.indexOf(overData.taskId);
      else newIdx = ids.length - 1;
      if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) return;
      const next = [...ids];
      next.splice(oldIdx, 1);
      next.splice(newIdx, 0, taskId);
      reorderTasks(sourceStatusId, next);
      return;
    }

    // Перенос между колонками
    const targetGroup = grouped.find(g => g.status.id === targetStatusId);
    if (!targetGroup) return;
    const targetIds = targetGroup.tasks.map(t => t.id);
    let insertAt = targetIds.length;
    if (overData.type === 'task') {
      insertAt = targetIds.indexOf(overData.taskId);
      if (insertAt < 0) insertAt = targetIds.length;
    }
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

  if (statuses.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-[13px]">
        {lang === 'ru' ? 'Нет видимых статусов' : 'No visible statuses'}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-x-auto overflow-y-hidden px-6 pb-6 pt-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="flex gap-3 h-full items-stretch min-w-min">
          {grouped.map(g => (
            <KanbanColumn
              key={g.status.id}
              status={g.status}
              tasks={g.tasks}
              onOpenTask={onOpenTask}
              lang={lang}
              dropIndicator={
                dropIndicator && dropIndicator.columnId === g.status.id
                  ? dropIndicator.index : null
              }
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {draggedTask ? (
            <div
              className="w-[270px] rotate-1 shadow-xl cursor-grabbing"
              style={{ pointerEvents: 'none' }}
            >
              <KanbanCard
                task={draggedTask}
                onOpenModal={() => {}}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
