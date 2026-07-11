/**
 * Unit-тесты для src/lib/outbox.ts — enqueue-хелпер.
 *
 * db.ts мокается — проверяем SQL-запросы (INSERT ... ON CONFLICT DO UPDATE)
 * и то, что enqueueOutbox корректно обрабатывает NULL uuid.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./db', () => ({
  get: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
}));

import * as db from './db';
import { enqueueOutbox, outboxPendingCount } from './outbox';

describe('enqueueOutbox', () => {
  beforeEach(() => {
    vi.mocked(db.run).mockReset();
    vi.mocked(db.get).mockReset();
  });

  it('вставляет запись через INSERT ... ON CONFLICT DO UPDATE', () => {
    enqueueOutbox('tasks', 'u-42', 'upsert');
    expect(db.run).toHaveBeenCalledTimes(1);
    const [sql, params] = vi.mocked(db.run).mock.calls[0];
    expect(sql).toContain('INSERT INTO sync_outbox');
    expect(sql).toContain('ON CONFLICT(entity_table, entity_uuid) DO UPDATE');
    expect(sql).toContain('op = excluded.op');
    expect(sql).toContain('attempt_count = 0');
    expect(params).toEqual(['tasks', 'u-42', 'upsert']);
  });

  it('передаёт op=delete как есть', () => {
    enqueueOutbox('tags', 'u-99', 'delete');
    expect(db.run).toHaveBeenCalledTimes(1);
    const [, params] = vi.mocked(db.run).mock.calls[0];
    expect(params).toEqual(['tags', 'u-99', 'delete']);
  });

  it('тихо пропускает enqueue при NULL uuid', () => {
    enqueueOutbox('tasks', null, 'upsert');
    enqueueOutbox('tasks', undefined, 'upsert');
    enqueueOutbox('tasks', '', 'upsert');
    expect(db.run).not.toHaveBeenCalled();
  });

  it('поддерживает все sync-таблицы', () => {
    enqueueOutbox('tasks', 'a', 'upsert');
    enqueueOutbox('tags', 'b', 'upsert');
    enqueueOutbox('statuses', 'c', 'upsert');
    enqueueOutbox('task_templates', 'd', 'upsert');
    enqueueOutbox('overdue_events', 'e', 'upsert');
    expect(db.run).toHaveBeenCalledTimes(5);
    const tables = vi.mocked(db.run).mock.calls.map((c) => (c[1] as any[])[0]);
    expect(tables).toEqual(['tasks', 'tags', 'statuses', 'task_templates', 'overdue_events']);
  });

  it('resets queued_at, attempt_count, last_attempt_at, last_error через excluded/константы', () => {
    enqueueOutbox('tasks', 'u-1', 'upsert');
    const [sql] = vi.mocked(db.run).mock.calls[0];
    expect(sql).toContain("queued_at = excluded.queued_at");
    expect(sql).toContain('attempt_count = 0');
    expect(sql).toContain('last_attempt_at = NULL');
    expect(sql).toContain('last_error = NULL');
  });
});

describe('outboxPendingCount', () => {
  beforeEach(() => {
    vi.mocked(db.get).mockReset();
  });

  it('возвращает count из COUNT(*)', () => {
    vi.mocked(db.get).mockReturnValue({ count: 7 } as any);
    expect(outboxPendingCount()).toBe(7);
    const [sql] = vi.mocked(db.get).mock.calls[0];
    expect(sql).toContain('COUNT(*)');
    expect(sql).toContain('sync_outbox');
  });

  it('возвращает 0 если запрос вернул null', () => {
    vi.mocked(db.get).mockReturnValue(null as any);
    expect(outboxPendingCount()).toBe(0);
  });
});
