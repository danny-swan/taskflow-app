/**
 * snapshots.ts — локальные снимки базы данных (v0.9.35-dev.6.9.0).
 *
 * Зачем: при смене аккаунта на одном устройстве (или при выборе «Загрузить
 * облачные») мы никогда не должны молча потерять локальные данные. Перед
 * любым разрушающим действием создаётся снимок, из которого всё можно
 * восстановить — даже офлайн, без облака.
 *
 * Два бэкенда (как и в db.ts):
 *   • Tauri (desktop) — полноценные бинарные копии файла data.db в подпапке
 *     `snapshots/` рядом с базой (через Rust-команды snapshot_db / list_snapshots
 *     / restore_snapshot / delete_snapshot). Переживают перезапуск и не зависят
 *     от localStorage.
 *   • Web (браузер) — снимок = JSON-дамп (buildBackup) в localStorage. Это
 *     используется в основном для разработки и будущей web-версии; у него есть
 *     ограничения (объём localStorage, дамп не бинарный), поэтому UI показывает
 *     мягкое предупреждение. См. isWebSnapshotLimited().
 *
 * Реестр метаданных (id, label, дата, размер, платформа) хранится в
 * settings.snapshot_registry_v1 как JSON-массив — кросс-платформенно и не
 * требует новой таблицы. Файлы (Tauri) или полезная нагрузка (Web) хранятся
 * отдельно; реестр — это индекс.
 *
 * Ротация: держим не более MAX_SNAPSHOTS (5). При создании нового самый
 * старый тихо удаляется (и файл, и запись в реестре). Так решено с
 * пользователем: «разумное количество, старые можно удалять».
 */

import * as db from './db';
import { logger } from './logger';

/** Максимум хранимых снимков. Старые удаляются тихо при создании нового. */
export const MAX_SNAPSHOTS = 5;

/** Общий префикс ключа реестра (из migration v8). */
const REGISTRY_KEY_BASE = 'snapshot_registry_v1';

/**
 * Возвращает ключ реестра снимков для данного userId.
 * v0.9.35-dev.6.10.0: реестр изолирован по аккаунту, чтобы пользователи разных
 * аккаунтов на одном устройстве не видели снимки друг друга.
 * Если userId = null — возвращает общий ключ (обратная совместимость / база непривязана).
 */
function registryKey(userId: string | null): string {
  return userId ? `${REGISTRY_KEY_BASE}_${userId}` : REGISTRY_KEY_BASE;
}

/** Префикс ключей localStorage для web-снимков (полезная нагрузка). */
const WEB_PAYLOAD_PREFIX = 'taskflow.snapshot.';

/** Одна запись реестра снимков. */
export interface SnapshotMeta {
  /** Уникальный id снимка (используется как ключ и в имени файла/localStorage). */
  id: string;
  /** Человекочитаемая метка причины (напр. 'before_account_switch', 'manual'). */
  label: string;
  /** ISO-дата создания. */
  createdAt: string;
  /** Размер в байтах (файл для Tauri, длина JSON для Web). */
  size: number;
  /** Платформа, на которой создан снимок. */
  platform: 'tauri' | 'web';
  /**
   * Tauri: полный путь к файлу снимка (для restore/delete).
   * Web: не используется (полезная нагрузка живёт в localStorage по id).
   */
  path?: string;
  /**
   * Опционально: user_id, которому принадлежала база на момент снимка.
   * Помогает пользователю понять, чей это снимок. Может быть null (не привязана).
   */
  boundUserId?: string | null;
  /** Опционально: сколько задач было в базе (для отображения в UI). */
  taskCount?: number;
}

// ─── Реестр (settings.snapshot_registry_v1) ──────────────────────────────────

/**
 * Читает реестр снимков из settings для текущего bound_user_id.
 * v0.9.35-dev.6.10.0: реестр изолирован по аккаунту.
 *
 * Логика миграции: если персональный ключ ещё пуст, но старый общий
 * REGISTRY_KEY_BASE содержит снимки, у которых boundUserId совпадает
 * с текущим userId (или null) — мигрируем их в персональный ключ и
 * удаляем старый, чтобы не засорять settings.
 *
 * Возвращает [] при любой ошибке.
 */
