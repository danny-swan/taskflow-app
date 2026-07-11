// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.5.1 — Deno tests for cancel-subscription Edge Function.
//
// Run:
//   deno test --allow-net --allow-env --allow-read supabase/functions/cancel-subscription/test.ts

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

Deno.test('cancel-subscription: 405 on GET', async () => {
  const { server, restore } = await setup()
  try {
    const req = new Request(server.url + '/', { method: 'GET' })
    const res = await handler(req)
    assertEquals(res.status, 405)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('cancel-subscription: 401 without Authorization header', async () => {
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

Deno.test('cancel-subscription: 404 when no entitlement', async () => {
  const { server, restore } = await setup()
  server.on('GET', '/rest/v1/user_entitlements', () => ({ status: 200, body: [] }))
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeUserJwt(USER_ID)}` },
      body: '{}',
    })
    const res = await handler(req)
    assertEquals(res.status, 404)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('cancel-subscription: 400 for free plan', async () => {
  const { server, restore } = await setup()
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{
      plan: 'free',
      valid_until: null,
      auto_renew: false,
      cancel_at_period_end: false,
    }],
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
    assert(body.error.includes("Cannot cancel plan='free'"))
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('cancel-subscription: idempotent when already cancelled', async () => {
  const { server, restore } = await setup()
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{
      plan: 'pro',
      valid_until: '2026-08-06T00:00:00Z',
      auto_renew: false,
      cancel_at_period_end: true,
    }],
  }))
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
    assertEquals(body.already_cancelled, true)
    assertEquals(body.access_until, '2026-08-06T00:00:00Z')
    // Нет PATCH-запроса — только GET
    assertEquals(server.calls.filter((c) => c.method === 'PATCH').length, 0)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('cancel-subscription: happy path — sets cancel_at_period_end=true', async () => {
  const { server, restore } = await setup()
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{
      plan: 'pro',
      valid_until: '2026-08-06T00:00:00Z',
      auto_renew: true,
      cancel_at_period_end: false,
    }],
  }))
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
    assertEquals(body.plan, 'pro')
    assertEquals(body.access_until, '2026-08-06T00:00:00Z')

    // Проверяем что был PATCH с правильным телом
    const patchCall = server.findCall('PATCH', '/rest/v1/user_entitlements')
    assert(patchCall !== undefined, 'PATCH call not found')
    assert(patchCall!.query.get('user_id') === `eq.${USER_ID}`)
    const patchBody = JSON.parse(patchCall!.body)
    assertEquals(patchBody.cancel_at_period_end, true)
    assertEquals(patchBody.auto_renew, false)
    assert(typeof patchBody.notes === 'string' && patchBody.notes.includes('cancelled by user'))
  } finally {
    await teardown(server, restore)
  }
})
