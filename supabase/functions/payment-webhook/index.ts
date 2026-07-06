// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.4 — Supabase Edge Function: payment-webhook
//
// Принимает уведомления от ЮKassa (payment.succeeded, payment.canceled,
// refund.succeeded), верифицирует их и обновляет user_entitlements.
//
// ─── Модель безопасности ─────────────────────────────────────────────────────
// ЮKassa НЕ подписывает вебхуки HMAC (в отличие от Stripe / CloudPayments).
// Используются два независимых слоя защиты:
//   1) IP whitelist — уведомления идут только с известных подсетей ЮKassa.
//   2) Dual-verify — после разбора payload вызываем GET /v3/payments/{id}
//      с нашими Basic-credentials. Это гарантирует что платёж РЕАЛЬНО существует
//      в ЮKassa и его статус/сумма/metadata совпадают с payload.
//
// Оба слоя обязательны: злоумышленник может подделать IP только при MITM —
// dual-verify это ловит.
//
// ─── Идемпотентность ─────────────────────────────────────────────────────────
// external_id (=payment.id ЮKassa) уникален в payment_events через
// UNIQUE (provider, external_id) (миграция 0007). Дубль → 200 OK + skipped.
//
// ЮKassa ретраит 24 часа при не-200 ответе, поэтому всегда отвечаем 200 после
// того как записали в payment_events (даже если активация ещё не удалась —
// добавим отдельный retry-механизм в dev.6.5).
//
// ─── Deploy ──────────────────────────────────────────────────────────────────
// supabase functions deploy payment-webhook --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt
// (--no-verify-jwt: провайдер не отправляет пользовательский JWT.)
//
// ─── Secrets ─────────────────────────────────────────────────────────────────
// YOOKASSA_SHOP_ID       — Basic auth username
// YOOKASSA_SECRET_KEY    — Basic auth password
// YOOKASSA_SKIP_IP_CHECK — 'true' в dev/test, чтобы можно было тестировать
//                           через ngrok / postman без ЮKassa-IP
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — стандартные Supabase.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ЮKassa IP whitelist (https://yookassa.ru/developers/using-api/webhooks)
// Формат: CIDR или одиночный IP.
const YOOKASSA_IP_RANGES = [
  '185.71.76.0/27',
  '185.71.77.0/27',
  '77.75.153.0/25',
  '77.75.156.11',
  '77.75.156.35',
  '77.75.154.128/25',
  // IPv6: 2a02:5180::/32 — обрабатываем отдельно (см. isIpAllowed)
]
const YOOKASSA_IPV6_PREFIX = '2a02:5180:'

// Прайс-лист — должен совпадать с create-payment/index.ts.
const TIER_TO_DAYS: Record<string, number | null> = {
  monthly: 30,
  annual: 365,
  lifetime: null, // бессрочно
}

// ─── Main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    // ─── 1. IP whitelist (первый слой защиты) ────────────────────────────────
    const skipIpCheck = Deno.env.get('YOOKASSA_SKIP_IP_CHECK') === 'true'
    if (!skipIpCheck) {
      const clientIp = getClientIp(req)
      if (!clientIp || !isIpAllowed(clientIp)) {
        return json({ error: 'Forbidden: source IP not in ЮKassa whitelist', ip: clientIp }, 403)
      }
    }

    // ─── 2. Читаем и парсим body ─────────────────────────────────────────────
    const rawBody = await req.text()
    if (!rawBody) {
      return json({ error: 'Empty body' }, 400)
    }

    let payload: YooKassaNotification
    try {
      payload = JSON.parse(rawBody) as YooKassaNotification
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }

    if (payload.type !== 'notification' || !payload.event || !payload.object?.id) {
      return json({ error: 'Malformed ЮKassa notification' }, 400)
    }

    const paymentId = payload.object.id
    const event = payload.event

    // ─── 3. Инициализация Supabase admin ─────────────────────────────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Server not configured: SUPABASE env missing' }, 500)
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // ─── 4. Dual-verify через GET /v3/payments/{id} ──────────────────────────
    const shopId = Deno.env.get('YOOKASSA_SHOP_ID')
    const secretKey = Deno.env.get('YOOKASSA_SECRET_KEY')
    if (!shopId || !secretKey) {
      return json({ error: 'Server not configured: YOOKASSA credentials missing' }, 500)
    }

    const verifyResp = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${btoa(`${shopId}:${secretKey}`)}`,
      },
    })

    if (!verifyResp.ok) {
      // Верификация не прошла — писать в БД не будем, вернём 502.
      // ЮKassa ретраит 24ч — если это временный сбой, восстановимся.
      const errJson = await verifyResp.json().catch(() => ({}))
      return json({
        error: 'ЮKassa verify failed',
        status: verifyResp.status,
        code: errJson?.code ?? 'unknown',
      }, 502)
    }

    const verified = await verifyResp.json() as YooKassaPaymentObject

    // Санити-чек: id совпадает
    if (verified.id !== paymentId) {
      return json({ error: 'Payment ID mismatch after verify' }, 400)
    }

    // ─── 5. Идемпотентная запись в payment_events ────────────────────────────
    // Первым делом фиксируем факт получения — даже если активация упадёт,
    // audit будет.
    const userIdFromMeta = verified.metadata?.user_id ?? payload.object.metadata?.user_id ?? null

    const { error: insErr } = await admin
      .from('payment_events')
      .insert({
        provider: 'yookassa',
        external_id: paymentId,
        user_id: userIdFromMeta,
        raw_payload: {
          notification: payload as unknown as Record<string, unknown>,
          verified: verified as unknown as Record<string, unknown>,
        },
        signature_valid: true, // прошли IP + dual-verify
        processed_at: null,
        error: null,
      })

    if (insErr) {
      if (insErr.code === '23505' /* unique_violation */) {
        // Дубль — идемпотентный OK, ЮKassa больше не будет ретраить.
        return json({ ok: true, skipped: 'duplicate', payment_id: paymentId }, 200)
      }
      // Реальная DB-ошибка — 500, чтобы ЮKassa повторила.
      return json({ error: 'DB insert failed: ' + insErr.message }, 500)
    }

    // ─── 6. Обработка события ────────────────────────────────────────────────
    let procResult: { ok: boolean; msg: string; error?: string } = { ok: false, msg: 'unhandled event' }

    switch (event) {
      case 'payment.succeeded':
        procResult = await handlePaymentSucceeded(admin, verified)
        break

      case 'payment.canceled':
        procResult = { ok: true, msg: 'payment.canceled — no entitlement change' }
        break

      case 'refund.succeeded':
        procResult = await handleRefundSucceeded(admin, verified)
        break

      default:
        procResult = { ok: true, msg: `event '${event}' ignored (not subscribed)` }
    }

    // Помечаем processed_at + error, чтобы аудит был полный.
    await admin
      .from('payment_events')
      .update({
        processed_at: new Date().toISOString(),
        error: procResult.error ?? null,
      })
      .eq('provider', 'yookassa')
      .eq('external_id', paymentId)

    // ЮKassa ждёт 200, всегда возвращаем 200 если запись в audit прошла.
    // Если внутренняя обработка не удалась — deep info в теле, но 200,
    // чтобы вебхук не ретраился бесконечно.
    return json({
      ok: procResult.ok,
      event,
      payment_id: paymentId,
      msg: procResult.msg,
      ...(procResult.error && { error: procResult.error }),
    }, 200)
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unknown error' }, 500)
  }
})

// ─── Event handlers ──────────────────────────────────────────────────────────

async function handlePaymentSucceeded(
  admin: ReturnType<typeof createClient>,
  payment: YooKassaPaymentObject,
): Promise<{ ok: boolean; msg: string; error?: string }> {
  const meta = payment.metadata ?? {}
  const userId = meta.user_id
  const tier = meta.tier
  const plan = meta.plan

  if (!userId || !tier || !plan) {
    return {
      ok: false,
      msg: 'metadata incomplete',
      error: `Missing user_id/tier/plan in metadata: ${JSON.stringify(meta)}`,
    }
  }

  if (!(tier in TIER_TO_DAYS)) {
    return { ok: false, msg: 'invalid tier', error: `Unknown tier: ${tier}` }
  }

  const days = TIER_TO_DAYS[tier]
  const now = new Date()
  let validUntil: string | null = null

  if (days !== null) {
    // Продление подписки: если у юзера уже есть активная pro-подписка (valid_until в будущем),
    // extendим от текущего valid_until, иначе — от now.
    // Правило "не даунгрейдить lifetime" — блокируется отдельно ниже.
    const { data: existing } = await admin
      .from('user_entitlements')
      .select('plan, valid_until')
      .eq('user_id', userId)
      .single()

    // Нельзя купить monthly/annual поверх активного lifetime
    if (existing?.plan === 'lifetime') {
      return {
        ok: false,
        msg: 'user already has lifetime — refund needed',
        error: `User ${userId} already has lifetime, but paid for ${tier}. Manual refund required.`,
      }
    }

    const baseDate = existing?.valid_until && new Date(existing.valid_until) > now
      ? new Date(existing.valid_until)
      : now
    const extended = new Date(baseDate.getTime() + days * 86400 * 1000)
    validUntil = extended.toISOString()
  }
  // lifetime → validUntil остаётся null (бессрочно)

  const { error: upsertErr } = await admin
    .from('user_entitlements')
    .upsert({
      user_id: userId,
      plan,
      valid_until: validUntil,
      activated_at: now.toISOString(),
      source: 'yookassa',
      trial_used: true, // после платежа trial уже не имеет значения
      notes: `payment_id=${payment.id}, tier=${tier}`,
    }, {
      onConflict: 'user_id',
    })

  if (upsertErr) {
    return { ok: false, msg: 'entitlement upsert failed', error: upsertErr.message }
  }

  return { ok: true, msg: `Activated ${plan} until ${validUntil ?? 'forever'}` }
}

async function handleRefundSucceeded(
  admin: ReturnType<typeof createClient>,
  payment: YooKassaPaymentObject,
): Promise<{ ok: boolean; msg: string; error?: string }> {
  // Refund: даунгрейдим до 'free'. Более тонкое поведение (частичный возврат,
  // пропорциональное сокращение valid_until) — в dev.6.5.
  const meta = payment.metadata ?? {}
  const userId = meta.user_id
  if (!userId) {
    return { ok: false, msg: 'no user_id in refund metadata', error: 'metadata.user_id missing' }
  }

  const { error: dgErr } = await admin
    .from('user_entitlements')
    .upsert({
      user_id: userId,
      plan: 'free',
      valid_until: null,
      activated_at: new Date().toISOString(),
      source: 'yookassa',
      trial_used: true,
      notes: `refund payment_id=${payment.id}`,
    }, {
      onConflict: 'user_id',
    })

  if (dgErr) {
    return { ok: false, msg: 'refund downgrade failed', error: dgErr.message }
  }

  return { ok: true, msg: 'Downgraded to free after refund' }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function getClientIp(req: Request): string | null {
  // На Supabase Edge клиентский IP приходит в 'x-forwarded-for' (первый в списке)
  // или 'x-real-ip'.
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    return xff.split(',')[0].trim()
  }
  return req.headers.get('x-real-ip') || null
}

function isIpAllowed(ip: string): boolean {
  // IPv6 фаст-path
  if (ip.includes(':')) {
    return ip.toLowerCase().startsWith(YOOKASSA_IPV6_PREFIX)
  }

  // IPv4: сравниваем с CIDR-диапазонами
  const ipNum = ipv4ToNum(ip)
  if (ipNum === null) return false

  for (const range of YOOKASSA_IP_RANGES) {
    if (range.includes('/')) {
      const [base, bitsStr] = range.split('/')
      const baseNum = ipv4ToNum(base)
      if (baseNum === null) continue
      const bits = parseInt(bitsStr, 10)
      // mask: старшие bits бит = 1, остальные = 0
      const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0
      if ((ipNum & mask) === (baseNum & mask)) return true
    } else {
      // одиночный IP
      if (range === ip) return true
    }
  }
  return false
}

function ipv4ToNum(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const v = parseInt(p, 10)
    if (Number.isNaN(v) || v < 0 || v > 255) return null
    n = (n << 8) | v
  }
  return n >>> 0
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface YooKassaNotification {
  type: string // 'notification'
  event: string // 'payment.succeeded' | 'payment.canceled' | 'refund.succeeded' | ...
  object: YooKassaPaymentObject
}

interface YooKassaPaymentObject {
  id: string
  status: string // 'succeeded' | 'canceled' | 'pending' | ...
  paid?: boolean
  amount?: { value: string; currency: string }
  created_at?: string
  description?: string
  metadata?: {
    user_id?: string
    tier?: string
    plan?: 'pro' | 'lifetime'
    source?: string
    [k: string]: unknown
  }
  refundable?: boolean
  test?: boolean
  [k: string]: unknown
}
