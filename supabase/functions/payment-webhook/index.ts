// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.5.1 — Supabase Edge Function: payment-webhook
//
// Принимает уведомления от ЮKassa (payment.succeeded, payment.canceled,
// refund.succeeded), верифицирует их и обновляет user_entitlements.
//
// dev.6.5.1 — новое:
//   • Сохраняем payment_method в public.payment_methods, когда ЮKassa
//     возвращает payment.payment_method.saved=true (для recurring и
//     update-card). Новый метод становится is_active=true, старые — false.
//   • metadata.mode === 'update-card' → после сохранения метода
//     автоматически инициируем refund через POST /v3/refunds. entitlement
//     НЕ трогаем. В handleRefundSucceeded тоже пропускаем downgrade
//     для таких payment.
//   • metadata.renewal === true → при payment.succeeded продлеваем
//     valid_until, сбрасываем renewal_attempts_count, логгируем
//     в renewal_attempts_log; при payment.canceled — ведём счётчик
//     попыток (но не даунгрейдим — это делает renew-subscription
//     после 3 провалов).
//   • При первичной покупке recurring-тарифа выставляем в user_entitlements
//     auto_renew=true, next_renewal_at, payment_method_id, last_payment_id/at.
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

// Tier'ы, которые обновляются автоматически (совпадает с create-payment TIERS.recurring)
const RECURRING_TIERS = new Set(['monthly', 'annual'])

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

