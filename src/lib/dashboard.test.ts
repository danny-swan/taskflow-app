/**
 * Тесты для currentSnapshotTasks — фильтр «Текущего среза» Дашборда.
 * Должен совпадать с набором задач вкладки «Задачи»: не архивные и не в
 * скрытых/технических статусах.
 */
import { describe, it, expect } from 'vitest';
import { currentSnapshotTasks } from './dashboard';
import type { Status, Task } from '../store/useStore';

const status = (id: number, extra: Partial<Status> = {}): Status =>
  ({
    id,
    name: `s${id}`,
    color: '#888',
    behavior: 'middle',
    sort_order: id,
    is_seed: 0,
    is_technical: 0,
    hidden: 0,
    default_collapsed: 0,
    ...extra,
  }) as Status;

const task = (id: number, status_id: number, extra: Partial<Task> = {}): Task =>
  ({
    id,
    title: `t${id}`,
    comment: '',
    tag_id: null,
    status_id,
    start_date: null,
    deadline: null,
    finish_date: null,
    created_at: '2026-07-01',
    updated_at: '2026-07-01',
    sort_order: id,
    archived: 0,
    ...extra,
  }) as Task;

describe('currentSnapshotTasks', () => {
  const statuses = [
    status(1, { name: 'В процессе' }),
    status(2, { name: 'Выполнено', behavior: 'archive' }),
    status(3, { name: 'Скрытый', hidden: 1 }),
    status(4, { name: 'Удалено', is_technical: 1, behavior: 'archive' }),
  ];

  it('исключает архивные задачи', () => {
    const tasks = [task(10, 1), task(11, 1, { archived: 1 })];
    const ids = currentSnapshotTasks(tasks, statuses).map(t => t.id);
    expect(ids).toEqual([10]);
  });

  it('исключает задачи в технических статусах («Удалено»)', () => {
    const tasks = [task(10, 1), task(12, 4)];
    const ids = currentSnapshotTasks(tasks, statuses).map(t => t.id);
    expect(ids).toEqual([10]);
  });

  it('исключает задачи в скрытых статусах', () => {
    const tasks = [task(10, 1), task(13, 3)];
    const ids = currentSnapshotTasks(tasks, statuses).map(t => t.id);
    expect(ids).toEqual([10]);
  });

  it('оставляет живые задачи, включая не-архивные «Выполнено»', () => {
    const tasks = [
      task(10, 1),          // в процессе — видна
      task(14, 2),          // выполнено, но не archived — видна (как на доске)
      task(15, 2, { archived: 1 }), // выполнено + архивировано — скрыта
    ];
    const ids = currentSnapshotTasks(tasks, statuses).map(t => t.id);
    expect(ids).toEqual([10, 14]);
  });

  it('совпадает с определением «видимых» задач вкладки Задачи', () => {
    const hiddenIds = new Set(statuses.filter(s => s.hidden || s.is_technical === 1).map(s => s.id));
    const tasks = [task(10, 1), task(11, 1, { archived: 1 }), task(12, 4), task(13, 3), task(14, 2)];
    const expected = tasks.filter(t => !t.archived && !hiddenIds.has(t.status_id)).map(t => t.id);
    expect(currentSnapshotTasks(tasks, statuses).map(t => t.id)).toEqual(expected);
  });
});
