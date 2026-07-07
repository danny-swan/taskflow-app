// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.5.1 — Deno tests for create-payment Edge Function.
//
// Run:
//   deno test --allow-net --allow-env --allow-read supabase/functions/create-payment/test.ts

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { MockServer, withEnv, fakeUserJwt } from '../_shared/test_mock_server.ts'
import { handler } from './index.ts'

const USER_ID = 'fc592c97-b640-4a49-8e94-10229733ec58'
const USER_EMAIL = 'daniil@example.com'

async function setup() {
  const server = await MockServer.start()
  server.on('GET', '/auth/v1/user', () => ({
    status: 200,
    body: { id: USER_ID, email: USER_EMAIL, aud: 'authenticated' },
  }))
  // ЮKassa mock: POST /v3/payments → 200 + confirmation.confirmation_url
  server.on('POST', '/v3/payments', (call) => {
    const req = JSON.parse(call.body)
    return {
      status: 200,
      body: {
        id: 'mock-payment-id-42',
        status: 'pending',
        amount: req.amount,
        confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru/checkout/mock' },
      },
    }
  })

  const restore = withEnv({
    SUPABASE_URL: server.url,
    SUPABASE_ANON_KEY: 'fake-anon-key',
    YOOKASSA_SHOP_ID: '1402561',
    YOOKASSA_SECRET_KEY: 'fake-yoo-secret',
    YOOKASSA_RETURN_URL_BASE: 'https://yourtaskflow.app',
    YOOKASSA_API_BASE: server.url,
  })
  return { server, restore }
}

async function teardown(server: MockServer, restore: () => void) {
  restore()
  await server.stop()
}

Deno.test('create-payment: 401 без JWT', async () => {
  const { server, restore } = await setup()
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      body: JSON.stringify({ tier: 'monthly' }),
    })
    const res = await handler(req)
    assertEquals(res.status, 401)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('create-payment: 400 invalid tier', async () => {
  const { server, restore } = await setup()
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeUserJwt(USER_ID)}` },
      body: JSON.stringify({ tier: 'lolwut' }),
    })
    const res = await handler(req)
    assertEquals(res.status, 400)
    const body = await res.json()
    assert(body.error.includes('Invalid tier'))
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('create-payment: happy path monthly — save_payment_method=true', async () => {
  const { server, restore } = await setup()
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeUserJwt(USER_ID)}` },
      body: JSON.stringify({ tier: 'monthly' }),
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)
    assertEquals(body.mode, 'purchase')
    assertEquals(body.tier, 'monthly')
    assertEquals(body.amount, '299.00')
    assertEquals(body.save_payment_method, true)
    assertEquals(body.confirmation_url, 'https://yoomoney.ru/checkout/mock')

    // Проверяем payload который ушёл в ЮKassa
    const yooCall = server.findCall('POST', '/v3/payments')
    assert(yooCall !== undefined)
    const yooBody = JSON.parse(yooCall!.body)
    assertEquals(yooBody.amount.value, '299.00')
    assertEquals(yooBody.amount.currency, 'RUB')
    assertEquals(yooBody.save_payment_method, true)
    assertEquals(yooBody.merchant_customer_id, USER_ID)
    assertEquals(yooBody.metadata.user_id, USER_ID)
    assertEquals(yooBody.metadata.tier, 'monthly')
    assertEquals(yooBody.metadata.mode, 'purchase')
    assertEquals(yooBody.metadata.plan, 'pro')
    assertEquals(yooBody.receipt.tax_system_code, 6)
    assertEquals(yooBody.receipt.customer.email, USER_EMAIL)
    // Idempotence-Key заголовок
    assert(yooCall!.headers['idempotence-key']!.length > 10)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('create-payment: lifetime — save_payment_method НЕ добавляется', async () => {
  const { server, restore } = await setup()
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeUserJwt(USER_ID)}` },
      body: JSON.stringify({ tier: 'lifetime' }),
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.amount, '4990.00')
    assertEquals(body.save_payment_method, false)

    const yooCall = server.findCall('POST', '/v3/payments')
    const yooBody = JSON.parse(yooCall!.body)
    assertEquals(yooBody.save_payment_method, undefined)
    assertEquals(yooBody.merchant_customer_id, undefined)
    assertEquals(yooBody.metadata.plan, 'lifetime')
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('create-payment: update-card mode — 1₽ + save_payment_method=true', async () => {
  const { server, restore } = await setup()
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeUserJwt(USER_ID)}` },
      body: JSON.stringify({ mode: 'update-card' }),
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)
    assertEquals(body.mode, 'update-card')
    assertEquals(body.tier, null)
    assertEquals(body.amount, '1.00')
    assertEquals(body.save_payment_method, true)

    const yooCall = server.findCall('POST', '/v3/payments')
    const yooBody = JSON.parse(yooCall!.body)
    assertEquals(yooBody.amount.value, '1.00')
    assertEquals(yooBody.save_payment_method, true)
    assertEquals(yooBody.merchant_customer_id, USER_ID)
    assertEquals(yooBody.metadata.mode, 'update-card')
    // Для update-card в metadata НЕТ tier/plan
    assertEquals(yooBody.metadata.tier, undefined)
    assertEquals(yooBody.metadata.plan, undefined)
    // return_url ведёт на /settings?card=updated
    assert((yooBody.confirmation.return_url as string).includes('/settings?card=updated'))
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('create-payment: 502 когда ЮKassa возвращает ошибку', async () => {
  const server = await MockServer.start()
  server.on('GET', '/auth/v1/user', () => ({
    status: 200,
    body: { id: USER_ID, email: USER_EMAIL, aud: 'authenticated' },
  }))
  server.on('POST', '/v3/payments', () => ({
    status: 400,
    body: { code: 'invalid_request', description: 'Bad amount' },
  }))
  const restore = withEnv({
    SUPABASE_URL: server.url,
    SUPABASE_ANON_KEY: 'fake-anon-key',
    YOOKASSA_SHOP_ID: '1402561',
    YOOKASSA_SECRET_KEY: 'fake-yoo-secret',
    YOOKASSA_RETURN_URL_BASE: 'https://yourtaskflow.app',
    YOOKASSA_API_BASE: server.url,
  })
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeUserJwt(USER_ID)}` },
      body: JSON.stringify({ tier: 'annual' }),
    })
    const res = await handler(req)
    assertEquals(res.status, 502)
    const body = await res.json()
    assertEquals(body.code, 'invalid_request')
    assertEquals(body.description, 'Bad amount')
  } finally {
    await teardown(server, restore)
  }
})
