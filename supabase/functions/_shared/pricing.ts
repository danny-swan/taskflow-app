// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// _shared/pricing.ts — ЕДИНЫЙ серверный источник истины по ценам подписки.
//
// Раньше прайс был продублирован (create-payment TIERS, renew-subscription
// TIER_AMOUNTS, payment-webhook TIER_TO_DAYS, фронт). Дублирование чисел —
// источник рассинхрона (см. аудит, п.12). Этот модуль держит money-critical
// поля (сумма/валюта/дни/план/recurring) в одном месте; функции импортируют
// его. Локальными в функциях остаются только человекочитаемые description
// (они различаются по контексту: «Подписка …» vs «Продление …»).
//
// Модуль намеренно НЕ имеет внешних/Deno-зависимостей — чтобы его можно было
// покрыть обычным vitest (см. pricing.test.ts) без Deno-рантайма.

export type Tier = 'monthly' | 'annual' | 'lifetime'
export type PaymentMode = 'purchase' | 'update-card' | 'trial'

export interface TierSpec {
  amount: string
  currency: string
  days: number | null
  plan: 'pro' | 'lifetime'
  recurring: boolean
}

// Значения ДОЛЖНЫ совпадать с оффертой (yourtaskflow.app/legal/offer.html)
// и с ценами на фронте (/checkout).
export const TIER_PRICING: Record<Tier, TierSpec> = {
  monthly: { amount: '299.00', currency: 'RUB', days: 30, plan: 'pro', recurring: true },
  annual: { amount: '2990.00', currency: 'RUB', days: 365, plan: 'pro', recurring: true },
  lifetime: { amount: '4990.00', currency: 'RUB', days: null, plan: 'lifetime', recurring: false },
}

// 1 ₽ — верификационное списание для привязки карты (mode=update-card) и trial.
// Совпадает с UPDATE_CARD_SPEC в create-payment.
export const VERIFICATION_AMOUNT = { value: '1.00', currency: 'RUB' } as const

export function isTier(v: unknown): v is Tier {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(TIER_PRICING, v)
}

// Сравнение денежных сумм в копейках — устойчиво к '299' vs '299.00' vs '299.0'.
export function amountToKopecks(value: string): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export interface AmountCheckInput {
  mode: PaymentMode
  tier?: string | null
  amount?: { value?: string | null; currency?: string | null } | null
}

export interface AmountCheckResult {
  ok: boolean
  expected: { value: string; currency: string } | null
  reason?: string
}

/**
 * N9: сверяет фактическую сумму+валюту платежа против ожидаемой серверной цены.
 *
 *  - purchase          → цена соответствующего tier из TIER_PRICING
 *  - update-card/trial → верификационные 1 ₽ (VERIFICATION_AMOUNT)
 *
 * Возвращает ok=false при отсутствии/несовпадении суммы либо неизвестном tier.
 * Вызывающий обязан НЕ выдавать entitlement при ok=false.
 */
export function verifyPaymentAmount(input: AmountCheckInput): AmountCheckResult {
  const value = input.amount?.value ?? null
  const currency = input.amount?.currency ?? null

  let expected: { value: string; currency: string }
  if (input.mode === 'update-card' || input.mode === 'trial') {
    expected = { value: VERIFICATION_AMOUNT.value, currency: VERIFICATION_AMOUNT.currency }
  } else {
    if (!isTier(input.tier)) {
      return { ok: false, expected: null, reason: `unknown or missing tier: ${String(input.tier)}` }
    }
    const spec = TIER_PRICING[input.tier]
    expected = { value: spec.amount, currency: spec.currency }
  }

  if (!value || !currency) {
    return { ok: false, expected, reason: 'payment amount/currency missing' }
  }

  const gotKop = amountToKopecks(value)
  const expKop = amountToKopecks(expected.value)
  const amountOk = gotKop !== null && expKop !== null && gotKop === expKop
  const currencyOk = currency === expected.currency

  if (!amountOk || !currencyOk) {
    return {
      ok: false,
      expected,
      reason: `amount mismatch: got ${value} ${currency}, expected ${expected.value} ${expected.currency}`,
    }
  }
  return { ok: true, expected }
}
