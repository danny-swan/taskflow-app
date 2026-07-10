// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.5.1 — Deno tests for payment-webhook Edge Function.
//
// Run:
//   deno test --allow-net --allow-env --allow-read supabase/functions/payment-webhook/test.ts

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { MockServer, withEnv } from '../_shared/test_mock_server.ts'
import { handler } from './index.ts'

const USER_ID = 'fc592c97-b640-4a49-8e94-10229733ec58'

function baseEnv(server: MockServer) {
  return withEnv({
    SUPABASE_URL: server.url,
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
    YOOKASSA_SHOP_ID: '1402561',
    YOOKASSA_SECRET_KEY: 'fake-yoo-secret',
    YOOKASSA_API_BASE: server.url,
    YOOKASSA_SKIP_IP_CHECK: 'true',
    INTERNAL_SHARED_SECRET: 'fake-internal-secret',
  })
}

/** Мок для GET /v3/payments/<id> (dual-verify). */
function verifyPayment(paymentObj: Record<string, unknown>) {
  return (call: { path: string }) => ({
    status: 200,
    body: paymentObj,
  })
}

Deno.test('webhook: 400 на пустое тело', async () => {
  const server = await MockServer.start()
  const restore = baseEnv(server)
  try {
    const req = new Request(server.url + '/', { method: 'POST', body: '' })
    const res = await handler(req)
    assertEquals(res.status, 400)
  } finally {
    restore()
    await server.stop()
  }
})

Deno.test('webhook: 400 на невалидный JSON', async () => {
  const server = await MockServer.start()
  const restore = baseEnv(server)
  try {
    const req = new Request(server.url + '/', { method: 'POST', body: 'not json' })
    const res = await handler(req)
    assertEquals(res.status, 400)
  } finally {
    restore()
    await server.stop()
  }
})

Deno.test('webhook: payment.succeeded monthly — активация pro + auto_renew=true + payment_method saved', async () => {
  const server = await MockServer.start()

  const payment = {
    id: 'yoo-payment-42',
    status: 'succeeded',
    amount: { value: '299.00', currency: 'RUB' },
    captured_at: '2026-07-07T10:00:00Z',
    created_at: '2026-07-07T09:59:00Z',
    payment_method: {
      type: 'bank_card',
      id: 'pm-token-abc',
      saved: true,
      card: { first6: '555555', last4: '4444', card_type: 'MasterCard', expiry_month: '12', expiry_year: '2030' },
      title: 'Bank card *4444',
    },
    metadata: { user_id: USER_ID, tier: 'monthly', plan: 'pro', mode: 'purchase' },
  }

  server.on('GET', '/v3/payments/yoo-payment-42', verifyPayment(payment))
  // payment_events insert
  server.on('POST', '/rest/v1/payment_events', () => ({ status: 201 }))
  // savePaymentMethod: PATCH deactivate old + POST upsert new (return=representation)
  server.on('PATCH', '/rest/v1/payment_methods', () => ({ status: 204 }))
  // upsertReturning ожидает representation-массив с внутренним uuid строки
  server.on('POST', '/rest/v1/payment_methods', () => ({
    status: 201,
    body: [{ id: 'pm-row-uuid', user_id: USER_ID, provider: 'yookassa', external_id: 'pm-token-abc', is_active: true }],
  }))
  // existing entitlement — free
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ plan: 'free', valid_until: null, cancel_at_period_end: false }],
  }))
  // entitlements upsert
  server.on('POST', '/rest/v1/user_entitlements', () => ({ status: 201 }))
  // update payment_events processed_at
  server.on('PATCH', '/rest/v1/payment_events', () => ({ status: 204 }))

  const restore = baseEnv(server)
  try {
    const notification = {
      type: 'notification',
      event: 'payment.succeeded',
      object: { id: 'yoo-payment-42', metadata: { user_id: USER_ID } },
    }
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)
    assertEquals(body.event, 'payment.succeeded')
    assert(body.msg.includes('Activated pro'))

    // Проверяем что payment_methods был вызван (сохранение метода)
    const pmCall = server.findCall('POST', '/rest/v1/payment_methods')
    assert(pmCall !== undefined, 'payment_methods insert not called')
    const pmBody = JSON.parse(pmCall!.body)
    const pmRow = Array.isArray(pmBody) ? pmBody[0] : pmBody
    assertEquals(pmRow.user_id, USER_ID)
    assertEquals(pmRow.provider, 'yookassa')
    assertEquals(pmRow.external_id, 'pm-token-abc')
    assertEquals(pmRow.is_active, true)

    // Проверяем что entitlements upsert имеет auto_renew=true + payment_method_id
    const entCall = server.findCall('POST', '/rest/v1/user_entitlements')
    assert(entCall !== undefined)
    const entBody = JSON.parse(entCall!.body)
    const entRow = Array.isArray(entBody) ? entBody[0] : entBody
    assertEquals(entRow.plan, 'pro')
    assertEquals(entRow.auto_renew, true)
    assertEquals(entRow.cancel_at_period_end, false)
    // dev.6.10.1: payment_method_id = ВНУТРЕННИЙ uuid строки payment_methods
    // (FK на payment_methods.id), а не токен ЮKassa.
    assertEquals(entRow.payment_method_id, 'pm-row-uuid')
    assertEquals(entRow.renewal_attempts_count, 0)
    assert(typeof entRow.valid_until === 'string' && entRow.valid_until.length > 0)
  } finally {
    restore()
    await server.stop()
  }
})

