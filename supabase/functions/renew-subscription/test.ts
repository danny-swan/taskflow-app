// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.5.1 — Deno tests for renew-subscription Edge Function.
//
// Run:
//   deno test --allow-net --allow-env --allow-read supabase/functions/renew-subscription/test.ts

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { MockServer, withEnv } from '../_shared/test_mock_server.ts'
import { handler } from './index.ts'

const USER_ID_1 = 'user-1-uuid'

function baseEnv(server: MockServer) {
  return withEnv({
    SUPABASE_URL: server.url,
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
    YOOKASSA_SHOP_ID: '1402561',
    YOOKASSA_SECRET_KEY: 'fake-yoo-secret',
    YOOKASSA_API_BASE: server.url,
    INTERNAL_SHARED_SECRET: 'fake-internal-secret',
    CRON_SHARED_SECRET: 'fake-cron-secret',
  })
}

const CRON_HEADERS = {
  Authorization: 'Bearer fake-service-role',
  'x-cron-secret': 'fake-cron-secret',
}

Deno.test('renew: no candidates → processed=0', async () => {
  const server = await MockServer.start()
  server.on('GET', '/rest/v1/user_entitlements', () => ({ status: 200, body: [] }))
  const restore = baseEnv(server)
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: CRON_HEADERS,
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)
    assertEquals(body.processed, 0)
  } finally {
    restore()
    await server.stop()
  }
})

Deno.test('renew: happy path — payment создан, last_renewal_attempt_at обновлён', async () => {
  const server = await MockServer.start()

  // Кандидат: 1 pro-юзер с активным payment_method
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{
      user_id: USER_ID_1,
      plan: 'pro',
      valid_until: '2026-07-01T00:00:00Z',
      tier_hint: 'payment_id=xxx, tier=monthly',
      // ВНУТРЕННИЙ uuid строки payment_methods (FK), НЕ токен ЮKassa.
      payment_method_id: 'pm-row-uuid',
      renewal_attempts_count: 0,
      last_renewal_attempt_at: null,
      last_payment_id: 'xxx',
    }],
  }))
  // Активный payment method: резолвится по id (uuid), в ЮKassa уходит external_id.
  server.on('GET', '/rest/v1/payment_methods', () => ({
    status: 200,
    body: [{ id: 'pm-row-uuid', external_id: 'yk-token-xyz', is_active: true, provider: 'yookassa' }],
  }))
  // Email из profiles
  server.on('GET', '/rest/v1/profiles', () => ({
    status: 200,
    body: [{ email: 'user1@example.com' }],
  }))
  // ЮKassa возвращает succeeded
  server.on('POST', '/v3/payments', () => ({
    status: 200,
    body: { id: 'new-payment-id', status: 'succeeded' },
  }))
  // PATCH last_renewal_attempt_at
  server.on('PATCH', '/rest/v1/user_entitlements', () => ({ status: 204 }))

  const restore = baseEnv(server)
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: CRON_HEADERS,
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.processed, 1)
    assertEquals(body.succeeded, 1)
    assertEquals(body.failed, 0)

    // ЮKassa вызвана с правильными полями
    const yooCall = server.findCall('POST', '/v3/payments')
    assert(yooCall !== undefined)
    const yooBody = JSON.parse(yooCall!.body)
    assertEquals(yooBody.amount.value, '299.00')
    // F1-регрессия: в ЮKassa должен уйти external_id (токен), а НЕ внутренний uuid.
    assertEquals(yooBody.payment_method_id, 'yk-token-xyz')
    assertEquals(yooBody.metadata.tier, 'monthly')

    // F1-регрессия: payment_methods резолвится по внутреннему id (uuid), не по external_id.
    const pmCall = server.findCall('GET', '/rest/v1/payment_methods')
    assert(pmCall !== undefined)
    assertEquals(pmCall!.query.get('id'), 'eq.pm-row-uuid')
    assertEquals(pmCall!.query.get('external_id'), null)
    assertEquals(yooBody.metadata.renewal, 'true')
    assertEquals(yooBody.metadata.attempt_no, '1')
    // Idempotence-Key — 64 hex-символа (SHA-256)
    const idem = yooCall!.headers['idempotence-key']
    assertEquals(idem!.length, 64)
    assert(/^[0-9a-f]+$/.test(idem!))

    // PATCH обновил last_renewal_attempt_at
    const patchCalls = server.calls.filter((c) => c.method === 'PATCH' && c.path.includes('user_entitlements'))
    assertEquals(patchCalls.length, 1)
    const patchBody = JSON.parse(patchCalls[0].body)
    assert(typeof patchBody.last_renewal_attempt_at === 'string')
  } finally {
    restore()
    await server.stop()
  }
})

