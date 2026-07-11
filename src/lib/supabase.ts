/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.9 — Supabase client (email/password + Google OAuth + телеметрия).
 * v0.9.35-dev.6.1 — URL/anon key вынесены в env (VITE_SUPABASE_URL,
 *   VITE_SUPABASE_ANON_KEY). Оба значения публичные по дизайну Supabase
 *   (anon key ограничен Row Level Security на стороне Postgres), поэтому
 *   их безопасно передавать в клиентский бандл. Секретный service_role
 *   ключ остаётся только на бэкенде/CI и никогда не попадает в клиент.
 *
 *   Env-переменные задаются в `.env.local` (dev) или в CI secrets (build).
 *   См. `.env.example` и `docs/DEPLOY.md`.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const rawAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!rawUrl || !rawAnonKey) {
  // Явная ошибка сборки лучше, чем немой сбой авторизации в рантайме.
  throw new Error(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY не заданы. ' +
      'Задайте их в .env.local (dev) или в CI secrets (build).',
  );
}

// После throw выше — гарантированно string. Фиксируем тип, чтобы TS
// не проваливался при использовании в асинхронных функциях ниже.
const url: string = rawUrl;
const anonKey: string = rawAnonKey;

/**
 * Supabase-клиент.
 * - persistSession: true — токены хранятся в localStorage автоматически
 * - autoRefreshToken: true — refresh за 60с до истечения (обычно раз в час)
 * - detectSessionInUrl: false — мы не в браузере с redirect-flow (Tauri desktop)
 */
export const supabase: SupabaseClient = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
});

/**
 * Проверка «онлайн» — простой ping до Supabase healthz.
 * Возвращает true, если можем достучаться до сервера.
 * Используется для grace period (7 дней offline).
 */
export async function isSupabaseReachable(timeoutMs = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${url}/auth/v1/health`, {
      method: 'GET',
      signal: controller.signal,
      headers: { apikey: anonKey },
    });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * v0.9.22: «keep-alive» ping для Supabase.
 *
 * Проблема: free-tier Supabase приостанавливает проект после 7 дней неактивности,
 * после чего первые запросы от пользователей будут медленными (10-30с).
 *
 * Решение:
 * 1. GitHub Actions workflow `.github/workflows/supabase-ping.yml` тыкает базу каждые 3 дня.
 * 2. Каждый запуск TaskFlow дополнительно дёргает базу (если есть сеть) — эта функция.
 *
 * Запрос — лёгкий SELECT 1 через REST (без авторизации, RLS вернёт [] — этого достаточно).
 * Ошибки глотаем — чисто fire-and-forget, не блокируем UI.
 */
export function pingSupabaseKeepAlive(): void {
  // Скипаем в SSR/тестах (нет fetch или нет window).
  if (typeof fetch === 'undefined') return;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  fetch(`${url}/rest/v1/tasks?select=id&limit=1`, {
    method: 'GET',
    signal: controller.signal,
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  })
    .catch(() => { /* offline — не важно */ })
    .finally(() => clearTimeout(timeoutId));
}
