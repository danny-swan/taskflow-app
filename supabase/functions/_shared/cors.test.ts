// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Wave 4 PR-A — N11: тесты CORS-allowlist хелпера.
//
// Run:
//   deno test --allow-env supabase/functions/_shared/cors.test.ts

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { corsHeaders } from './cors.ts'

const ORIGINS_ENV = 'tauri://localhost,https://tauri.localhost,https://app.example.test'

function withOrigins<T>(value: string | undefined, fn: () => T): T {
  const prevList = Deno.env.get('APP_ALLOWED_ORIGINS')
  const prevAppUrl = Deno.env.get('PUBLIC_APP_URL')
  // Изолируем от PUBLIC_APP_URL, чтобы тесты были детерминированы.
  Deno.env.delete('PUBLIC_APP_URL')
  if (value === undefined) Deno.env.delete('APP_ALLOWED_ORIGINS')
  else Deno.env.set('APP_ALLOWED_ORIGINS', value)
  try {
    return fn()
  } finally {
    if (prevList === undefined) Deno.env.delete('APP_ALLOWED_ORIGINS')
    else Deno.env.set('APP_ALLOWED_ORIGINS', prevList)
    if (prevAppUrl === undefined) Deno.env.delete('PUBLIC_APP_URL')
    else Deno.env.set('PUBLIC_APP_URL', prevAppUrl)
  }
}

Deno.test('cors: allowed origin is echoed back', () => {
  withOrigins(ORIGINS_ENV, () => {
    const h = corsHeaders('https://tauri.localhost')
    assertEquals(h['Access-Control-Allow-Origin'], 'https://tauri.localhost')
    assertEquals(h['Vary'], 'Origin')
  })
})

Deno.test('cors: disallowed origin falls back to first allowed', () => {
  withOrigins(ORIGINS_ENV, () => {
    const h = corsHeaders('https://evil.example.com')
    assertEquals(h['Access-Control-Allow-Origin'], 'tauri://localhost')
  })
})

Deno.test('cors: missing origin falls back to first allowed', () => {
  withOrigins(ORIGINS_ENV, () => {
    const h = corsHeaders(null)
    assertEquals(h['Access-Control-Allow-Origin'], 'tauri://localhost')
  })
})

Deno.test('cors: never emits wildcard *', () => {
  withOrigins(ORIGINS_ENV, () => {
    const h = corsHeaders('https://evil.example.com')
    assertEquals(h['Access-Control-Allow-Origin'] === '*', false)
  })
})

Deno.test('cors: empty allowlist yields empty origin (deny), not wildcard', () => {
  withOrigins('', () => {
    const h = corsHeaders('https://tauri.localhost')
    assertEquals(h['Access-Control-Allow-Origin'], '')
  })
})

Deno.test('cors: PUBLIC_APP_URL is folded into the allowlist', () => {
  const prevList = Deno.env.get('APP_ALLOWED_ORIGINS')
  const prevAppUrl = Deno.env.get('PUBLIC_APP_URL')
  Deno.env.set('APP_ALLOWED_ORIGINS', 'tauri://localhost')
  Deno.env.set('PUBLIC_APP_URL', 'https://prod.example.test')
  try {
    const h = corsHeaders('https://prod.example.test')
    assertEquals(h['Access-Control-Allow-Origin'], 'https://prod.example.test')
  } finally {
    if (prevList === undefined) Deno.env.delete('APP_ALLOWED_ORIGINS')
    else Deno.env.set('APP_ALLOWED_ORIGINS', prevList)
    if (prevAppUrl === undefined) Deno.env.delete('PUBLIC_APP_URL')
    else Deno.env.set('PUBLIC_APP_URL', prevAppUrl)
  }
})
