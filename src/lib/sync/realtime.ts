// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * sync/realtime.ts — Supabase Realtime подписка на sync-таблицы.
 *
 * v0.9.35-dev.5.
 *
 * Идея простая: вместо того чтобы полагаться только на debounced авто-sync
 * (2с после enqueue + on-focus + on-online), подписываемся на postgres_changes
 * для всех sync-таблиц. Как только приходит INSERT/UPDATE/DELETE — планируем
 * debounced pull (общий debounce, чтобы серия событий схлопнулась в 1 pull).
 *
 * Мы НЕ применяем payload события напрямую (он приходит без соблюдения
 * PUSH_ORDER, без FK-резолюции и без LWW-конфликтов) — просто триггерим
 * обычный pull, который уже умеет всё это правильно.
 *
 * Debounce специально держим коротким (600 мс): достаточно, чтобы схлопнуть
 * burst из 5-10 событий (batch push с другого устройства обычно занимает
 * секунду-две), но при этом пользователь видит изменения почти мгновенно.
 *
 * RLS фильтр (Wave A): подписываемся по пространствам юзера —
 * `filter: 'workspace_id=in.(<ws1>,<ws2>,…)'`. Это ловит строки ВСЕХ
 * пространств, к которым принадлежит юзер (в Wave A ровно одно personal-ws),
 * и остаётся корректным для shared-ws в следующих волнах. Список ws-id берём
 * из listWorkspaceIds(userId). При изменении набора пространств нужно
 * переподписаться (resubscribeRealtime) — набор фильтров пересоберётся.
 *
 * Замечание про workspace_settings: сервер шлёт события и по этой таблице,
 * фильтр по workspace_id работает и там (у неё нет user_id-колонки, поэтому
 * фильтр по пространству — единственный корректный вариант).
 *
 * Важно про client_id: чтобы не гонять зайцем pull после собственного push
 * (мы только что запушили → сервер шлёт нам обратно наш же INSERT), мы
 * НЕ пытаемся дедупить по client_id тут. Дедупу делает pullTable через
 * LWW: наши же строки уже локально updated с тем же updated_at, поэтому
 * LWW-сравнение вернёт skip. Ценой одного лишнего HTTP-запроса. Это ок
 * для v0.9.35 — оптимизируем при необходимости.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { logger } from '../logger';
import { pullAll } from './pull';
import { listWorkspaceIds } from './workspace';

/** Таблицы, за которыми следим. Должны быть в publication supabase_realtime. */
const WATCHED_TABLES = [
  'sync_workspaces',
  'sync_workspace_members',
  'sync_workspace_settings',
  'sync_tasks',
  'sync_statuses',
  'sync_tags',
  'sync_task_templates',
  'sync_overdue_events',
  'sync_task_hold_periods',
] as const;

const REALTIME_PULL_DEBOUNCE_MS = 600;

/**
 * Колонка-скоуп для realtime-фильтра. У самой sync_workspaces id пространства
 * лежит в PK `id`, у всех остальных таблиц — в `workspace_id`.
 */
function scopeColumn(table: string): 'id' | 'workspace_id' {
  return table === 'sync_workspaces' ? 'id' : 'workspace_id';
}

/** Значение фильтра `col=in.(a,b,c)` из списка ws-id. */
function inFilter(col: string, wsIds: string[]): string {
  return `${col}=in.(${wsIds.join(',')})`;
}

let channel: RealtimeChannel | null = null;
/** userId текущей подписки — нужен для resubscribe при смене набора ws. */
let subscribedUserId: string | null = null;
let pullTimer: ReturnType<typeof setTimeout> | null = null;
let pullInFlight = false;
/** Если во время pull-а прилетело новое событие — сделаем ещё один pull после. */
let pullQueued = false;

/**
 * Debounced pull. Многократные вызовы в течение окна схлопываются в 1 pull.
 * Если pull уже идёт — ставим флаг "нужен ещё один".
 */
