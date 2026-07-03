/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.9 — Authentication hook и helpers.
 *
 * Логика grace period:
 *   - При успешном login сохраняем last_online_at в settings.
 *   - При старте приложения:
 *     * если сессия есть в localStorage и last_online_at < 7 дней назад — пускаем без сети
 *     * если > 7 дней — требуем подключение к сети для refresh
 *     * если сети нет и prошло > 7 дней — показываем AuthScreen с сообщением
 */
import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseReachable } from './supabase';
import * as db from './db';

const LAST_ONLINE_KEY = 'auth_last_online_at';
const GRACE_PERIOD_DAYS = 7;

export function getLastOnline(): number | null {
  try {
    const row = db.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [LAST_ONLINE_KEY]);
    return row ? parseInt(row.value, 10) : null;
  } catch {
    return null;
  }
}

export function setLastOnline(ts: number = Date.now()) {
  try {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [LAST_ONLINE_KEY, String(ts)]);
  } catch { /* silent */ }
}

export function isInGracePeriod(): boolean {
  const last = getLastOnline();
  if (!last) return false;
  const daysAgo = (Date.now() - last) / (1000 * 60 * 60 * 24);
  return daysAgo < GRACE_PERIOD_DAYS;
}

export function daysUntilExpiry(): number {
  const last = getLastOnline();
  if (!last) return 0;
  const daysAgo = (Date.now() - last) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(GRACE_PERIOD_DAYS - daysAgo));
}

/**
 * Основной hook — отслеживает состояние сессии.
 * Возвращает: { session, user, loading, gracePeriod, needsReauth }.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsReauth, setNeedsReauth] = useState(false);

  useEffect(() => {
    let mounted = true;

    // 1. Пробуем восстановить сессию из localStorage
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const s = data.session;

      if (s) {
        // Есть сессия — проверяем grace period или пробуем refresh
        if (isInGracePeriod()) {
          setSession(s);
          setLoading(false);
          // Опционально пингуем сеть и обновляем last_online
          isSupabaseReachable().then(ok => {
            if (ok) setLastOnline();
          });
        } else {
          // Grace истёк — нужен свежий refresh
          const online = await isSupabaseReachable();
          if (online) {
            const { data: r, error } = await supabase.auth.refreshSession();
            if (!mounted) return;
            if (error || !r.session) {
              setNeedsReauth(true);
              setSession(null);
            } else {
              setSession(r.session);
              setLastOnline();
            }
            setLoading(false);
          } else {
            // Нет сети И grace истёк — требуем перелогин
            setNeedsReauth(true);
            setSession(null);
            setLoading(false);
          }
        }
      } else {
        setLoading(false);
      }
    });

    // 2. Подписка на изменения аутентификации
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mounted) return;
      setSession(s);
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setLastOnline();
        setNeedsReauth(false);
      }
      if (event === 'SIGNED_OUT') {
        setNeedsReauth(false);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return {
    session,
    user: session?.user ?? null as User | null,
    loading,
    needsReauth,
    gracePeriod: isInGracePeriod(),
  };
}

/** Логин по email/password. */
export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  setLastOnline();
  return data;
}

/** Регистрация по email/password. */
export async function signUpWithPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  setLastOnline();
  return data;
}

/**
 * v0.9.11 — Google OAuth через deep link taskflow://auth/callback.
 *
 * Flow:
 *   1. Клиент вызывает signInWithOAuth({ skipBrowserRedirect: true }) —
 *      Supabase возвращает URL, который мы сами открываем в системном браузере.
 *   2. Google → Supabase → redirect на taskflow://auth/callback#access_token=…&refresh_token=…
 *   3. ONE (Windows) открывает taskflow.exe, Tauri emit'ит deep-link://auth-callback,
 *      listener в App.tsx вызывает handleAuthCallback(url) из этого файла.
 *   4. Парсим fragment, вызываем supabase.auth.setSession → SIGNED_IN.
 */
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: 'taskflow://auth/callback',
      skipBrowserRedirect: true,
    },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Supabase не вернул OAuth URL');

  // Открываем в системном браузере через tauri-plugin-shell.
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(data.url);
  } catch {
    // Фолбэк для dev-web (вне Tauri, когда vite открыт в браузере напрямую).
    window.open(data.url, '_blank');
  }
  return data;
}

/**
 * v0.9.11 — обработчик deep link taskflow://auth/callback#…
 * Вызывается из App.tsx при emit события от Rust.
 *
 * Supabase отдаёт токены в hash fragment: #access_token=…&refresh_token=…&expires_in=…&token_type=bearer
 * (это implicit flow; PKCE Supabase пока не требует для OAuth через свой callback).
 */
export async function handleAuthCallback(url: string): Promise<boolean> {
  try {
    // Парсим даже если URL с custom scheme — URL API его принимает.
    const u = new URL(url);
    // Приоритет — hash (implicit); fallback — query (если Supabase переключаться на code flow).
    const raw = u.hash.startsWith('#') ? u.hash.slice(1) : u.search.replace(/^\?/, '');
    const params = new URLSearchParams(raw);

    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    const error_desc = params.get('error_description') || params.get('error');

    if (error_desc) throw new Error(error_desc);
    if (!access_token || !refresh_token) return false;

    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    setLastOnline();
    return true;
  } catch (e) {
    console.error('[deep-link] auth callback failed:', e);
    return false;
  }
}

/** Выход. Токены удаляются из localStorage. */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  // Очищаем grace period
  try {
    db.run('DELETE FROM settings WHERE key=?', [LAST_ONLINE_KEY]);
  } catch { /* silent */ }
}

/**
 * v0.9.11 — удаление аккаунта через Edge Function delete_account.
 *
 * Edge Function использует service_role key (внутри Supabase, не виден клиенту)
 * и вызывает auth.admin.deleteUser(user.id). При этом profiles и все связанные
 * строки удаляются каскадом (см. миграции).
 */
export async function deleteAccount() {
  const { data, error } = await supabase.functions.invoke('delete_account');
  if (error) throw error;
  if (data && data.error) throw new Error(String(data.error));
  await signOut();
}
