/**
 * client_id — стабильный идентификатор ЭТОГО устройства (одна установка приложения).
 *
 * Генерится один раз миграцией v5 (sync foundation) и хранится в settings('client_id').
 * Все INSERT'ы в sync-таблицы (tasks/tags/statuses/task_templates/overdue_events)
 * должны проставлять этот client_id — так при sync можно понять, "кто" создал
 * или последний раз изменил строку. Полезно для дебага и conflict resolution.
 *
 * Значение кэшируется в модуле (client_id не меняется в течение сессии).
 */
import * as db from './db';

let cachedClientId: string | null = null;

/**
 * Возвращает client_id текущего устройства. Читает из settings при первом вызове.
 * Если по какой-то причине client_id ещё не сгенерирован (например, миграция v5
 * не отработала на этой сессии), возвращает NULL — вызывающий код должен корректно
 * обработать это (uuid всё равно генерится, client_id — второстепенный атрибут).
 */
export function getClientId(): string | null {
  if (cachedClientId !== null) return cachedClientId;
  try {
    const row = db.get<{ value: string }>(
      `SELECT value FROM settings WHERE key = 'client_id'`,
    );
    cachedClientId = row?.value ?? null;
  } catch (e) {
    console.warn('[clientId] read failed:', e);
    cachedClientId = null;
  }
  return cachedClientId;
}

/**
 * Сброс кэша (для тестов и hot-reload). В production не должно вызываться.
 */
export function resetClientIdCache(): void {
  cachedClientId = null;
}
