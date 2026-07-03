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

/** Логин через Google OAuth. */
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // В Tauri desktop OAuth flow работает через system browser + deep link
      // (детали настройки — в docs/AUTH_GOOGLE.md, добавим позже)
      redirectTo: 'http://localhost:1420/auth/callback',
    },
  });
  if (error) throw error;
  return data;
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

/** Удалить аккаунт. Нужен свежий JWT — auth.users на стороне БД удаляется каскадом. */
export async function deleteAccount() {
  // Supabase не даёт удалить свой auth.users через anon key (безопасность).
  // Мы удаляем profile — а auth.users надо удалить через Edge Function с
  // service_role. Пока просто signOut + помечаем profile как deleted через RPC.
  // TODO(v0.9.10): создать Edge Function delete-account, вызывать через .rpc('delete_account')
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.from('profiles').update({ metadata: { deleted_at: new Date().toISOString() } }).eq('id', user.id);
  }
  await signOut();
}
