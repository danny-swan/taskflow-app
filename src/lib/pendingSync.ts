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
