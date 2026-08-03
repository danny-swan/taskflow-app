// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * usePendingSyncCount — реактивный счётчик записей в sync_outbox.
 *
 * v0.9.35-dev.3: используется в dev-only индикаторе в сайдбаре. В prod-сборках
 * push будет запускаться автоматически, а счётчик покажется только если >0
 * (то есть только когда что-то реально ждёт отправки).
 *
 * Реактивность: значение хранится в useStore.pendingSyncCount и пересчитывается
 * в каждом refresh() — а refresh вызывается всеми action'ами стора.
 */
import { useStore } from '../store/useStore';

/** Возвращает текущий размер очереди outbox (ждёт push'а в облако). */
export function usePendingSyncCount(): number {
  return useStore(s => s.pendingSyncCount);
}

/** Статусы sync-оркестратора, влияющие на видимость чипа (см. SyncState). */
export type PendingChipSyncStatus =
  | 'idle'
  | 'pulling'
  | 'pushing'
  | 'synced'
  | 'error'
  | 'skipped'
  | 'paywalled';

/**
 * Нужно ли СКРЫТЬ чип «pending sync» в сайдбаре (P2).
 *
 * Когда sync недоступен — 'paywalled' (free/истёкший trial) или 'skipped'
 * (нет сессии) — очередь никогда не отправится, поэтому счётчик только путает:
 * прячем чип ВСЕГДА, даже в dev-сборке. Для остальных статусов сохраняем
 * прежнее поведение: в prod чип виден лишь когда есть что показать (очередь
 * непуста, идёт обмен или ошибка), а в dev показываем всегда — для отладки.
 */
export function shouldHidePendingChip(
  status: PendingChipSyncStatus,
  count: number,
  isDev: boolean,
): boolean {
  if (status === 'paywalled' || status === 'skipped') return true;
  const isBusy = status === 'pulling' || status === 'pushing';
  const isError = status === 'error';
  if (!isDev && count === 0 && !isBusy && !isError) return true;
  return false;
}
