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
import { enqueueOutbox, outboxPendingCount, workspaceHasPendingOutbox, workspaceOutboxFailedPermanently } from './outbox';
import { MAX_ATTEMPTS } from './sync/push';

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

describe('workspaceHasPendingOutbox', () => {
  beforeEach(() => {
    vi.mocked(db.get).mockReset();
  });

  it('false без workspaceId (не трогает БД)', () => {
    expect(workspaceHasPendingOutbox(null)).toBe(false);
    expect(workspaceHasPendingOutbox(undefined)).toBe(false);
    expect(workspaceHasPendingOutbox('')).toBe(false);
    expect(db.get).not.toHaveBeenCalled();
  });

  it('true когда есть pending по ws или его members', () => {
    vi.mocked(db.get).mockReturnValue({ n: 2 } as any);
    expect(workspaceHasPendingOutbox('ws_s')).toBe(true);
    const [sql, params] = vi.mocked(db.get).mock.calls[0];
    expect(sql).toContain('sync_outbox');
    expect(sql).toContain('workspace_members');
    // Bug A: исчерпанные строки не считаются pending — фильтр attempt_count < MAX.
    expect(sql).toContain('attempt_count < ?');
    expect(params).toEqual(['ws_s', MAX_ATTEMPTS, 'ws_s', MAX_ATTEMPTS]);
  });

  it('false когда pending нет', () => {
    vi.mocked(db.get).mockReturnValue({ n: 0 } as any);
    expect(workspaceHasPendingOutbox('ws_s')).toBe(false);
  });

  it('false и не бросает, если БД недоступна', () => {
    vi.mocked(db.get).mockImplementation(() => { throw new Error('DB not initialized'); });
    expect(workspaceHasPendingOutbox('ws_s')).toBe(false);
  });
});

describe('workspaceOutboxFailedPermanently (Bug A)', () => {
  beforeEach(() => {
    vi.mocked(db.get).mockReset();
  });

  it('false без workspaceId (не трогает БД)', () => {
    expect(workspaceOutboxFailedPermanently(null)).toBe(false);
    expect(workspaceOutboxFailedPermanently(undefined)).toBe(false);
    expect(workspaceOutboxFailedPermanently('')).toBe(false);
    expect(db.get).not.toHaveBeenCalled();
  });

  it('true когда по ws есть исчерпанные строки (attempt_count >= MAX)', () => {
    vi.mocked(db.get).mockReturnValue({ n: 1 } as any);
    expect(workspaceOutboxFailedPermanently('ws_s')).toBe(true);
    const [sql, params] = vi.mocked(db.get).mock.calls[0];
    expect(sql).toContain('attempt_count >= ?');
    expect(params).toEqual(['ws_s', MAX_ATTEMPTS, 'ws_s', MAX_ATTEMPTS]);
  });

  it('false когда исчерпанных строк нет', () => {
    vi.mocked(db.get).mockReturnValue({ n: 0 } as any);
    expect(workspaceOutboxFailedPermanently('ws_s')).toBe(false);
  });

  it('false и не бросает, если БД недоступна', () => {
    vi.mocked(db.get).mockImplementation(() => { throw new Error('DB not initialized'); });
    expect(workspaceOutboxFailedPermanently('ws_s')).toBe(false);
  });
});
