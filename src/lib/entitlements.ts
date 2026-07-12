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

/**
 * Email-ы, которые всегда считаются lifetime (двойная страховка к БД seed).
 *
 * Читается из `VITE_ADMIN_EMAILS` (comma-separated) на этапе сборки.
 * По умолчанию пустой массив — никакого хардкода в исходниках.
 *
 * Пример `.env.local`: `VITE_ADMIN_EMAILS=admin@example.com,team@example.com`
 */
export const ADMIN_EMAILS: readonly string[] = (
  (import.meta as unknown as { env?: { VITE_ADMIN_EMAILS?: string } }).env?.VITE_ADMIN_EMAILS ?? ''
)
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s.length > 0);

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
  // v0.9.35-dev.6.5.1 — recurring billing (см. migration 0014)
  auto_renew?: boolean;
  cancel_at_period_end?: boolean;
  next_renewal_at?: string | null; // ISO timestamp
  renewal_attempts_count?: number;
  payment_method_id?: string | null; // FK → payment_methods.id
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
  // v0.9.35-dev.6.5.1 — recurring billing
  /** true если подписка настроена на автопродление (save_payment_method сработал). */
  autoRenew: boolean;
  /** true если пользователь отменил автопродление, но период ещё действует. */
  cancelAtPeriodEnd: boolean;
  /** Момент следующего попытки списания (null если auto_renew=false или lifetime). */
  nextRenewalAt: Date | null;
  /** Количество неуспешных попыток списания подряд (0…3). После 3-й — downgrade. */
  renewalAttempts: number;
  /** ID сохранённого способа оплаты в payment_methods (null если не привязан). */
  paymentMethodId: string | null;
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
  // isAdmin: проверяем сначала VITE_ADMIN_EMAILS (compile-time), затем fallback
  // через source='seed' из БД (runtime — не зависит от env при сборке).
  const isAdminByEmail = !!userEmail && ADMIN_EMAILS.includes(userEmail.toLowerCase());
  const isAdminBySeed = !!row && row.source === 'seed' && row.plan === 'lifetime';
  const isAdmin = isAdminByEmail || isAdminBySeed;

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
      autoRenew: false,
      cancelAtPeriodEnd: false,
      nextRenewalAt: null,
      renewalAttempts: 0,
      paymentMethodId: null,
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
      autoRenew: false,
      cancelAtPeriodEnd: false,
      nextRenewalAt: null,
      renewalAttempts: 0,
      paymentMethodId: null,
    };
  }

  const validUntil = row.valid_until ? new Date(row.valid_until) : null;
  const msLeft = validUntil ? validUntil.getTime() - now : null;

  // v0.9.35-dev.6.5.1 — recurring поля (backward-compatible: undefined ⇒ дефолты)
  const autoRenew = row.auto_renew ?? false;
  const cancelAtPeriodEnd = row.cancel_at_period_end ?? false;
  const nextRenewalAt = row.next_renewal_at ? new Date(row.next_renewal_at) : null;
  const renewalAttempts = row.renewal_attempts_count ?? 0;
  const paymentMethodId = row.payment_method_id ?? null;

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
      autoRenew: false, // lifetime не продлевается
      cancelAtPeriodEnd: false,
      nextRenewalAt: null,
      renewalAttempts: 0,
      paymentMethodId,
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
        autoRenew: false, // истёк — считаем отключённым
        cancelAtPeriodEnd: false,
        nextRenewalAt: null,
        renewalAttempts,
        paymentMethodId,
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
      // trial не имеет auto_renew, но если в БД flag выставлен — уважаем его (будущее расширение)
      autoRenew,
      cancelAtPeriodEnd,
      nextRenewalAt,
      renewalAttempts,
      paymentMethodId,
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
    autoRenew: false,
    cancelAtPeriodEnd: false,
    nextRenewalAt: null,
    renewalAttempts: 0,
    paymentMethodId,
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
    .select('user_id, plan, valid_until, activated_at, source, trial_used, notes, updated_at, auto_renew, cancel_at_period_end, next_renewal_at, renewal_attempts_count, payment_method_id')
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

/** Статус гидрации entitlement для текущего userId. */
export type EntitlementStatus = 'loading' | 'loaded' | 'error';