function schedulePull(userId: string): void {
  if (pullTimer) clearTimeout(pullTimer);
  pullTimer = setTimeout(() => {
    pullTimer = null;
    runPull(userId).catch(e => logger.warn('[sync/realtime] pull failed:', e));
  }, REALTIME_PULL_DEBOUNCE_MS);
}

async function runPull(userId: string): Promise<void> {
  if (pullInFlight) {
    pullQueued = true;
    return;
  }
  pullInFlight = true;
  try {
    const r = await pullAll(userId);
    if (r.applied > 0) {
      logger.info(
        `[sync/realtime] pulled ${r.applied} rows (skipped ${r.skipped}, deferred ${r.deferred})`,
      );
      // Обновляем UI. Lazy import — как в orchestrator.ts.
      try {
        const mod = await import('../../store/useStore');
        const state = mod.useStore.getState();
        if (typeof state.refresh === 'function') state.refresh();
        // Realtime-pull мог изменить состав/указатель пространств — перечитываем
        // in-memory ws-состояние (как в orchestrator refreshStoreAfterPull).
        if (typeof state.loadWorkspaces === 'function') state.loadWorkspaces();
        if (typeof state.loadWorkspaceMembers === 'function') state.loadWorkspaceMembers();
      } catch (e) {
        logger.warn('[sync/realtime] store refresh failed:', e);
      }
    }
    if (r.firstError) {
      logger.warn('[sync/realtime] pull had errors:', r.firstError);
    }
  } finally {
    pullInFlight = false;
    if (pullQueued) {
      pullQueued = false;
      // Повторный pull через debounce (может ещё событий прилетит).
      schedulePull(userId);
    }
  }
}

/**
 * Подключить realtime-подписку. Возвращает unsubscribe.
 * Idempotent — при повторном вызове старый канал закрывается и создаётся
 * новый (например, если сменился userId после signout/signin).
 */
export function subscribeRealtime(userId: string): () => void {
  // Idempotent: если канал уже есть — снимаем.
  unsubscribeRealtime();

  const wsIds = listWorkspaceIds(userId);
  const ch = supabase.channel(`sync-realtime-${userId}`);

  for (const table of WATCHED_TABLES) {
    ch.on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table,
        filter: inFilter(scopeColumn(table), wsIds),
      },
      (_payload: unknown) => {
        // Не смотрим payload — просто триггерим pull.
        schedulePull(userId);
      },
    );
  }

  ch.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      logger.info(
        `[sync/realtime] subscribed for user ${userId.slice(0, 8)}… (${wsIds.length} ws)`,
      );
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      logger.warn(`[sync/realtime] channel status: ${status}`);
    }
  });

  channel = ch;
  subscribedUserId = userId;
  return unsubscribeRealtime;
}

/**
 * Переподписаться при изменении набора пространств юзера (создание/удаление ws).
 * В Wave A набор ws статичен (одно personal-ws), но код готов к списку: при
 * добавлении/удалении пространства вызовите это, чтобы пересобрать фильтры.
 * No-op, если подписки ещё нет.
 */
export function resubscribeRealtime(): void {
  if (subscribedUserId) subscribeRealtime(subscribedUserId);
}

/** Снять подписку и отменить отложенный pull. */
export function unsubscribeRealtime(): void {
  if (pullTimer) {
    clearTimeout(pullTimer);
    pullTimer = null;
  }
  pullQueued = false;
  if (channel) {
    supabase.removeChannel(channel).catch(e => logger.warn('[sync/realtime] removeChannel failed:', e));
    channel = null;
  }
  subscribedUserId = null;
}

/** Экспорт для тестов. */
export const _internals = {
  WATCHED_TABLES,
  REALTIME_PULL_DEBOUNCE_MS,
  schedulePull,
  runPull,
  isSubscribed: () => channel !== null,
};
