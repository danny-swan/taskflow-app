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
import { uuidv7 } from './uuid';

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

/**
 * Самолечение от конфликта в `sync_devices` (Bug 3, 04.08.2026).
 *
 * Ситуация: одно и то же устройство использовалось для тестирования нескольких
 * аккаунтов подряд. `client_id` привязан к устройству, а не к аккаунту — поэтому
 * строка `sync_devices` с этим id остаётся привязанной к старому user_id, и любой
 * другой аккаунт на этом устройстве получает RLS-отказ на каждой попытке upsert
 * ("new row violates row-level security policy ... sync_devices").
 *
 * Вызывается точечно из `ensureDeviceRegistered` ОДИН раз, только после того как
 * upsert реально получил RLS-отказ (а не на каждом logout) — для одноаккаунтных
 * устройств (обычный случай) client_id никогда не меняется и остаётся
 * стабильным идентификатором устройства между сессиями.
 *
 * @returns новый client_id (уже сохранён в settings и в кэше).
 */
export function regenerateClientId(): string {
  const next = uuidv7();
  db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('client_id', ?)`, [next]);
  cachedClientId = next;
  return next;
}
