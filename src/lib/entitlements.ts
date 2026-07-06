/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.35-dev.6 — Entitlements (Freemium + Trial + Subscription + Lifetime).
 *
 * ЦЕЛЬ:
 *   Единая точка правды о том, что пользователю доступно. UI не должен сам
 *   лазить в supabase.user_entitlements — только через `getEntitlement()` /
 *   `useEntitlement()`. Это даёт нам:
 *     - Offline fallback (кэш в settings, как last_online_at в auth.ts).
 *     - Realtime обновления при апруве заявки админом (Supabase realtime).
 *     - Grandfathered override для админа (safety net если БД недоступна).
 *     - Единое место для добавления фиче-флагов (isPro, isProOrTrial и т.п.).
 *
 * АРХИТЕКТУРА:
 *
 *   Server (Supabase, миграция 0007):
 *     user_entitlements(user_id PK, plan, valid_until, source, trial_used, …)
 *     RLS: SELECT свои строки; INSERT/UPDATE только service_role.
 *     Клиент НЕ может сам себе выдать Pro. Trial выдаётся через RPC-хелпер
 *     (см. startTrial ниже — использует Edge Function либо service_role).
 *
 *   Client:
 *     resolveEntitlement(row, userEmail) — детерминированный чистый резолвер.
 *     Учитывает:
 *       - null (нет строки в БД) → free;
 *       - lifetime → навсегда, valid_until игнорируется;
 *       - trial/pro с valid_until в прошлом → expired → free;
 *       - ADMIN_EMAILS override → всегда lifetime.
 *
 *   Кэш:
 *     Пишем последнюю успешную ре-загрузку в settings (ключ ENTITLEMENT_CACHE_KEY)
 *     как JSON. При старте offline читаем оттуда, чтобы UI не мигал в free.
 *     Кэш не даёт вечный Pro — если valid_until истёк, resolveEntitlement
 *     всё равно вернёт free.
 *
 * ТРЕЙ-ОФФЫ / РИСКИ:
 *   - Кэш в settings может протухнуть, если пользователь надолго уйдёт офлайн
 *     после оплаты (не увидит апгрейд). Realtime + on-focus refresh покрывают
 *     штатные сценарии.
 *   - ADMIN_EMAILS в клиенте — не секьюрити (клиент можно пересобрать),
 *     это UX-фича: gate на клиенте не пропускает free в платные экраны,
 *     но реальная защита — RLS на сервере. Всё Pro-содержимое (Calendar,
 *     Realtime, sync payloads) уже защищено RLS в 0001-0006.
 *   - startTrial ниже полагается на RPC/Edge Function; если её нет —
 *     возвращаем ошибку, а не пытаемся INSERT напрямую (клиент не имеет прав).
 */

