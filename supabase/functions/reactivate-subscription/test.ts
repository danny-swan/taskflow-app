// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.5.1 — Deno tests for reactivate-subscription Edge Function.
//
// Run:
//   deno test --allow-net --allow-env --allow-read supabase/functions/reactivate-subscription/test.ts

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { MockServer, withEnv, fakeUserJwt } from '../_shared/test_mock_server.ts'
import { handler } from './index.ts'

const USER_ID = 'test-user-id'

async function setup() {
  const server = await MockServer.start()
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

Deno.test('reactivate: 401 без JWT', async () => {
  const { server, restore } = await setup()
  try {
    const req = new Request(server.url + '/', { method: 'POST', body: '{}' })
    const res = await handler(req)
    assertEquals(res.status, 401)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('reactivate: 400 если plan != pro', async () => {
  const { server, restore } = await setup()
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ plan: 'lifetime', valid_until: null, auto_renew: false, cancel_at_period_end: false, payment_method_id: null }],
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
    assert(body.error.includes("Cannot reactivate plan='lifetime'"))
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('reactivate: 400 если срок истёк', async () => {
  const { server, restore } = await setup()
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{
      plan: 'pro',
      valid_until: '2020-01-01T00:00:00Z', // прошлое
      auto_renew: false,
      cancel_at_period_end: true,
      payment_method_id: 'pm-uuid',
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
    assert(body.error.includes('expired'))
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('reactivate: 400 если нет payment_method_id', async () => {
  const { server, restore } = await setup()
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{
      plan: 'pro',
      valid_until: '2099-01-01T00:00:00Z',
      auto_renew: false,
      cancel_at_period_end: true,
      payment_method_id: null,
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
    assert(body.error.includes('No saved payment method'))
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('reactivate: happy path — переводит cancel_at_period_end в false', async () => {
  const { server, restore } = await setup()
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{
      plan: 'pro',
      valid_until: '2099-01-01T00:00:00Z',
      auto_renew: false,
      cancel_at_period_end: true,
      payment_method_id: 'pm-uuid-42',
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

    const patchCall = server.findCall('PATCH', '/rest/v1/user_entitlements')
    assert(patchCall !== undefined)
    const patchBody = JSON.parse(patchCall!.body)
    assertEquals(patchBody.cancel_at_period_end, false)
    assertEquals(patchBody.auto_renew, true)
    assertEquals(patchBody.next_renewal_at, '2099-01-01T00:00:00Z')
    assertEquals(patchBody.renewal_attempts_count, 0)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('reactivate: idempotent если уже активна', async () => {
  const { server, restore } = await setup()
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{
      plan: 'pro',
      valid_until: '2099-01-01T00:00:00Z',
      auto_renew: true,
      cancel_at_period_end: false,
      payment_method_id: 'pm-uuid-42',
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
    assertEquals(body.already_active, true)
    // Никакого PATCH
    assertEquals(server.calls.filter((c) => c.method === 'PATCH').length, 0)
  } finally {
    await teardown(server, restore)
  }
})
