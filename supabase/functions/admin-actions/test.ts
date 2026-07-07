// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.6 — Deno tests for admin-actions Edge Function.
//
// Run:
//   deno test --allow-net --allow-env --allow-read supabase/functions/admin-actions/test.ts

import { assertEquals, assert } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { MockServer, withEnv, fakeUserJwt } from '../_shared/test_mock_server.ts'
import { handler } from './index.ts'

const ADMIN_ID     = 'fc592c97-b640-4a49-8e94-10229733ec58'
const ADMIN_EMAIL  = 'lebedevdo.one@gmail.com'
const TARGET_ID    = '9ef5d96b-9055-4db1-b3c5-c6effc6f0cce'

async function setupAdmin() {
  const server = await MockServer.start()

  // Auth: getUser → admin
  server.on('GET', '/auth/v1/user', () => ({
    status: 200,
    body: { id: ADMIN_ID, email: ADMIN_EMAIL, aud: 'authenticated' },
  }))

  const restore = withEnv({
    SUPABASE_URL:              server.url,
    SUPABASE_ANON_KEY:         'fake-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
    ADMIN_EMAILS:              ADMIN_EMAIL,
  })

  return { server, restore }
}

async function setupNonAdmin() {
  const server = await MockServer.start()

  server.on('GET', '/auth/v1/user', () => ({
    status: 200,
    body: { id: TARGET_ID, email: 'user@example.com', aud: 'authenticated' },
  }))
  // Non-admin entitlement: source = 'yookassa'
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ source: 'yookassa', plan: 'pro' }],
  }))

  const restore = withEnv({
    SUPABASE_URL:              server.url,
    SUPABASE_ANON_KEY:         'fake-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
    ADMIN_EMAILS:              '',
  })

  return { server, restore }
}

function teardown(server: MockServer, restore: () => void) {
  restore()
  return server.stop()
}

// ─── Auth / guard tests ────────────────────────────────────────────────────