export function readRegistry(): SnapshotMeta[] {
  const userId = getBoundUserId();
  const key = registryKey(userId);
  try {
    const row = db.get<{ value: string }>(
      'SELECT value FROM settings WHERE key=?',
      [key],
    );
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      return Array.isArray(parsed) ? (parsed as SnapshotMeta[]) : [];
    }

    // Персональный ключ пуст — проверяем старый общий реестр (миграция).
    if (userId) {
      const oldRow = db.get<{ value: string }>(
        'SELECT value FROM settings WHERE key=?',
        [REGISTRY_KEY_BASE],
      );
      if (oldRow?.value) {
        const oldParsed = JSON.parse(oldRow.value);
        if (Array.isArray(oldParsed) && oldParsed.length > 0) {
          // Фильтруем снимки, принадлежащие текущему пользователю (или без привязки).
          const mine = (oldParsed as SnapshotMeta[]).filter(
            (s) => !s.boundUserId || s.boundUserId === userId,
          );
          if (mine.length > 0) {
            // Мигрируем в персональный ключ.
            db.run(
              `INSERT INTO settings (key, value) VALUES (?, ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
              [key, JSON.stringify(mine)],
            );
            // Удаляем старый общий ключ.
            db.run('DELETE FROM settings WHERE key=?', [REGISTRY_KEY_BASE]);
            db.save();
            logger.info(
              `[snapshots] migrated ${mine.length} snapshot(s) from shared registry to user-scoped key (${key})`,
            );
            return mine;
          }
          // Снимки есть, но все чужие — просто удаляем старый ключ.
          db.run('DELETE FROM settings WHERE key=?', [REGISTRY_KEY_BASE]);
          db.save();
        }
      }
    }

    return [];
  } catch (e) {
    logger.warn('[snapshots] readRegistry failed:', e);
    return [];
  }
}

/** Пишет реестр снимков в settings (перезаписывает целиком) для текущего bound_user_id. */
function writeRegistry(list: SnapshotMeta[]): void {
  const key = registryKey(getBoundUserId());
  db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, JSON.stringify(list)],
  );
  db.save();
}

// ─── Вспомогательное ─────────────────────────────────────────────────────────

/** Генерирует уникальный id снимка. */
function newId(): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `snap_${Date.now()}_${rnd}`;
}

/** Быстрый подсчёт задач для метаданных (best-effort, не критично). */
function countTasks(): number {
  try {
    const row = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM tasks');
    return Number(row?.c ?? 0);
  } catch {
    return 0;
  }
}

/** Текущий bound_user_id (или null). Экспортируется — нужен и вне снимков. */
export function getBoundUserId(): string | null {
  try {
    const row = db.get<{ value: string }>(
      'SELECT value FROM settings WHERE key=?',
      ['bound_user_id'],
    );
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Записывает bound_user_id (привязка базы к аккаунту). Передайте null, чтобы
 * снять привязку (напр. после «Загрузить облачные» перед первым sync нового
 * аккаунта — там привязку выставит успешный sync).
 */
export function setBoundUserId(userId: string | null): void {
  if (userId == null) {
    try { db.run('DELETE FROM settings WHERE key=?', ['bound_user_id']); } catch { /* ignore */ }
  } else {
    db.run(
      `INSERT INTO settings (key, value) VALUES ('bound_user_id', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [userId],
    );
  }
  db.save();
}

/**
 * true, если web-снимки в текущей среде ограничены (нет полноценного
 * файлового бэкенда). UI показывает мягкое предупреждение. В Tauri — false.
 */
export function isWebSnapshotLimited(): boolean {
  return !db.isTauri();
}

// ─── Детект смены аккаунта ────────────────────────────────────────────

/** Результат проверки привязки базы к текущей сессии. */
export interface AccountBindingCheck {
  /**
   * true, если нужно показать гейт выбора (база привязана к ДРУГОМУ
   * аккаунту, чем текущая сессия).
   */
  mismatch: boolean;
  /** Кому привязана база сейчас (null = не привязана). */
  boundUserId: string | null;
  /** id текущей сессии. */
  sessionUserId: string;
}

/**
 * Проверяет, не принадлежит ли локальная база другому аккаунту.
 *
 * Логика:
 *   • база не привязана (bound_user_id отсутствует) → mismatch=false.
 *     Это первый вход либо старая база до migration v8 — гейт не показываем,
 *     привязку выставит первый успешный sync (или выбор в гейте).
 *   • bound_user_id == sessionUserId → mismatch=false (тот же аккаунт).
 *   • bound_user_id != sessionUserId → mismatch=true (СМЕНА АККАУНТА).
 *
 * @param sessionUserId id пользователя из текущей сессии Supabase.
 */
export function checkAccountBinding(sessionUserId: string): AccountBindingCheck {
  const boundUserId = getBoundUserId();
  const mismatch = boundUserId != null && boundUserId !== sessionUserId;
  return { mismatch, boundUserId, sessionUserId };
}

// ─── Создание снимка ─────────────────────────────────────────────────────────

/**
 * Создаёт снимок текущей базы и регистрирует его.
 * После создания выполняет ротацию (оставляет MAX_SNAPSHOTS свежих).
 *
 * @param label человекочитаемая метка причины (напр. 'before_account_switch').
 * @returns метаданные созданного снимка.
 */
export async function createSnapshot(label: string): Promise<SnapshotMeta> {
  const id = newId();
  const createdAt = new Date().toISOString();
  const boundUserId = getBoundUserId();
  const taskCount = countTasks();

  let meta: SnapshotMeta;

  if (db.isTauri()) {
    // Tauri: бинарная копия файла через Rust.
    const { invoke } = await import('@tauri-apps/api/core');
    // Перед копией файла сбрасываем in-memory кэш на диск, чтобы снимок был
    // актуальным (run() пишет в Tauri DB fire-and-forget, save() — в localStorage;
    // сам файл data.db пишется плагином sql, но небольшой лаг возможен).
    try { db.save(); } catch { /* web-only, в Tauri no-op по факту */ }
    const info = await invoke<{ path: string; file_name: string; size: number }>(
      'snapshot_db',
      { label: `${label}_${id}` },
    );
    meta = {
      id,
      label,
      createdAt,
      size: info.size,
      platform: 'tauri',
      path: info.path,
      boundUserId,
      taskCount,
    };
  } else {
    // Web: JSON-дамп в localStorage. Берём всё (tasks+tags+statuses+templates).
    const payload = db.buildBackup({ tasks: true, tags: true, statuses: true });
    const json = JSON.stringify(payload);
    try {
      localStorage.setItem(WEB_PAYLOAD_PREFIX + id, json);
    } catch (e) {
      throw new Error(
        'Не удалось сохранить снимок в браузере (возможно, переполнено хранилище). ' +
        (e instanceof Error ? e.message : String(e)),
      );
    }
    meta = {
      id,
      label,
      createdAt,
      size: json.length,
      platform: 'web',
      boundUserId,
      taskCount,
    };
  }

  // Регистрируем и ротируем.
  const list = readRegistry();
  list.unshift(meta); // новый — в начало
  writeRegistry(list);
  await rotate();

  logger.info(`[snapshots] created ${id} (label=${label}, platform=${meta.platform}, tasks=${taskCount})`);
  return meta;
}

/**
 * Ротация: оставляет MAX_SNAPSHOTS самых свежих снимков, остальные удаляет
 * (и полезную нагрузку, и записи реестра). Тихо, без ошибок наружу.
 */
export async function rotate(): Promise<void> {
  const list = readRegistry();
  // Свежие — в начале (createSnapshot делает unshift). На всякий случай
  // сортируем по дате убыванию, чтобы ротация была детерминирована.
  list.sort((a, b) => (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0));
  if (list.length <= MAX_SNAPSHOTS) return;

  const keep = list.slice(0, MAX_SNAPSHOTS);
  const drop = list.slice(MAX_SNAPSHOTS);
  for (const s of drop) {
    await deletePayload(s);
  }
  writeRegistry(keep);
  logger.info(`[snapshots] rotated: dropped ${drop.length}, kept ${keep.length}`);
}

/** Удаляет только полезную нагрузку снимка (файл или localStorage), без реестра. */
async function deletePayload(meta: SnapshotMeta): Promise<void> {
  try {
    if (meta.platform === 'tauri' && meta.path) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('delete_snapshot', { snapshotPath: meta.path });
    } else {
      try { localStorage.removeItem(WEB_PAYLOAD_PREFIX + meta.id); } catch { /* ignore */ }
    }
  } catch (e) {
    // Не валим ротацию из-за одного файла — просто логируем.
    logger.warn(`[snapshots] deletePayload failed for ${meta.id}:`, e);
  }
}

// ─── Список / удаление ───────────────────────────────────────────────────────

/**
 * Список снимков (самые свежие первыми). Читается из реестра.
 * В Tauri дополнительно фильтрует записи, чьих файлов уже нет на диске
 * (например, пользователь удалил папку вручную) — и подчищает реестр.
 */
export async function listSnapshots(): Promise<SnapshotMeta[]> {
  const list = readRegistry();
  if (!db.isTauri()) {
    return [...list].sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1));
  }
  // Tauri: сверяем с реальными файлами.
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const files = await invoke<Array<{ path: string; file_name: string; size: number }>>(
      'list_snapshots',
    );
    const existingPaths = new Set(files.map((f) => f.path));
    const alive = list.filter((m) => !m.path || existingPaths.has(m.path));
    if (alive.length !== list.length) {
      writeRegistry(alive); // подчистили висячие записи
    }
    return alive.sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1));
  } catch (e) {
    logger.warn('[snapshots] listSnapshots (tauri verify) failed, returning registry as-is:', e);
    return [...list].sort((a, b) => (b.createdAt < a.createdAt ? -1 : 1));
  }
}

