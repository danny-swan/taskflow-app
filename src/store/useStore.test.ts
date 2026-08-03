/**
 * Unit-тесты для src/store/useStore.ts — тесты чистых derived-хелперов.
 *
 * Реальный init() трогает БД (sql.js/Tauri), поэтому мокаем db.ts и не
 * вызываем init — используем setState напрямую для подготовки фикстур.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Мокаем db.ts, чтобы импорт store не падал на sql.js.
vi.mock('../lib/db', () => ({
  initDb: vi.fn(async () => {}),
  get: vi.fn(),
  all: vi.fn(() => []),
  run: vi.fn(),
  exec: vi.fn(),
  save: vi.fn(async () => {}),
  isReady: vi.fn(() => true),
}));

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { useStore, type Status, type Task } from './useStore';
import { filterByWorkspace } from './workspaceScope';

const activeStatus = (id: number, name: string, extra: Partial<Status> = {}): Status =>
  ({
    id,
    name,
    color: '#888',
    behavior: 'middle',
    sort_order: id,
    is_seed: 0,
    is_technical: 0,
    hidden: 0,
    default_collapsed: 0,
    ...extra,
  }) as Status;

const techStatus = (id: number, name: string): Status =>
  activeStatus(id, name, { is_technical: 1, behavior: 'archive' });

const makeTask = (id: number, status_id: number, archived = 0): Task =>
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
    archived,
  }) as Task;

beforeEach(() => {
  // Сбрасываем стор в контролируемое состояние.
  useStore.setState({
    ready: true,
    statuses: [],
    tags: [],
    tasks: [],
    toasts: [],
  });
});

describe('useStore — derived helpers', () => {
  it('visibleStatuses фильтрует technical и hidden', () => {
    useStore.setState({
      statuses: [
        activeStatus(1, 'В работе'),
        activeStatus(2, 'Пауза', { hidden: 1 }),
        techStatus(3, 'Удалено'),
        activeStatus(4, 'Готово'),
      ],
    });
    const ids = useStore.getState().visibleStatuses().map(s => s.id);
    expect(ids).toEqual([1, 4]);
  });

  it('visibleTasks убирает archived и задачи в technical-статусах', () => {
    useStore.setState({
      statuses: [
        activeStatus(1, 'В работе'),
        techStatus(2, 'Удалено'),
      ],
      tasks: [
        makeTask(101, 1),
        makeTask(102, 2),          // в техническом статусе
        makeTask(103, 1, 1),       // archived
        makeTask(104, 1),
      ],
    });
    const ids = useStore.getState().visibleTasks().map(t => t.id);
    expect(ids).toEqual([101, 104]);
  });

  it('allTasks возвращает все, включая archived', () => {
    useStore.setState({
      statuses: [activeStatus(1, 'A'), techStatus(2, 'Удалено')],
      tasks: [makeTask(1, 1), makeTask(2, 2), makeTask(3, 1, 1)],
    });
    expect(useStore.getState().allTasks()).toHaveLength(3);
  });

  it('getDeletedStatusId находит технический статус «Удалено»', () => {
    useStore.setState({
      statuses: [
        activeStatus(1, 'В работе'),
        techStatus(5, 'Удалено'),
      ],
    });
    expect(useStore.getState().getDeletedStatusId()).toBe(5);
  });

  it('getDeletedStatusId → undefined если статуса нет', () => {
    useStore.setState({
      statuses: [activeStatus(1, 'В работе')],
    });
    expect(useStore.getState().getDeletedStatusId()).toBeUndefined();
  });

  it('getDeletedStatusId игнорирует нетехнический статус с тем же именем', () => {
    useStore.setState({
      statuses: [activeStatus(7, 'Удалено', { is_technical: 0 })],
    });
    expect(useStore.getState().getDeletedStatusId()).toBeUndefined();
  });
});

describe('useStore — reloadAccountBinding (Fix 2)', () => {
  it('перечитывает bound_user_id из settings в стор + подтягивает ws/members', async () => {
    const db = await import('../lib/db');
    (db.get as any).mockImplementation((_sql: string, params: any[] = []) =>
      params[0] === 'bound_user_id' ? { value: 'user-owner' } : null,
    );
    (db.all as any).mockReturnValue([]);

    useStore.setState({ boundUserId: null, workspaces: [], workspaceMembers: [] });
    useStore.getState().reloadAccountBinding();

    // boundUserId подхвачен из settings — computeRole теперь найдёт свою строку
    // членства и отдаст owner-роль вместо «только владелец может менять статусы».
    expect(useStore.getState().boundUserId).toBe('user-owner');
    // ws/members перечитаны из БД (мок пустой — но вызовы прошли без throw).
    expect(db.all).toHaveBeenCalled();
  });

  it('пустой bound_user_id → null (нормализация trim)', async () => {
    const db = await import('../lib/db');
    (db.get as any).mockImplementation((_sql: string, params: any[] = []) =>
      params[0] === 'bound_user_id' ? { value: '   ' } : null,
    );
    (db.all as any).mockReturnValue([]);

    useStore.setState({ boundUserId: 'stale' });
    useStore.getState().reloadAccountBinding();
    expect(useStore.getState().boundUserId).toBeNull();
  });
});

describe('useStore — reloadAccountBinding гидрирует currentWorkspaceId (F31)', () => {
  const wsTask = (id: number, wsId: string | null): Task =>
    ({
      id, title: `t${id}`, comment: '', tag_id: null, status_id: 1,
      start_date: null, deadline: null, finish_date: null,
      created_at: '2026-08-03', updated_at: '2026-08-03', sort_order: id,
      archived: 0, workspace_id: wsId,
    }) as Task;

  it('воспроизведение бага: заливший от прошлого аккаунта currentWorkspaceId гидрируется из settings, и ws-scoped выборка задач снова видит данные', async () => {
    const db = await import('../lib/db');
    // Сидируем: 2 workspaces входящего аккаунта (personal ws_A с 2 задачами, ws_B без задач),
    // settings.current_workspace_id = ws_A, bound_user_id = user-new.
    (db.get as any).mockImplementation((_sql: string, params: any[] = []) => {
      if (params[0] === 'bound_user_id') return { value: 'user-new' };
      if (params[0] === 'current_workspace_id') return { value: 'ws_A' };
      if (params[0] === 'personal_workspace_id') return null;
      return null;
    });
    (db.all as any).mockImplementation((sql: string) => {
      if (sql.includes('FROM workspace_members')) return [];
      return [];
    });

    const allTasks = [wsTask(1, 'ws_A'), wsTask(2, 'ws_A')];

    // Эмулируем залипание: in-memory currentWorkspaceId остался от предыдущего
    // аккаунта и указывает на несуществующий в новом наборе id.
    useStore.setState({
      boundUserId: null,
      workspaces: [],
      workspaceMembers: [],
      currentWorkspaceId: 'ws_STALE_from_prev_account',
      tasks: allTasks,
    });

    // loadWorkspaces() вызывает readWorkspacesFromDb(), который идёт в db.all.
    // readWorkspacesFromDb не экспортируется отдельно, поэтому мокаем db.all так,
    // чтобы SELECT из workspaces вернул входящий набор (ws_A, ws_B).
    (db.all as any).mockImplementation((sql: string) => {
      if (sql.includes('FROM workspaces')) {
        return [
          { uuid: 'ws_A', name: 'Мои задачи', kind: 'personal', owner_id: 'user-new', sort_order: 0 },
          { uuid: 'ws_B', name: 'Второе', kind: 'personal', owner_id: 'user-new', sort_order: 1 },
        ];
      }
      if (sql.includes('FROM workspace_members')) return [];
      return [];
    });

    useStore.getState().reloadAccountBinding();

    // currentWorkspaceId гидрировался из settings (ws_A) — НЕ ws_STALE и НЕ
    // pickDefaultWorkspaceId, потому что settings.current_workspace_id валиден.
    expect(useStore.getState().currentWorkspaceId).toBe('ws_A');

    // ws-scoped выборка задач для текущего currentWorkspaceId теперь видит обе
    // задачи аккаунта — репродукция бага (список был бы пуст до фикса, т.к. фильтр
    // бы искал по ws_STALE_from_prev_account).
    const visible = filterByWorkspace(useStore.getState().tasks, useStore.getState().currentWorkspaceId);
    expect(visible.map(t => t.id)).toEqual([1, 2]);
  });
});

describe('useStore — toasts', () => {
  it('pushToast добавляет тост, dismissToast удаляет по id', () => {
    const { pushToast } = useStore.getState();
    pushToast('привет');
    let toasts = useStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].text).toBe('привет');

    const id = toasts[0].id;
    useStore.getState().dismissToast(id);
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it('pushToast с action сохраняет action', () => {
    const onClick = vi.fn();
    useStore.getState().pushToast('undo', { label: 'Отмена', onClick });
    const t = useStore.getState().toasts[0];
    expect(t.action?.label).toBe('Отмена');
    t.action!.onClick();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