Deno.test('renew: 3-я попытка → downgrade и renewal_failed email', async () => {
  const server = await MockServer.start()

  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{
      user_id: USER_ID_1,
      plan: 'pro',
      valid_until: '2026-07-01T00:00:00Z',
      tier_hint: 'payment_id=xxx, tier=monthly',
      payment_method_id: 'pm-row-uuid',
      renewal_attempts_count: 2, // третья попытка после этой = downgrade
      last_renewal_attempt_at: null,
      last_payment_id: 'xxx',
    }],
  }))
  server.on('GET', '/rest/v1/payment_methods', () => ({
    status: 200,
    body: [{ id: 'pm-row-uuid', external_id: 'yk-token-xyz', is_active: true, provider: 'yookassa' }],
  }))
  server.on('GET', '/rest/v1/profiles', (call) => {
    // Для email lookup
    if (call.query.get('select')?.includes('email')) {
      return { status: 200, body: [{ email: 'user1@example.com' }] }
    }
    // Для language lookup из metadata
    if (call.query.get('select')?.includes('metadata')) {
      return { status: 200, body: [{ metadata: { language: 'ru' } }] }
    }
    return { status: 200, body: [] }
  })
  // ЮKassa возвращает ошибку карты
  server.on('POST', '/v3/payments', () => ({
    status: 400,
    body: { code: 'card_expired', description: 'Card expired' },
  }))
  // renewal_attempts_log INSERT
  server.on('POST', '/rest/v1/renewal_attempts_log', () => ({ status: 201 }))
  // user_entitlements PATCH — 2 раза: инкремент + downgrade... нет, только 1 (downgrade)
  server.on('PATCH', '/rest/v1/user_entitlements', () => ({ status: 204 }))
  // send-user-email
  server.on('POST', '/functions/v1/send-user-email', () => ({ status: 200, body: { ok: true } }))

  const restore = baseEnv(server)
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: CRON_HEADERS,
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.processed, 1)
    assertEquals(body.failed, 1)
    assertEquals(body.downgraded, 1)

    // Downgrade PATCH — plan=free
    const patchCall = server.calls.find((c) => c.method === 'PATCH' && c.path.includes('user_entitlements'))
    assert(patchCall !== undefined)
    const patchBody = JSON.parse(patchCall!.body)
    assertEquals(patchBody.plan, 'free')
    assertEquals(patchBody.auto_renew, false)
    assertEquals(patchBody.valid_until, null)
    assertEquals(patchBody.payment_method_id, null)
    assertEquals(patchBody.renewal_attempts_count, 3)

    // Email отправлен
    const emailCall = server.findCall('POST', '/functions/v1/send-user-email')
    assert(emailCall !== undefined, 'send-user-email not called')
    assertEquals(emailCall!.headers['x-internal-token'], 'fake-internal-secret')
    const emailBody = JSON.parse(emailCall!.body)
    assertEquals(emailBody.template, 'renewal_failed')
    assertEquals(emailBody.to, 'user1@example.com')
    assertEquals(emailBody.params.attempt_no, 3)
    assertEquals(emailBody.params.max_attempts, 3)
    assertEquals(emailBody.params.retry_at, null) // isLastAttempt → null
  } finally {
    restore()
    await server.stop()
  }
})

Deno.test('renew: F5 — синхронный canceled НЕ шлёт письмо, НЕ инкрементит, НЕ логирует', async () => {
  const server = await MockServer.start()

  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{
      user_id: USER_ID_1,
      plan: 'pro',
      valid_until: '2026-07-01T00:00:00Z',
      tier_hint: 'payment_id=xxx, tier=monthly',
      payment_method_id: 'pm-row-uuid',
      renewal_attempts_count: 0,
      last_renewal_attempt_at: null,
      last_payment_id: 'xxx',
    }],
  }))
  server.on('GET', '/rest/v1/payment_methods', () => ({
    status: 200,
    body: [{ id: 'pm-row-uuid', external_id: 'yk-token-xyz', is_active: true, provider: 'yookassa' }],
  }))
  server.on('GET', '/rest/v1/profiles', () => ({
    status: 200,
    body: [{ email: 'user1@example.com' }],
  }))
  // ЮKassa синхронно вернула canceled в теле ответа (HTTP 200, status=canceled).
  server.on('POST', '/v3/payments', () => ({
    status: 200,
    body: {
      id: 'sync-canceled-payment-id',
      status: 'canceled',
      cancellation_details: { reason: 'card_expired', party: 'payment_network' },
    },
  }))
  // Разрешаем эндпоинты, чтобы отловить нежелательные вызовы (их быть НЕ должно).
  server.on('POST', '/rest/v1/renewal_attempts_log', () => ({ status: 201 }))
  server.on('POST', '/functions/v1/send-user-email', () => ({ status: 200, body: { ok: true } }))
  server.on('PATCH', '/rest/v1/user_entitlements', () => ({ status: 204 }))

  const restore = baseEnv(server)
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: CRON_HEADERS,
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.processed, 1)
    assertEquals(body.failed, 1)
    // F5: cron НЕ делает downgrade в синхронной canceled-ветке — это забота webhook'а.
    assertEquals(body.downgraded, 0)

    // F5: письмо renewal_failed из cron НЕ отправляется (его пошлёт webhook).
    assertEquals(
      server.calls.filter((c) => c.method === 'POST' && c.path.includes('/functions/v1/send-user-email')).length,
      0,
    )
    // F5: запись в renewal_attempts_log из cron НЕ делается (её сделает webhook).
    assertEquals(
      server.calls.filter((c) => c.method === 'POST' && c.path.includes('/rest/v1/renewal_attempts_log')).length,
      0,
    )

    // Единственный побочный эффект cron — PATCH last_renewal_attempt_at (без инкремента/downgrade).
    const patchCalls = server.calls.filter((c) => c.method === 'PATCH' && c.path.includes('user_entitlements'))
    assertEquals(patchCalls.length, 1)
    const patchBody = JSON.parse(patchCalls[0].body)
    assert(typeof patchBody.last_renewal_attempt_at === 'string')
    // Никакого инкремента счётчика и никакого downgrade в этом PATCH.
    assertEquals(patchBody.renewal_attempts_count, undefined)
    assertEquals(patchBody.plan, undefined)
  } finally {
    restore()
    await server.stop()
  }
})

