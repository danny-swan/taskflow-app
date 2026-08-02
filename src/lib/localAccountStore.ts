/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * localAccountStore.ts — локальное «псевдо-облако» per-account (F21, ADR 0014).
 *
 * Зачем: free-план не имеет облачной синхронизации (гейт в `lib/sync/index.ts`:
 * при `!isProOrTrial(ent)` цикл заканчивается статусом `paywalled`, без pull/push).
 * Локальная SQLite — одна на устройство, а НЕ на аккаунт, поэтому смена аккаунта
 * в `AccountSwitchGate` (free-ветка) стирает базу уходящего пользователя, и при
 * возврате на тот же free-аккаунт он видит пустоту: снимки (`snapshots.ts`)
 * ротируются (max 5) и восстанавливаются только вручную.
 *
 * Решение: постоянный слот-слепок БД на каждый user_id. Пишется при уходе с
 * аккаунта (и автосейвом активной сессии), читается при возврате.
 *
 * Носитель — `localStorage['taskflow.localstore.v1.<userId>']` в ОБОИХ режимах:
 *   • Web — единственный доступный носитель (как web-снимки в snapshots.ts).
 *   • Tauri — `@tauri-apps/plugin-fs` в проекте не подключён (нет ни в
 *     package.json, ни в Cargo.toml), а заводить новую Rust-команду ради JSON
 *     ради одного слота избыточно. localStorage в webview персистентен между
 *     запусками (WebView2/WKWebView хранят его в app-data профиля).
 * Полезная нагрузка — `db.buildBackup()`/`db.applyBackup()`, то есть тот же
 * кросс-режимный JSON-контракт, что у web-снимков и импорта/экспорта.
 *
 * ИНВАРИАНТ: слот принадлежит free-плану. Читать его для Pro/Trial/Lifetime
 * нельзя ни при каких условиях — там источник истины облако (см. ADR 0014).
 * Модуль сам план не проверяет: гейт — на стороне вызывающего
 * (`AccountSwitchGate` free-ветка и `useLocalAccountAutosave`).
 */
import * as db from './db';
import { logger } from './logger';

/** Префикс ключа слота. Версия в имени — на случай смены формата payload. */
const SLOT_PREFIX = 'taskflow.localstore.v1.';

/** Обёртка слота: payload плюс минимальные метаданные для диагностики. */
interface LocalAccountSlot {
  version: 1;
  userId: string;
  savedAt: string;
  payload: db.BackupPayload;
}

function slotKey(userId: string): string {
  return SLOT_PREFIX + userId;
}

function readSlot(userId: string): LocalAccountSlot | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(slotKey(userId));
  } catch {
    return null; // localStorage недоступен (приватный режим / отключён)
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LocalAccountSlot;
    return parsed && typeof parsed === 'object' && parsed.payload ? parsed : null;
  } catch (e) {
    logger.warn('[localAccountStore] slot is not valid JSON, ignoring:', e);
    return null;
  }
}

/**
 * true, если в дампе есть хоть что-то. Пустой дамп — это база сразу после
 * `clearUserData()` (транзитное состояние смены аккаунта), и записывать его
 * поверх живого слота нельзя: это уничтожило бы данные аккаунта.
 */
function isNonEmpty(payload: db.BackupPayload | null | undefined): boolean {
  if (!payload) return false;
  const n =
    (payload.tasks?.length ?? 0) +
    (payload.tags?.length ?? 0) +
    (payload.statuses?.length ?? 0) +
    (payload.templates?.length ?? 0);
  return n > 0;
}

/** Есть ли непустой слот у аккаунта. */
export function hasLocalAccountData(userId: string | null): boolean {
  if (!userId) return false;
  return isNonEmpty(readSlot(userId)?.payload);
}

/**
 * Сохраняет текущее состояние БД в слот аккаунта (перезаписывает предыдущий —
 * один слот на аккаунт, вне ротации снимков).
 *
 * @returns true, если слот записан. false — если писать было нечего
 *          (пустая база) или носитель недоступен/переполнен.
 */
export async function saveLocalAccountData(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  let slot: LocalAccountSlot;
  try {
    const payload = db.buildBackup({ tasks: true, tags: true, statuses: true });
    if (!isNonEmpty(payload)) {
      logger.info(`[localAccountStore] nothing to save for ${userId} (empty db), slot kept as is`);
      return false;
    }
    slot = { version: 1, userId, savedAt: new Date().toISOString(), payload };
  } catch (e) {
    logger.warn('[localAccountStore] buildBackup failed:', e);
    return false;
  }
  try {
    localStorage.setItem(slotKey(userId), JSON.stringify(slot));
  } catch (e) {
    // Переполнение localStorage / приватный режим. Не критично: снимок перед
    // сменой аккаунта создаётся отдельно и остаётся страховкой.
    logger.warn(`[localAccountStore] failed to persist slot for ${userId}:`, e);
    return false;
  }
  logger.info(
    `[localAccountStore] saved slot for ${userId} (tasks=${slot.payload.tasks?.length ?? 0})`,
  );
  return true;
}

/**
 * Восстанавливает данные аккаунта из его слота в живую БД (`applyBackup` в
 * режиме 'replace').
 *
 * ВАЖНО: вызывать ПОСЛЕ `reconcilePersonalWorkspace(userId)` — `applyBackup`
 * штампует восстановленные строки текущим `current_workspace_id`, который
 * реконсиль как раз и переводит на personal-ws нового аккаунта.
 *
 * @returns true, если данные восстановлены; false — слота нет/он пуст/битый.
 */
export async function loadLocalAccountData(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const slot = readSlot(userId);
  if (!isNonEmpty(slot?.payload)) return false;
  try {
    const counts = await db.applyBackup(slot!.payload, 'replace');
    logger.info(
      `[localAccountStore] restored slot for ${userId}: ` +
      `${counts.tasks} tasks, ${counts.tags} tags, ${counts.statuses} statuses, ${counts.templates} templates`,
    );
    return true;
  } catch (e) {
    logger.warn(`[localAccountStore] applyBackup failed for ${userId}:`, e);
    return false;
  }
}
