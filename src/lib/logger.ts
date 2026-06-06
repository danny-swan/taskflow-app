/**
 * v0.8.12 — Frontend logger
 *
 * Маленький JSON-line логгер, который пишет события в файл рядом с БД
 * (через Rust-команду `log_line`). В web-режиме (без Tauri) тихо no-op,
 * чтобы не падать в браузере. В worst-case (например, Rust-команда вернула
 * ошибку) тоже глотаем — логгер не должен ронять приложение.
 *
 * Формат строки в файле — JSON-объект на строку:
 *   {"ts":"2026-06-06T12:34:56.789Z","level":"info","msg":"text","meta":{...}}
 *
 * Это упрощает «прислать лог разработчику»: достаточно открыть файл
 * через Settings → Диагностика → «Открыть лог».
 */
import { isTauri } from './db';

type Level = 'info' | 'warn' | 'error';

async function write(level: Level, msg: string, meta?: any) {
  if (!isTauri()) return;
  try {
    const entry: Record<string, any> = {
      ts: new Date().toISOString(),
      level,
      msg,
    };
    if (meta !== undefined) {
      // На случай circular structures — best-effort
      try { entry.meta = JSON.parse(JSON.stringify(meta)); }
      catch { entry.meta = String(meta); }
    }
    const line = JSON.stringify(entry);
    // Используем @tauri-apps/api/core напрямую, чтобы не зависеть от внутренних
    // деталей db.ts. invoke резолвится только в десктопе (isTauri() выше).
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('log_line', { line });
  } catch {
    /* silent — логгер не должен мешать приложению */
  }
}

export const logger = {
  info(msg: string, meta?: any) { void write('info', msg, meta); },
  warn(msg: string, meta?: any) { void write('warn', msg, meta); },
  error(msg: string, meta?: any) { void write('error', msg, meta); },
};

/**
 * Устанавливает глобальные обработчики window.error / unhandledrejection.
 * Вызывать один раз при старте приложения.
 */
export function installGlobalErrorHandlers() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (ev) => {
    logger.error('window.error', {
      message: ev.message,
      filename: ev.filename,
      lineno: ev.lineno,
      colno: ev.colno,
      stack: ev.error?.stack,
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    logger.error('unhandledrejection', {
      reason: String(ev.reason?.message || ev.reason || 'unknown'),
      stack: ev.reason?.stack,
    });
  });
}
