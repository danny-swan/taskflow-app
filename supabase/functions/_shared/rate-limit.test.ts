// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// _shared/rate-limit.test.ts — N13: юнит-тесты throttling-хелперов.
//
// Сети нет: RpcClient мокается in-memory объектом, повторяющим семантику
// public.rate_limit_hit (фиксированное окно на ключ). Проверяем:
//   • clientIp — доверенные заголовки, игнор x-forwarded-for
//   • checkRateLimit — allow до лимита, block после, retryAfter, fail-open
//   • checkRateLimits — первый сработавший лимит, пропуск null-ключей
//   • tooManyRequests — 429 + Retry-After

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  checkRateLimit,
  checkRateLimits,
  clientIp,
  type RpcClient,
  tooManyRequests,
} from './rate-limit.ts'

// ─── Мок RPC-клиента, эмулирующий public.rate_limit_hit ──────────────────────
// Фиксированное окно на ключ в памяти. Не завязан на реальное время окна —
// достаточно счётчика для проверки allow/block логики.
function makeMockClient(opts: { failWith?: string; throwErr?: boolean } = {}): RpcClient & {
  counts: Map<string, number>
} {
  const counts = new Map<string, number>()
  return {
    counts,
    rpc(fn: string, args: Record<string, unknown>) {
      if (opts.throwErr) {
        return Promise.reject(new Error('boom'))
      }
      if (opts.failWith) {
        return Promise.resolve({ data: null, error: { message: opts.failWith } })
      }
      assertEquals(fn, 'rate_limit_hit')
      const key = String(args.p_key)
      const max = Number(args.p_max)
      const windowSeconds = Number(args.p_window_seconds)
      const next = (counts.get(key) ?? 0) + 1
      counts.set(key, next)
      const allowed = next <= max
      return Promise.resolve({
        data: [{ allowed, retry_after: allowed ? 0 : windowSeconds }],
        error: null,
      })
    },
  }
}

function reqWith(headers: Record<string, string>): Request {
  return new Request('https://example.com', { headers })
}

// ─── clientIp ────────────────────────────────────────────────────────────────
Deno.test('clientIp: prefers cf-connecting-ip', () => {
  const req = reqWith({ 'cf-connecting-ip': '1.2.3.4', 'x-real-ip': '5.6.7.8' })
  assertEquals(clientIp(req), '1.2.3.4')
})

Deno.test('clientIp: falls back to x-real-ip', () => {
  const req = reqWith({ 'x-real-ip': '5.6.7.8' })
  assertEquals(clientIp(req), '5.6.7.8')
})

Deno.test('clientIp: ignores x-forwarded-for (N8 — spoofable)', () => {
  const req = reqWith({ 'x-forwarded-for': '9.9.9.9' })
  assertEquals(clientIp(req), null)
})

Deno.test('clientIp: null when no trusted header', () => {
  assertEquals(clientIp(reqWith({})), null)
})

// ─── checkRateLimit ──────────────────────────────────────────────────────────
Deno.test('checkRateLimit: allows up to max then blocks', async () => {
  const client = makeMockClient()
  const rule = { max: 3, windowSeconds: 60 }
  for (let i = 0; i < 3; i++) {
    const r = await checkRateLimit(client, 'k', rule)
    assertEquals(r.allowed, true)
  }
  const blocked = await checkRateLimit(client, 'k', rule)
  assertEquals(blocked.allowed, false)
  assertEquals(blocked.retryAfter, 60)
})

Deno.test('checkRateLimit: separate keys have independent windows', async () => {
  const client = makeMockClient()
  const rule = { max: 1, windowSeconds: 60 }
  assertEquals((await checkRateLimit(client, 'a', rule)).allowed, true)
  assertEquals((await checkRateLimit(client, 'b', rule)).allowed, true)
  assertEquals((await checkRateLimit(client, 'a', rule)).allowed, false)
})

Deno.test('checkRateLimit: fail-open on rpc error', async () => {
  const client = makeMockClient({ failWith: 'db down' })
  const r = await checkRateLimit(client, 'k', { max: 1, windowSeconds: 60 })
  assertEquals(r.allowed, true)
})

Deno.test('checkRateLimit: fail-open on rpc exception', async () => {
  const client = makeMockClient({ throwErr: true })
  const r = await checkRateLimit(client, 'k', { max: 1, windowSeconds: 60 })
  assertEquals(r.allowed, true)
})

// ─── checkRateLimits (multi-rule) ────────────────────────────────────────────
Deno.test('checkRateLimits: returns first blocked rule', async () => {
  const client = makeMockClient()
  // user limit 1, ip limit 5 → второй запрос по user должен блокнуть
  const checks = [
    { key: 'fn:user:u1', rule: { max: 1, windowSeconds: 60 } },
    { key: 'fn:ip:1.1.1.1', rule: { max: 5, windowSeconds: 60 } },
  ]
  assertEquals((await checkRateLimits(client, checks)).allowed, true)
  const blocked = await checkRateLimits(client, checks)
  assertEquals(blocked.allowed, false)
})

Deno.test('checkRateLimits: skips null keys', async () => {
  const client = makeMockClient()
  const checks = [
    { key: null, rule: { max: 1, windowSeconds: 60 } },
    { key: 'fn:user:u1', rule: { max: 1, windowSeconds: 60 } },
  ]
  const r = await checkRateLimits(client, checks)
  assertEquals(r.allowed, true)
  // Только один ключ реально дёрнул RPC.
  assertEquals(client.counts.size, 1)
})

// ─── tooManyRequests ─────────────────────────────────────────────────────────
Deno.test('tooManyRequests: 429 with Retry-After and merged headers', async () => {
  const resp = tooManyRequests(42, { 'X-Custom': 'y' })
  assertEquals(resp.status, 429)
  assertEquals(resp.headers.get('Retry-After'), '42')
  assertEquals(resp.headers.get('X-Custom'), 'y')
  const body = await resp.json()
  assertEquals(body.code, 'rate_limited')
  assertEquals(body.retry_after, 42)
})
