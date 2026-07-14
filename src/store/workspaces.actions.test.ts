/**
 * Тесты Wave A (PR-4): store-действия управления пространствами и участниками.
 *
 *   createWorkspace — INSERT workspaces + owner-membership + 2×enqueueOutbox + switch;
 *   renameWorkspace — UPDATE name + enqueueOutbox upsert;
 *   deleteWorkspace — personal блокируется; shared → soft-delete + enqueueOutbox delete;
 *   addWorkspaceMember — INSERT нового / реактивация существующего;
 *   updateWorkspaceMemberRole / removeWorkspaceMember — UPDATE + enqueueOutbox.
 *
 * db.ts мокаем: db.run пишет в лог вызовов (для проверки SQL + params),
 * db.get отвечает на точечные SELECT (sort_order, существующий member).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const dbGet = vi.fn((..._a: any[]): any => undefined);
const dbRun = vi.fn((..._a: any[]): any => undefined);
const dbAll = vi.fn((..._a: any[]): any[] => []);

vi.mock('../lib/db', () => ({
  initDb: vi.fn(async () => {}),
  get: (...a: any[]) => dbGet(...a),
  all: (...a: any[]) => dbAll(...a),
  run: (...a: any[]) => dbRun(...a),
  exec: vi.fn(),
  save: vi.fn(async () => {}),
  isReady: vi.fn(() => true),
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../lib/clientId', () => ({ getClientId: () => 'client-1' }));

const enqueueOutbox = vi.fn();
vi.mock('../lib/outbox', () => ({ enqueueOutbox: (...a: any[]) => enqueueOutbox(...a) }));

import { useStore, type Workspace } from './useStore';
import { SEED_STATUSES } from '../lib/seedData';

const UID = 'user-abc';

const wsRow = (id: string, kind: string): Workspace =>
  ({ id, name: id, kind, owner_id: UID, sort_order: 0 });

/** Достаёт все SQL-строки, прошедшие через db.run. */
const runSqls = () => dbRun.mock.calls.map(c => String(c[0]));
const outboxCalls = () => enqueueOutbox.mock.calls.map(c => [c[0], c[2]]);

beforeEach(() => {
  dbGet.mockReset();
  dbRun.mockReset();
  dbAll.mockReset();
  dbAll.mockReturnValue([]);
  enqueueOutbox.mockReset();
  useStore.setState({
    ready: true, workspaces: [], workspaceMembers: [],
    currentWorkspaceId: null, boundUserId: UID, overdueMode: 'calendar',
  });
});

