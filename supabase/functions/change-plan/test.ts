// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.6 — Deno tests for change-plan Edge Function.
//
// Run:
//   deno test --allow-net --allow-env --allow-read supabase/functions/change-plan/test.ts

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { MockServer, withEnv, fakeUserJwt } from '../_shared/test_mock_server.ts'
import { handler } from './index.ts'

const USER_ID    = 'fc592c97-b640-4a49-8e94-10229733ec58'
const USER_EMAIL = 'lebedevdo.one@gmail.com'

const MONTHLY_UNTIL = new Date(Date.now() + 15 * 86_400_000).toISOString() // 15 дней — точно monthly

async function setup() {
  const server = await MockServer.start()

  server.on('GET', '/auth/v1/user', () => ({
    status: 200,
    body: { id: USER_ID, email: USER_EMAIL, aud: 'authenticated' },
  }))

  const restore = withEnv({
    SUPABASE_URL:              server.url,
    SUPABASE_ANON_KEY:         'fake-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
    YOOKASSA_SHOP_ID:          'test-shop-id',
    YOOKASSA_SECRET_KEY:       'test-secret',
    YOOKASSA_RETURN_URL_BASE:  'https://yourtaskflow.app',
  })

  return { server, restore }
}

function teardown(server: MockServer, restore: () => void) {
  restore()
  return server.stop()
}

// ─── Auth ─────────────────────────────────────────────────────────────────

Deno.test('change-plan: 405 on GET', async () => {
  const { server, restore } = await setup()
  try {
    const req = new Request(server.url + '/', { method: 'GET' })
    const res = await handler(req)
    assertEquals(res.status, 405)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('change-plan: 401 without JWT', async () => {
  const { server, restore } = await setup()
  try {
    const req = new Request(server.url + '/', { method: 'POST', body: '{}' })
    const res = await handler(req)
    assertEquals(res.status, 401)
  } finally {
    await teardown(server, restore)
  }
})

// ─── Business rules ────────────────────────────────────────────────────────

Deno.test('change-plan: 400 not a pro subscription', async () => {
  const { server, restore } = await setup()
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ plan: 'free', valid_until: null, auto_renew: false, payment_method_id: null, cancel_at_period_end: false }],
  }))
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeUserJwt(USER_ID)}` },
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 400)
    const body = await res.json()
    assert(body.error.includes('Pro subscription'))
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('change-plan: 400 already annual (daysLeft > 300)', async () => {
  const { server, restore } = await setup()
  const annualUntil = new Date(Date.now() + 350 * 86_400_000).toISOString()
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ plan: 'pro', valid_until: annualUntil, auto_renew: true, payment_method_id: 'pm-123', cancel_at_period_end: false }],
  }))
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeUserJwt(USER_ID)}` },
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 400)
    const body = await res.json()
    assert(body.error.includes('annual'))
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('change-plan: 400 no saved payment method', async () => {
  const { server, restore } = await setup()
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ plan: 'pro', valid_until: MONTHLY_UNTIL, auto_renew: false, payment_method_id: null, cancel_at_period_end: false }],
  }))
  // payment_methods пустой
  server.on('GET', '/rest/v1/payment_methods', () => ({ status: 200, body: [] }))
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeUserJwt(USER_ID)}` },
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 400)
    const body = await res.json()
    assertEquals(body.code, 'no_payment_method')
  } finally {
    await teardown(server, restore)
  }
})

// ─── Happy path ────────────────────────────────────────────────────────────

Deno.test('change-plan: 200 upgrade monthly→annual (payment succeeded)', async () => {
  const { server, restore } = await setup()
  const pm = { id: 'pm-uuid', external_id: 'yk-pm-123', card_last4: '4444', card_brand: 'Mir', title: 'Mir •••• 4444' }
  const paymentId = 'test-payment-id-' + Date.now()

  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ plan: 'pro', valid_until: MONTHLY_UNTIL, auto_renew: true, payment_method_id: pm.id, cancel_at_period_end: false }],
  }))
  server.on('GET', '/rest/v1/payment_methods', () => ({ status: 200, body: [pm] }))
  // ЮKassa mock: succeeded без 3DS
  server.on('POST', '/v3/payments', () => ({
    status: 201,
    body: {
      id: paymentId,
      status: 'succeeded',
      amount: { value: '2990.00', currency: 'RUB' },
      metadata: { user_id: USER_ID, tier: 'annual' },
    },
  }))
  server.on('PATCH', '/rest/v1/user_entitlements', () => ({ status: 204 }))
  server.on('POST', '/rest/v1/payment_events', () => ({ status: 201, body: {} }))

  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeUserJwt(USER_ID)}`,
      },
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)
    assertEquals(body.payment_id, paymentId)
    assertEquals(body.payment_status, 'succeeded')
    assertEquals(body.confirmation_url, null)

    // new_valid_until = MONTHLY_UNTIL + 365 дней
    const expectedUntil = new Date(new Date(MONTHLY_UNTIL).getTime() + 365 * 86_400_000)
    const actualUntil   = new Date(body.new_valid_until)
    // Разница < 60 секунд (допуск на timing)
    assert(Math.abs(expectedUntil.getTime() - actualUntil.getTime()) < 60_000)

    // PATCH должен был обновить entitlement
    const patchCall = server.findCall('PATCH', '/rest/v1/user_entitlements')
    assert(patchCall !== undefined, 'PATCH user_entitlements not called')
    const patchBody = JSON.parse(patchCall!.body)
    assertEquals(patchBody.last_payment_id, paymentId)
    assertEquals(patchBody.renewal_attempts_count, 0)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('change-plan: 402 when YooKassa declines', async () => {
  const { server, restore } = await setup()
  const pm = { id: 'pm-uuid', external_id: 'yk-pm-123', card_last4: '4444', card_brand: 'Mir', title: 'Mir •••• 4444' }

  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ plan: 'pro', valid_until: MONTHLY_UNTIL, auto_renew: true, payment_method_id: pm.id, cancel_at_period_end: false }],
  }))
  server.on('GET', '/rest/v1/payment_methods', () => ({ status: 200, body: [pm] }))
  // ЮKassa отказывает
  server.on('POST', '/v3/payments', () => ({
    status: 422,
    body: { type: 'error', code: 'invalid_request', description: 'Insufficient funds' },
  }))

  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeUserJwt(USER_ID)}`,
      },
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 402)
    const body = await res.json()
    assert(typeof body.error === 'string')
    assertEquals(body.yookassa_code, 'invalid_request')
  } finally {
    await teardown(server, restore)
  }
})