import { useEffect, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import * as db from './db';
import { logger } from './logger';

// ─── Константы ────────────────────────────────────────────────────────────────

/** Email-ы, которые всегда считаются lifetime (двойная страховка к БД seed). */
export const ADMIN_EMAILS: readonly string[] = ['lebedevdo.one@gmail.com'];

/** Длительность trial (14 дней по продуктовому решению). */
export const TRIAL_DAYS = 14;

/** Ключ в settings для offline-кэша. */
const ENTITLEMENT_CACHE_KEY = 'entitlement_cache_v1';

// ─── Типы ─────────────────────────────────────────────────────────────────────

export type Plan = 'free' | 'trial' | 'pro' | 'lifetime';

/** Источник апгрейда — совпадает с public.entitlement_source в БД. */
export type EntitlementSource =
  | 'admin'
  | 'trial'
  | 'manual'
  | 'yookassa'
  | 'cloudpayments'
  | 'crypto'
  | 'seed';

/** «Сырой» вид строки из user_entitlements. */
export interface EntitlementRow {
  user_id: string;
  plan: Plan;
  valid_until: string | null; // ISO timestamp
  activated_at: string | null;
  source: EntitlementSource | null;
  trial_used: boolean;
  notes: string | null;
  updated_at: string;
}

/**
 * Итоговый resolved-эффективный статус, с которым работает UI.
 *
 * effectivePlan — что показываем в UI (учитывая expiry и admin override).
 * rawPlan       — что реально в БД (нужно, например, чтобы понять
 *                 «истёк trial» vs «его никогда не было»).
 * isAdmin       — true, если это ADMIN_EMAILS override.
 */
export interface Entitlement {
  effectivePlan: Plan;
  rawPlan: Plan;
  validUntil: Date | null;
  source: EntitlementSource | null;
  trialUsed: boolean;
  isAdmin: boolean;
  /** Осталось миллисекунд до valid_until (null для lifetime и free). */
  msLeft: number | null;
  /** true если trial активен прямо сейчас. */
  isTrialActive: boolean;
  /** true если оплаченный Pro активен прямо сейчас. */
  isPaidPro: boolean;
}

// ─── Резолвер (чистая функция, тестируется в изоляции) ────────────────────────

/**
 * Единственное место, где решается «что показывать пользователю».
 *
 * @param row       Строка из user_entitlements, либо null если её нет.
 * @param userEmail Email залогиненого пользователя (для ADMIN override).
 * @param now       Момент времени (для тестов — иначе Date.now()).
 */
export function resolveEntitlement(
  row: EntitlementRow | null,
  userEmail: string | null,
  now: number = Date.now(),
): Entitlement {
  const isAdmin = !!userEmail && ADMIN_EMAILS.includes(userEmail.toLowerCase());

  // Case 1: админ — всегда lifetime, независимо от БД (safety net).
  if (isAdmin) {
    return {
      effectivePlan: 'lifetime',
      rawPlan: row?.plan ?? 'lifetime',
      validUntil: null,
      source: row?.source ?? 'admin',
      trialUsed: row?.trial_used ?? true,
      isAdmin: true,
      msLeft: null,
      isTrialActive: false,
      isPaidPro: true,
    };
  }

  // Case 2: строки нет — free.
  if (!row) {
    return {
      effectivePlan: 'free',
      rawPlan: 'free',
      validUntil: null,
      source: null,
      trialUsed: false,
      isAdmin: false,
      msLeft: null,
      isTrialActive: false,
      isPaidPro: false,
    };
  }

  const validUntil = row.valid_until ? new Date(row.valid_until) : null;
  const msLeft = validUntil ? validUntil.getTime() - now : null;

  // Case 3: lifetime — навсегда.
  if (row.plan === 'lifetime') {
    return {
      effectivePlan: 'lifetime',
      rawPlan: 'lifetime',
      validUntil: null,
      source: row.source,
      trialUsed: row.trial_used,
      isAdmin: false,
      msLeft: null,
      isTrialActive: false,
      isPaidPro: true,
    };
  }

  // Case 4: trial или pro — проверяем valid_until.
  // Если valid_until = null (не должно быть, но защита от битой СУБД) —
  // трактуем как expired, чтобы не выдавать вечный trial/pro.
  if (row.plan === 'trial' || row.plan === 'pro') {
    const expired = validUntil === null || validUntil.getTime() <= now;
    if (expired) {
      // Истёк — фактически free, но rawPlan сохраняем (UI покажет «trial закончился»).
      return {
        effectivePlan: 'free',
        rawPlan: row.plan,
        validUntil,
        source: row.source,
        trialUsed: row.trial_used,
        isAdmin: false,
        msLeft: 0,
        isTrialActive: false,
        isPaidPro: false,
      };
    }
    return {
      effectivePlan: row.plan,
      rawPlan: row.plan,
      validUntil,
      source: row.source,
      trialUsed: row.trial_used,
      isAdmin: false,
      msLeft,
      isTrialActive: row.plan === 'trial',
      isPaidPro: row.plan === 'pro',
    };
  }

  // Case 5: plan='free' (или неизвестный enum) → free.
  return {
    effectivePlan: 'free',
    rawPlan: 'free',
    validUntil,
    source: row.source,
    trialUsed: row.trial_used,
    isAdmin: false,
    msLeft: null,
    isTrialActive: false,
    isPaidPro: false,
  };
}

// ─── Хелперы-предикаты (сахар для гейтов) ─────────────────────────────────────

export function isPro(e: Entitlement): boolean {
  return e.effectivePlan === 'pro' || e.effectivePlan === 'lifetime';
}

export function isProOrTrial(e: Entitlement): boolean {
  return e.effectivePlan === 'pro' || e.effectivePlan === 'lifetime' || e.effectivePlan === 'trial';
}

export function isAdmin(e: Entitlement): boolean {
  return e.isAdmin;
}

export function daysLeftInTrial(e: Entitlement): number {
  if (e.effectivePlan !== 'trial' || e.msLeft == null) return 0;
  return Math.max(0, Math.ceil(e.msLeft / (1000 * 60 * 60 * 24)));
}

export function daysLeftInSubscription(e: Entitlement): number {
  if (e.effectivePlan !== 'pro' || e.msLeft == null) return 0;
  return Math.max(0, Math.ceil(e.msLeft / (1000 * 60 * 60 * 24)));
}

// ─── Кэш в settings (offline fallback) ────────────────────────────────────────

/** Читает последнюю известную строку из локального кэша. Возвращает null если пусто. */
export function readCachedRow(): EntitlementRow | null {
  try {
    const rec = db.get<{ value: string }>(
      'SELECT value FROM settings WHERE key=?',
      [ENTITLEMENT_CACHE_KEY],
    );
    if (!rec) return null;
    return JSON.parse(rec.value) as EntitlementRow;
  } catch (e) {
    logger.warn('[entitlements] readCachedRow failed:', e);
    return null;
  }
}

/** Пишет строку в кэш. */
export function writeCachedRow(row: EntitlementRow | null): void {
  try {
    if (row == null) {
      db.run('DELETE FROM settings WHERE key=?', [ENTITLEMENT_CACHE_KEY]);
    } else {
      db.run(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        [ENTITLEMENT_CACHE_KEY, JSON.stringify(row)],
      );
    }
  } catch (e) {
    logger.warn('[entitlements] writeCachedRow failed:', e);
  }
}

// ─── Загрузка из БД ───────────────────────────────────────────────────────────

/**
 * Загружает EntitlementRow из Supabase. RLS выберет только свою строку.
 * Возвращает null если строки нет (юзер ещё в free).
 */
export async function fetchEntitlementRow(userId: string): Promise<EntitlementRow | null> {
  const { data, error } = await supabase
    .from('user_entitlements')
    .select('user_id, plan, valid_until, activated_at, source, trial_used, notes, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    // maybeSingle не выкидывает на 0 строк — только на реальные ошибки.
    logger.warn('[entitlements] fetchEntitlementRow failed:', error.message);
    throw error;
  }
  return (data as EntitlementRow | null) ?? null;
}

/**
 * Основная точка входа для не-React кода (Edge Function-каллеры, sync-гейты).
 * Сначала пробует БД, при ошибке — падает на кэш.
 */
export async function getEntitlement(
  userId: string,
  userEmail: string | null,
): Promise<Entitlement> {
  try {
    const row = await fetchEntitlementRow(userId);
    writeCachedRow(row);
    return resolveEntitlement(row, userEmail);
  } catch {
    // Сетевая ошибка / RLS-сбой — падаем на кэш.
    const cached = readCachedRow();
    return resolveEntitlement(cached, userEmail);
  }
}

// ─── Actions: startTrial, submitActivationRequest ─────────────────────────────

/**
 * Запуск 14-дневного trial через Edge Function `start-trial`.
 *
 * Клиент НЕ может сам записать в user_entitlements (RLS), поэтому вся логика
 * (проверка trial_used, INSERT с service_role) на серверной стороне.
 * Edge Function будет создана в task 9-10 dev.6; пока функция может отсутствовать —
 * в этом случае возвращаем ошибку с осмысленным сообщением, чтобы UI показал
 * «Пока недоступно».
 */
export async function startTrial(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('start-trial');
    if (error) {
      // Стандартная ошибка Supabase — например, 404 если функция не задеплоена.
      const msg = (error as { message?: string }).message ?? String(error);
      return { ok: false, error: msg };
    }
    if (data && typeof data === 'object' && 'error' in data) {
      return { ok: false, error: String((data as { error: unknown }).error) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Тип формы для ручной активации. */
export interface ActivationRequestInput {
  txRef: string;
  planRequested: 'monthly' | 'annual' | 'lifetime';
  providerHint: string; // 'cloudtips' | 'ton' | 'usdt-trc20' | 'usdt-erc20' | 'other'
  notes?: string;
}

/**
 * Отправить заявку на ручную активацию. INSERT разрешён клиентам через RLS
 * (WITH CHECK user_id = auth.uid()), поэтому идёт напрямую в таблицу.
 * Уведомление админу — через Edge Function `activation-notify` (Resend),
 * которая триггерится postgres_changes (реализована в task 9 dev.6).
 */
export async function submitActivationRequest(
  input: ActivationRequestInput,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp?.user) {
    return { ok: false, error: 'Не удалось получить текущего пользователя' };
  }
  const user = userResp.user;

  const { data, error } = await supabase
    .from('activation_requests')
    .insert({
      user_id: user.id,
      email: user.email ?? '',
      tx_ref: input.txRef.trim(),
      plan_requested: input.planRequested,
      provider_hint: input.providerHint,
      admin_notes: input.notes ?? null,
    })
    .select('id')
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, id: (data as { id: string }).id };
}

// ─── Realtime подписка ────────────────────────────────────────────────────────

let entitlementChannel: RealtimeChannel | null = null;

/**
 * Подписаться на изменения своей строки user_entitlements. Возвращает
 * unsubscribe. Idempotent (повторный вызов закрывает старую подписку).
 *
 * onChange вызывается при любом INSERT/UPDATE/DELETE в user_entitlements
 * для этого userId — колбэку удобно триггерить пере-fetch (см. useEntitlement).
 */
export function subscribeEntitlement(userId: string, onChange: () => void): () => void {
  unsubscribeEntitlement();

  const ch = supabase.channel(`entitlement-${userId}`);
  ch.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'user_entitlements',
      filter: `user_id=eq.${userId}`,
    },
    () => {
      onChange();
    },
  );
  ch.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      logger.info(`[entitlements] realtime subscribed for user ${userId.slice(0, 8)}…`);
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      logger.warn(`[entitlements] channel status: ${status}`);
    }
  });

  entitlementChannel = ch;
  return unsubscribeEntitlement;
}