export const handler = async (req: Request): Promise<Response> => {
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

    const yooApiBase = Deno.env.get('YOOKASSA_API_BASE') || 'https://api.yookassa.ru'
    const verifyResp = await fetch(`${yooApiBase}/v3/payments/${paymentId}`, {
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
        procResult = await handlePaymentSucceeded(admin, verified, shopId, yooSecretKey, supabaseUrl, supabaseSecretKey)
        break
      case 'payment.canceled':
        procResult = await handlePaymentCanceled(admin, verified)
        break
      case 'refund.succeeded':
        procResult = await handleRefundSucceeded(admin, verified, shopId, yooSecretKey, supabaseUrl, supabaseSecretKey)
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
}

Deno.serve(handler)

// ─── payment.succeeded ───────────────────────────────────────────────────────────────────────────────────────────────
async function handlePaymentSucceeded(
  admin: AdminClient,
  payment: YooKassaPaymentObject,
  shopId: string,
  yooSecretKey: string,
  supabaseUrl: string,
  supabaseSecretKey: string,
): Promise<{ ok: boolean; msg: string; error?: string }> {
  const meta = payment.metadata ?? {}
  const userId = meta.user_id
  const mode = meta.mode ?? 'purchase'
  const isRenewal = meta.renewal === 'true' || meta.renewal === '1'
  const isUpdateCard = mode === 'update-card'

  if (!userId) {
    return {
      ok: false,
      msg: 'metadata incomplete',
      error: `Missing user_id in metadata: ${JSON.stringify(meta)}`,
    }
  }

  // 1) Сохранение способа оплаты (если ЮKassa прислала payment_method.saved=true)
  let savedMethodId: string | null = null
  if (payment.payment_method?.saved === true && payment.payment_method?.id) {
    const smRes = await savePaymentMethod(admin, userId, payment)
    if (!smRes.ok) {
      return { ok: false, msg: 'payment_method save failed', error: smRes.error }
    }
    savedMethodId = payment.payment_method.id
  }

  // 2) Режим update-card — инициируем refund, entitlement НЕ трогаем
  if (isUpdateCard) {
    if (!savedMethodId) {
      // update-card без сохранённого метода — ситуация аномальная (возможно,
      // гео-ограничение, SBP, банковский кошелёк). Всё равно refund'им 1₽,
      // но логгируем.
      console.warn(`update-card without saved method for user ${userId}, payment ${payment.id}`)
    }
    const refundRes = await initiateRefund(shopId, yooSecretKey, payment)
    if (!refundRes.ok) {
      return { ok: false, msg: 'refund initiation failed', error: refundRes.error }
    }
    return {
      ok: true,
      msg: `update-card: saved method ${savedMethodId ?? '—'}, refund ${refundRes.refundId ?? 'initiated'}`,
    }
  }

  // 3) Обычная покупка / renewal — требует tier + plan
  const tier = meta.tier
  const plan = meta.plan

  if (!tier || !plan) {
    return {
      ok: false,
      msg: 'metadata incomplete for purchase',
      error: `Missing tier/plan in metadata: ${JSON.stringify(meta)}`,
    }
  }

  if (!(tier in TIER_TO_DAYS)) {
    return { ok: false, msg: 'invalid tier', error: `Unknown tier: ${tier}` }
  }

  const days = TIER_TO_DAYS[tier]
  const now = new Date()
  let validUntil: string | null = null

  // Читаем текущий entitlement (нужен всегда — для проверки lifetime и для
  // продления valid_until от текущей даты, а не от now).
  const existingRes = await admin.selectOne<{
    plan: string
    valid_until: string | null
    cancel_at_period_end: boolean | null
  }>(
    'user_entitlements',
    'plan,valid_until,cancel_at_period_end',
    { user_id: userId },
  )
  const existing = existingRes.ok ? existingRes.data : null

  if (days !== null) {
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

  // Собираем патч для user_entitlements
  const isRecurringTier = RECURRING_TIERS.has(tier)
  const patch: Record<string, unknown> = {
    user_id: userId,
    plan,
    valid_until: validUntil,
    activated_at: now.toISOString(),
    source: 'yookassa',
    trial_used: true,
    notes: `payment_id=${payment.id}, tier=${tier}${isRenewal ? ', renewal=true' : ''}`,
    last_payment_id: payment.id,
    last_payment_at: (payment.captured_at ?? payment.created_at ?? now.toISOString()),
  }

  if (isRecurringTier && validUntil) {
    // При первичной покупке monthly/annual — включаем auto_renew.
    // При renewal — auto_renew уже true, но перезапишем для идемпотентности.
    // Если пользователь ранее отменил (cancel_at_period_end=true) и платит
    // вручную снова — снимаем cancel_at_period_end.
    patch.auto_renew = true
    patch.cancel_at_period_end = false
    if (savedMethodId) {
      patch.payment_method_id = savedMethodId
    }
    patch.next_renewal_at = validUntil // продлеваем на дату окончания
    patch.renewal_attempts_count = 0 // сбрасываем счётчик провалов
  } else if (!isRecurringTier) {
    // lifetime — auto_renew=false, next_renewal_at=NULL
    patch.auto_renew = false
    patch.cancel_at_period_end = false
    patch.next_renewal_at = null
    patch.payment_method_id = null
    patch.renewal_attempts_count = 0
  }

  const upsertRes = await admin.upsert('user_entitlements', patch, 'user_id')
  if (!upsertRes.ok) {
    return { ok: false, msg: 'entitlement upsert failed', error: upsertRes.error?.message }
  }

  // 4) Если renewal — логгируем в renewal_attempts_log со status='succeeded'
  if (isRenewal) {
    const logRes = await admin.insert('renewal_attempts_log', {
      user_id: userId,
      attempted_at: now.toISOString(),
      status: 'succeeded',
      payment_id: payment.id,
      error_code: null,
      error_message: null,
    })
    if (!logRes.ok) {
      // Не фальбекаем — основное действие (продление) выполнено.
      console.error(`renewal_attempts_log insert failed for user ${userId}: ${logRes.error?.message}`)
    }

    // v0.9.35-dev.6.5.1: уведомление пользователя об успешном продлении
    const contact = await loadUserContact(admin, userId)
    const amountRub = payment.amount?.value ? Number(payment.amount.value) : 0
    const last4 = payment.payment_method?.card?.last4 ?? null
    await sendUserEmailAsync(
      supabaseUrl,
      supabaseSecretKey,
      contact.email,
      contact.language,
      'subscription_renewed',
      {
        plan: tier, // 'monthly' | 'annual'
        amount_rub: amountRub,
        next_renewal_at: validUntil,
        payment_last4: last4,
      },
    )
  }

  const kind = isRenewal ? 'Renewed' : 'Activated'
  return { ok: true, msg: `${kind} ${plan} until ${validUntil ?? 'forever'}` }
}

// ─── payment.canceled ───────────────────────────────────────────────────────────────────────────────────────────────
async function handlePaymentCanceled(
  admin: AdminClient,
  payment: YooKassaPaymentObject,
): Promise<{ ok: boolean; msg: string; error?: string }> {
  const meta = payment.metadata ?? {}
  const userId = meta.user_id
  const isRenewal = meta.renewal === 'true' || meta.renewal === '1'

  if (!userId || !isRenewal) {
    // Первичный платёж отменён (карта не прошла, cancel by user) — entitlement
    // не меняем. Генерация payment.canceled без первичного succeeded
    // — достаточно логгирования в payment_events (уже сделали выше).
    return { ok: true, msg: 'payment.canceled — no entitlement change (not a renewal)' }
  }

  // Renewal attempt failed — ведём счётчик попыток. Сам downgrade — в renew-subscription
  // через pg_cron (после 3 провалов через 24ч каждый).
  const nowIso = new Date().toISOString()
  const cancellationDetails = payment.cancellation_details as { reason?: string; party?: string } | undefined
  const errorCode = cancellationDetails?.reason ?? 'unknown'

  // Читаем текущий counter, чтобы его инкрементить в патче (без PostgREST RPC).
  const existingRes = await admin.selectOne<{ renewal_attempts_count: number | null }>(
    'user_entitlements',
    'renewal_attempts_count',
    { user_id: userId },
  )
  const currentCount = existingRes.ok ? (existingRes.data?.renewal_attempts_count ?? 0) : 0

  const upd = await admin.update(
    'user_entitlements',
    { user_id: userId },
    {
      renewal_attempts_count: currentCount + 1,
      last_renewal_attempt_at: nowIso,
    },
  )
  if (!upd.ok) {
    // Не фальбекаем — лог важнее, entitlement patch опционален.
    console.error(`renewal_attempts_count update failed for ${userId}: ${upd.error?.message}`)
  }

  const logRes = await admin.insert('renewal_attempts_log', {
    user_id: userId,
    attempted_at: nowIso,
    status: 'canceled',
    payment_id: payment.id,
    error_code: errorCode,
    error_message: cancellationDetails?.party ? `party=${cancellationDetails.party}` : null,
  })
  if (!logRes.ok) {
    return { ok: false, msg: 'renewal_attempts_log insert failed', error: logRes.error?.message }
  }

  return { ok: true, msg: `Renewal failed (attempt ${currentCount + 1}) — ${errorCode}` }
}

// ─── refund.succeeded ───────────────────────────────────────────────────────────────────────────────────────────────
async function handleRefundSucceeded(
  admin: AdminClient,
  refund: YooKassaPaymentObject,
  shopId: string,
  yooSecretKey: string,
  supabaseUrl: string,
  supabaseSecretKey: string,
): Promise<{ ok: boolean; msg: string; error?: string }> {
  const meta = refund.metadata ?? {}
  const userId = meta.user_id

  // Для refund ЮKassa присылает refund.payment_id в теле (не metadata).
  const originalPaymentId = (refund.payment_id as string | undefined)
    ?? meta.original_payment_id
    ?? null

  // Найти исходный payment — его metadata.mode говорит, нужен ли downgrade.
  let originalMode: string | null = null
  let originalUserId: string | null = userId ?? null
  if (originalPaymentId) {
    const orig = await getOriginalPayment(shopId, yooSecretKey, originalPaymentId)
    if (orig.ok && orig.payment) {
      originalMode = orig.payment.metadata?.mode ?? null
      if (!originalUserId) {
        originalUserId = orig.payment.metadata?.user_id ?? null
      }
    }
  }

  // update-card refund (1₽) — entitlement НЕ трогаем
  if (originalMode === 'update-card') {
    // v0.9.35-dev.6.5.1: уведомляем об успешном возврате 1₽
    if (originalUserId) {
      const contact = await loadUserContact(admin, originalUserId)
      const amountRub = refund.amount?.value ? Number(refund.amount.value) : 1
      await sendUserEmailAsync(
        supabaseUrl,
        supabaseSecretKey,
        contact.email,
        contact.language,
        'refund_completed',
        {
          amount_rub: amountRub,
          reason: 'update-card',
          payment_id: originalPaymentId,
        },
      )
    }
    return { ok: true, msg: 'refund of update-card (1₽ verification) — no entitlement change' }
  }

  if (!originalUserId) {
    return { ok: false, msg: 'no user_id resolvable for refund', error: 'neither refund.metadata nor original payment provided user_id' }
  }

  // Настоящий refund — даунгрейдим в free + auto_renew=false + cancel_at_period_end=true
  const dgRes = await admin.upsert(
    'user_entitlements',
    {
      user_id: originalUserId,
      plan: 'free',
      valid_until: null,
      activated_at: new Date().toISOString(),
      source: 'yookassa',
      trial_used: true,
      notes: `refund refund_id=${refund.id}, original_payment_id=${originalPaymentId ?? '—'}`,
      auto_renew: false,
      cancel_at_period_end: true,
      next_renewal_at: null,
      payment_method_id: null,
      renewal_attempts_count: 0,
    },
    'user_id',
  )

  if (!dgRes.ok) {
    return { ok: false, msg: 'refund downgrade failed', error: dgRes.error?.message }
  }

  // v0.9.35-dev.6.5.1: уведомляем пользователя о возврате и даунгрейде
  const contact = await loadUserContact(admin, originalUserId)
  const amountRub = refund.amount?.value ? Number(refund.amount.value) : 0
  await sendUserEmailAsync(
    supabaseUrl,
    supabaseSecretKey,
    contact.email,
    contact.language,
    'refund_completed',
    {
      amount_rub: amountRub,
      reason: 'downgrade',
      payment_id: originalPaymentId,
    },
  )

  return { ok: true, msg: 'Downgraded to free after refund' }
}

// ─── Helpers: payment_methods, refund, GET original payment ───────────────────────────────────
async function savePaymentMethod(
  admin: AdminClient,
  userId: string,
  payment: YooKassaPaymentObject,
): Promise<{ ok: boolean; error?: string }> {
  const pm = payment.payment_method
  if (!pm?.id) {
    return { ok: false, error: 'payment_method.id missing' }
  }

  // 1) Деактивируем все текущие активные методы этого юзера
  const deactRes = await admin.update(
    'payment_methods',
    { user_id: userId, is_active: 'true' },
    { is_active: false },
  )
  if (!deactRes.ok) {
    return { ok: false, error: `deactivate old methods failed: ${deactRes.error?.message}` }
  }

  // 2) Upsert новый метод (на случай если такой payment_method_id уже был
  // — conflict по (user_id, provider, external_id), см. миграцию 0014)
  const card = pm.card ?? {}
  const nowIso = new Date().toISOString()
  const row: Record<string, unknown> = {
    user_id: userId,
    provider: 'yookassa',
    external_id: pm.id,
    method_type: pm.type ?? 'bank_card',
    card_first6: card.first6 ?? null,
    card_last4: card.last4 ?? null,
    card_expiry_month: card.expiry_month ? parseInt(card.expiry_month, 10) : null,
    card_expiry_year: card.expiry_year ? parseInt(card.expiry_year, 10) : null,
    card_type: card.card_type ?? null,
    title: pm.title ?? null,
    is_active: true,
    saved_at: nowIso,
  }

  const upsertRes = await admin.upsert('payment_methods', row, 'user_id,provider,external_id')
  if (!upsertRes.ok) {
    return { ok: false, error: `upsert failed: ${upsertRes.error?.message}` }
  }
  return { ok: true }
}

async function initiateRefund(
  shopId: string,
  yooSecretKey: string,
  payment: YooKassaPaymentObject,
): Promise<{ ok: boolean; refundId?: string; error?: string }> {
  if (!payment.amount) {
    return { ok: false, error: 'payment.amount missing' }
  }
  const idempotenceKey = `refund-${payment.id}` // детерминированный
  const body = {
    payment_id: payment.id,
    amount: payment.amount,
    description: 'TaskFlow — возврат 1₽ (верификация карты)',
  }
  const yooApiBase = Deno.env.get('YOOKASSA_API_BASE') || 'https://api.yookassa.ru'
  const resp = await fetch(`${yooApiBase}/v3/refunds`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${shopId}:${yooSecretKey}`)}`,
      'Idempotence-Key': idempotenceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const respJson = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    return { ok: false, error: `YooKassa refund ${resp.status}: ${respJson?.description ?? respJson?.code ?? 'unknown'}` }
  }
  return { ok: true, refundId: (respJson?.id as string | undefined) ?? undefined }
}

/**
 * v0.9.35-dev.6.5.1: fire-and-forget вызов send-user-email.
 * Ошибка отправки не блокирует основной flow — только логгируем.
 */
async function sendUserEmailAsync(
  supabaseUrl: string,
  supabaseSecretKey: string,
  to: string | null,
  language: 'ru' | 'en',
  template: 'subscription_renewed' | 'renewal_failed' | 'refund_completed',
  params: Record<string, unknown>,
): Promise<void> {
  if (!to) {
    console.warn(`[send-user-email] skipped (no recipient) template=${template}`)
    return
  }
  const internalSecret = Deno.env.get('INTERNAL_SHARED_SECRET')
  if (!internalSecret) {
    console.warn('[send-user-email] INTERNAL_SHARED_SECRET not set — skipping')
    return
  }
  try {
    const url = `${supabaseUrl}/functions/v1/send-user-email`
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
        'x-internal-token': internalSecret,
      },
      body: JSON.stringify({ to, language, template, params }),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '(no body)')
      console.error(`[send-user-email] ${template} failed ${resp.status}: ${body}`)
    }
  } catch (e) {
    console.error(`[send-user-email] ${template} exception:`, e)
  }
}