/** Удаляет снимок по id (полезную нагрузку + запись реестра). Идемпотентно. */
export async function deleteSnapshot(id: string): Promise<void> {
  const list = readRegistry();
  const meta = list.find((m) => m.id === id);
  if (meta) await deletePayload(meta);
  writeRegistry(list.filter((m) => m.id !== id));
  logger.info(`[snapshots] deleted ${id}`);
}

// ─── Восстановление ──────────────────────────────────────────────────────────

/**
 * Восстанавливает базу из снимка.
 *
 * Tauri: перезаписывает файл data.db из бинарной копии (Rust делает
 * страховочную копию текущей БД внутри папки снимков). ТРЕБУЕТСЯ перезапуск
 * приложения — sql-плагин держит файл открытым. Возвращает
 * { needsRestart: true }; вызывающий должен показать диалог и вызвать
 * restart_app.
 *
 * Web: применяет JSON-дамп через applyBackup('replace'). Перезапуск не нужен —
 * возвращает { needsRestart: false }.
 */
export async function restoreSnapshot(id: string): Promise<{ needsRestart: boolean }> {
  const list = readRegistry();
  const meta = list.find((m) => m.id === id);
  if (!meta) throw new Error(`Снимок ${id} не найден в реестре`);

  if (meta.platform === 'tauri') {
    if (!meta.path) throw new Error('У снимка нет пути к файлу');
    const { invoke } = await import('@tauri-apps/api/core');
    const safetyPath = await invoke<string>('restore_snapshot', { snapshotPath: meta.path });
    logger.info(`[snapshots] restored ${id} from file; safety copy at: ${safetyPath || '(none)'}`);
    return { needsRestart: true };
  }

  // Web: восстановление из JSON-дампа.
  const raw = (() => {
    try { return localStorage.getItem(WEB_PAYLOAD_PREFIX + id); } catch { return null; }
  })();
  if (!raw) throw new Error('Полезная нагрузка снимка не найдена в браузере');
  const payload = JSON.parse(raw) as db.BackupPayload;
  await db.applyBackup(payload, 'replace');
  logger.info(`[snapshots] restored ${id} from web payload`);
  return { needsRestart: false };
}
