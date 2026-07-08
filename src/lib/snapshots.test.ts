/**
 * snapshots.test.ts — Unit-тесты локальных снимков базы (v0.9.35-dev.6.9.0).
 *
 * Покрываем:
 *   1. Реестр: readRegistry / writeRegistry (через createSnapshot) — settings kv.
 *   2. Привязка аккаунта: getBoundUserId / setBoundUserId / checkAccountBinding.
 *   3. isWebSnapshotLimited() — зависит от db.isTauri().
 *   4. Web-снимки: createSnapshot → listSnapshots → restoreSnapshot → deleteSnapshot.
 *   5. Ротация до MAX_SNAPSHOTS (5): 6-й снимок вытесняет самый старый.
 *
 * Мокаем ./db (kv-store settings + isTauri=false + buildBackup/applyBackup) и
 * ./logger. Работаем в web-режиме (isTauri=false), чтобы не тащить invoke.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── In-memory settings kv-store (эмулирует settings-таблицу) ─────────────────
const settingsStore = new Map<string, string>();

// Мок db: get/run обслуживают ключи settings, save() no-op, isTauri()=false,
// buildBackup возвращает фиксированный payload, applyBackup записываем в спай.
const applyBackupSpy = vi.fn();

vi.mock('./db', () => ({
  get: (sql: string, params?: unknown[]) => {
    const key = params?.[0] as string | undefined;
    if (sql.includes('COUNT(*)')) return { c: 3 };
    if (!key) return null;
    const val = settingsStore.get(key);
    return val !== undefined ? { value: val } : null;
  },
  run: (sql: string, params?: unknown[]) => {
    if (sql.startsWith('DELETE FROM settings')) {
      settingsStore.delete(params?.[0] as string);
    } else if (sql.includes("'bound_user_id'")) {
      // setBoundUserId: ключ вшит в SQL, params[0] = value.
      settingsStore.set('bound_user_id', params?.[0] as string);
    } else {
      // writeRegistry: INSERT (key, value) ... ON CONFLICT — params[0]=key, [1]=value.
      settingsStore.set(params?.[0] as string, params?.[1] as string);
    }
  },
  save: () => {},
  isTauri: () => false,
  buildBackup: () => ({ tasks: [{ id: 1 }], tags: [], statuses: [] }),
  applyBackup: (payload: unknown, mode: string) => applyBackupSpy(payload, mode),
}));

vi.mock('./logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

// localStorage-полифилл для web-снимков (payload).
const lsStore = new Map<string, string>();
beforeEach(() => {
  settingsStore.clear();
  lsStore.clear();
  applyBackupSpy.mockClear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (lsStore.has(k) ? lsStore.get(k)! : null),
    setItem: (k: string, v: string) => { lsStore.set(k, v); },
    removeItem: (k: string) => { lsStore.delete(k); },
    clear: () => lsStore.clear(),
  });
});

import {
  MAX_SNAPSHOTS,
  readRegistry,
  getBoundUserId,
  setBoundUserId,
  checkAccountBinding,
  isWebSnapshotLimited,
  createSnapshot,
  listSnapshots,
  deleteSnapshot,
  restoreSnapshot,
} from './snapshots';

describe('snapshots — реестр', () => {
  it('пустой реестр по умолчанию', () => {
    expect(readRegistry()).toEqual([]);
  });

  it('createSnapshot добавляет запись в реестр', async () => {
    const meta = await createSnapshot('manual');
    expect(meta.label).toBe('manual');
    expect(meta.platform).toBe('web');
    expect(meta.taskCount).toBe(3);
    const reg = readRegistry();
    expect(reg).toHaveLength(1);
    expect(reg[0].id).toBe(meta.id);
  });
});

describe('snapshots — привязка аккаунта', () => {
  it('getBoundUserId возвращает null, если не привязана', () => {
    expect(getBoundUserId()).toBeNull();
  });

  it('setBoundUserId / getBoundUserId round-trip', () => {
    setBoundUserId('user-A');
    expect(getBoundUserId()).toBe('user-A');
    setBoundUserId(null);
    expect(getBoundUserId()).toBeNull();
  });

  it('checkAccountBinding: не привязана → mismatch=false', () => {
    const r = checkAccountBinding('user-A');
    expect(r.mismatch).toBe(false);
    expect(r.boundUserId).toBeNull();
    expect(r.sessionUserId).toBe('user-A');
  });

  it('checkAccountBinding: тот же аккаунт → mismatch=false', () => {
    setBoundUserId('user-A');
    expect(checkAccountBinding('user-A').mismatch).toBe(false);
  });

  it('checkAccountBinding: другой аккаунт → mismatch=true', () => {
    setBoundUserId('user-A');
    const r = checkAccountBinding('user-B');
    expect(r.mismatch).toBe(true);
    expect(r.boundUserId).toBe('user-A');
    expect(r.sessionUserId).toBe('user-B');
  });
});

describe('snapshots — среда', () => {
  it('isWebSnapshotLimited=true в web-режиме', () => {
    expect(isWebSnapshotLimited()).toBe(true);
  });
});

describe('snapshots — web CRUD', () => {
  it('create → list → restore → delete', async () => {
    const meta = await createSnapshot('manual');
    // payload лежит в localStorage
    expect(lsStore.get('taskflow.snapshot.' + meta.id)).toBeTruthy();

    const list = await listSnapshots();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(meta.id);

    const res = await restoreSnapshot(meta.id);
    expect(res.needsRestart).toBe(false);
    expect(applyBackupSpy).toHaveBeenCalledOnce();
    expect(applyBackupSpy.mock.calls[0][1]).toBe('replace');

    await deleteSnapshot(meta.id);
    expect(await listSnapshots()).toHaveLength(0);
    expect(lsStore.get('taskflow.snapshot.' + meta.id)).toBeUndefined();
  });

  it('deleteSnapshot идемпотентен для несуществующего id', async () => {
    await expect(deleteSnapshot('nope')).resolves.toBeUndefined();
  });

  it('restoreSnapshot бросает для несуществующего id', async () => {
    await expect(restoreSnapshot('nope')).rejects.toThrow();
  });
});

describe('snapshots — ротация', () => {
  it('держит не более MAX_SNAPSHOTS, вытесняя самые старые', async () => {
    const created: string[] = [];
    for (let i = 0; i < MAX_SNAPSHOTS + 1; i++) {
      // Разводим createdAt по времени, чтобы сортировка была детерминирована.
      vi.setSystemTime(new Date(2026, 0, 1, 0, 0, i));
      const m = await createSnapshot(`snap_${i}`);
      created.push(m.id);
    }
    vi.useRealTimers();

    const list = await listSnapshots();
    expect(list).toHaveLength(MAX_SNAPSHOTS);
    // Самый первый (created[0]) должен быть вытеснен.
    const ids = list.map((s) => s.id);
    expect(ids).not.toContain(created[0]);
    // payload самого старого тоже удалён.
    expect(lsStore.get('taskflow.snapshot.' + created[0])).toBeUndefined();
  });
});
