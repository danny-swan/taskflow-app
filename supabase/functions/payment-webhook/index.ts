// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6 — Supabase Edge Function: payment-webhook
//
// ЗАГОТОВКА (dev.6). Провайдер (ЮKassa / CloudPayments) будет подключён в
// dev.6.1. Сейчас функция:
//   1. Валидирует HMAC-SHA256 подпись входящего вебхука (общий секрет).
//   2. Пишет payload в payment_events (staging-таблица для audit).
//   3. Возвращает 501 Not Implemented для необработанных событий — чтобы
//      провайдер не считал вебхук доставленным до того, как логика активации
//      подписки реально готова.
//
// Идемпотентность:
//   - external_id (уникальный ID транзакции провайдера) должен быть UNIQUE
//     в payment_events (миграция 0007). При дубле → 200 OK + skipped.
//
// Deploy:
//   supabase functions deploy payment-webhook --project-ref sejpmzrmtgcvevukggkx --no-verify-jwt
//   (--no-verify-jwt: провайдер не отправляет пользовательский JWT.)
//
// Secrets:
//   PAYMENT_WEBHOOK_SECRET — общий секрет (HMAC key).
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — стандартные Supabase.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature, x-payment-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    // ─── 1. Читаем raw body для HMAC ────────────────────────────────────────
    const rawBody = await req.text()
    if (!rawBody) {
      return json({ error: 'Empty body' }, 400)
    }

    // ─── 2. HMAC validation ─────────────────────────────────────────────────
    const secret = Deno.env.get('PAYMENT_WEBHOOK_SECRET')
    if (!secret) {
      return json({ error: 'Server not configured: PAYMENT_WEBHOOK_SECRET missing' }, 500)
    }

    // Провайдеры используют разные имена заголовков; поддержим оба.
    const providedSig =
      req.headers.get('x-signature') ||
      req.headers.get('x-payment-signature') ||
      ''
    if (!providedSig) {
      return json({ error: 'Missing signature header' }, 401)
    }

    const expectedSig = await hmacSha256Hex(secret, rawBody)
    if (!constantTimeEquals(expectedSig, providedSig.toLowerCase())) {
      // 401 без деталей чтобы не помогать подобрать подпись.
      return json({ error: 'Invalid signature' }, 401)
    }

    // ─── 3. Парсим JSON ─────────────────────────────────────────────────────
    let payload: PaymentWebhookPayload
    try {
      payload = JSON.parse(rawBody) as PaymentWebhookPayload
    } catch {
      return json({ error: 'Invalid JSON payload' }, 400)
    }

    if (!payload.event_type || !payload.external_id) {
      return json({ error: 'Missing required fields: event_type, external_id' }, 400)
    }

    // ─── 4. Идемпотентная запись в payment_events ───────────────────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Server not configured: SUPABASE_URL / SERVICE_ROLE missing' }, 500)
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Схема payment_events (миграция 0007):
    //   provider text, external_id text, user_id uuid?, raw_payload jsonb,
    //   signature_valid boolean, processed_at timestamptz?, error text?
    // Unique index: (provider, external_id).
    //
    // user_id пока NULL — резолвим по user_email в dev.6.1.
    const { error: insErr } = await admin
      .from('payment_events')
      .insert({
        provider: payload.provider ?? 'unknown',
        external_id: payload.external_id,
        user_id: null,
        raw_payload: payload as unknown as Record<string, unknown>,
        signature_valid: true,
        processed_at: null,
        error: null,
      })

    if (insErr) {
      // Дубль по external_id — идемпотентный OK.
      if (insErr.code === '23505' /* unique_violation */) {
        return json({ ok: true, skipped: 'duplicate external_id', external_id: payload.external_id }, 200)
      }
      return json({ error: 'DB insert failed: ' + insErr.message }, 500)
    }

    // ─── 5. dev.6: логика активации ЕЩЁ НЕ РЕАЛИЗОВАНА ─────────────────────
    //
    // В dev.6.1 здесь будет:
    //   - разбор event_type (payment.succeeded, payment.refunded, subscription.cancelled, ...)
    //   - lookup пользователя по user_email
    //   - upsert в user_entitlements с корректным valid_until и source
    //   - формирование чека НПД
    //
    // Пока — 501 Not Implemented + запись в audit сделали, дальше по чек-листу.

    return json({
      ok: false,
      code: 'not_implemented',
      message: 'Payment processing logic will be added in dev.6.1. Event stored in payment_events audit log.',
      external_id: payload.external_id,
    }, 501)
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unknown error' }, 500)
  }
})

// ─── Types ────────────────────────────────────────────────────────────────────

interface PaymentWebhookPayload {
  provider?: 'yukassa' | 'cloudpayments' | 'unknown'
  external_id: string      // уникальный ID транзакции провайдера
  event_type: string       // e.g. 'payment.succeeded', 'payment.refunded'
  status?: string          // e.g. 'succeeded', 'canceled'
  amount?: number          // копейки / центы
  currency?: string        // 'RUB', 'USD'
  user_email?: string
  [k: string]: unknown
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  const bytes = new Uint8Array(sigBuf)
  let hex = ''
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0')
  }
  return hex
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