describe('createWorkspace', () => {
  it('вставляет ws + owner-membership, ставит 2 outbox-upsert и переключается', () => {
    // sort_order-SELECT и readOverdueModeForWs → undefined (calendar по умолчанию)
    dbGet.mockReturnValue(undefined);
    // readWorkspacesFromDb (SELECT ... FROM workspaces) должен «увидеть» только что
    // вставленную строку — иначе switchWorkspace посчитает id неизвестным.
    dbAll.mockImplementation((sql: string) => {
      if (/FROM workspaces/.test(sql)) {
        const ins = dbRun.mock.calls.find(c => /INSERT INTO workspaces/.test(String(c[0])));
        if (ins) {
          const p = ins[1] as any[];
          return [{ uuid: p[0], name: p[1], kind: p[2], owner_id: p[3], sort_order: p[4] }];
        }
      }
      return [];
    });
    const id = useStore.getState().createWorkspace('  Проект  ', 'shared');

    expect(id).toMatch(/^ws_[0-9a-f]+$/);
    const sqls = runSqls();
    expect(sqls.some(s => /INSERT INTO workspaces/.test(s))).toBe(true);
    expect(sqls.some(s => /INSERT INTO workspace_members/.test(s))).toBe(true);
    // trim применён к имени
    const wsInsert = dbRun.mock.calls.find(c => /INSERT INTO workspaces/.test(String(c[0])));
    expect(wsInsert?.[1]).toContain('Проект');
    // два upsert: workspaces + workspace_members
    expect(outboxCalls()).toEqual(
      expect.arrayContaining([['workspaces', 'upsert'], ['workspace_members', 'upsert']]),
    );
    // переключились на новый ws
    expect(useStore.getState().currentWorkspaceId).toBe(id);
  });

  it('Bug #4: сеет 7 эталонных статусов с workspace_id нового ws + outbox-upsert на каждый', () => {
    dbGet.mockReturnValue(undefined); // sort_order/COUNT → 0 (ws пустой)
    dbAll.mockImplementation((sql: string) => {
      if (/FROM workspaces/.test(sql)) {
        const ins = dbRun.mock.calls.find(c => /INSERT INTO workspaces/.test(String(c[0])));
        if (ins) {
          const p = ins[1] as any[];
          return [{ uuid: p[0], name: p[1], kind: p[2], owner_id: p[3], sort_order: p[4] }];
        }
      }
      return [];
    });

    const id = useStore.getState().createWorkspace('Проект', 'personal');

    const statusInserts = dbRun.mock.calls.filter(c => /INSERT INTO statuses/.test(String(c[0])));
    expect(statusInserts).toHaveLength(SEED_STATUSES.length);

    // Имена и behavior сеются точь-в-точь по эталону; workspace_id = новый ws.
    statusInserts.forEach((call, i) => {
      const p = call[1] as any[];
      expect(p[0]).toBe(SEED_STATUSES[i].name);
      expect(p[1]).toBe(SEED_STATUSES[i].color);
      expect(p[2]).toBe(SEED_STATUSES[i].behavior);
      expect(p[3]).toBe(i);                 // sort_order = индекс
      expect(p[p.length - 1]).toBe(id);     // workspace_id — последний параметр
    });

    // Технический «Удалено» сеется скрытым.
    const deleted = statusInserts.find(c => (c[1] as any[])[0] === 'Удалено');
    expect((deleted?.[1] as any[])[4]).toBe(1); // is_technical
    expect((deleted?.[1] as any[])[5]).toBe(1); // hidden

    // На каждый статус — enqueueOutbox('statuses', uuid, 'upsert').
    const statusOutbox = enqueueOutbox.mock.calls.filter(c => c[0] === 'statuses');
    expect(statusOutbox).toHaveLength(SEED_STATUSES.length);
    expect(statusOutbox.every(c => c[2] === 'upsert')).toBe(true);
  });

  it('Bug #4: идемпотентность — если в ws уже есть статусы, повторно не сеет', () => {
    dbGet.mockImplementation((sql: string) => {
      if (/COUNT\(\*\)\s+AS\s+c\s+FROM statuses/.test(sql)) return { c: 7 };
      return undefined;
    });
    dbAll.mockImplementation((sql: string) => {
      if (/FROM workspaces/.test(sql)) {
        const ins = dbRun.mock.calls.find(c => /INSERT INTO workspaces/.test(String(c[0])));
        if (ins) {
          const p = ins[1] as any[];
          return [{ uuid: p[0], name: p[1], kind: p[2], owner_id: p[3], sort_order: p[4] }];
        }
      }
      return [];
    });

    useStore.getState().createWorkspace('Проект', 'shared');

    const statusInserts = dbRun.mock.calls.filter(c => /INSERT INTO statuses/.test(String(c[0])));
    expect(statusInserts).toHaveLength(0);
    expect(enqueueOutbox.mock.calls.filter(c => c[0] === 'statuses')).toHaveLength(0);
  });
});

describe('renameWorkspace', () => {
  it('UPDATE name + enqueueOutbox upsert; пустое имя игнорируется', () => {
    useStore.setState({ workspaces: [wsRow('ws_s', 'shared')], currentWorkspaceId: 'ws_s' });
    useStore.getState().renameWorkspace('ws_s', '  Новое имя  ');
    const upd = dbRun.mock.calls.find(c => /UPDATE workspaces SET name/.test(String(c[0])));
    expect(upd).toBeTruthy();
    expect(upd?.[1]?.[0]).toBe('Новое имя'); // trim
    expect(outboxCalls()).toContainEqual(['workspaces', 'upsert']);

    dbRun.mockReset(); enqueueOutbox.mockReset();
    useStore.getState().renameWorkspace('ws_s', '   ');
    expect(dbRun).not.toHaveBeenCalled();
  });
});

