// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// N10 — vitest для _shared/renewal-idempotency.ts (дедуп автопродления).

import { describe, it, expect } from 'vitest'
import { selectActiveRenewalPayment } from './renewal-idempotency.ts'

const UID = 'fc592c97-b640-4a49-8e94-10229733ec58'

describe('selectActiveRenewalPayment', () => {
  it('зависший (pending) платёж автопродления этого юзера → возвращаем (не создавать второй)', () => {
    const found = selectActiveRenewalPayment(
      [{ id: 'p1', status: 'pending', metadata: { user_id: UID, renewal: 'true' } }],
      UID,
    )
    expect(found?.id).toBe('p1')
  })

  it('уже succeeded (webhook ещё не дошёл) → возвращаем', () => {
    const found = selectActiveRenewalPayment(
      [{ id: 'p2', status: 'succeeded', metadata: { user_id: UID, renewal: 'true' } }],
      UID,
    )
    expect(found?.id).toBe('p2')
  })

  it('waiting_for_capture → возвращаем', () => {
    const found = selectActiveRenewalPayment(
      [{ id: 'p3', status: 'waiting_for_capture', metadata: { user_id: UID, renewal: '1' } }],
      UID,
    )
    expect(found?.id).toBe('p3')
  })

  it('только canceled платежи → null (можно пробовать снова)', () => {
    const found = selectActiveRenewalPayment(
      [{ id: 'p4', status: 'canceled', metadata: { user_id: UID, renewal: 'true' } }],
      UID,
    )
    expect(found).toBeNull()
  })

  it('активный платёж ДРУГОГО юзера → null', () => {
    const found = selectActiveRenewalPayment(
      [{ id: 'p5', status: 'pending', metadata: { user_id: 'other-uid', renewal: 'true' } }],
      UID,
    )
    expect(found).toBeNull()
  })

  it('не-renewal платёж (первичная покупка) → null', () => {
    const found = selectActiveRenewalPayment(
      [{ id: 'p6', status: 'pending', metadata: { user_id: UID } }],
      UID,
    )
    expect(found).toBeNull()
  })

  it('пустой список → null', () => {
    expect(selectActiveRenewalPayment([], UID)).toBeNull()
  })
})
