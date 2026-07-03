// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.8: обёртка над @tauri-apps/plugin-updater.
//
// В браузере (npm run dev через vite без Tauri) plugin недоступен —
// динамический import ловим в try/catch и возвращаем «no update».

import { logger } from './logger';

export type UpdateInfo = {
  available: boolean;
  currentVersion: string;
  newVersion?: string;
  notes?: string;
  date?: string;
};

const isTauri = () => typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';

/**
 * Проверяет наличие обновления через Tauri updater endpoint.
 * НЕ скачивает и не устанавливает — только проверяет.
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo> {
  if (!isTauri()) {
    return { available: false, currentVersion };
  }
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) {
      return { available: false, currentVersion };
    }
    return {
      available: true,
      currentVersion,
      newVersion: update.version,
      notes: update.body || undefined,
      date: update.date || undefined,
    };
  } catch (e: any) {
    logger.warn('updater: check failed', { error: String(e?.message || e) });
    // Ошибка сети / отсутствия latest.json — трактуем как «нет обновления»
    return { available: false, currentVersion };
  }
}

/**
 * Скачивает и устанавливает найденное обновление, затем перезапускает приложение.
 * Показывает прогресс через onProgress (0..100).
 */
export async function downloadAndInstall(
  onProgress?: (percent: number) => void
): Promise<void> {
  if (!isTauri()) {
    throw new Error('Auto-update доступен только в собранном приложении');
  }
  const { check } = await import('@tauri-apps/plugin-updater');
  const { relaunch } = await import('@tauri-apps/plugin-process');
  const update = await check();
  if (!update) {
    throw new Error('Обновление не найдено');
  }
  let downloaded = 0;
  let contentLength = 0;
  await update.downloadAndInstall(evt => {
    switch (evt.event) {
      case 'Started':
        contentLength = evt.data.contentLength || 0;
        onProgress?.(0);
        break;
      case 'Progress':
        downloaded += evt.data.chunkLength;
        if (contentLength > 0) {
          const pct = Math.min(99, Math.round((downloaded / contentLength) * 100));
          onProgress?.(pct);
        }
        break;
      case 'Finished':
        onProgress?.(100);
        break;
    }
  });
  logger.info('updater: installed, relaunching');
  await relaunch();
}