export function unsubscribeEntitlement(): void {
  if (entitlementChannel) {
    supabase.removeChannel(entitlementChannel).catch(e =>
      logger.warn('[entitlements] removeChannel failed:', e),
    );
    entitlementChannel = null;
  }
}

// ─── React hook ───────────────────────────────────────────────────────────────

/**
 * Хук с realtime-обновлением. Стратегия:
 *   1. При mount: сразу отдаём Entitlement, собранный из кэша (быстрый первый рендер,
 *      без flash-of-free).
 *   2. Параллельно fetch из БД, обновляем.
 *   3. Подписываемся на realtime; при апруве заявки админом — refetch.
 *
 * Если userId/email == null — считаем free.
 */
export function useEntitlement(
  userId: string | null,
  userEmail: string | null,
): { entitlement: Entitlement; loading: boolean; refetch: () => void } {
  // Оптимистичный старт: кэш (или free если кэша нет).
  const [entitlement, setEntitlement] = useState<Entitlement>(() =>
    resolveEntitlement(readCachedRow(), userEmail),
  );
  const [loading, setLoading] = useState<boolean>(!!userId);
  const [refetchTick, setRefetchTick] = useState(0);

  useEffect(() => {
    if (!userId) {
      setEntitlement(resolveEntitlement(null, userEmail));
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);

    (async () => {
      try {
        const row = await fetchEntitlementRow(userId);
        if (!mounted) return;
        writeCachedRow(row);
        setEntitlement(resolveEntitlement(row, userEmail));
      } catch (e) {
        logger.warn('[entitlements] hook fetch failed, using cache:', e);
        if (!mounted) return;
        setEntitlement(resolveEntitlement(readCachedRow(), userEmail));
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    // Realtime подписка.
    const unsub = subscribeEntitlement(userId, () => {
      // Триггерим refetch, увеличивая tick.
      setRefetchTick(t => t + 1);
    });

    return () => {
      mounted = false;
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, userEmail, refetchTick]);

  return {
    entitlement,
    loading,
    refetch: () => setRefetchTick(t => t + 1),
  };
}

// ─── Debug / тесты ────────────────────────────────────────────────────────────

export const _internals = {
  ENTITLEMENT_CACHE_KEY,
  ADMIN_EMAILS,
  TRIAL_DAYS,
};
