// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.4.2 — Supabase Edge Function: payment-webhook
//
// Принимает уведомления от ЮKassa (payment.succeeded, payment.canceled,
// refund.succeeded), верифицирует их и обновляет user_entitlements.
//
// ─── Почему без supabase-js ────────────────────────────────────────────────
// Новые sb_secret_* ключи (SUPABASE_SECRET_KEYS.default) должны отправляться
// ТОЛЬКО в apikey header. supabase-js даже с global.headers = { apikey, Authorization: '' }
// продолжает падать с permission denied — платформа отвергает запросы у которых
// есть Authorization header (пусть даже пустой) и это не JWT.
//
// Решение: используем прямой fetch к PostgREST с { apikey: sb_secret_... }
// без Authorization вообще. Это надёжно и не зависит от того что делает
// supabase-js под капотом.
//
// ─── Модель безопасности ─────────────────────────────────────────────────────
// ЮKassa НЕ подписывает вебхуки HMAC (в отличие от Stripe / CloudPayments).
// Используются два независимых слоя защиты:
//   1) IP whitelist — уведомления идут только с известных подсетей ЮKassa.
//   2) Dual-verify — после разбора payload вызываем GET /v3/payments/{id}
//      с нашими Basic-credentials. Это гарантирует что платёж РЕАЛЬНО существует
//      в ЮKassa и его статус/сумма/metadata совпадают с payload.
//
// ─── Идемпотентность ─────────────────────────────────────────────────────────
// external_id (=payment.id ЮKassa) уникален в payment_events через
// UNIQUE (provider, external_id) (миграция 0007). Дубль → 200 OK + skipped.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const YOOKASSA_IP_RANGES = [
  '185.71.76.0/27',
  '185.71.77.0/27',
  '77.75.153.0/25',
  '77.75.156.11',
  '77.75.156.35',
  '77.75.154.128/25',
]
const YOOKASSA_IPV6_PREFIX = '2a02:5180:'

const TIER_TO_DAYS: Record<string, number | null> = {
  monthly: 30,
  annual: 365,
  lifetime: null,
}

