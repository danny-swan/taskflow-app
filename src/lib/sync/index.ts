// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * sync/index.ts — orchestrator для двусторонней синхронизации.
 *
 * v0.9.35-dev.4: первая рабочая версия sync-цикла.
 *
 * Основной API:
 *   - syncNow() — запускает полный цикл pull → push → pull (idempotent, mutex).
 *   - getSyncState() — текущее состояние (idle/pulling/pushing/error/synced).
 *   - subscribeSyncState(cb) — подписка на изменения состояния (для UI).
 *   - scheduleAutoSync() — запланировать debounced авто-sync (используется
 *     хуками enqueueOutbox → useStore.refresh).
 *
 * Порядок операций в syncNow():
 *   1. Проверить сессию Supabase (если её нет — просто вернуть idle, ничего не делаем).
 *   2. Убедиться, что устройство зарегистрировано в sync_devices (иначе FK упадёт).
 *   3. pullAll(userId) — забираем изменения из облака (LWW применяется локально).
 *   4. pushAll(userId, clientId) — отправляем локальные изменения.
 *   5. pullAll(userId) ещё раз — забираем то, что могли добавить другие устройства
 *      пока мы пушили.
 *
 * State machine:
 *   idle → pulling → pushing → pulling → synced   (happy path)
 *   idle → pulling → error                       (что-то упало, retry позже)
 *   idle → skipped                               (нет сессии / offline)
 *
 * Feature flag (push trigger):
 *   - import.meta.env.DEV = true → авто-sync ОТКЛЮЧЁН, только manual (кнопка в
 *     Settings). Это удобно для разработки: сами контролируем, когда пушить.
 *   - prod-сборка → авто-sync ВКЛЮЧЁН (debounced 2с после enqueue + on-init
 *     + on-focus). Пользователь не видит sync-логики, всё "just works".
 */
import { supabase } from '../supabase';
import { getClientId } from '../clientId';
import { logger } from '../logger';
import { pushAll, type PushResult } from './push';
import { pullAll, type PullResult } from './pull';

/** Публичное состояние sync-цикла (для UI). */
export type SyncState =
  | { status: 'idle'; lastSyncedAt: string | null; lastError: string | null }
  | { status: 'pulling'; lastSyncedAt: string | null; lastError: string | null }
  | { status: 'pushing'; lastSyncedAt: string | null; lastError: string | null }
  | { status: 'synced'; lastSyncedAt: string; lastError: null }
  | { status: 'error'; lastSyncedAt: string | null; lastError: string }
  | { status: 'skipped'; lastSyncedAt: string | null; lastError: null };

let currentState: SyncState = {
  status: 'idle',
  lastSyncedAt: null,
  lastError: null,
};

/**
 * Подписчики UI. Функция возвращает unsubscribe.
 */
const subscribers = new Set<(s: SyncState) => void>();

/** Публичный getter. */
export function getSyncState(): SyncState {
  return currentState;
}

