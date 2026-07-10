// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// N9 — vitest для _shared/pricing.ts (сверка суммы платежа с прайсом).

import { describe, it, expect } from 'vitest'
import { verifyPaymentAmount, TIER_PRICING, amountToKopecks } from './pricing.ts'

describe('verifyPaymentAmount — purchase', () => {
  it('правильная сумма monthly → ok', () => {
    const r = verifyPaymentAmount({ mode: 'purchase', tier: 'monthly', amount: { value: '299.00', currency: 'RUB' } })
    expect(r.ok).toBe(true)
    expect(r.expected).toEqual({ value: '299.00', currency: 'RUB' })
  })

  it('правильная сумма annual → ok', () => {
    const r = verifyPaymentAmount({ mode: 'purchase', tier: 'annual', amount: { value: '2990.00', currency: 'RUB' } })
    expect(r.ok).toBe(true)
  })

  it('lifetime правильная сумма → ok', () => {
    const r = verifyPaymentAmount({ mode: 'purchase', tier: 'lifetime', amount: { value: '4990.00', currency: 'RUB' } })
    expect(r.ok).toBe(true)
  })

  it('заниженная сумма → НЕ ok', () => {
    const r = verifyPaymentAmount({ mode: 'purchase', tier: 'monthly', amount: { value: '1.00', currency: 'RUB' } })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/amount mismatch/)
  })

  it('неверная валюта → НЕ ok', () => {
    const r = verifyPaymentAmount({ mode: 'purchase', tier: 'monthly', amount: { value: '299.00', currency: 'USD' } })
    expect(r.ok).toBe(false)
  })

  it('неизвестный tier → НЕ ok', () => {
    const r = verifyPaymentAmount({ mode: 'purchase', tier: 'weekly', amount: { value: '299.00', currency: 'RUB' } })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/unknown or missing tier/)
  })

  it('отсутствует amount → НЕ ok', () => {
    const r = verifyPaymentAmount({ mode: 'purchase', tier: 'monthly', amount: null })
    expect(r.ok).toBe(false)
  })

  it('эквивалентные форматы суммы (299 == 299.00 == 299.0) → ok', () => {
    for (const v of ['299', '299.0', '299.00']) {
      expect(verifyPaymentAmount({ mode: 'purchase', tier: 'monthly', amount: { value: v, currency: 'RUB' } }).ok).toBe(true)
    }
  })
})

describe('verifyPaymentAmount — update-card / trial (1 ₽)', () => {
  it('update-card 1.00 RUB → ok', () => {
    const r = verifyPaymentAmount({ mode: 'update-card', amount: { value: '1.00', currency: 'RUB' } })
    expect(r.ok).toBe(true)
    expect(r.expected).toEqual({ value: '1.00', currency: 'RUB' })
  })

  it('trial 1.00 RUB → ok', () => {
    expect(verifyPaymentAmount({ mode: 'trial', amount: { value: '1.00', currency: 'RUB' } }).ok).toBe(true)
  })

  it('update-card на сумму тарифа (299) → НЕ ok (не путаем с покупкой)', () => {
    const r = verifyPaymentAmount({ mode: 'update-card', amount: { value: '299.00', currency: 'RUB' } })
    expect(r.ok).toBe(false)
  })

  it('update-card не требует tier', () => {
    expect(verifyPaymentAmount({ mode: 'update-card', amount: { value: '1.00', currency: 'RUB' } }).ok).toBe(true)
  })
})

describe('amountToKopecks', () => {
  it('парсит и округляет', () => {
    expect(amountToKopecks('299.00')).toBe(29900)
    expect(amountToKopecks('1')).toBe(100)
    expect(amountToKopecks('bad')).toBeNull()
  })
})

describe('TIER_PRICING — контракт с create-payment', () => {
  it('содержит monthly/annual/lifetime с ожидаемыми суммами', () => {
    expect(TIER_PRICING.monthly.amount).toBe('299.00')
    expect(TIER_PRICING.annual.amount).toBe('2990.00')
    expect(TIER_PRICING.lifetime.amount).toBe('4990.00')
    expect(TIER_PRICING.lifetime.recurring).toBe(false)
    expect(TIER_PRICING.monthly.recurring).toBe(true)
  })
})