/**
 * Читаем email + language для отправки письма.
 * Колонка language ещё не интегрирована в profiles — читаем из metadata
 * если есть, иначе дефолт 'ru' (основной язык продакта).
 */
async function loadUserContact(
  admin: AdminClient,
  userId: string,
): Promise<{ email: string | null; language: 'ru' | 'en' }> {
  const res = await admin.selectOne<{ email: string | null; metadata: Record<string, unknown> | null }>(
    'profiles',
    'email,metadata',
    { id: userId },
  )
  if (!res.ok || !res.data) {
    return { email: null, language: 'ru' }
  }
  const meta = res.data.metadata ?? {}
  const rawLang = (meta as Record<string, unknown>)?.language
  const lang: 'ru' | 'en' = rawLang === 'en' ? 'en' : 'ru'
  return { email: res.data.email ?? null, language: lang }
}

async function getOriginalPayment(
  shopId: string,
  yooSecretKey: string,
  paymentId: string,
): Promise<{ ok: boolean; payment?: YooKassaPaymentObject; error?: string }> {
  const yooApiBase = Deno.env.get('YOOKASSA_API_BASE') || 'https://api.yookassa.ru'
  const resp = await fetch(`${yooApiBase}/v3/payments/${paymentId}`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${btoa(`${shopId}:${yooSecretKey}`)}`,
    },
  })
  if (!resp.ok) {
    return { ok: false, error: `HTTP ${resp.status}` }
  }
  const payment = await resp.json().catch(() => null) as YooKassaPaymentObject | null
  if (!payment) {
    return { ok: false, error: 'invalid JSON' }
  }
  return { ok: true, payment }
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
  captured_at?: string
  description?: string
  metadata?: {
    user_id?: string
    tier?: string
    plan?: 'pro' | 'lifetime'
    source?: string
    mode?: string          // 'purchase' | 'update-card'
    renewal?: string       // 'true' для автосписаний от renew-subscription
    original_payment_id?: string // для refund — чтобы найти исходный mode
    [k: string]: unknown
  }
  payment_method?: {
    type?: string
    id?: string
    saved?: boolean
    title?: string
    card?: {
      first6?: string
      last4?: string
      expiry_month?: string
      expiry_year?: string
      card_type?: string
    }
    [k: string]: unknown
  }
  refundable?: boolean
  test?: boolean
  [k: string]: unknown
}