/** Публичный subscribe. Возвращает unsubscribe. */
export function subscribeSyncState(cb: (s: SyncState) => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function setState(next: SyncState): void {
  currentState = next;
  for (const cb of subscribers) {
    try {
      cb(next);
    } catch (e) {
      logger.warn('[sync/state] subscriber error:', e);
    }
  }
}

/**
 * Mutex: syncNow() не должен запускаться параллельно сам с собой.
 * Если вызвали второй раз пока первый идёт — вернём тот же promise.
 */
let inFlight: Promise<SyncResult> | null = null;

export interface SyncResult {
  ok: boolean;
  skipped: boolean;
  pushResult: PushResult | null;
  pullResult: PullResult | null;
  finalPullResult: PullResult | null;
  error: string | null;
}

/**
 * Убедиться, что текущее устройство есть в sync_devices.
 * Без этой строки FK'и sync_*.client_id → sync_devices.id упадут при push.
 *
 * Идемпотентно: используем upsert, если запись уже есть — просто обновится
 * last_seen_at. Ошибку логируем но не фейлим — устройство может быть
 * зарегистрировано в другом окне.
 */
async function ensureDeviceRegistered(userId: string, clientId: string): Promise<void> {
  try {
    // Пытаемся понять платформу для отладочных целей. Не критично если не удастся.
    let platform = 'unknown';
    try {
      // navigator.userAgent есть и в Tauri (webview), и в браузере
      if (typeof navigator !== 'undefined' && navigator.userAgent) {
        platform = navigator.userAgent.slice(0, 200);
      }
    } catch {
      // ignore
    }

    const now = new Date().toISOString();
    const { error } = await supabase.from('sync_devices').upsert(
      {
        id: clientId,
        user_id: userId,
        platform,
        last_seen_at: now,
      },
      { onConflict: 'id' },
    );
    if (error) {
      logger.warn('[sync/device] upsert failed:', error.message);
    }
  } catch (e) {
    logger.warn('[sync/device] unexpected error:', e);
  }
}

/**
 * Основная функция: полный цикл синхронизации.
 * Idempotent — mutex защищает от параллельных вызовов.
 */
export async function syncNow(): Promise<SyncResult> {
  if (inFlight) {
    logger.info('[sync/orchestrator] already in flight, returning existing promise');
    return inFlight;
  }

  const run = async (): Promise<SyncResult> => {
    const emptyResult: SyncResult = {
      ok: false,
      skipped: true,
      pushResult: null,
      pullResult: null,
      finalPullResult: null,
      error: null,
    };

    // 1. Проверяем сессию.
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id;
    if (!userId) {
      logger.info('[sync/orchestrator] no session, skipping');
      setState({ status: 'skipped', lastSyncedAt: currentState.lastSyncedAt, lastError: null });
      return emptyResult;
    }

    // 2. client_id обязателен.
    const clientId = getClientId();
    if (!clientId) {
      const err = 'client_id not initialized (migration v5 не отработала?)';
      logger.warn('[sync/orchestrator]', err);
      setState({ status: 'error', lastSyncedAt: currentState.lastSyncedAt, lastError: err });
      return { ...emptyResult, error: err };
    }

    // 3. Регистрируем устройство (idempotent).
    await ensureDeviceRegistered(userId, clientId);

    // 4. Первый pull — забираем изменения из облака.
    setState({ status: 'pulling', lastSyncedAt: currentState.lastSyncedAt, lastError: null });
    let pullResult: PullResult | null = null;
    try {
      pullResult = await pullAll(userId);
      if (pullResult.firstError) {
        // Pull частично упал, но не фатально — идём дальше.
        logger.warn('[sync/orchestrator] pull had errors:', pullResult.firstError);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('[sync/orchestrator] pull failed:', msg);
      setState({ status: 'error', lastSyncedAt: currentState.lastSyncedAt, lastError: msg });
      return { ...emptyResult, skipped: false, error: msg };
    }

    // 5. Push — отправляем локальные изменения.
    setState({ status: 'pushing', lastSyncedAt: currentState.lastSyncedAt, lastError: null });
    let pushResult: PushResult | null = null;
    try {
      pushResult = await pushAll(userId, clientId);
      if (pushResult.firstError) {
        logger.warn('[sync/orchestrator] push had errors:', pushResult.firstError);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('[sync/orchestrator] push failed:', msg);
      setState({ status: 'error', lastSyncedAt: currentState.lastSyncedAt, lastError: msg });
      return { ...emptyResult, skipped: false, pullResult, error: msg };
    }

    // 6. Финальный pull — вдруг за время push кто-то ещё запушил.
    setState({ status: 'pulling', lastSyncedAt: currentState.lastSyncedAt, lastError: null });
    let finalPullResult: PullResult | null = null;
    try {
      finalPullResult = await pullAll(userId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('[sync/orchestrator] final pull failed:', msg);
      // Не критично, основная работа сделана. Оставим error для UI.
      setState({
        status: 'error',
        lastSyncedAt: new Date().toISOString(),
        lastError: msg,
      });
      return { ok: true, skipped: false, pullResult, pushResult, finalPullResult: null, error: msg };
    }

    // 7. Итог.
    const now = new Date().toISOString();
    const hadPushErr = !!pushResult.firstError;
    const hadPullErr = !!pullResult?.firstError || !!finalPullResult?.firstError;
    if (hadPushErr || hadPullErr) {
      const firstErr =
        pushResult.firstError || pullResult?.firstError || finalPullResult?.firstError || 'unknown';
      setState({ status: 'error', lastSyncedAt: now, lastError: firstErr });
      return {
        ok: false,
        skipped: false,
        pullResult,
        pushResult,
        finalPullResult,
        error: firstErr,
      };
    }

    setState({ status: 'synced', lastSyncedAt: now, lastError: null });
    logger.info(
      `[sync/orchestrator] synced at ${now}: pull ${pullResult?.applied ?? 0}+${finalPullResult?.applied ?? 0} / push ${pushResult.pushed}`,
    );
    return {
      ok: true,
      skipped: false,
      pullResult,
      pushResult,
      finalPullResult,
      error: null,
    };
  };

  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

// ─── Auto-sync (feature-flag'ed) ─────────────────────────────────────────────
//
// В prod-сборке автоматически:
//   - debounced 2с после каждого enqueueOutbox (через scheduleAutoSync)
//   - при init приложения (initAutoSync)
//   - при возврате фокуса на окно (initAutoSync)
//
// В dev-сборке всё это отключено. Пользователь запускает syncNow() вручную
// (кнопкой в Settings). Флаг: import.meta.env.DEV.

const AUTO_SYNC_ENABLED =
  typeof import.meta !== 'undefined' && !!import.meta.env && !import.meta.env.DEV;

const AUTO_SYNC_DEBOUNCE_MS = 2000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Запланировать debounced авто-sync. В dev-сборке — no-op.
 * Многократные вызовы в течение 2с схлопываются в один.
 */
export function scheduleAutoSync(): void {
  if (!AUTO_SYNC_ENABLED) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    syncNow().catch(e => logger.warn('[sync/auto] scheduled sync failed:', e));
  }, AUTO_SYNC_DEBOUNCE_MS);
}

let autoSyncInitialized = false;

/**
 * Инициализация авто-sync триггеров. Вызывается один раз при старте приложения
 * (например, из useStore.init или App.tsx). В dev-сборке — no-op.
 */
export function initAutoSync(): void {
  if (!AUTO_SYNC_ENABLED) {
    logger.info('[sync/auto] disabled (dev build) — используйте кнопку "Синхронизировать сейчас"');
    return;
  }
  if (autoSyncInitialized) return;
  autoSyncInitialized = true;

  // Первый sync при инициализации.
  syncNow().catch(e => logger.warn('[sync/auto] initial sync failed:', e));

  // On-focus триггер.
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', () => {
      syncNow().catch(e => logger.warn('[sync/auto] focus sync failed:', e));
    });

    // Онлайн после offline — тоже хороший момент.
    window.addEventListener('online', () => {
      syncNow().catch(e => logger.warn('[sync/auto] online sync failed:', e));
    });
  }
}

/** Только для тестов: сбросить состояние. */
export function _resetForTests(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  autoSyncInitialized = false;
  inFlight = null;
  currentState = { status: 'idle', lastSyncedAt: null, lastError: null };
}

/** Экспорт для тестов. */
export const _internals = {
  ensureDeviceRegistered,
  AUTO_SYNC_ENABLED,
  AUTO_SYNC_DEBOUNCE_MS,
};
