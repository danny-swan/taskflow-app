import type { Task, Status } from '../store/useStore';

/**
 * v0.9.35-dev.6.10.5: «Текущий срез» на Дашборде должен отражать РОВНО тот
 * набор задач, что виден на вкладке «Задачи» прямо сейчас — то есть живое
 * состояние, а не всю историю. Определение «текущей» задачи повторяет фильтр
 * TasksPage: задача НЕ архивная и её статус НЕ скрытый и НЕ технический
 * (в т.ч. «Удалено»). Мягко удалённые (deleted_at) сюда уже не попадают —
 * их отфильтровывает refresh() на уровне SELECT.
 *
 * Исторические графики «За период» (Активность, тепловая карта, недавно
 * выполненные) намеренно продолжают считать по всем задачам и этот хелпер
 * не используют.
 */
export function currentSnapshotTasks(tasks: Task[], statuses: Status[]): Task[] {
  const hiddenStatusIds = new Set(
    statuses.filter(s => s.hidden || s.is_technical === 1).map(s => s.id),
  );
  return tasks.filter(t => !t.archived && !hiddenStatusIds.has(t.status_id));
}
