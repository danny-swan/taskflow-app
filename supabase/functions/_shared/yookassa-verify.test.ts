// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// N8 — vitest для _shared/yookassa-verify.ts (dual-verify как источник истины).

import { describe, it, expect } from 'vitest'
import { assessVerifiedPayment } from './yookassa-verify.ts'

describe('assessVerifiedPayment — payment.succeeded', () => {
  it('реальный статус succeeded → принимаем', () => {
    expect(assessVerifiedPayment('payment.succeeded', { status: 'succeeded', paid: true }).ok).toBe(true)
  })

  it('поддельное succeeded, а реальный платёж pending → отклоняем', () => {
    const r = assessVerifiedPayment('payment.succeeded', { status: 'pending' })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/!= succeeded/)
  })

  it('реальный платёж canceled → отклоняем', () => {
    expect(assessVerifiedPayment('payment.succeeded', { status: 'canceled' }).ok).toBe(false)
  })

  it('статус succeeded, но paid=false → отклоняем', () => {
    expect(assessVerifiedPayment('payment.succeeded', { status: 'succeeded', paid: false }).ok).toBe(false)
  })

  it('нет статуса (платёж не найден у ЮKassa) → отклоняем', () => {
    expect(assessVerifiedPayment('payment.succeeded', {}).ok).toBe(false)
  })
})

describe('assessVerifiedPayment — payment.canceled', () => {
  it('реальный статус canceled → принимаем', () => {
    expect(assessVerifiedPayment('payment.canceled', { status: 'canceled' }).ok).toBe(true)
  })

  it('поддельное canceled по реально succeeded платежу → отклоняем', () => {
    expect(assessVerifiedPayment('payment.canceled', { status: 'succeeded' }).ok).toBe(false)
  })
})

describe('assessVerifiedPayment — прочие события', () => {
  it('refund.succeeded не ужесточаем (прежнее поведение)', () => {
    expect(assessVerifiedPayment('refund.succeeded', { status: 'succeeded' }).ok).toBe(true)
  })

  it('неподписанное событие пропускаем', () => {
    expect(assessVerifiedPayment('payment.waiting_for_capture', { status: 'waiting_for_capture' }).ok).toBe(true)
  })
})
