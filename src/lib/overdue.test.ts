/**
 * Unit-тесты для src/lib/overdue.ts — детектор пересечений дедлайна.
 *
 * db.ts мокается — тестируем чистую логику фильтров и дубликатов.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Мокаем db.ts перед импортом overdue.ts.
vi.mock('./db', () => ({
  get: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
}));

import * as db from './db';
import { detectOverdueEventForTask, detectOverdueEvents, overdueEventsByDate } from './overdue';
import type { Task, Status } from '../store/useStore';

const activeStatus: Status = {
  id: 1,
  name: 'В работе',
  color: '#888',
  behavior: 'middle',
  sort_order: 1,
  is_seed: 0,
  is_technical: 0,
  hidden: 0,
  default_collapsed: 0,
};

const archivedStatus: Status = {
  id: 2,
  name: 'Выполнено',
  color: '#0a0',
  behavior: 'archive',
  sort_order: 2,
  is_seed: 0,
  is_technical: 1,
  hidden: 0,
  default_collapsed: 0,
};

const statuses = [activeStatus, archivedStatus];

function makeTask(partial: Partial<Task>): Task {
  return {
    id: 1,
    title: 'test',
    comment: '',
    tag_id: null,
    status_id: 1,
    start_date: null,
    deadline: null,
    finish_date: null,
    created_at: '2026-07-01',
    updated_at: '2026-07-01',
    sort_order: 1,
    archived: 0,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('detectOverdueEventForTask', () => {
  const today = '2026-07-04';

  it('без дедлайна → false', () => {
    const task = makeTask({ deadline: null });
    expect(detectOverdueEventForTask(task, statuses, today)).toBe(false);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('дедлайн сегодня → не просрочено', () => {
    const task = makeTask({ deadline: today });
    expect(detectOverdueEventForTask(task, statuses, today)).toBe(false);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('дедлайн в будущем → не просрочено', () => {
    const task = makeTask({ deadline: '2026-08-01' });
    expect(detectOverdueEventForTask(task, statuses, today)).toBe(false);
  });

  it('архивный статус → не создаём событие даже при просроченном дедлайне', () => {
    const task = makeTask({ deadline: '2026-06-01', status_id: 2 });
    expect(detectOverdueEventForTask(task, statuses, today)).toBe(false);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('archived=1 → не создаём событие', () => {
    const task = makeTask({ deadline: '2026-06-01', archived: 1 });
    expect(detectOverdueEventForTask(task, statuses, today)).toBe(false);
  });

  it('статус не найден → false', () => {
    const task = makeTask({ deadline: '2026-06-01', status_id: 999 });
    expect(detectOverdueEventForTask(task, statuses, today)).toBe(false);
  });

  it('первая просрочка → создаём событие', () => {
    vi.mocked(db.get).mockReturnValueOnce(undefined);
    const task = makeTask({ deadline: '2026-06-01' });
    expect(detectOverdueEventForTask(task, statuses, today)).toBe(true);
    expect(db.run).toHaveBeenCalledOnce();
    const args = vi.mocked(db.run).mock.calls[0];
    expect(args[1]).toEqual([1, '2026-06-01', today]);
  });

  it('дубликат: тот же deadline_snapshot → пропускаем', () => {
    vi.mocked(db.get).mockReturnValueOnce({ deadline_snapshot: '2026-06-01' });
    const task = makeTask({ deadline: '2026-06-01' });
    expect(detectOverdueEventForTask(task, statuses, today)).toBe(false);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('дедлайн сдвинут — новое событие', () => {
    vi.mocked(db.get).mockReturnValueOnce({ deadline_snapshot: '2026-05-01' });
    const task = makeTask({ deadline: '2026-06-01' });
    expect(detectOverdueEventForTask(task, statuses, today)).toBe(true);
    expect(db.run).toHaveBeenCalledOnce();
  });

  it('ошибка в db.get → безопасно возвращает false', () => {
    vi.mocked(db.get).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const task = makeTask({ deadline: '2026-06-01' });
    expect(detectOverdueEventForTask(task, statuses, today)).toBe(false);
    expect(db.run).not.toHaveBeenCalled();
  });
});

describe('detectOverdueEvents', () => {
  it('считает кол-во созданных событий', () => {
    vi.mocked(db.get).mockReturnValue(undefined);
    const tasks = [
      makeTask({ id: 1, deadline: '2026-06-01' }), // просрочена
      makeTask({ id: 2, deadline: '2026-08-01' }), // будущее
      makeTask({ id: 3, deadline: null }),         // без дедлайна
      makeTask({ id: 4, deadline: '2026-05-01' }), // просрочена
    ];
    expect(detectOverdueEvents(tasks, statuses, '2026-07-04')).toBe(2);
    expect(db.run).toHaveBeenCalledTimes(2);
  });

  it('ошибка в одной задаче не ломает всё', () => {
    vi.mocked(db.get)
      .mockImplementationOnce(() => { throw new Error('boom'); })
      .mockReturnValueOnce(undefined);
    const tasks = [
      makeTask({ id: 1, deadline: '2026-06-01' }),
      makeTask({ id: 2, deadline: '2026-05-01' }),
    ];
    expect(detectOverdueEvents(tasks, statuses, '2026-07-04')).toBe(1);
  });
});

describe('overdueEventsByDate', () => {
  it('группирует события по дате', () => {
    vi.mocked(db.all).mockReturnValueOnce([
      { event_date: '2026-07-01', c: 3 },
      { event_date: '2026-07-02', c: 1 },
    ]);
    const map = overdueEventsByDate('2026-07-01', '2026-07-10');
    expect(map.get('2026-07-01')).toBe(3);
    expect(map.get('2026-07-02')).toBe(1);
    expect(map.get('2026-07-03')).toBeUndefined();
  });

  it('ошибка в db.all → пустая map, не бросает', () => {
    vi.mocked(db.all).mockImplementationOnce(() => {
      throw new Error('table missing');
    });
    const map = overdueEventsByDate('2026-07-01', '2026-07-10');
    expect(map.size).toBe(0);
  });
});
