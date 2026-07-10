// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Deno tests for _shared/cors.ts (N11). Без сети — только логика заголовков.
//
// Run:
//   deno test supabase/functions/_shared/cors.test.ts

import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { corsHeaders, DEFAULT_ALLOWED_ORIGINS, resolveAllowedOrigins } from './cors.ts'

function reqWithOrigin(origin?: string): Request {
  const headers = new Headers()
  if (origin !== undefined) headers.set('Origin', origin)
  return new Request('https://fn.example/functions/v1/x', { method: 'POST', headers })
}

Deno.test('corsHeaders: эхо разрешённого Origin (никогда *)', () => {
  const origin = 'https://yourtaskflow.app'
  const h = corsHeaders(reqWithOrigin(origin))
  assertEquals(h['Access-Control-Allow-Origin'], origin)
  assert(h['Access-Control-Allow-Origin'] !== '*')
})

Deno.test('corsHeaders: Tauri desktop origin разрешён', () => {
  for (const origin of ['tauri://localhost', 'https://tauri.localhost']) {
    const h = corsHeaders(reqWithOrigin(origin))
    assertEquals(h['Access-Control-Allow-Origin'], origin)
  }
})

Deno.test('corsHeaders: неразрешённый Origin НЕ эхается, отдаём дефолтный', () => {
  const h = corsHeaders(reqWithOrigin('https://evil.example'))
  assert(h['Access-Control-Allow-Origin'] !== 'https://evil.example')
  assert(h['Access-Control-Allow-Origin'] !== '*')
  assertEquals(h['Access-Control-Allow-Origin'], DEFAULT_ALLOWED_ORIGINS[0])
})

Deno.test('corsHeaders: всегда Vary: Origin', () => {
  const h = corsHeaders(reqWithOrigin('https://yourtaskflow.app'))
  assertEquals(h['Vary'], 'Origin')
})

Deno.test('corsHeaders: запрос без Origin (не-браузер) не ломается', () => {
  const h = corsHeaders(reqWithOrigin(undefined))
  assert(h['Access-Control-Allow-Origin'] !== '*')
  assertEquals(h['Access-Control-Allow-Origin'], DEFAULT_ALLOWED_ORIGINS[0])
})

Deno.test('corsHeaders: методы по умолчанию и переопределение', () => {
  const def = corsHeaders(reqWithOrigin('https://yourtaskflow.app'))
  assertEquals(def['Access-Control-Allow-Methods'], 'POST, OPTIONS')
  const custom = corsHeaders(reqWithOrigin('https://yourtaskflow.app'), { methods: 'GET, POST, OPTIONS' })
  assertEquals(custom['Access-Control-Allow-Methods'], 'GET, POST, OPTIONS')
})

Deno.test('resolveAllowedOrigins: env APP_ALLOWED_ORIGINS переопределяет дефолт', () => {
  const env = (k: string) => (k === 'APP_ALLOWED_ORIGINS' ? 'https://a.example, https://b.example' : undefined)
  assertEquals(resolveAllowedOrigins(env), ['https://a.example', 'https://b.example'])
})

Deno.test('resolveAllowedOrigins: пустой/отсутствующий env → дефолт', () => {
  assertEquals(resolveAllowedOrigins(() => undefined), [...DEFAULT_ALLOWED_ORIGINS])
  assertEquals(resolveAllowedOrigins(() => '   '), [...DEFAULT_ALLOWED_ORIGINS])
})

Deno.test('corsHeaders: явный allowedOrigins (инъекция) эхает из него', () => {
  const h = corsHeaders(reqWithOrigin('https://a.example'), { allowedOrigins: ['https://a.example'] })
  assertEquals(h['Access-Control-Allow-Origin'], 'https://a.example')
})
