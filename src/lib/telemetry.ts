/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.9 — Телеметрия событий.
 *
 * Событие вставляется в public.usage_events. Если пользователь не залогинен —
 * событие не отправляется (у нас RLS insert only for own user_id).
 *
 * Ошибки сети не блокируют UI: тихо игнорируем неудачные отправки.
 * Никаких персональных данных о задачах (title, description) — только тип
 * события и счётчики.
 */
import { supabase } from './supabase';

export type EventType =
  | 'signup'
  | 'login'
  | 'logout'
  | 'app_start'
  | 'task_created'
  | 'task_deleted'
  | 'task_completed';

let cachedOs: { os: string; os_version: string } | null = null;

async function detectOs(): Promise<{ os: string; os_version: string }> {
  if (cachedOs) return cachedOs;
  try {
    // Tauri v2 API
    const w = window as any;
    if (w.__TAURI_INTERNALS__) {
      const { platform, version } = await import('@tauri-apps/plugin-os');
      cachedOs = { os: await platform(), os_version: await version() };
      return cachedOs;
    }
  } catch { /* silent */ }
  // Fallback для web / если plugin-os не доступен
  const ua = navigator.userAgent;
  let os = 'unknown';
  if (/Windows/i.test(ua)) os = 'windows';
  else if (/Mac/i.test(ua)) os = 'macos';
  else if (/Linux/i.test(ua)) os = 'linux';
  cachedOs = { os, os_version: '' };
  return cachedOs;
}

const APP_VERSION = (import.meta.env.VITE_APP_VERSION as string) || '0.9.9';

export async function logEvent(
  eventType: EventType,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // Не логируем неаутентифицированные события

    const { os, os_version } = await detectOs();

    await supabase.from('usage_events').insert({
      user_id: user.id,
      event_type: eventType,
      app_version: APP_VERSION,
      os,
      os_version,
      metadata,
    });
  } catch {
    // Тихо игнорируем — телеметрия не должна ломать UX
  }
}
