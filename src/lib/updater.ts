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

// v0.9.33: грубое сравнение semver вида "0.9.32" > "0.9.31".
// Не обрабатывает pre-release суффиксы, но для нашего формата версий достаточно.
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/**
 * v0.9.33: для macOS авто-апдейт недоступен (сборка не подписана),
 * проверяем наличие новой версии через GitHub Releases API. Пользователь видит баннер
 * со ссылкой на релиз — скачивает .dmg вручную.
 */
async function checkForUpdateViaGitHub(currentVersion: string): Promise<UpdateInfo> {
  try {
    const res = await fetch('https://api.github.com/repos/danny-swan/taskflow-app/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      return { available: false, currentVersion };
    }
    const data = await res.json();
    const tagName = String(data.tag_name || '');
    const latestVersion = tagName.replace(/^v/, '');
    if (!latestVersion || !isNewerVersion(latestVersion, currentVersion)) {
      return { available: false, currentVersion };
    }
    return {
      available: true,
      currentVersion,
      newVersion: latestVersion,
      notes: data.body || undefined,
      date: data.published_at || undefined,
    };
  } catch (e: any) {
    logger.warn('updater: github check failed', { error: String(e?.message || e) });
    return { available: false, currentVersion };
  }
}

/**
 * Проверяет наличие обновления через Tauri updater endpoint.
 * v0.9.33: на macOS авто-апдейт недоступен — падаем на GitHub API fallback.
 * НЕ скачивает и не устанавливает — только проверяет.
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo> {
  if (!isTauri()) {
    return { available: false, currentVersion };
  }

  // v0.9.33: на macOS сразу в GitHub API (в latest.json нет darwin-секций)
  try {
    const { platform } = await import('@tauri-apps/plugin-os');
    if ((await platform()) === 'macos') {
      return await checkForUpdateViaGitHub(currentVersion);
    }
  } catch {
    // не критично — идём через Tauri updater как обычно
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
