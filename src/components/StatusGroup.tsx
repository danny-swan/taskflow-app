import { ChevronDown, ChevronRight } from 'lucide-react';
import { Status, Task } from '../store/useStore';
import { TaskCard } from './TaskCard';
import { StatusDot } from './StatusPill';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { motion, AnimatePresence } from 'framer-motion';

export function StatusGroup({
  status, tasks, onOpenTask, open, onToggle,
}: {
  status: Status;
  tasks: Task[];
  onOpenTask: (t: Task) => void;
  open: boolean;
  onToggle: () => void;
}) {
  const containerId = `group-${status.id}`;
  // Whole-group droppable so cards can be dropped onto an empty group too
  const { setNodeRef, isOver } = useDroppable({
    id: containerId,
    data: { type: 'group', statusId: status.id },
  });

  return (
    <section className="mb-6">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 mb-2 group w-full"
      >
        {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
        <StatusDot color={status.color} />
        <span className="font-display font-semibold text-[14px] tracking-tight">{status.name}</span>
        <span className="text-muted text-[12px] mono">· {tasks.length}</span>
      </button>

      {open && (
        <SortableContext items={tasks.map(t => `task-${t.id}`)} strategy={verticalListSortingStrategy}>
          <div
            ref={setNodeRef}
            className={'space-y-2 transition-colors rounded-lg ' + (isOver ? 'dnd-drop-active' : '')}
            style={{ minHeight: tasks.length === 0 ? 44 : undefined, padding: isOver ? 4 : 0 }}
          >
            <AnimatePresence initial={false}>
              {tasks.map(t => (
                <motion.div
                  key={t.id}
                  layout
                  initial={{ opacity: 0, y: -12, scale: 0.92 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.18 } }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                >
                  <SortableTask task={t} onOpenTask={onOpenTask} />
                </motion.div>
              ))}
            </AnimatePresence>
            {tasks.length === 0 && !isOver && (
              <div className="text-[12px] text-faint italic ml-6">пусто</div>
            )}
          </div>
        </SortableContext>
      )}
    </section>
  );
}

function SortableTask({ task, onOpenTask }: { task: Task; onOpenTask: (t: Task) => void }) {
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
      <TaskCard
        task={task}
        onOpenModal={() => onOpenTask(task)}
        dragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}