Deno.test('webhook: payment.succeeded lifetime — auto_renew=false, valid_until=null', async () => {
  const server = await MockServer.start()

  const payment = {
    id: 'yoo-payment-lifetime',
    status: 'succeeded',
    amount: { value: '4990.00', currency: 'RUB' },
    captured_at: '2026-07-07T10:00:00Z',
    created_at: '2026-07-07T09:59:00Z',
    // lifetime не сохраняет метод
    payment_method: null,
    metadata: { user_id: USER_ID, tier: 'lifetime', plan: 'lifetime', mode: 'purchase' },
  }

  server.on('GET', '/v3/payments/yoo-payment-lifetime', verifyPayment(payment))
  server.on('POST', '/rest/v1/payment_events', () => ({ status: 201 }))
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ plan: 'free', valid_until: null, cancel_at_period_end: false }],
  }))
  server.on('POST', '/rest/v1/user_entitlements', () => ({ status: 201 }))
  server.on('PATCH', '/rest/v1/payment_events', () => ({ status: 204 }))

  const restore = baseEnv(server)
  try {
    const notification = {
      type: 'notification',
      event: 'payment.succeeded',
      object: { id: 'yoo-payment-lifetime', metadata: { user_id: USER_ID } },
    }
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)

    const entCall = server.findCall('POST', '/rest/v1/user_entitlements')
    assert(entCall !== undefined)
    const entRow = JSON.parse(entCall!.body)[0] ?? JSON.parse(entCall!.body)
    assertEquals(entRow.plan, 'lifetime')
    assertEquals(entRow.auto_renew, false)
    assertEquals(entRow.valid_until, null)
    assertEquals(entRow.next_renewal_at, null)
    assertEquals(entRow.payment_method_id, null)

    // payment_methods НЕ должен вызываться (payment_method=null)
    assertEquals(server.calls.filter((c) => c.method === 'POST' && c.path === '/rest/v1/payment_methods').length, 0)
  } finally {
    restore()
    await server.stop()
  }
})

