/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.25 — Общая валидация пароля.
 *
 *   Правила синхронизированы с Supabase Auth Policies:
 *     Minimum length: 8
 *     Password requirements: Lowercase, uppercase letters and digits
 *
 *   Используется:
 *     - AuthScreen         (регистрация)
 *     - PasswordResetModal (смена / сброс пароля)
 *
 *   Возвращает null, если пароль валиден, иначе — локализованное сообщение.
 *
 * v0.9.25 — Ephemeral Supabase-клиент для проверки текущего пароля.
 *
 *   Проблема: если делать reauthenticate через глобальный supabase-клиент
 *   (`signInWithPassword`), Supabase выпустит новую сессию и перепишет
 *   локальные токены — это ломает refresh и другие запросы.
 *
 *   Решение: отдельный клиент без persistSession / без storage. Он живёт
 *   ровно один вызов, ничего не сохраняет, глобальную сессию не трогает.
 *   Если пароль верный — `error === null`, иначе получаем AuthApiError.
 */

import { createClient } from '@supabase/supabase-js';

// ─── Валидация ───────────────────────────────────────────────────────────────

/**
 * Проверяет пароль на соответствие правилам Supabase.
 * @returns null если валиден, иначе локализованное сообщение об ошибке.
 */
export function validatePasswordStrength(pwd: string, ru: boolean): string | null {
  if (pwd.length < 8) {
    return ru
      ? 'Пароль должен быть не короче 8 символов'
      : 'Password must be at least 8 characters';
  }
  if (!/[a-z]/.test(pwd)) {
    return ru
      ? 'Пароль должен содержать хотя бы одну строчную букву (a-z)'
      : 'Password must contain at least one lowercase letter (a-z)';
  }
  if (!/[A-Z]/.test(pwd)) {
    return ru
      ? 'Пароль должен содержать хотя бы одну заглавную букву (A-Z)'
      : 'Password must contain at least one uppercase letter (A-Z)';
  }
  if (!/\d/.test(pwd)) {
    return ru
      ? 'Пароль должен содержать хотя бы одну цифру'
      : 'Password must contain at least one digit';
  }
  return null;
}

/**
 * Короткая подсказка (placeholder) с описанием правил пароля.
 * Используется в input[placeholder] под полями «Новый пароль».
 */
export function passwordHint(ru: boolean): string {
  return ru
    ? 'минимум 8: A-Z, a-z, цифра'
    : 'min 8: A-Z, a-z, digit';
}

// ─── Ephemeral verify ────────────────────────────────────────────────────────

// URL/anon key берём из env — те же, что и в глобальном supabase-клиенте.
// Отсутствие уже обработано в `./supabase.ts` (throw на старте), здесь просто
// предполагаем string.
const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/**
 * Проверяет текущий пароль пользователя, не затрагивая глобальную сессию.
 *
 * Создаёт эфемерный supabase-клиент (persistSession=false, storage=undefined)
 * и делает через него signInWithPassword. Если пароль верный — возвращает
 * true, иначе — false. Глобальный `supabase` из `./supabase.ts` не трогается.
 *
 * @returns true если пароль верный, false если неверный или произошла ошибка.
 */
export async function verifyCurrentPassword(
  email: string,
  password: string,
): Promise<boolean> {
  const ephemeral = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: undefined,
    },
  });
  try {
    const { error } = await ephemeral.auth.signInWithPassword({ email, password });
    if (error) return false;
    // Выходим сразу, чтобы даже локальная память клиента не держала сессию.
    // Ошибку signOut игнорируем — клиент всё равно будет собран GC.
    await ephemeral.auth.signOut().catch(() => { /* noop */ });
    return true;
  } catch {
    return false;
  }
}
