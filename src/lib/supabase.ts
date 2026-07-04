/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.9 — Supabase client (email/password + Google OAuth + телеметрия).
 *
 * ВАЖНО: anon key публичный по дизайну (доступ ограничен Row Level Security
 * на стороне Postgres). Его можно безопасно вшивать в клиентский код и
 * коммитить в открытый репозиторий. Секретный ключ (service_role) остаётся
 * только на бэкенде/CI и никогда не попадает в клиент.
 *
 * Fallback-значения ниже нужны, чтобы бинарник работал без .env файла у
 * конечного пользователя. Приоритет — переменные окружения (для локальной
 * разработки и подмены в CI), потом hard-coded fallback.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Fallback-значения (публичные, безопасно коммитить)
const FALLBACK_URL = 'https://sejpmzrmtgcvevukggkx.supabase.co';
const FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNlanBtenJtdGdjdmV2dWtnZ2t4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNjYzNDAsImV4cCI6MjA5ODY0MjM0MH0.TXGc-JS5TyaR_egzRt71cWUB8YDaWwnMrn-zrTW-aMM';

const url = (import.meta.env.VITE_SUPABASE_URL as string) || FALLBACK_URL;
const anonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || FALLBACK_ANON_KEY;

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
