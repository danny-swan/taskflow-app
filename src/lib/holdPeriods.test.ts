/**
 * Unit-тесты для src/lib/holdPeriods.ts — учёт интервалов «Приостановлено»
 * (столбец «Холд» в Статистике).
 *
 * db.ts и outbox.ts мокаются — тестируем чистую логику расчёта дней и
 * записи переходов статуса.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({
  get: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
}));
vi.mock('./outbox', () => ({
  enqueueOutbox: vi.fn(),
}));
vi.mock('./clientId', () => ({
  getClientId: () => 'test-client',
}));

import * as db from './db';
import { enqueueOutbox } from './outbox';
import {
  isHoldStatus,
  holdDaysForPeriod,
  holdDaysFromPeriods,
  holdDaysByTask,
  recordHoldTransition,
  HOLD_STATUS_NAME,
} from './holdPeriods';
import type { Status } from '../store/useStore';

const holdStatus: Status = {
  id: 5,
  name: HOLD_STATUS_NAME,
  color: '#888',
  behavior: 'bottom',
  sort_order: 5,
  is_seed: 1,
  is_technical: 0,
  hidden: 0,
  default_collapsed: 0,
};
const workStatus: Status = {
  id: 1,
  name: 'В работе',
  color: '#08f',
  behavior: 'middle',
  sort_order: 1,
  is_seed: 1,
  is_technical: 0,
  hidden: 0,
  default_collapsed: 0,
};
const statuses = [workStatus, holdStatus];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isHoldStatus', () => {
  it('распознаёт статус «Приостановлено» по имени', () => {
    expect(isHoldStatus(5, statuses)).toBe(true);
  });
  it('обычный статус → false', () => {
    expect(isHoldStatus(1, statuses)).toBe(false);
  });
  it('null / несуществующий → false', () => {
    expect(isHoldStatus(null, statuses)).toBe(false);
    expect(isHoldStatus(999, statuses)).toBe(false);
  });
});

describe('holdDaysForPeriod — разница ДАТ, целые дни', () => {
  it('поставили и сняли в тот же день → 0 дней', () => {
    expect(holdDaysForPeriod('2026-06-02T09:00:00Z', '2026-06-02T18:00:00Z')).toBe(0);
  });
  it('02.06 → 05.06 → 3 дня', () => {
    expect(holdDaysForPeriod('2026-06-02T00:00:00', '2026-06-05T00:00:00')).toBe(3);
  });
  it('открытый интервал (ended=null) считается до now', () => {
    const now = new Date('2026-06-05T12:00:00');
    expect(holdDaysForPeriod('2026-06-02T00:00:00', null, now)).toBe(3);
  });
  it('битая дата → 0', () => {
    expect(holdDaysForPeriod('not-a-date', '2026-06-05')).toBe(0);
  });
  it('отрицательная разница → 0 (min 0)', () => {
    expect(holdDaysForPeriod('2026-06-05T00:00:00', '2026-06-02T00:00:00')).toBe(0);
  });
});

describe('holdDaysFromPeriods — сумма интервалов', () => {
  it('два интервала складываются (1 + 3 = 4)', () => {
    const days = holdDaysFromPeriods([
      { started_at: '2026-06-01T00:00:00', ended_at: '2026-06-02T00:00:00' }, // 1
      { started_at: '2026-06-10T00:00:00', ended_at: '2026-06-13T00:00:00' }, // 3
    ]);
    expect(days).toBe(4);
  });
  it('пустой список → 0', () => {
    expect(holdDaysFromPeriods([])).toBe(0);
  });
});

describe('holdDaysByTask — агрегация по задачам', () => {
  it('группирует и суммирует по task_id', () => {
    vi.mocked(db.all).mockReturnValueOnce([
      { task_id: 1, started_at: '2026-06-01T00:00:00', ended_at: '2026-06-02T00:00:00' }, // 1
      { task_id: 1, started_at: '2026-06-10T00:00:00', ended_at: '2026-06-13T00:00:00' }, // 3
      { task_id: 2, started_at: '2026-06-02T00:00:00', ended_at: '2026-06-02T00:00:00' }, // 0
    ]);
    const map = holdDaysByTask();
    expect(map.get(1)).toBe(4);
    expect(map.get(2)).toBe(0);
    expect(map.get(3)).toBeUndefined();
  });
  it('таблицы нет (db.all бросает) → пустая map', () => {
    vi.mocked(db.all).mockImplementationOnce(() => { throw new Error('no table'); });
    expect(holdDaysByTask().size).toBe(0);
  });
});

describe('recordHoldTransition', () => {
  it('вход в холд (work → hold) без открытого интервала → INSERT + enqueue', () => {
    vi.mocked(db.get).mockReturnValueOnce(undefined); // нет открытого интервала
    const changed = recordHoldTransition(10, 1, 5, statuses);
    expect(changed).toBe(true);
    const insertCall = vi.mocked(db.run).mock.calls[0];
    expect(insertCall[0]).toContain('INSERT INTO task_hold_periods');
    expect((insertCall[1] as any[])[0]).toBe(10); // task_id
    expect(enqueueOutbox).toHaveBeenCalledWith('task_hold_periods', expect.any(String), 'upsert');
  });

  it('вход в холд, но открытый интервал уже есть → идемпотентно, ничего', () => {
    vi.mocked(db.get).mockReturnValueOnce({ id: 99 }); // уже открыт
    const changed = recordHoldTransition(10, 1, 5, statuses);
    expect(changed).toBe(false);
    expect(db.run).not.toHaveBeenCalled();
    expect(enqueueOutbox).not.toHaveBeenCalled();
  });

  it('выход из холда (hold → work) → закрываем интервал + enqueue', () => {
    vi.mocked(db.get).mockReturnValueOnce({ id: 42, uuid: 'u-42' }); // открытый интервал
    const changed = recordHoldTransition(10, 5, 1, statuses);
    expect(changed).toBe(true);
    const updateCall = vi.mocked(db.run).mock.calls[0];
    expect(updateCall[0]).toContain('UPDATE task_hold_periods');
    expect(updateCall[0]).toContain('ended_at');
    expect(enqueueOutbox).toHaveBeenCalledWith('task_hold_periods', 'u-42', 'upsert');
  });

  it('выход из холда без открытого интервала → ничего', () => {
    vi.mocked(db.get).mockReturnValueOnce(undefined);
    const changed = recordHoldTransition(10, 5, 1, statuses);
    expect(changed).toBe(false);
    expect(db.run).not.toHaveBeenCalled();
  });

  it('переход не касается холда (work → work) → ничего', () => {
    const changed = recordHoldTransition(10, 1, 1, statuses);
    expect(changed).toBe(false);
    expect(db.get).not.toHaveBeenCalled();
    expect(db.run).not.toHaveBeenCalled();
  });

  it('hold → work → hold создаёт ДВА интервала (два входа)', () => {
    // Первый вход: нет открытого → INSERT.
    vi.mocked(db.get).mockReturnValueOnce(undefined);
    expect(recordHoldTransition(10, 1, 5, statuses)).toBe(true);
    // Выход: есть открытый → закрываем.
    vi.mocked(db.get).mockReturnValueOnce({ id: 1, uuid: 'u-1' });
    expect(recordHoldTransition(10, 5, 1, statuses)).toBe(true);
    // Второй вход: снова нет открытого (предыдущий закрыт) → второй INSERT.
    vi.mocked(db.get).mockReturnValueOnce(undefined);
    expect(recordHoldTransition(10, 1, 5, statuses)).toBe(true);

    const inserts = vi.mocked(db.run).mock.calls.filter(c =>
      String(c[0]).includes('INSERT INTO task_hold_periods'),
    );
    expect(inserts).toHaveLength(2);
  });

  it('ошибка в db (нет таблицы) → безопасно false, не бросает', () => {
    vi.mocked(db.get).mockImplementationOnce(() => { throw new Error('no table'); });
    expect(recordHoldTransition(10, 1, 5, statuses)).toBe(false);
  });
});