Deno.test('renew: payment_method inactive → skip без ЮKassa-вызова', async () => {
  const server = await MockServer.start()

  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{
      user_id: USER_ID_1,
      plan: 'pro',
      valid_until: '2026-07-01T00:00:00Z',
      tier_hint: 'tier=monthly',
      payment_method_id: 'pm-inactive-uuid',
      renewal_attempts_count: 0,
      last_renewal_attempt_at: null,
      last_payment_id: null,
    }],
  }))
  server.on('GET', '/rest/v1/payment_methods', () => ({
    status: 200,
    body: [{ id: 'pm-inactive-uuid', external_id: 'yk-token-inactive', is_active: false, provider: 'yookassa' }],
  }))
  server.on('POST', '/rest/v1/renewal_attempts_log', () => ({ status: 201 }))
  server.on('PATCH', '/rest/v1/user_entitlements', () => ({ status: 204 }))

  const restore = baseEnv(server)
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: CRON_HEADERS,
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.processed, 1)
    assertEquals(body.failed, 1)

    // ЮKassa НЕ вызвана
    assertEquals(server.calls.filter((c) => c.method === 'POST' && c.path.includes('/v3/payments')).length, 0)

    // Log записан с error_code=payment_method_inactive
    const logCall = server.findCall('POST', '/rest/v1/renewal_attempts_log')
    assert(logCall !== undefined)
    const logBody = JSON.parse(logCall!.body)
    assertEquals(logBody[0].error_code, 'payment_method_inactive')
  } finally {
    restore()
    await server.stop()
  }
})

Deno.test('renew (N10): «зависший» succeeded-платёж в ЮKassa → второе списание НЕ создаётся', async () => {
  const server = await MockServer.start()

  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{
      user_id: USER_ID_1,
      plan: 'pro',
      valid_until: '2026-07-01T00:00:00Z',
      tier_hint: 'payment_id=xxx, tier=monthly',
      payment_method_id: 'pm-row-uuid',
      renewal_attempts_count: 0,
      last_renewal_attempt_at: null,
      last_payment_id: 'xxx',
    }],
  }))
  server.on('GET', '/rest/v1/payment_methods', () => ({
    status: 200,
    body: [{ id: 'pm-row-uuid', external_id: 'yk-token-xyz', is_active: true, provider: 'yookassa' }],
  }))
  server.on('GET', '/rest/v1/profiles', () => ({
    status: 200,
    body: [{ email: 'user1@example.com' }],
  }))
  // N10: предыдущий POST /v3/payments оборвался таймаутом — ответ не дошёл,
  // last_renewal_attempt_at не выставился, но у ЮKassa платёж УЖЕ succeeded.
  // GET /v3/payments отдаёт его → создавать второй нельзя.
  server.on('GET', '/v3/payments', () => ({
    status: 200,
    body: {
      items: [{
        id: 'hung-renewal-payment-id',
        status: 'succeeded',
        metadata: { user_id: USER_ID_1, renewal: 'true' },
      }],
    },
  }))
  // Разрешаем POST, чтобы отловить нежелательный второй charge (его быть НЕ должно).
  server.on('POST', '/v3/payments', () => ({
    status: 200,
    body: { id: 'SECOND-CHARGE-must-not-happen', status: 'succeeded' },
  }))
  server.on('PATCH', '/rest/v1/user_entitlements', () => ({ status: 204 }))

  const restore = baseEnv(server)
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: CRON_HEADERS,
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.processed, 1)
    assertEquals(body.succeeded, 1)
    assertEquals(body.failed, 0)

    // Ключевое: НИ ОДНОГО POST /v3/payments — второе списание не создано.
    assertEquals(server.calls.filter((c) => c.method === 'POST' && c.path.includes('/v3/payments')).length, 0)

    // Единственный побочный эффект — PATCH last_renewal_attempt_at (итог доведёт webhook).
    const patchCalls = server.calls.filter((c) => c.method === 'PATCH' && c.path.includes('user_entitlements'))
    assertEquals(patchCalls.length, 1)
    const patchBody = JSON.parse(patchCalls[0].body)
    assert(typeof patchBody.last_renewal_attempt_at === 'string')
    assertEquals(patchBody.renewal_attempts_count, undefined)
    assertEquals(patchBody.plan, undefined)
  } finally {
    restore()
    await server.stop()
  }
})