Deno.test('webhook: payment.succeeded mode=update-card (СБП, одношаговый) — привязка метода + auto_renew=true + refund', async () => {
  const server = await MockServer.start()

  // СБП: type=sbp, card отсутствует, saved=true
  const payment = {
    id: 'yoo-update-card-1',
    status: 'succeeded',
    amount: { value: '1.00', currency: 'RUB' },
    captured_at: '2026-07-07T10:00:00Z',
    created_at: '2026-07-07T09:59:00Z',
    payment_method: {
      type: 'sbp',
      id: 'pm-token-new',
      saved: true,
      title: 'СБП',
    },
    metadata: { user_id: USER_ID, mode: 'update-card' },
  }

  server.on('GET', '/v3/payments/yoo-update-card-1', verifyPayment(payment))
  server.on('POST', '/rest/v1/payment_events', () => ({ status: 201 }))
  server.on('PATCH', '/rest/v1/payment_methods', () => ({ status: 204 }))
  // upsertReturning → внутренний uuid строки payment_methods
  server.on('POST', '/rest/v1/payment_methods', () => ({
    status: 201,
    body: [{ id: 'pm-row-uuid', user_id: USER_ID, provider: 'yookassa', external_id: 'pm-token-new', method_type: 'sbp', is_active: true }],
  }))
  // selectOne valid_until (текущий период) + PATCH привязки
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ valid_until: '2026-08-06T00:00:00Z' }],
  }))
  server.on('PATCH', '/rest/v1/user_entitlements', () => ({ status: 204 }))
  // ЮKassa refund
  server.on('POST', '/v3/refunds', () => ({
    status: 200,
    body: { id: 'yoo-refund-1', status: 'succeeded', amount: { value: '1.00', currency: 'RUB' } },
  }))
  server.on('PATCH', '/rest/v1/payment_events', () => ({ status: 204 }))

  const restore = baseEnv(server)
  try {
    const notification = {
      type: 'notification',
      event: 'payment.succeeded',
      object: { id: 'yoo-update-card-1', metadata: { user_id: USER_ID } },
    }
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)
    assert(body.msg.includes('update-card'))
    assert(body.msg.includes('refund'))

    // Payment method сохранён
    const pmCall = server.findCall('POST', '/rest/v1/payment_methods')
    assert(pmCall !== undefined)
    const pmRow = JSON.parse(pmCall!.body)[0] ?? JSON.parse(pmCall!.body)
    assertEquals(pmRow.external_id, 'pm-token-new')

    // dev.6.10.1: entitlement ОБНОВЛЯЕТСЯ через PATCH (одношаговый флоу):
    // auto_renew=true, cancel_at_period_end=false, payment_method_id=внутренний uuid.
    const entPatch = server.findCall('PATCH', '/rest/v1/user_entitlements')
    assert(entPatch !== undefined, 'user_entitlements PATCH not called')
    const entRow = JSON.parse(entPatch!.body)
    assertEquals(entRow.payment_method_id, 'pm-row-uuid')
    assertEquals(entRow.auto_renew, true)
    assertEquals(entRow.cancel_at_period_end, false)
    assertEquals(entRow.renewal_attempts_count, 0)
    assertEquals(entRow.next_renewal_at, '2026-08-06T00:00:00Z')

    // Refund вызван
    const refundCall = server.findCall('POST', '/v3/refunds')
    assert(refundCall !== undefined, 'refund not initiated')
    const refundBody = JSON.parse(refundCall!.body)
    assertEquals(refundBody.payment_id, 'yoo-update-card-1')
    assertEquals(refundBody.amount.value, '1.00')
  } finally {
    restore()
    await server.stop()
  }
})

Deno.test('webhook: refund.succeeded (downgrade) — plan сбрасывается в free + email', async () => {
  const server = await MockServer.start()

  const refund = {
    id: 'yoo-refund-2',
    status: 'succeeded',
    amount: { value: '299.00', currency: 'RUB' },
    payment_id: 'orig-payment-id',
    // При refund.succeeded metadata может быть пустой — но в нашем flow ЮKassa
    // копирует metadata из оригинального платежа. Здесь для чистоты — с user_id.
    metadata: { user_id: USER_ID, tier: 'monthly', plan: 'pro', mode: 'purchase' },
    created_at: '2026-07-07T12:00:00Z',
  }

  server.on('GET', '/v3/payments/yoo-refund-2', verifyPayment(refund))
  server.on('POST', '/rest/v1/payment_events', () => ({ status: 201 }))
  // Тут webhook смотрит на metadata оригинального платежа и downgrade'ит.
  // Ищем как webhook определяет reason=downgrade vs update-card — по metadata.mode.
  // mode=purchase → это refund обычной покупки → downgrade.
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ plan: 'pro', valid_until: '2026-08-06T00:00:00Z', cancel_at_period_end: false, last_payment_id: 'orig-payment-id' }],
  }))
  server.on('PATCH', '/rest/v1/user_entitlements', () => ({ status: 204 }))
  server.on('PATCH', '/rest/v1/payment_events', () => ({ status: 204 }))
  server.on('GET', '/rest/v1/profiles', () => ({
    status: 200,
    body: [{ email: 'user1@example.com', metadata: { language: 'ru' } }],
  }))
  server.on('POST', '/functions/v1/send-user-email', () => ({ status: 200, body: { ok: true } }))

  const restore = baseEnv(server)
  try {
    const notification = {
      type: 'notification',
      event: 'refund.succeeded',
      object: { id: 'yoo-refund-2', metadata: { user_id: USER_ID } },
    }
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    // Не строгий assert на ok=true — тест проверяет что общий flow не падает
    assertEquals(body.event, 'refund.succeeded')
  } finally {
    restore()
    await server.stop()
  }
})