Deno.test('admin-actions: 405 on GET', async () => {
  const { server, restore } = await setupAdmin()
  try {
    const req = new Request(server.url + '/', { method: 'GET' })
    const res = await handler(req)
    assertEquals(res.status, 405)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('admin-actions: 401 without JWT', async () => {
  const { server, restore } = await setupAdmin()
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set-plan' }),
    })
    const res = await handler(req)
    assertEquals(res.status, 401)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('admin-actions: 403 for non-admin user', async () => {
  const { server, restore } = await setupNonAdmin()
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeUserJwt(TARGET_ID)}`,
      },
      body: JSON.stringify({ action: 'set-plan', target_user_id: TARGET_ID, plan: 'pro' }),
    })
    const res = await handler(req)
    assertEquals(res.status, 403)
    const body = await res.json()
    assert(body.error.includes('Forbidden'))
  } finally {
    await teardown(server, restore)
  }
})

// ─── set-plan tests ────────────────────────────────────────────────────────

Deno.test('admin-actions/set-plan: 400 missing target_user_id', async () => {
  const { server, restore } = await setupAdmin()
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeUserJwt(ADMIN_ID)}`,
      },
      body: JSON.stringify({ action: 'set-plan', plan: 'pro' }),
    })
    const res = await handler(req)
    assertEquals(res.status, 400)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('admin-actions/set-plan: 400 invalid plan', async () => {
  const { server, restore } = await setupAdmin()
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeUserJwt(ADMIN_ID)}`,
      },
      body: JSON.stringify({ action: 'set-plan', target_user_id: TARGET_ID, plan: 'vip' }),
    })
    const res = await handler(req)
    assertEquals(res.status, 400)
    const body = await res.json()
    assert(body.error.includes('Invalid plan'))
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('admin-actions/set-plan: 400 pro without valid_until', async () => {
  const { server, restore } = await setupAdmin()
  server.on('GET', '/auth/v1/admin/users', () => ({
    status: 200,
    body: { id: TARGET_ID, email: 'target@example.com' },
  }))
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeUserJwt(ADMIN_ID)}`,
      },
      body: JSON.stringify({ action: 'set-plan', target_user_id: TARGET_ID, plan: 'pro' }),
    })
    const res = await handler(req)
    assertEquals(res.status, 400)
    const body = await res.json()
    assert(body.error.includes('valid_until'))
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('admin-actions/set-plan: 200 lifetime (no valid_until)', async () => {
  const { server, restore } = await setupAdmin()
  server.on('GET', '/auth/v1/admin/users', () => ({
    status: 200,
    body: { user: { id: TARGET_ID, email: 'target@example.com' } },
  }))
  server.on('POST', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ user_id: TARGET_ID, plan: 'lifetime', valid_until: null, updated_at: new Date().toISOString() }],
  }))
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeUserJwt(ADMIN_ID)}`,
      },
      body: JSON.stringify({ action: 'set-plan', target_user_id: TARGET_ID, plan: 'lifetime' }),
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)
    assertEquals(body.plan, 'lifetime')
    assertEquals(body.valid_until, null)
  } finally {
    await teardown(server, restore)
  }
})

// ─── extend tests ──────────────────────────────────────────────────────────

Deno.test('admin-actions/extend: 400 days out of range', async () => {
  const { server, restore } = await setupAdmin()
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeUserJwt(ADMIN_ID)}`,
      },
      body: JSON.stringify({ action: 'extend', target_user_id: TARGET_ID, days: 9999 }),
    })
    const res = await handler(req)
    assertEquals(res.status, 400)
    const body = await res.json()
    assert(body.error.includes('1–3650'))
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('admin-actions/extend: 400 for lifetime plan', async () => {
  const { server, restore } = await setupAdmin()
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ plan: 'lifetime', valid_until: null }],
  }))
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeUserJwt(ADMIN_ID)}`,
      },
      body: JSON.stringify({ action: 'extend', target_user_id: TARGET_ID, days: 30 }),
    })
    const res = await handler(req)
    assertEquals(res.status, 400)
    const body = await res.json()
    assert(body.error.includes('lifetime'))
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('admin-actions/extend: 200 adds days to valid_until', async () => {
  const { server, restore } = await setupAdmin()
  const currentUntil = '2026-08-06T10:58:08.803Z'
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ plan: 'pro', valid_until: currentUntil }],
  }))
  server.on('PATCH', '/rest/v1/user_entitlements', () => ({ status: 204 }))
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeUserJwt(ADMIN_ID)}`,
      },
      body: JSON.stringify({ action: 'extend', target_user_id: TARGET_ID, days: 30 }),
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)
    assertEquals(body.added_days, 30)
    // new_valid_until должен быть currentUntil + 30 дней
    const expected = new Date(new Date(currentUntil).getTime() + 30 * 86_400_000)
    const actual = new Date(body.new_valid_until)
    assertEquals(actual.toDateString(), expected.toDateString())
  } finally {
    await teardown(server, restore)
  }
})

// ─── cancel tests ──────────────────────────────────────────────────────────

Deno.test('admin-actions/cancel: 200 sets cancel_at_period_end', async () => {
  const { server, restore } = await setupAdmin()
  const validUntil = '2026-09-01T00:00:00.000Z'
  server.on('GET', '/rest/v1/user_entitlements', () => ({
    status: 200,
    body: [{ plan: 'pro', valid_until: validUntil, cancel_at_period_end: false }],
  }))
  server.on('PATCH', '/rest/v1/user_entitlements', () => ({ status: 204 }))
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeUserJwt(ADMIN_ID)}`,
      },
      body: JSON.stringify({ action: 'cancel', target_user_id: TARGET_ID }),
    })
    const res = await handler(req)
    assertEquals(res.status, 200)
    const body = await res.json()
    assertEquals(body.ok, true)
    assertEquals(body.access_until, validUntil)

    const patchCall = server.findCall('PATCH', '/rest/v1/user_entitlements')
    assert(patchCall !== undefined)
    const patchBody = JSON.parse(patchCall!.body)
    assertEquals(patchBody.cancel_at_period_end, true)
    assertEquals(patchBody.auto_renew, false)
  } finally {
    await teardown(server, restore)
  }
})

Deno.test('admin-actions: 400 unknown action', async () => {
  const { server, restore } = await setupAdmin()
  try {
    const req = new Request(server.url + '/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeUserJwt(ADMIN_ID)}`,
      },
      body: JSON.stringify({ action: 'delete-all-data', target_user_id: TARGET_ID }),
    })
    const res = await handler(req)
    assertEquals(res.status, 400)
    const body = await res.json()
    assert(body.error.includes('Unknown action'))
  } finally {
    await teardown(server, restore)
  }
})
