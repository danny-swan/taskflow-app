/**
 * Регрессия fix/admin-first-click-redirect.
 *
 * Баг: при первом клике «Администрирование» админа перекидывало на /tasks,
 * а со второго раза открывалось нормально.
 *
 * Корневая причина — race в useEntitlement: useAuth() резолвит сессию
 * асинхронно, поэтому на первом рендере страницы userId === null и loading
 * инициализировался как false. Когда сессия подтягивалась и userId становился
 * ненулевым, loading ещё один коммит оставался false (setLoading(true) жил в
 * эффекте). В этот момент route-guard видел «загрузка завершена + не админ» и
 * делал ложный redirect.
 *
 * Тест воспроизводит именно этот переход userId: null → 'user-1' и проверяет,
 * что loading становится true СИНХРОННО на том же рендере (до резолва fetch),
 * а финальный isAdmin виден только после загрузки.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ─── Управляемый fetch (deferred) для user_entitlements ──────────────────────
interface Deferred<T> { resolve: (v: T) => void; promise: Promise<T>; }
function makeDeferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { resolve, promise };
}
let entRowDeferred: Deferred<{ data: unknown; error: unknown }>;

// ─── Мок db (кэш в settings) — по умолчанию пустой ───────────────────────────
const settingsStore = new Map<string, string>();
vi.mock('./db', () => ({
  get: (_sql: string, params: unknown[]) => {
    const key = params?.[0] as string | undefined;
    const val = key ? settingsStore.get(key) : undefined;
    return val ? { value: val } : null;
  },
  run: (sql: string, params: unknown[]) => {
    const key = params?.[0] as string;
    if (sql.startsWith('DELETE FROM settings')) settingsStore.delete(key);
    else if (sql.startsWith('INSERT OR REPLACE INTO settings')) settingsStore.set(key, params?.[1] as string);
  },
  all: () => [],
}));

vi.mock('./logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => entRowDeferred.promise }) }) }),
    channel: () => {
      const ch: Record<string, unknown> = {};
      ch.on = () => ch;
      ch.subscribe = () => ch;
      return ch;
    },
    removeChannel: () => Promise.resolve(),
  },
}));

import { useEntitlement } from './entitlements';

beforeEach(() => {
  settingsStore.clear();
  entRowDeferred = makeDeferred();
});

describe('useEntitlement — гидрация при позднем появлении userId (guard race)', () => {
  it('loading становится true синхронно, когда userId приходит после mount', async () => {
    const { result, rerender } = renderHook(
      ({ uid, email }: { uid: string | null; email: string | null }) => useEntitlement(uid, email),
      { initialProps: { uid: null as string | null, email: null as string | null } },
    );

    // Сессия ещё не резолвнута (userId null) → не грузимся, free.
    expect(result.current.loading).toBe(false);
    expect(result.current.status).toBe('loaded');
    expect(result.current.entitlement.isAdmin).toBe(false);

    // useAuth резолвит сессию → userId появляется. Ключевой момент:
    // на этом же рендере loading обязан быть true (до фикса был false → redirect).
    rerender({ uid: 'user-1', email: 'seed@x.test' });
    expect(result.current.loading).toBe(true);
    expect(result.current.status).toBe('loading');

    // Приходит строка seed/lifetime → админ.
    await act(async () => {
      entRowDeferred.resolve({
        data: {
          user_id: 'user-1', plan: 'lifetime', source: 'seed', valid_until: null,
          activated_at: null, trial_used: true, notes: null, updated_at: new Date().toISOString(),
        },
        error: null,
      });
      await entRowDeferred.promise;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBe('loaded');
    expect(result.current.entitlement.isAdmin).toBe(true);
  });

  it('не-админ после загрузки → loaded + isAdmin=false (guard корректно редиректит)', async () => {
    const { result, rerender } = renderHook(
      ({ uid, email }: { uid: string | null; email: string | null }) => useEntitlement(uid, email),
      { initialProps: { uid: null as string | null, email: null as string | null } },
    );

    rerender({ uid: 'user-2', email: 'plain@x.test' });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      entRowDeferred.resolve({ data: null, error: null }); // строки нет → free
      await entRowDeferred.promise;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBe('loaded');
    expect(result.current.entitlement.isAdmin).toBe(false);
  });

  it('ошибка fetch → status=error, loading=false (нет вечного скелетона)', async () => {
    const { result, rerender } = renderHook(
      ({ uid, email }: { uid: string | null; email: string | null }) => useEntitlement(uid, email),
      { initialProps: { uid: null as string | null, email: null as string | null } },
    );

    rerender({ uid: 'user-3', email: 'plain@x.test' });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      entRowDeferred.resolve({ data: null, error: { message: 'network boom' } });
      await entRowDeferred.promise;
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.loading).toBe(false);
    expect(result.current.entitlement.isAdmin).toBe(false);
  });
});