/**
 * Хук с realtime-обновлением. Стратегия:
 *   1. При mount: сразу отдаём Entitlement, собранный из кэша (быстрый первый рендер,
 *      без flash-of-free).
 *   2. Параллельно fetch из БД, обновляем.
 *   3. Подписываемся на realtime; при апруве заявки админом — refetch.
 *
 * Если userId/email == null — считаем free.
 *
 * v1.0.1 (fix/admin-first-click-redirect): `loading` вычисляется СИНХРОННО на
 * рендере, а не через отдельный useState, обновляемый в эффекте. Раньше был
 * race: `useAuth()` резолвит сессию асинхронно, поэтому на первом рендере
 * AdminPage `userId === null` → `loading` инициализировался как `false`. Когда
 * сессия подтягивалась, `userId` становился ненулевым, но `loading` оставался
 * `false` ещё один коммит (пока эффект не вызовет `setLoading(true)`). В этот
 * момент route-guard в AdminPage видел `!entLoading && !isAdmin` и делал
 * ложный redirect на /tasks. Теперь `loading` = «данные ещё не резолвнуты для
 * текущего userId», что известно уже на рендере и лага нет.
 */
export function useEntitlement(
  userId: string | null,
  userEmail: string | null,
): { entitlement: Entitlement; loading: boolean; status: EntitlementStatus; refetch: () => void } {
  // Единый снапшот: какой Entitlement и для какого userId уже резолвнут из БД.
  // resolvedFor === undefined означает «fetch для текущего userId ещё не
  // завершался» (в т.ч. на самом первом рендере). Оптимистично отдаём кэш.
  const [state, setState] = useState<{
    entitlement: Entitlement;
    resolvedFor: string | null | undefined;
    outcome: 'loaded' | 'error';
  }>(() => ({
    entitlement: resolveEntitlement(readCachedRow(), userEmail),
    resolvedFor: undefined,
    outcome: 'loaded',
  }));
  const [refetchTick, setRefetchTick] = useState(0);

  useEffect(() => {
    if (!userId) {
      setState({ entitlement: resolveEntitlement(null, userEmail), resolvedFor: null, outcome: 'loaded' });
      return;
    }

    let mounted = true;

    (async () => {
      try {
        const row = await fetchEntitlementRow(userId);
        if (!mounted) return;
        writeCachedRow(row);
        setState({ entitlement: resolveEntitlement(row, userEmail), resolvedFor: userId, outcome: 'loaded' });
      } catch (e) {
        logger.warn('[entitlements] hook fetch failed, using cache:', e);
        if (!mounted) return;
        setState({ entitlement: resolveEntitlement(readCachedRow(), userEmail), resolvedFor: userId, outcome: 'error' });
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

  // Синхронный вывод статуса: если есть userId, но резолвнутые данные относятся
  // к другому (или ещё ни к какому) userId — мы ещё грузимся. Это верно уже на
  // том рендере, где userId впервые стал ненулевым, поэтому guard не мигает.
  const status: EntitlementStatus =
    userId != null && state.resolvedFor !== userId ? 'loading' : state.outcome;

  return {
    entitlement: state.entitlement,
    loading: status === 'loading',
    status,
    refetch: () => setRefetchTick(t => t + 1),
  };
}

// ─── v0.9.35-dev.6.5.1: Recurring subscription management ───────────────────

/**
 * Отмена автопродления текущей pro-подписки. Ставит cancel_at_period_end=true;
 * доступ сохраняется до valid_until. Не возвращает деньги (для этого — refund через support).
 *
 * Edge Function: /functions/v1/cancel-subscription
 * Auth: JWT (автоматически через supabase.functions.invoke).
 */
export async function cancelSubscription(): Promise<
  { ok: true; cancelledAt: string; accessUntil: string | null; plan: Plan }
  | { ok: false; error: string }
> {
  try {
    const { data, error } = await supabase.functions.invoke('cancel-subscription', {
      body: {},
    });
    if (error) {
      logger.warn('[entitlements] cancelSubscription invoke error:', error.message);
      return { ok: false, error: error.message };
    }
    if (!data || (data as any).ok !== true) {
      return { ok: false, error: (data as any)?.error ?? 'unknown error' };
    }
    return {
      ok: true,
      cancelledAt: (data as any).cancelled_at as string,
      accessUntil: ((data as any).access_until as string | null) ?? null,
      plan: (data as any).plan as Plan,
    };
  } catch (e: any) {
    logger.warn('[entitlements] cancelSubscription failed:', e?.message ?? e);
    return { ok: false, error: e?.message ?? 'network error' };
  }
}

/**
 * Реактивация автопродления: cancel_at_period_end=false. Работает только для подписки,
 * где всё ещё есть привязанный payment_method и valid_until в будущем.
 *
 * Edge Function: /functions/v1/reactivate-subscription
 */
export async function reactivateSubscription(): Promise<
  { ok: true; nextRenewalAt: string; plan: Plan }
  | { ok: false; error: string }
> {
  try {
    const { data, error } = await supabase.functions.invoke('reactivate-subscription', {
      body: {},
    });
    if (error) {
      logger.warn('[entitlements] reactivateSubscription invoke error:', error.message);
      return { ok: false, error: error.message };
    }
    if (!data || (data as any).ok !== true) {
      return { ok: false, error: (data as any)?.error ?? 'unknown error' };
    }
    return {
      ok: true,
      nextRenewalAt: (data as any).next_renewal_at as string,
      plan: (data as any).plan as Plan,
    };
  } catch (e: any) {
    logger.warn('[entitlements] reactivateSubscription failed:', e?.message ?? e);
    return { ok: false, error: e?.message ?? 'network error' };
  }
}

/**
 * Отвязка карты. Деактивирует все активные payment_methods текущего юзера
 * (is_active=false) и обнуляет привязку в user_entitlements (payment_method_id=null,
 * auto_renew=false, cancel_at_period_end=true). Доступ по valid_until сохраняется,
 * но автопродления больше не будет.
 *
 * Требование ЮKassa: пользователь должен иметь возможность самостоятельно
 * отвязать карту без обращения в поддержку.
 *
 * Edge Function: /functions/v1/detach-payment-method
 * Auth: JWT (автоматически через supabase.functions.invoke).
 */
export async function detachPaymentMethod(): Promise<
  { ok: true; detachedAt: string; detachedCount: number; alreadyDetached: boolean }
  | { ok: false; error: string }
> {
  try {
    const { data, error } = await supabase.functions.invoke('detach-payment-method', {
      body: {},
    });
    if (error) {
      logger.warn('[entitlements] detachPaymentMethod invoke error:', error.message);
      return { ok: false, error: error.message };
    }
    if (!data || (data as any).ok !== true) {
      return { ok: false, error: (data as any)?.error ?? 'unknown error' };
    }
    return {
      ok: true,
      detachedAt: (data as any).detached_at as string,
      detachedCount: ((data as any).detached_count as number) ?? 0,
      alreadyDetached: (data as any).already_detached === true,
    };
  } catch (e: any) {
    logger.warn('[entitlements] detachPaymentMethod failed:', e?.message ?? e);
    return { ok: false, error: e?.message ?? 'network error' };
  }
}

/**
 * Строка из payment_methods (для UI: маска карты, срок действия).
 */
export interface PaymentMethodRow {
  id: string;
  user_id: string;
  provider: string;
  external_id: string;
  card_first6: string | null;
  card_last4: string | null;
  card_expiry_month: number | null;
  card_expiry_year: number | null;
  is_active: boolean;
  saved_at: string;
  // v0.9.35-dev.6.10.1: тип метода (СБП/ЮMoney/карта и т.п.), чтобы UI
  // не показывал «Карта ••••» для СБП без номера карты.
  method_type: string | null;
  card_type: string | null;
}

/**
 * Загружает активные payment_methods текущего юзера (RLS отсекает чужие).
 */
export async function fetchActivePaymentMethods(
  userId: string,
): Promise<PaymentMethodRow[]> {
  const { data, error } = await supabase
    .from('payment_methods')
    .select('id, user_id, provider, external_id, card_first6, card_last4, card_expiry_month, card_expiry_year, is_active, saved_at, method_type, card_type')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('saved_at', { ascending: false });

  if (error) {
    logger.warn('[entitlements] fetchActivePaymentMethods failed:', error.message);
    return [];
  }
  return (data ?? []) as PaymentMethodRow[];
}

// ─── change-plan (monthly → annual upgrade) ─────────────────────────────────

/**
 * v0.9.35-dev.6.6 — Upgrade monthly → annual.
 * Вызывает Edge Function change-plan с JWT текущего пользователя.
 * Даунгрейд (annual → monthly) не поддерживается.
 *
 * Returns:
 *   { ok: true, new_valid_until, payment_id, confirmation_url? }
 *   { ok: false, error: string, code?: string }
 */
export async function changePlan(): Promise<
  | { ok: true; new_valid_until: string; payment_id: string; confirmation_url: string | null }
  | { ok: false; error: string; code?: string }
> {
  const { data: { session }, error: sessErr } = await supabase.auth.getSession();
  if (sessErr || !session) return { ok: false, error: sessErr?.message ?? 'Not authenticated' };

  // VITE_SUPABASE_URL имеет вид https://xxx.supabase.co (без /rest/v1 суффикса)
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/rest\/v1$/, '');

  try {
    const res = await fetch(
      `${supabaseUrl}/functions/v1/change-plan`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      }
    );
    const data = await res.json() as Record<string, unknown>;
    if (data.ok) {
      return {
        ok: true,
        new_valid_until: data.new_valid_until as string,
        payment_id: data.payment_id as string,
        confirmation_url: (data.confirmation_url as string | null) ?? null,
      };
    }
    return { ok: false, error: (data.error as string) ?? `HTTP ${res.status}`, code: data.code as string | undefined };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Debug / тесты ────────────────────────────────────────────────────────────

export const _internals = {
  ENTITLEMENT_CACHE_KEY,
  ADMIN_EMAILS,
  TRIAL_DAYS,
};
