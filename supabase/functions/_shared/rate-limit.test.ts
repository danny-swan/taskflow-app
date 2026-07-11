// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Wave 4 PR-B — N13: тесты table-based rate limiter (модуль rate-limit.ts).
//
// Run:
//   deno test --allow-env supabase/functions/_shared/rate-limit.test.ts
//
// Сеть/реальный Supabase не нужны: RPC-клиент подменяется фейком через
// параметр checkRateLimit(..., client).

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
  type RpcClient,
} from './rate-limit.ts'

// Фейковый RPC-клиент: возвращает заранее заданный ответ и запоминает аргументы.
function fakeClient(
  response: { data: unknown; error: { message: string } | null },
): RpcClient & { calls: Array<{ fn: string; args: Record<string, unknown> }> } {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  return {
    calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args })
      return Promise.resolve(response)
    },
  }
}

Deno.test('checkRateLimit: allowed=true parsed from RPC row (array shape)', async () => {
  const client = fakeClient({ data: [{ allowed: true, retry_after: 0 }], error: null })
  const res = await checkRateLimit('k', 10, 60, client)
  assertEquals(res, { allowed: true, retryAfter: 0 })
  assertEquals(client.calls[0].fn, 'check_rate_limit')
  assertEquals(client.calls[0].args, { p_key: 'k', p_max_requests: 10, p_window_seconds: 60 })
})

Deno.test('checkRateLimit: denied parsed with retry_after (array shape)', async () => {
  const client = fakeClient({ data: [{ allowed: false, retry_after: 42 }], error: null })
  const res = await checkRateLimit('k', 10, 60, client)
  assertEquals(res, { allowed: false, retryAfter: 42 })
})

Deno.test('checkRateLimit: handles scalar (non-array) RPC row', async () => {
  const client = fakeClient({ data: { allowed: false, retry_after: 7 }, error: null })
  const res = await checkRateLimit('k', 5, 60, client)
  assertEquals(res, { allowed: false, retryAfter: 7 })
})

Deno.test('checkRateLimit: fail-open on RPC error → allowed=true', async () => {
  const client = fakeClient({ data: null, error: { message: 'db down' } })
  const res = await checkRateLimit('k', 1, 60, client)
  assertEquals(res, { allowed: true, retryAfter: 0 })
})

Deno.test('checkRateLimit: fail-open on empty/undefined row → allowed=true', async () => {
  const client = fakeClient({ data: [], error: null })
  const res = await checkRateLimit('k', 1, 60, client)
  assertEquals(res, { allowed: true, retryAfter: 0 })
})

Deno.test('getClientIp: prefers x-forwarded-for over x-real-ip / cf-connecting-ip', () => {
  const req = new Request('https://x.test', {
    headers: {
      'x-forwarded-for': '1.1.1.1',
      'x-real-ip': '2.2.2.2',
      'cf-connecting-ip': '3.3.3.3',
    },
  })
  assertEquals(getClientIp(req), '1.1.1.1')
})

Deno.test('getClientIp: takes the FIRST ip from a multi-hop x-forwarded-for', () => {
  const req = new Request('https://x.test', {
    headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1, 172.16.0.2' },
  })
  assertEquals(getClientIp(req), '9.9.9.9')
})

Deno.test('getClientIp: falls back to x-real-ip when x-forwarded-for absent', () => {
  const req = new Request('https://x.test', { headers: { 'x-real-ip': '2.2.2.2' } })
  assertEquals(getClientIp(req), '2.2.2.2')
})

Deno.test('getClientIp: falls back to cf-connecting-ip when only that is present', () => {
  const req = new Request('https://x.test', { headers: { 'cf-connecting-ip': '3.3.3.3' } })
  assertEquals(getClientIp(req), '3.3.3.3')
})

Deno.test('getClientIp: returns null when no ip header is present (per-IP skipped, NOT a shared bucket)', () => {
  // Контракт: null → вызывающий код пропускает per-IP лимит целиком. Так мы НЕ
  // схлопываем всех анонимов в общий бакет 'ip:unknown' (иначе per-IP лимит
  // стал бы глобальным и один аноним заблокировал бы эндпоинт всем).
  const req = new Request('https://x.test')
  assertEquals(getClientIp(req), null)
})

Deno.test('rateLimitResponse: 429 + Retry-After + merged CORS headers', async () => {
  const cors = { 'Access-Control-Allow-Origin': 'tauri://localhost', 'Vary': 'Origin' }
  const resp = rateLimitResponse(30, cors)
  assertEquals(resp.status, 429)
  assertEquals(resp.headers.get('Retry-After'), '30')
  assertEquals(resp.headers.get('Content-Type'), 'application/json')
  assertEquals(resp.headers.get('Access-Control-Allow-Origin'), 'tauri://localhost')
  assertEquals(resp.headers.get('Vary'), 'Origin')
  const body = await resp.json()
  assertEquals(body, { error: 'rate_limited', message: 'Too many requests', retry_after: 30 })
})
