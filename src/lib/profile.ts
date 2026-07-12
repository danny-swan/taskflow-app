/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v1.0.x — Кастомизация профиля (public ID + профильные поля).
 *
 * МОДЕЛЬ ИДЕНТИФИКАТОРОВ (см. миграцию 0026):
 *   • profiles.id (uuid = auth.users.id) — ВНУТРЕННИЙ ID. Связность/логика,
 *     пользователю не показывается. Клиент им пользуется только как ключом
 *     `where id = uid`, но в UI не выводит.
 *   • public_user_id (TF-XXXXXX) — ПУБЛИЧНЫЙ ID. Его юзер сообщает другим
 *     (будущий поиск/друзья). Сервер присваивает при регистрации, guard-триггер
 *     запрещает менять. Клиент его НЕ шлёт на UPDATE.
 *   • nickname / avatar_variant / bio — косметика профиля.
 *
 * profiles НЕ участвует в sync-цикле (outbox/push/pull). Профиль читается и
 * пишется отдельным Supabase-запросом (RLS own-row), поэтому эти поля не
 * влияют на upsert/conflict-flow sync_* таблиц.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { logger } from './logger';

// ─── Ограничения (совпадают с CHECK'ами в миграции 0026) ────────────────────
export const NICKNAME_MAX = 32;
export const BIO_MAX = 160;
export const AVATAR_MIN = 1;
export const AVATAR_MAX = 8;

/** Профиль, каким его читает клиент. Внутренний `id` намеренно не тянем в UI. */
export interface Profile {
  public_user_id: string;
  nickname: string | null;
  avatar_variant: number;
  bio: string | null;
  email: string;
  created_at: string;
}

/** Поля, которые пользователь может изменить. */
export interface ProfileUpdate {
  nickname?: string | null;
  avatar_variant?: number;
  bio?: string | null;
}

// ─── Валидация (клиентское зеркало серверных CHECK'ов) ──────────────────────

/** Возвращает нормализованное значение или бросает при нарушении лимитов. */
export function validateProfileUpdate(patch: ProfileUpdate): ProfileUpdate {
  const out: ProfileUpdate = {};
  if ('nickname' in patch) {
    const n = patch.nickname;
    if (n != null && n.length > NICKNAME_MAX) {
      throw new Error(`nickname превышает ${NICKNAME_MAX} символов`);
    }
    out.nickname = n === '' ? null : n ?? null;
  }
  if ('bio' in patch) {
    const b = patch.bio;
    if (b != null && b.length > BIO_MAX) {
      throw new Error(`bio превышает ${BIO_MAX} символов`);
    }
    out.bio = b === '' ? null : b ?? null;
  }
  if ('avatar_variant' in patch) {
    const v = patch.avatar_variant;
    if (
      typeof v !== 'number' ||
      !Number.isInteger(v) ||
      v < AVATAR_MIN ||
      v > AVATAR_MAX
    ) {
      throw new Error(`avatar_variant должен быть целым ${AVATAR_MIN}..${AVATAR_MAX}`);
    }
    out.avatar_variant = v;
  }
  return out;
}

// ─── Запросы к Supabase ─────────────────────────────────────────────────────

const PROFILE_COLUMNS = 'public_user_id, nickname, avatar_variant, bio, email, created_at';

/** Читает профиль текущего пользователя (RLS ограничивает own-row). */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return data as unknown as Profile;
}

/**
 * Обновляет косметические поля профиля. Публичный ID / внутренний id / email
 * НЕ отправляются (public_user_id вдобавок защищён guard-триггером на сервере).
 */
export async function updateProfile(
  userId: string,
  patch: ProfileUpdate,
): Promise<Profile> {
  const clean = validateProfileUpdate(patch);
  const { data, error } = await supabase
    .from('profiles')
    .update(clean)
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as Profile;
}

// ─── Хук ────────────────────────────────────────────────────────────────────

export interface UseProfileResult {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  save: (patch: ProfileUpdate) => Promise<void>;
}

/**
 * Загрузка/refetch/save профиля для экрана настроек.
 * userId = null (нет сессии) → ничего не грузим.
 */
export function useProfile(userId: string | null): UseProfileResult {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(userId != null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const p = await fetchProfile(userId);
      setProfile(p);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('[profile] fetch failed:', msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const save = useCallback(
    async (patch: ProfileUpdate) => {
      if (!userId) throw new Error('Нет активной сессии');
      const updated = await updateProfile(userId, patch);
      setProfile(updated);
    },
    [userId],
  );

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { profile, loading, error, refetch, save };
}
