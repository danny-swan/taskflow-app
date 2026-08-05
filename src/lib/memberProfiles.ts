/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v1.1.x — публичные профили участников пространства. F40, ADR 0031.
 *
 * ПРОБЛЕМА: на public.profiles действуют только own-row политики
 * (profiles_select_own), поэтому клиент физически не может прочитать ник, TF-id
 * и аватар других участников. Список участников из-за этого показывал первые 8
 * символов внутреннего uuid и одинаковый аватар-заглушку.
 *
 * РЕШЕНИЕ: SECURITY DEFINER RPC `get_workspace_member_profiles(p_workspace_id)`
 * (миграция 0043) отдаёт публичный минимум профилей участников тому, кто сам
 * состоит в этом пространстве. Здесь — тонкая обёртка + кэш в localStorage,
 * чтобы список оставался читаемым офлайн (десктоп часто работает без сети).
 *
 * ВАЖНО: только чтение отображаемых полей. Логика членства, приглашений и
 * sync-цикла не затрагивается (ADR 0008/0009/0011); profiles в sync не участвует.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { logger } from './logger';

export interface MemberProfile {
  user_id: string;
  public_user_id: string;
  nickname: string | null;
  avatar_variant: number;
  avatar_color: string | null;
  bio: string | null;
}

export type MemberProfileMap = Record<string, MemberProfile>;

const CACHE_KEY = 'tf.memberProfiles.v1';

/**
 * In-memory зеркало localStorage: журнал активности спрашивает профили на
 * каждую строку, а читать/парсить JSON на каждый рендер не нужно.
 */
let memCache: MemberProfileMap | null = null;

/** Кэш публичных профилей (user_id → профиль). Общий на все пространства. */
export function readMemberProfileCache(): MemberProfileMap {
  if (memCache) return memCache;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) { memCache = {}; return memCache; }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { memCache = {}; return memCache; }
    memCache = parsed as MemberProfileMap;
    return memCache;
  } catch {
    memCache = {};
    return memCache;
  }
}

function writeMemberProfileCache(map: MemberProfileMap): void {
  memCache = map;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {
    /* квота/приватный режим — кэш best-effort, не критично */
  }
}

/** Сбросить in-memory зеркало (нужно тестам и смене аккаунта). */
export function resetMemberProfileCache(): void {
  memCache = null;
}

/** Синхронный поиск профиля в кэше (без сетевых запросов). */
export function lookupCachedMemberProfile(userId: string | null | undefined): MemberProfile | undefined {
  if (!userId) return undefined;
  return readMemberProfileCache()[userId];
}

/** Нормализация строки RPC (числа/nullable приводим к нашему контракту). */
export function normalizeMemberProfileRow(row: Record<string, unknown>): MemberProfile | null {
  const userId = typeof row.user_id === 'string' ? row.user_id : null;
  const publicId = typeof row.public_user_id === 'string' ? row.public_user_id : null;
  if (!userId || !publicId) return null;
  const variant = Number(row.avatar_variant ?? 1);
  return {
    user_id: userId,
    public_user_id: publicId,
    nickname: (row.nickname as string | null) ?? null,
    avatar_variant: Number.isFinite(variant) ? variant : 1,
    avatar_color: (row.avatar_color as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
  };
}

/**
 * Читает публичные профили участников пространства через RPC.
 * Пустой массив — легальный ответ (не участник / нет сети → решает вызывающий).
 */
export async function fetchWorkspaceMemberProfiles(workspaceId: string): Promise<MemberProfile[]> {
  const { data, error } = await supabase.rpc('get_workspace_member_profiles', {
    p_workspace_id: workspaceId,
  });
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows
    .map(r => normalizeMemberProfileRow(r as Record<string, unknown>))
    .filter((p): p is MemberProfile => p !== null);
}

/**
 * F51: точечно положить один профиль в кэш (без RPC).
 *
 * Нужно для СОБСТВЕННОГО профиля: журнал активности берёт аватары из
 * этого кэша, а `get_workspace_member_profiles` вызывается только на экране
 * участников shared-пространства. Без этого в личном пространстве (или до
 * первого визита на «Участников») свой аватар оставался бы заглушкой.
 * Запись best-effort и не трогает остальные ключи кэша.
 */
export function upsertMemberProfileCacheEntry(profile: MemberProfile): void {
  const merged = { ...readMemberProfileCache(), [profile.user_id]: profile };
  writeMemberProfileCache(merged);
}

export interface UseMemberProfilesResult {
  /** user_id → публичный профиль (сервер + кэш). */
  byId: MemberProfileMap;
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * Хук для списка участников: тянет профили пространства, мержит в кэш и отдаёт
 * карту по user_id. Ошибка RPC (офлайн, local-only ws) не ломает UI — остаётся
 * то, что уже было в кэше.
 */
export function useWorkspaceMemberProfiles(workspaceId: string | null): UseMemberProfilesResult {
  const [byId, setById] = useState<MemberProfileMap>(() => readMemberProfileCache());
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const rows = await fetchWorkspaceMemberProfiles(workspaceId);
      if (rows.length === 0) return;
      const merged = { ...readMemberProfileCache() };
      for (const r of rows) merged[r.user_id] = r;
      writeMemberProfileCache(merged);
      setById(merged);
    } catch (e: unknown) {
      logger.warn('[memberProfiles] fetch failed:', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { byId, loading, refetch };
}

/** Что показывать в списке: ник, если задан, иначе TF-id, иначе прочерк. */
export function memberDisplayName(profile: MemberProfile | undefined): string | null {
  if (!profile) return null;
  const nick = profile.nickname?.trim();
  if (nick) return nick;
  return profile.public_user_id || null;
}