describe('deleteWorkspace', () => {
  it('personal — отказ (никаких db.run / outbox)', () => {
    useStore.setState({ workspaces: [wsRow('ws_p', 'personal')], currentWorkspaceId: 'ws_p' });
    useStore.getState().deleteWorkspace('ws_p');
    expect(dbRun).not.toHaveBeenCalled();
    expect(enqueueOutbox).not.toHaveBeenCalled();
  });

  it('shared — soft-delete (UPDATE deleted_at) + enqueueOutbox delete', () => {
    useStore.setState({ workspaces: [wsRow('ws_s', 'shared')], currentWorkspaceId: 'ws_s' });
    dbAll.mockReturnValue([]); // после удаления readWorkspacesFromDb → пусто
    useStore.getState().deleteWorkspace('ws_s');
    const del = dbRun.mock.calls.find(c => /UPDATE workspaces SET deleted_at/.test(String(c[0])));
    expect(del).toBeTruthy();
    expect(outboxCalls()).toContainEqual(['workspaces', 'delete']);
  });
});

describe('addWorkspaceMember', () => {
  it('новый участник → INSERT + enqueueOutbox upsert', () => {
    useStore.setState({ currentWorkspaceId: 'ws_s' });
    dbGet.mockReturnValue(undefined); // существующего нет
    useStore.getState().addWorkspaceMember('user-x', 'editor');
    const ins = dbRun.mock.calls.find(c => /INSERT INTO workspace_members/.test(String(c[0])));
    expect(ins).toBeTruthy();
    expect(ins?.[1]).toEqual(expect.arrayContaining(['ws_s', 'user-x', 'editor']));
    expect(outboxCalls()).toContainEqual(['workspace_members', 'upsert']);
  });

  it('существующий (soft-deleted) участник → реактивация UPDATE', () => {
    useStore.setState({ currentWorkspaceId: 'ws_s' });
    dbGet.mockReturnValue({ uuid: 'm-existing' });
    useStore.getState().addWorkspaceMember('user-x', 'viewer');
    const upd = dbRun.mock.calls.find(c => /UPDATE workspace_members/.test(String(c[0])) && /deleted_at=NULL/.test(String(c[0])));
    expect(upd).toBeTruthy();
    expect(upd?.[1]).toEqual(expect.arrayContaining(['viewer', 'm-existing']));
    expect(outboxCalls()).toContainEqual(['workspace_members', 'upsert']);
  });

  it('без текущего ws — no-op', () => {
    useStore.setState({ currentWorkspaceId: null });
    useStore.getState().addWorkspaceMember('user-x', 'editor');
    expect(dbRun).not.toHaveBeenCalled();
  });
});

describe('updateWorkspaceMemberRole / removeWorkspaceMember', () => {
  it('updateWorkspaceMemberRole → UPDATE role + outbox upsert', () => {
    useStore.getState().updateWorkspaceMemberRole('m1', 'owner');
    const upd = dbRun.mock.calls.find(c => /UPDATE workspace_members SET role/.test(String(c[0])));
    expect(upd?.[1]).toEqual(expect.arrayContaining(['owner', 'm1']));
    expect(outboxCalls()).toContainEqual(['workspace_members', 'upsert']);
  });

  it('removeWorkspaceMember → soft-delete + outbox delete', () => {
    useStore.getState().removeWorkspaceMember('m1');
    const del = dbRun.mock.calls.find(c => /UPDATE workspace_members SET deleted_at/.test(String(c[0])));
    expect(del?.[1]).toEqual(expect.arrayContaining(['m1']));
    expect(outboxCalls()).toContainEqual(['workspace_members', 'delete']);
  });
});