// ═══ Admin PostgREST client через raw fetch ══════════════════════════════════
// Никаких supabase-js. Только apikey header, без Authorization.
class AdminClient {
  constructor(private baseUrl: string, private apiKey: string) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...extra,
    }
  }

  async insert(table: string, rows: unknown | unknown[]): Promise<{ ok: boolean; status: number; data?: unknown; error?: { code?: string; message: string } }> {
    const url = `${this.baseUrl}/rest/v1/${table}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: this.headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
    })
    if (resp.ok) {
      return { ok: true, status: resp.status, data: await resp.json().catch(() => null) }
    }
    const errJson = await resp.json().catch(() => ({}))
    return { ok: false, status: resp.status, error: { code: errJson.code, message: errJson.message ?? `HTTP ${resp.status}` } }
  }

  async update(table: string, filters: Record<string, string>, patch: Record<string, unknown>): Promise<{ ok: boolean; status: number; error?: { message: string } }> {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(filters)) {
      qs.set(k, `eq.${v}`)
    }
    const url = `${this.baseUrl}/rest/v1/${table}?${qs.toString()}`
    const resp = await fetch(url, {
      method: 'PATCH',
      headers: this.headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify(patch),
    })
    if (resp.ok) return { ok: true, status: resp.status }
    const errJson = await resp.json().catch(() => ({}))
    return { ok: false, status: resp.status, error: { message: errJson.message ?? `HTTP ${resp.status}` } }
  }

  async upsert(table: string, row: Record<string, unknown>, onConflict: string): Promise<{ ok: boolean; status: number; error?: { message: string } }> {
    const url = `${this.baseUrl}/rest/v1/${table}?on_conflict=${onConflict}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: this.headers({ Prefer: 'return=minimal,resolution=merge-duplicates' }),
      body: JSON.stringify([row]),
    })
    if (resp.ok) return { ok: true, status: resp.status }
    const errJson = await resp.json().catch(() => ({}))
    return { ok: false, status: resp.status, error: { message: errJson.message ?? `HTTP ${resp.status}` } }
  }

  async selectOne<T = Record<string, unknown>>(table: string, columns: string, filters: Record<string, string>): Promise<{ ok: boolean; data?: T | null; error?: { message: string } }> {
    const qs = new URLSearchParams({ select: columns })
    for (const [k, v] of Object.entries(filters)) {
      qs.set(k, `eq.${v}`)
    }
    qs.set('limit', '1')
    const url = `${this.baseUrl}/rest/v1/${table}?${qs.toString()}`
    const resp = await fetch(url, {
      method: 'GET',
      headers: this.headers(),
    })
    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}))
      return { ok: false, error: { message: errJson.message ?? `HTTP ${resp.status}` } }
    }
    const arr = await resp.json().catch(() => []) as T[]
    return { ok: true, data: arr.length > 0 ? arr[0] : null }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const skipIpCheck = Deno.env.get('YOOKASSA_SKIP_IP_CHECK') === 'true'
    if (!skipIpCheck) {
      const clientIp = getClientIp(req)
      if (!clientIp || !isIpAllowed(clientIp)) {
        return json({ error: 'Forbidden: source IP not in ЮKassa whitelist', ip: clientIp }, 403)
      }
    }

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

    // ─── 3. Инициализация Admin client (raw fetch, apikey only) ─────────────
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    let supabaseSecretKey: string | undefined
    try {
      const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>
        if (parsed && typeof parsed.default === 'string' && parsed.default.length > 0) {
          supabaseSecretKey = parsed.default
        }
      }
    } catch (_e) {
      // ignore, fallback
    }
    if (!supabaseSecretKey) {
      supabaseSecretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || undefined
    }
    if (!supabaseUrl || !supabaseSecretKey) {
      return json({ error: 'Server not configured: SUPABASE env missing' }, 500)
    }
    const admin = new AdminClient(supabaseUrl, supabaseSecretKey)

    // ─── 4. Dual-verify через ЮKassa API ───────────────────────────────────
    const shopId = Deno.env.get('YOOKASSA_SHOP_ID')
    const yooSecretKey = Deno.env.get('YOOKASSA_SECRET_KEY')
    if (!shopId || !yooSecretKey) {
      return json({ error: 'Server not configured: YOOKASSA credentials missing' }, 500)
    }

    const verifyResp = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${btoa(`${shopId}:${yooSecretKey}`)}`,
      },
    })

    if (!verifyResp.ok) {
      const errJson = await verifyResp.json().catch(() => ({}))
      return json({
        error: 'ЮKassa verify failed',
        status: verifyResp.status,
        code: errJson?.code ?? 'unknown',
      }, 502)
    }

    const verified = await verifyResp.json() as YooKassaPaymentObject

    if (verified.id !== paymentId) {
      return json({ error: 'Payment ID mismatch after verify' }, 400)
    }

    const userIdFromMeta = verified.metadata?.user_id ?? payload.object.metadata?.user_id ?? null

    const insRes = await admin.insert('payment_events', {
      provider: 'yookassa',
      external_id: paymentId,
      user_id: userIdFromMeta,
      raw_payload: {
        notification: payload,
        verified,
      },
      signature_valid: true,
      processed_at: null,
      error: null,
    })

    if (!insRes.ok) {
      if (insRes.error?.code === '23505') {
        return json({ ok: true, skipped: 'duplicate', payment_id: paymentId }, 200)
      }
      return json({ error: 'DB insert failed: ' + (insRes.error?.message ?? 'unknown') }, 500)
    }

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

    await admin.update(
      'payment_events',
      { provider: 'yookassa', external_id: paymentId },
      {
        processed_at: new Date().toISOString(),
        error: procResult.error ?? null,
      },
    )

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

async function handlePaymentSucceeded(
  admin: AdminClient,
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
    const existingRes = await admin.selectOne<{ plan: string; valid_until: string | null }>(
      'user_entitlements',
      'plan,valid_until',
      { user_id: userId },
    )
    const existing = existingRes.ok ? existingRes.data : null

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

  const upsertRes = await admin.upsert(
    'user_entitlements',
    {
      user_id: userId,
      plan,
      valid_until: validUntil,
      activated_at: now.toISOString(),
      source: 'yookassa',
      trial_used: true,
      notes: `payment_id=${payment.id}, tier=${tier}`,
    },
    'user_id',
  )

  if (!upsertRes.ok) {
    return { ok: false, msg: 'entitlement upsert failed', error: upsertRes.error?.message }
  }

  return { ok: true, msg: `Activated ${plan} until ${validUntil ?? 'forever'}` }
}

async function handleRefundSucceeded(
  admin: AdminClient,
  payment: YooKassaPaymentObject,
): Promise<{ ok: boolean; msg: string; error?: string }> {
  const meta = payment.metadata ?? {}
  const userId = meta.user_id
  if (!userId) {
    return { ok: false, msg: 'no user_id in refund metadata', error: 'metadata.user_id missing' }
  }

  const dgRes = await admin.upsert(
    'user_entitlements',
    {
      user_id: userId,
      plan: 'free',
      valid_until: null,
      activated_at: new Date().toISOString(),
      source: 'yookassa',
      trial_used: true,
      notes: `refund payment_id=${payment.id}`,
    },
    'user_id',
  )

  if (!dgRes.ok) {
    return { ok: false, msg: 'refund downgrade failed', error: dgRes.error?.message }
  }

  return { ok: true, msg: 'Downgraded to free after refund' }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function getClientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    return xff.split(',')[0].trim()
  }
  return req.headers.get('x-real-ip') || null
}

function isIpAllowed(ip: string): boolean {
  if (ip.includes(':')) {
    return ip.toLowerCase().startsWith(YOOKASSA_IPV6_PREFIX)
  }

  const ipNum = ipv4ToNum(ip)
  if (ipNum === null) return false

  for (const range of YOOKASSA_IP_RANGES) {
    if (range.includes('/')) {
      const [base, bitsStr] = range.split('/')
      const baseNum = ipv4ToNum(base)
      if (baseNum === null) continue
      const bits = parseInt(bitsStr, 10)
      const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0
      if ((ipNum & mask) === (baseNum & mask)) return true
    } else {
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

interface YooKassaNotification {
  type: string
  event: string
  object: YooKassaPaymentObject
}

interface YooKassaPaymentObject {
  id: string
  status: string
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