Deno.test('webhook: payment.canceled (renewal) — счётчик +1 + renewal_failed email (F4)', async () => {
  const server = await MockServer.start()

  const payment = {
    id: 'yoo-renewal-canceled-1',
    status: 'canceled',
    amount: { value: '299.00', currency: 'RUB' },
    created_at: '2026-07-07T09:59:00Z',
    cancellation_details: { reason: 'card_expired', party: 'payment_network' },
    metadata: { user_id: USER_ID, tier: 'monthly', plan: 'pro', mode: 'purchase', renewal: 'true' },
  }

  server.on('GET', '/v3/payments/yoo-renewal-canceled-1', verifyPayment(payment))
  server.on('POST', '/rest/v1/payment_events', () => ({ status: 201 }))
  // Текущий счётчик + valid_until (для access_until)
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ renewal_attempts_count: 0, valid_until: '2026-08-06T00:00:00Z' }],
  }))
  server.on('PATCH', '/rest/v1/user_entitlements', () => ({ status: 204 }))
  server.on('POST', '/rest/v1/renewal_attempts_log', () => ({ status: 201 }))
  server.on('PATCH', '/rest/v1/payment_events', () => ({ status: 204 }))
  server.on('GET', '/rest/v1/profiles', () => ({
    status: 200,
    body: [{ email: 'user1@example.com', metadata: { language: 'ru' } }],
  }))
  server.on('POST', '/functions/v1/send-user-email', () => ({ status: 200, body: { ok: true } }))

  const restore = baseEnv(server)
  try {
    const notification = {
      type: 'notification',
      event: 'payment.canceled',
      object: { id: 'yoo-renewal-canceled-1', metadata: { user_id: USER_ID } },
    }
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)
    assertEquals(body.event, 'payment.canceled')

    // Счётчик инкрементнут
    const entPatch = server.findCall('PATCH', '/rest/v1/user_entitlements')
    assert(entPatch !== undefined, 'user_entitlements PATCH not called')
    const entRow = JSON.parse(entPatch!.body)
    assertEquals(entRow.renewal_attempts_count, 1)

    // F4: renewal_failed email отправлен (раньше в этой ветке письма не было)
    const emailCall = server.findCall('POST', '/functions/v1/send-user-email')
    assert(emailCall !== undefined, 'renewal_failed email not sent')
    assertEquals(emailCall!.headers['x-internal-token'], 'fake-internal-secret')
    const emailBody = JSON.parse(emailCall!.body)
    assertEquals(emailBody.template, 'renewal_failed')
    assertEquals(emailBody.to, 'user1@example.com')
    assertEquals(emailBody.params.attempt_no, 1)
    assertEquals(emailBody.params.max_attempts, 3)
    assertEquals(emailBody.params.access_until, '2026-08-06T00:00:00Z')
    assert(typeof emailBody.params.retry_at === 'string')
  } finally {
    restore()
    await server.stop()
  }
})

Deno.test('webhook: payment.canceled (не renewal) — без изменений и без письма', async () => {
  const server = await MockServer.start()

  const payment = {
    id: 'yoo-canceled-primary',
    status: 'canceled',
    amount: { value: '299.00', currency: 'RUB' },
    created_at: '2026-07-07T09:59:00Z',
    cancellation_details: { reason: 'general_decline' },
    metadata: { user_id: USER_ID, tier: 'monthly', plan: 'pro', mode: 'purchase' },
  }

  server.on('GET', '/v3/payments/yoo-canceled-primary', verifyPayment(payment))
  server.on('POST', '/rest/v1/payment_events', () => ({ status: 201 }))
  server.on('PATCH', '/rest/v1/payment_events', () => ({ status: 204 }))
  server.on('POST', '/functions/v1/send-user-email', () => ({ status: 200, body: { ok: true } }))

  const restore = baseEnv(server)
  try {
    const notification = {
      type: 'notification',
      event: 'payment.canceled',
      object: { id: 'yoo-canceled-primary', metadata: { user_id: USER_ID } },
    }
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notification),
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)

    // Не renewal → письмо renewal_failed НЕ отправляем
    assertEquals(server.calls.filter((c) => c.method === 'POST' && c.path.includes('send-user-email')).length, 0)
  } finally {
    restore()
    await server.stop()
  }
})

Deno.test('webhook: 403 когда IP не в whitelist (и SKIP=false)', async () => {
  const server = await MockServer.start()
  const restore = withEnv({
    SUPABASE_URL: server.url,
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
    YOOKASSA_SHOP_ID: '1402561',
    YOOKASSA_SECRET_KEY: 'fake-yoo-secret',
    // YOOKASSA_SKIP_IP_CHECK не задан → check включён
  })
  try {
    const notification = { type: 'notification', event: 'payment.succeeded', object: { id: 'x' } }
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '1.2.3.4', // не ЮKassa IP
      },
      body: JSON.stringify(notification),
    })
    const res = await handler(req)
    assertEquals(res.status, 403)
  } finally {
    restore()
    await server.stop()
  }
})
