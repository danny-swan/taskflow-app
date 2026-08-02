/**
 * localAccountStore.test.ts — локальное per-account хранилище free-аккаунтов
 * (F21, ADR 0014).
 *
 * Покрываем:
 *   1. Roundtrip save → has → load (applyBackup получает тот же payload в 'replace').
 *   2. Изоляция по userId: слот аккаунта A не виден аккаунту B.
 *   3. Пустой слот: load несуществующего → false, applyBackup не дёргается.
 *   4. Один слот на аккаунт: повторный save перезаписывает предыдущий.
 *   5. Пустая база не затирает живой слот (защита от save после clearUserData).
 *   6. Битый JSON в слоте — не падаем, отдаём false.
 *
 * Мокаем ./db (buildBackup отдаёт управляемый payload, applyBackup — спай) и
 * ./logger. localStorage берём из jsdom, чистим между тестами.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BackupPayload } from './db';

let backup: BackupPayload = { version: 't', exported_at: 'now' };
const applyBackupSpy = vi.fn(
  async (_payload: BackupPayload, _mode: 'replace' | 'merge') =>
    ({ statuses: 0, tags: 0, tasks: 0, templates: 0 }),
);

vi.mock('./db', () => ({
  buildBackup: () => backup,
  applyBackup: (payload: BackupPayload, mode: 'replace' | 'merge') => applyBackupSpy(payload, mode),
}));

vi.mock('./logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

import {
  saveLocalAccountData,
  loadLocalAccountData,
  hasLocalAccountData,
} from './localAccountStore';

const USER_A = 'user-a';
const USER_B = 'user-b';

function payloadWith(taskTitle: string): BackupPayload {
  return {
    version: '0.8.13',
    exported_at: '2026-08-02T00:00:00.000Z',
    statuses: [{ id: 1, name: 'В работе' }],
    tags: [],
    tasks: [{ id: 1, title: taskTitle, status_id: 1 }],
    templates: [],
  };
}

beforeEach(() => {
  localStorage.clear();
  applyBackupSpy.mockClear();
  backup = payloadWith('task A');
});

describe('localAccountStore — roundtrip', () => {
  it('save → has → load возвращает данные аккаунта через applyBackup(replace)', async () => {
    expect(hasLocalAccountData(USER_A)).toBe(false);

    expect(await saveLocalAccountData(USER_A)).toBe(true);
    expect(hasLocalAccountData(USER_A)).toBe(true);
    expect(localStorage.getItem('taskflow.localstore.v1.user-a')).toBeTruthy();

    expect(await loadLocalAccountData(USER_A)).toBe(true);
    expect(applyBackupSpy).toHaveBeenCalledTimes(1);
    const [payload, mode] = applyBackupSpy.mock.calls[0] as unknown as [BackupPayload, string];
    expect(mode).toBe('replace');
    expect(payload.tasks).toEqual([{ id: 1, title: 'task A', status_id: 1 }]);
  });

  it('повторный save перезаписывает слот (один слот на аккаунт)', async () => {
    await saveLocalAccountData(USER_A);
    backup = payloadWith('task A2');
    await saveLocalAccountData(USER_A);

    await loadLocalAccountData(USER_A);
    const [payload] = applyBackupSpy.mock.calls[0] as unknown as [BackupPayload];
    expect(payload.tasks?.[0].title).toBe('task A2');
  });
});

describe('localAccountStore — изоляция по аккаунтам', () => {
  it('слот A не виден аккаунту B', async () => {
    await saveLocalAccountData(USER_A);

    expect(hasLocalAccountData(USER_B)).toBe(false);
    expect(await loadLocalAccountData(USER_B)).toBe(false);
    expect(applyBackupSpy).not.toHaveBeenCalled();
  });

  it('у каждого аккаунта свой слот', async () => {
    await saveLocalAccountData(USER_A);
    backup = payloadWith('task B');
    await saveLocalAccountData(USER_B);

    await loadLocalAccountData(USER_A);
    const [payloadA] = applyBackupSpy.mock.calls[0] as unknown as [BackupPayload];
    expect(payloadA.tasks?.[0].title).toBe('task A');

    await loadLocalAccountData(USER_B);
    const [payloadB] = applyBackupSpy.mock.calls[1] as unknown as [BackupPayload];
    expect(payloadB.tasks?.[0].title).toBe('task B');
  });
});

describe('localAccountStore — крайние случаи', () => {
  it('load без слота → false, applyBackup не вызывается', async () => {
    expect(await loadLocalAccountData(USER_A)).toBe(false);
    expect(applyBackupSpy).not.toHaveBeenCalled();
  });

  it('userId=null — no-op во всех трёх функциях', async () => {
    expect(hasLocalAccountData(null)).toBe(false);
    expect(await saveLocalAccountData(null)).toBe(false);
    expect(await loadLocalAccountData(null)).toBe(false);
    expect(localStorage.length).toBe(0);
  });

  it('пустая база не затирает живой слот', async () => {
    await saveLocalAccountData(USER_A);

    // Состояние сразу после clearUserData(): дамп пуст.
    backup = { version: '0.8.13', exported_at: 'now', statuses: [], tags: [], tasks: [], templates: [] };
    expect(await saveLocalAccountData(USER_A)).toBe(false);

    expect(hasLocalAccountData(USER_A)).toBe(true);
    expect(await loadLocalAccountData(USER_A)).toBe(true);
    const [payload] = applyBackupSpy.mock.calls[0] as unknown as [BackupPayload];
    expect(payload.tasks?.[0].title).toBe('task A');
  });

  it('битый JSON в слоте → false, без исключения', async () => {
    localStorage.setItem('taskflow.localstore.v1.user-a', '{not json');

    expect(hasLocalAccountData(USER_A)).toBe(false);
    expect(await loadLocalAccountData(USER_A)).toBe(false);
    expect(applyBackupSpy).not.toHaveBeenCalled();
  });

  it('ошибка applyBackup → false, без исключения наружу', async () => {
    await saveLocalAccountData(USER_A);
    applyBackupSpy.mockRejectedValueOnce(new Error('db is busy') as never);

    expect(await loadLocalAccountData(USER_A)).toBe(false);
  });
});
