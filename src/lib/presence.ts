// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// presence.ts — «кто сейчас онлайн в shared-пространстве» через Supabase
// Realtime Presence API (Wave C, PR-c-01).
//
// В ОТЛИЧИЕ от sync/realtime.ts (postgres_changes на sync-таблицы) presence —
// это отдельный класс Realtime-каналов: клиенты «трекают» своё присутствие
// (`channel.track(meta)`), а сервер рассылает всем `presence` события
// (sync/join/leave). Никакой БД/DDL это не требует — состояние живёт только в
// памяти Realtime-сервера, поэтому мы держим локальное зеркало в эфемерном
// usePresenceStore (см. его комментарий).
//
// Канал создаётся тем же способом, что и sync-канал — `supabase.channel(...)`,
// но с `config.presence.key = userId`, чтобы сервер группировал метаданные по
// пользователю (несколько вкладок → один ключ).
//
// Приватность: в meta уходит только публичный минимум профиля — nickname,
// avatar_variant, public_user_id (TF-XXXXXX). EMAIL НЕ ТРЕКАЕТСЯ и нигде в
// presence-UI не показывается (см. wave-c-plan.md §1).
//
// Только для shared-пространств: на personal (там гарантированно один человек)
// канал не поднимается вообще — лишний Realtime-канал не нужен.
import { useEffect } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { logger } from './logger';
import { fetchProfile } from './profile';
import { useStore } from '../store/useStore';
import { usePresenceStore, type PresenceMember } from '../store/usePresenceStore';

/** Профиль текущего пользователя, которым мы «трекаем» присутствие. */
export interface PresenceProfile {
  userId: string;
  nickname: string | null;
  avatarVariant: number;
  publicUserId: string;
}

/** Форма meta, которую кладём в channel.track() (snake_case — как в БД). */
interface PresenceMeta {
  nickname: string | null;
  avatar_variant: number;
  public_user_id: string;
}

/** presence_ref добавляется сервером к каждому meta. */
type TrackedMeta = PresenceMeta & { presence_ref: string };

/** Свести серверный meta к нашему PresenceMember (последний meta — свежайший). */
function metaToMember(userId: string, metas: TrackedMeta[]): PresenceMember | null {
  const meta = metas[metas.length - 1];
  if (!meta) return null;
  return {
    userId,
    nickname: meta.nickname ?? null,
    avatarVariant: Number(meta.avatar_variant ?? 1),
    publicUserId: meta.public_user_id,
  };
}

/**
 * Подписаться на presence shared-пространства. Возвращает unsubscribe, который
 * ОБЯЗАТЕЛЬНО дёргать при смене пространства / логауте / закрытии вкладки —
 * иначе «призрачные» пользователи останутся в чужих списках до серверного
 * heartbeat-таймаута.
 */
export function subscribeWorkspacePresence(
  workspaceId: string,
  profile: PresenceProfile,
): () => void {
  const store = usePresenceStore.getState();
  // Начинаем с чистого списка именно для этого пространства.
  store.syncFrom(workspaceId, []);

  const channel: RealtimeChannel = supabase.channel(`presence-ws-${workspaceId}`, {
    config: { presence: { key: profile.userId } },
  });

  // sync — авторитетный полный снимок: пересобираем список целиком (без себя).
  const applySync = () => {
    const state = channel.presenceState<PresenceMeta>();
    const members: PresenceMember[] = [];
    for (const key of Object.keys(state)) {
      if (key === profile.userId) continue; // себя в «кто ещё здесь» не показываем
      const m = metaToMember(key, state[key] as TrackedMeta[]);
      if (m) members.push(m);
    }
    usePresenceStore.getState().syncFrom(workspaceId, members);
  };

  channel
    .on('presence', { event: 'sync' }, applySync)
    .on('presence', { event: 'join' }, ({ key, newPresences }) => {
      if (key === profile.userId) return;
      const m = metaToMember(key, newPresences as TrackedMeta[]);
      if (m) usePresenceStore.getState().join(workspaceId, m);
    })
    .on('presence', { event: 'leave' }, ({ key }) => {
      if (key === profile.userId) return;
      usePresenceStore.getState().leave(key);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        const meta: PresenceMeta = {
          nickname: profile.nickname,
          avatar_variant: profile.avatarVariant,
          public_user_id: profile.publicUserId,
        };
        channel.track(meta).catch((e) => logger.warn('[presence] track failed:', e));
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        logger.warn(`[presence] channel status: ${status}`);
      }
    });

  return () => {
    channel.untrack().catch((e) => logger.warn('[presence] untrack failed:', e));
    supabase
      .removeChannel(channel)
      .catch((e) => logger.warn('[presence] removeChannel failed:', e));
    usePresenceStore.getState().clear();
  };
}

/**
 * Хук жизненного цикла presence. Поднимает канал ТОЛЬКО когда текущее
 * пространство shared и известен профиль пользователя; переподключается при
 * смене currentWorkspaceId; снимает подписку при уходе с shared / размонтаже.
 *
 * Держится симметрично subscribeRealtime/resubscribeRealtime из sync/realtime:
 * набор входных данных (workspaceId, userId) меняется — канал пересобирается.
 */
export function useWorkspacePresence(): void {
  const workspaceId = useStore((s) => s.currentWorkspaceId);
  const workspaces = useStore((s) => s.workspaces);
  const boundUserId = useStore((s) => s.boundUserId);
  const kind = workspaces.find((w) => w.id === workspaceId)?.kind ?? null;

  useEffect(() => {
    if (kind !== 'shared' || !workspaceId || !boundUserId) {
      usePresenceStore.getState().clear();
      return;
    }
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    fetchProfile(boundUserId)
      .then((profile) => {
        if (cancelled || !profile) return;
        cleanup = subscribeWorkspacePresence(workspaceId, {
          userId: boundUserId,
          nickname: profile.nickname,
          avatarVariant: profile.avatar_variant,
          publicUserId: profile.public_user_id,
        });
      })
      .catch((e) => logger.warn('[presence] profile fetch failed:', e));

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [workspaceId, kind, boundUserId]);
}
