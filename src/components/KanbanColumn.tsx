import { Plus } from 'lucide-react';
import { Status, Task } from '../store/useStore';
import { StatusDot } from './StatusPill';
import { KanbanCard } from './KanbanCard';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * KanbanColumn — вертикальная колонка канбан-доски (v0.9.0).
 *
 * Хедер фиксирован сверху: цветная точка + название статуса + счётчик + «+».
 * Список карточек скроллится вертикально независимо внутри колонки.
 *
 * Сама колонка — droppable (для пустых колонок) + SortableContext
 * для перетаскивания карточек по вертикали.
 */
export function KanbanColumn({
  status,
  tasks,
  onOpenTask,
  onAdd,
  lang,
  dropIndicator,
}: {
  status: Status;
  tasks: Task[];
  onOpenTask: (t: Task) => void;
  onAdd?: () => void;
  lang: 'ru' | 'en';
  /**
   * v0.9.2: если не null — перед какой позицией надо показать полоску-плейсхолдер.
   * Активен только при переносе карточки между колонками (внутри колонки сам
   * SortableContext двигает карточки). index считается от 0..tasks.length (в конце списка).
   */
  dropIndicator?: number | null;
}) {
  const containerId = `col-${status.id}`;
  const { setNodeRef, isOver } = useDroppable({
    id: containerId,
    data: { type: 'group', statusId: status.id },
  });

  return (
    <div
      className="flex flex-col rounded-lg bg-surface-alt/40 border border-border-soft shrink-0"
      style={{ width: 290, maxHeight: '100%' }}
    >
      {/* Хедер колонки */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-soft">
        <StatusDot color={status.color} />
        <span className="font-display font-semibold text-[13px] tracking-tight truncate flex-1">
          {status.name}
        </span>
        <span className="text-muted text-[11px] mono shrink-0">{tasks.length}</span>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            title={lang === 'ru' ? 'Новая задача в эту колонку' : 'New task in this column'}
            aria-label={lang === 'ru' ? 'Новая задача' : 'New task'}
            className="w-5 h-5 rounded flex items-center justify-center text-muted hover:bg-surface hover:text-text shrink-0"
          >
            <Plus size={13} />
          </button>
        )}
      </div>

      {/* Список карточек — вертикальный скрол */}
      <SortableContext items={tasks.map(t => `task-${t.id}`)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={
            'flex-1 overflow-y-auto p-2 space-y-2 transition-colors ' +
            (isOver ? 'dnd-drop-active' : '')
          }
          style={{ scrollbarWidth: 'thin', minHeight: 80 }}
        >
          <AnimatePresence initial={false}>
            {tasks.map((t, i) => (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: -12, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.18 } }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                {dropIndicator === i && <DropSlot />}
                <SortableKanbanTask task={t} onOpenTask={onOpenTask} />
              </motion.div>
            ))}
          </AnimatePresence>
          {/* Плейсхолдер в конце списка (или в пустой колонке — единственный индикатор) */}
          {dropIndicator !== null && dropIndicator !== undefined && dropIndicator >= tasks.length && <DropSlot />}
          {tasks.length === 0 && !isOver && dropIndicator == null && (
            <div className="text-[11px] text-faint italic text-center py-3">
              {lang === 'ru' ? 'пусто' : 'empty'}
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// v0.9.2: визуальный слот-подсветка места, куда встанет карточка при drop.
// Высота от средней карточки (≈ 60px), цвет — accent с низкой непрозрачностью.
function DropSlot() {
  return (
    <div
      className="rounded-md border-2 border-dashed transition-colors"
      style={{
        borderColor: 'var(--accent)',
        backgroundColor: 'color-mix(in oklab, var(--accent) 12%, transparent)',
        height: 60,
        marginBottom: 8,
      }}
      aria-hidden="true"
    />
  );
}

function SortableKanbanTask({
  task,
  onOpenTask,
}: {
  task: Task;
  onOpenTask: (t: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `task-${task.id}`,
    data: { type: 'task', taskId: task.id, statusId: task.status_id },
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <KanbanCard
        task={task}
        onOpenModal={() => onOpenTask(task)}
        dragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}
