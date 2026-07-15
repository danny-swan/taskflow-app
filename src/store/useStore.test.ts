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
