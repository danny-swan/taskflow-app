// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.5.2 — Deno tests for detach-payment-method Edge Function.
//
// Run:
//   deno test --allow-net --allow-env --allow-read supabase/functions/detach-payment-method/test.ts

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { MockServer, withEnv, fakeUserJwt } from '../_shared/test_mock_server.ts'
import { handler } from './index.ts'

const USER_ID = 'fc592c97-b640-4a49-8e94-10229733ec58'

async function setup() {
  const server = await MockServer.start()

  // Auth: getUser → 200 { id: USER_ID }
  server.on('GET', '/auth/v1/user', () => ({
    status: 200,
    body: { id: USER_ID, email: 'test@example.com', aud: 'authenticated' },
  }))

  const restore = withEnv({
    SUPABASE_URL: server.url,
    SUPABASE_ANON_KEY: 'fake-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
  })

  return { server, restore }
}

async function teardown(server: MockServer, restore: () => void) {
  restore()
  await server.stop()
}

Deno.test('detach-payment-method: 405 on GET', async () => {
  const { server, restore } = await setup()
  try {
    const req = new Request(server.url + '/', { method: 'GET' })
    const res = await handler(req)
    assertEquals(res.status, 405)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('detach-payment-method: 401 without Authorization header', async () => {
  const { server, restore } = await setup()
  try {
    const req = new Request(server.url + '/', { method: 'POST', body: '{}' })
    const res = await handler(req)
    assertEquals(res.status, 401)
    const body = await res.json()
    assert(body.error.includes('Authorization'))
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('detach-payment-method: happy path — deactivates card + clears entitlement', async () => {
  const { server, restore } = await setup()
  // Активная карта существует
  server.on('GET', '/rest/v1/payment_methods', () => ({
    status: 200,
    body: [{ id: '11111111-1111-1111-1111-111111111111' }],
  }))
  server.on('PATCH', '/rest/v1/payment_methods', () => ({ status: 204 }))
  server.on('PATCH', '/rest/v1/user_entitlements', () => ({ status: 204 }))
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeUserJwt(USER_ID)}` },
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)
    assertEquals(body.detached_count, 1)
    assert(typeof body.detached_at === 'string')
    assert(body.already_detached === undefined)

    // PATCH payment_methods: is_active=false, фильтр user_id + is_active=true
    const pmPatch = server.findCall('PATCH', '/rest/v1/payment_methods')
    assert(pmPatch !== undefined, 'payment_methods PATCH not found')
    assertEquals(pmPatch!.query.get('user_id'), `eq.${USER_ID}`)
    assertEquals(pmPatch!.query.get('is_active'), 'eq.true')
    const pmBody = JSON.parse(pmPatch!.body)
    assertEquals(pmBody.is_active, false)

    // PATCH user_entitlements: обнулили привязку
    const entPatch = server.findCall('PATCH', '/rest/v1/user_entitlements')
    assert(entPatch !== undefined, 'user_entitlements PATCH not found')
    assertEquals(entPatch!.query.get('user_id'), `eq.${USER_ID}`)
    const entBody = JSON.parse(entPatch!.body)
    assertEquals(entBody.payment_method_id, null)
    assertEquals(entBody.auto_renew, false)
    assertEquals(entBody.cancel_at_period_end, true)
    assert(typeof entBody.notes === 'string' && entBody.notes.includes('card detached by user'))
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('detach-payment-method: idempotent when no active card', async () => {
  const { server, restore } = await setup()
  // Нет активных карт
  server.on('GET', '/rest/v1/payment_methods', () => ({ status: 200, body: [] }))
  // entitlement всё равно чистим (best-effort)
  server.on('PATCH', '/rest/v1/user_entitlements', () => ({ status: 204 }))
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeUserJwt(USER_ID)}` },
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)
    assertEquals(body.already_detached, true)
    assertEquals(body.detached_count, 0)

    // НЕ должно быть PATCH к payment_methods (нечего деактивировать)
    assertEquals(server.calls.filter((c) => c.method === 'PATCH' && c.path.includes('payment_methods')).length, 0)
    // entitlement всё же чистим
    assert(server.findCall('PATCH', '/rest/v1/user_entitlements') !== undefined)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('detach-payment-method: 500 when payment_methods deactivation fails', async () => {
  const { server, restore } = await setup()
  server.on('GET', '/rest/v1/payment_methods', () => ({
    status: 200,
    body: [{ id: '11111111-1111-1111-1111-111111111111' }],
  }))
  server.on('PATCH', '/rest/v1/payment_methods', () => ({
    status: 400,
    body: { message: 'db error' },
  }))
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeUserJwt(USER_ID)}` },
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 500)
    const body = await res.json()
    assert(body.error.includes('deactivate'))
  } finally {
    await teardown(server, restore)
  }
})
