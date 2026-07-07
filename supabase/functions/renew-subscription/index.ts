// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.5.3 — Supabase Edge Function: renew-subscription
//
// Дёргается pg_cron через pg_net раз в час (см. миграцию 0015):
//   SELECT net.http_post(
//     url:='https://<ref>.supabase.co/functions/v1/renew-subscription',
//     headers:='{"Authorization":"Bearer <service_role_key>"}'::jsonb
//   );
//
// Логика:
//   1. Отбираем entitlements: plan='pro', auto_renew=true, cancel_at_period_end=false,
//      next_renewal_at <= now(), renewal_attempts_count < 3, payment_method_id NOT NULL,
//      last_renewal_attempt_at NULL OR last_renewal_attempt_at < now() - interval '20 hours'
//      (окно 20ч а не 24ч, чтобы не пропустить попытку из-за drift'а cron).
//   2. Для каждого:
//      a) Читаем payment_method (проверяем is_active=true, provider='yookassa')
//      b) POST /v3/payments — save_payment_method=false, payment_method_id=<token>,
//         capture=true, metadata.renewal='true', metadata.user_id=<uid>,
//         metadata.tier=<tier>, receipt НПД.
//         Idempotence-Key: детерминированный хеш(user_id + valid_until + attempt_no).
//         Тариф определяем по valid_until — но проще положить в notes при первичной
//         покупке. Здесь берём monthly по умолчанию, если tier не сохранён —
//         это упрощение (в dev.6.5.1 у нас только monthly recurring в реальном сценарии
//         продления, annual тоже recurring но продлится ровно на 365 дней через
//         webhook только после первой годовщины). Точный tier читаем из notes
//         последнего payment_id (поля last_payment_id + notes уже есть).
//      c) ЮKassa вернула status=succeeded (или pending для 3DS) → ничего не делаем,
//         webhook отработает и продлит valid_until + сбросит attempts_count.
//      d) ЮKassa вернула ошибку или status=canceled сразу:
//         — INSERT renewal_attempts_log status='canceled' + error_code + error_message
//         — UPDATE user_entitlements renewal_attempts_count=+1, last_renewal_attempt_at=now()
//         — Если после инкремента attempts_count >= 3 → downgrade: plan='free',
//           auto_renew=false, valid_until=NULL, next_renewal_at=NULL, payment_method_id=NULL.
//           TODO(dev.6.5.1 email): отправить renewal_failed email через Resend.
//
// Auth: JWT verification включена (Supabase проверяет Bearer token).
// pg_cron присылает service_role_key — он проходит проверку как admin.
//
// Secrets:
//   YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, YOOKASSA_RETURN_URL_BASE
//   SUPABASE_URL, SUPABASE_SECRET_KEYS (default), SUPABASE_SERVICE_ROLE_KEY (fallback)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// tier → days для расчёта суммы (совпадает с create-payment TIERS)
const TIER_AMOUNTS: Record<string, { amount: string; description: string; days: number }> = {
  monthly: { amount: '299.00', description: 'Продление подписки TaskFlow Pro — 1 месяц', days: 30 },
  annual: { amount: '2990.00', description: 'Продление подписки TaskFlow Pro — 1 год', days: 365 },
}

const MAX_ATTEMPTS = 3
const ATTEMPT_WINDOW_HOURS = 20 // 20ч между попытками (grace ≈ 3×24ч суммарно)

// ═══ Admin PostgREST client через raw fetch ══════════════════════════════════
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

  async selectMany<T = Record<string, unknown>>(
    table: string,
    columns: string,
    filters: Record<string, string>,
    limit = 100,
  ): Promise<{ ok: boolean; data?: T[]; error?: { message: string } }> {
    const qs = new URLSearchParams({ select: columns })
    for (const [k, v] of Object.entries(filters)) {
      qs.set(k, v) // здесь v уже с префиксом (eq., is., lt.)
    }
    qs.set('limit', String(limit))
    const url = `${this.baseUrl}/rest/v1/${table}?${qs.toString()}`
    const resp = await fetch(url, { method: 'GET', headers: this.headers() })
    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}))
      return { ok: false, error: { message: errJson.message ?? `HTTP ${resp.status}` } }
    }
    const arr = await resp.json().catch(() => []) as T[]
    return { ok: true, data: arr }
  }

  async selectOne<T = Record<string, unknown>>(
    table: string,
    columns: string,
    filters: Record<string, string>,
  ): Promise<{ ok: boolean; data?: T | null; error?: { message: string } }> {
    const qs = new URLSearchParams({ select: columns })
    for (const [k, v] of Object.entries(filters)) {
      qs.set(k, `eq.${v}`)
    }
    qs.set('limit', '1')
    const url = `${this.baseUrl}/rest/v1/${table}?${qs.toString()}`
    const resp = await fetch(url, { method: 'GET', headers: this.headers() })
    if (!resp.ok) {
      const errJson = await resp.json().catch(() => ({}))
      return { ok: false, error: { message: errJson.message ?? `HTTP ${resp.status}` } }
    }
    const arr = await resp.json().catch(() => []) as T[]
    return { ok: true, data: arr.length > 0 ? arr[0] : null }
  }

  async insert(table: string, row: unknown | unknown[]): Promise<{ ok: boolean; error?: { message: string } }> {
    const url = `${this.baseUrl}/rest/v1/${table}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: this.headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify(Array.isArray(row) ? row : [row]),
    })
    if (resp.ok) return { ok: true }
    const errJson = await resp.json().catch(() => ({}))
    return { ok: false, error: { message: errJson.message ?? `HTTP ${resp.status}` } }
  }

  async update(
    table: string,
    filters: Record<string, string>,
    patch: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: { message: string } }> {
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
    if (resp.ok) return { ok: true }
    const errJson = await resp.json().catch(() => ({}))
    return { ok: false, error: { message: errJson.message ?? `HTTP ${resp.status}` } }
  }
}

// ═══ Main handler ══════════════════════════════════════════════════════════
export const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    // ─── env ──
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
      // ignore
    }
    if (!supabaseSecretKey) {
      supabaseSecretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || undefined
    }
    const shopId = Deno.env.get('YOOKASSA_SHOP_ID')
    const yooSecretKey = Deno.env.get('YOOKASSA_SECRET_KEY')

    if (!supabaseUrl || !supabaseSecretKey) {
      return json({ error: 'Server not configured: SUPABASE env missing' }, 500)
    }
    if (!shopId || !yooSecretKey) {
      return json({ error: 'Server not configured: YOOKASSA credentials missing' }, 500)
    }

    const admin = new AdminClient(supabaseUrl, supabaseSecretKey)

    // ─── 1. Отбираем подходящие entitlements ──
    // Условия:
    //   plan='pro' (у lifetime auto_renew всегда false)
    //   auto_renew=true
    //   cancel_at_period_end=false
    //   next_renewal_at <= now()
    //   renewal_attempts_count < 3
    //   payment_method_id NOT NULL
    //   last_renewal_attempt_at IS NULL OR < now() - 20h
    const nowIso = new Date().toISOString()
    const cutoffIso = new Date(Date.now() - ATTEMPT_WINDOW_HOURS * 3600 * 1000).toISOString()

    // Собираем 2 запроса и берём пересечение в JS — PostgREST не поддерживает
    // OR по разным колонкам через один запрос без or=(). Для читаемости и
    // безопасности используем or=() синтаксис через URLSearchParams вручную.
    const qs = new URLSearchParams({
      select: 'user_id,plan,valid_until,tier_hint:notes,payment_method_id,renewal_attempts_count,last_renewal_attempt_at,last_payment_id',
      plan: 'eq.pro',
      auto_renew: 'eq.true',
      cancel_at_period_end: 'eq.false',
      next_renewal_at: `lte.${nowIso}`,
      renewal_attempts_count: `lt.${MAX_ATTEMPTS}`,
      payment_method_id: 'not.is.null',
      or: `(last_renewal_attempt_at.is.null,last_renewal_attempt_at.lt.${cutoffIso})`,
      limit: '100',
    })
    const listUrl = `${supabaseUrl}/rest/v1/user_entitlements?${qs.toString()}`
    const listResp = await fetch(listUrl, {
      method: 'GET',
      headers: {
        apikey: supabaseSecretKey,
        Accept: 'application/json',
      },
    })
    if (!listResp.ok) {
      const errJson = await listResp.json().catch(() => ({}))
      return json({ error: 'Failed to list entitlements', db_error: errJson }, 500)
    }
    const candidates = await listResp.json() as Array<{
      user_id: string
      plan: string
      valid_until: string | null
      tier_hint: string | null
      payment_method_id: string
      renewal_attempts_count: number | null
      last_renewal_attempt_at: string | null
      last_payment_id: string | null
    }>

    if (candidates.length === 0) {
      return json({ ok: true, processed: 0, msg: 'no candidates' }, 200)
    }

    // ─── 2. Обрабатываем каждый ──
    let succeeded = 0
    let failed = 0
    let downgraded = 0
    const details: Array<Record<string, unknown>> = []

    for (const cand of candidates) {
      const uid = cand.user_id

      // 2a) Достаём tier из notes последнего платежа. Формат notes:
      //    "payment_id=<id>, tier=<monthly|annual>[, renewal=true]"
      const tierMatch = (cand.tier_hint ?? '').match(/tier=(monthly|annual|lifetime)/)
      const tier = tierMatch ? tierMatch[1] : 'monthly' // fallback
      if (!(tier in TIER_AMOUNTS)) {
        // lifetime не может попасть сюда (у lifetime auto_renew=false), но подстрахуемся
        details.push({ user_id: uid, skipped: `tier ${tier} not recurring` })
        continue
      }
      const spec = TIER_AMOUNTS[tier]

      // 2b) Проверяем payment_method активен
      const pmRes = await admin.selectOne<{ external_id: string; is_active: boolean; provider: string }>(
        'payment_methods',
        'external_id,is_active,provider',
        { user_id: uid, external_id: cand.payment_method_id, provider: 'yookassa' },
      )
      if (!pmRes.ok || !pmRes.data || pmRes.data.is_active === false) {
        // Метод удалён или неактивен — не пытаемся, downgrade сразу нет смысла (пусть юзер обновит карту)
        await logAttempt(admin, uid, 'canceled', null, 'payment_method_inactive', 'payment_method not active in DB', (cand.renewal_attempts_count ?? 0) + 1)
        await incrementAttempts(admin, uid, cand.renewal_attempts_count, MAX_ATTEMPTS)
        failed++
        details.push({ user_id: uid, error: 'payment_method inactive' })
        continue
      }

      // 2c) Читаем email юзера из public.profiles (нужен для чека НПД).
      // auth.users через PostgREST недоступна (только public схема), но у нас
      // есть триггер on_auth_user_created, который синхронизирует email в profiles.
      const profRes = await admin.selectOne<{ email: string | null }>('profiles', 'email', { id: uid })
      const email = profRes.ok ? (profRes.data?.email ?? null) : null
      if (!email) {
        await logAttempt(admin, uid, 'canceled', null, 'email_missing', 'no email for receipt', (cand.renewal_attempts_count ?? 0) + 1)
        await incrementAttempts(admin, uid, cand.renewal_attempts_count, MAX_ATTEMPTS)
        failed++
        details.push({ user_id: uid, error: 'no email' })
        continue
      }

      // 2d) Готовим Idempotence-Key: детерминированный хеш(uid + valid_until + attempts_count)
      const attemptNo = (cand.renewal_attempts_count ?? 0) + 1
      const idempotenceKey = await deterministicIdempotenceKey(uid, cand.valid_until ?? '', attemptNo)

      // 2e) POST /v3/payments
      const yooBody = {
        amount: { value: spec.amount, currency: 'RUB' },
        capture: true,
        payment_method_id: cand.payment_method_id,
        description: spec.description,
        metadata: {
          user_id: uid,
          tier,
          plan: 'pro',
          mode: 'purchase',
          renewal: 'true',
          source: 'taskflow-app-renew',
          attempt_no: String(attemptNo),
        },
        receipt: {
          customer: { email },
          tax_system_code: 6,
          items: [{
            description: spec.description,
            quantity: '1.00',
            amount: { value: spec.amount, currency: 'RUB' },
            vat_code: 1,
            payment_subject: 'service',
            payment_mode: 'full_payment',
          }],
        },
      }

      const basicAuth = btoa(`${shopId}:${yooSecretKey}`)
      const yooApiBase = Deno.env.get('YOOKASSA_API_BASE') || 'https://api.yookassa.ru'
      const yooResp = await fetch(`${yooApiBase}/v3/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Idempotence-Key': idempotenceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(yooBody),
      })
      const yooJson = await yooResp.json().catch(() => ({})) as {
        id?: string
        status?: string
        code?: string
        description?: string
      }

      if (!yooResp.ok) {
        // Ошибка API — логируем как canceled
        const errCode = yooJson?.code ?? `http_${yooResp.status}`
        const errMsg = yooJson?.description ?? `HTTP ${yooResp.status}`
        await logAttempt(admin, uid, 'canceled', yooJson?.id ?? null, errCode, errMsg, attemptNo)
        const dg = await incrementAttempts(admin, uid, cand.renewal_attempts_count, MAX_ATTEMPTS)
        if (dg) downgraded++
        // v0.9.35-dev.6.5.1: renewal_failed email
        await notifyRenewalFailed(supabaseUrl, supabaseSecretKey, admin, uid, {
          email,
          tier,
          amountRub: Number(spec.amount),
          attemptNo,
          maxAttempts: MAX_ATTEMPTS,
          validUntil: cand.valid_until,
          isLastAttempt: dg,
        })
        failed++
        details.push({ user_id: uid, error: errMsg, code: errCode, http: yooResp.status })
        continue
      }

      const status = yooJson.status ?? 'unknown'
      if (status === 'succeeded' || status === 'pending' || status === 'waiting_for_capture') {
        // Успешно инициировано — webhook отработает и продлит.
        // Attempt логируется в webhook (payment.succeeded или payment.canceled).
        succeeded++
        details.push({ user_id: uid, payment_id: yooJson.id, status })
        // last_renewal_attempt_at обновим сразу, чтобы cron не дёрнул нас
        // повторно до прихода webhook.
        await admin.update('user_entitlements', { user_id: uid }, {
          last_renewal_attempt_at: nowIso,
        })
      } else {
        // status=canceled сразу — редкий кейс, но обрабатываем
        const errCode = (yooJson as { cancellation_details?: { reason?: string } }).cancellation_details?.reason ?? 'canceled'
        await logAttempt(admin, uid, 'canceled', yooJson.id ?? null, errCode, `status=${status}`, attemptNo)
        const dg = await incrementAttempts(admin, uid, cand.renewal_attempts_count, MAX_ATTEMPTS)
        if (dg) downgraded++
        // v0.9.35-dev.6.5.1: renewal_failed email
        await notifyRenewalFailed(supabaseUrl, supabaseSecretKey, admin, uid, {
          email,
          tier,
          amountRub: Number(spec.amount),
          attemptNo,
          maxAttempts: MAX_ATTEMPTS,
          validUntil: cand.valid_until,
          isLastAttempt: dg,
        })
        failed++
        details.push({ user_id: uid, payment_id: yooJson.id, status, error_code: errCode })
      }
    }

    return json({
      ok: true,
      processed: candidates.length,
      succeeded,
      failed,
      downgraded,
      details,
    }, 200)
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unknown error' }, 500)
  }
}

Deno.serve(handler)

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * v0.9.35-dev.6.5.1: renewal_failed email через Edge Function send-user-email.
 * Fire-and-forget: ошибка отправки не блокирует следующего кандидата.
 *
 * retry_at вычисляем сами: cron запускается часто, но ATTEMPT_WINDOW_HOURS
 * не даёт биться в одного юзера чаще чем раз в 20 часов, что даёт grace ≈ 3×20ч = 60ч.
 */
async function notifyRenewalFailed(
  supabaseUrl: string,
  supabaseSecretKey: string,
  admin: AdminClient,
  userId: string,
  args: {
    email: string,
    tier: string,
    amountRub: number,
    attemptNo: number,
    maxAttempts: number,
    validUntil: string | null,
    isLastAttempt: boolean,
  },
): Promise<void> {
  try {
    // Когда попытка последняя, retry_at не передаём — template покажет "No further attempts".
    const retryAt = args.isLastAttempt
      ? null
      : new Date(Date.now() + ATTEMPT_WINDOW_HOURS * 3600 * 1000).toISOString()

    // access_until = valid_until (если ещё не даунгрейднули) или now (если уже даунгрейднули).
    const accessUntil = args.isLastAttempt
      ? new Date().toISOString()
      : (args.validUntil ?? new Date().toISOString())

    // Язык — как в payment-webhook: через profiles.metadata.language, default 'ru'.
    const profRes = await admin.selectOne<{ metadata: Record<string, unknown> | null }>(
      'profiles', 'metadata', { id: userId },
    )
    const rawLang = profRes.ok ? (profRes.data?.metadata as Record<string, unknown> | undefined)?.language : undefined
    const language: 'ru' | 'en' = rawLang === 'en' ? 'en' : 'ru'

    const internalSecret = Deno.env.get('INTERNAL_SHARED_SECRET')
    if (!internalSecret) {
      console.warn('[renew-subscription] INTERNAL_SHARED_SECRET not set — renewal_failed email skipped')
      return
    }
    const url = `${supabaseUrl}/functions/v1/send-user-email`
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseSecretKey,
        Authorization: `Bearer ${supabaseSecretKey}`,
        'x-internal-token': internalSecret,
      },
      body: JSON.stringify({
        to: args.email,
        language,
        template: 'renewal_failed',
        params: {
          plan: args.tier,
          amount_rub: args.amountRub,
          attempt_no: args.attemptNo,
          max_attempts: args.maxAttempts,
          retry_at: retryAt,
          access_until: accessUntil,
        },
      }),
    })
    if (!resp.ok) {
      const body = await resp.text().catch(() => '(no body)')
      console.error(`[renew-subscription] renewal_failed email failed ${resp.status}: ${body}`)
    }
  } catch (e) {
    console.error('[renew-subscription] notifyRenewalFailed exception:', e)
  }
}

async function logAttempt(
  admin: AdminClient,
  userId: string,
  status: 'canceled' | 'succeeded',
  paymentId: string | null,
  errorCode: string | null,
  errorMessage: string | null,
  attemptNumber: number = 1,
): Promise<void> {
  const res = await admin.insert('renewal_attempts_log', {
    user_id: userId,
    attempted_at: new Date().toISOString(),
    status,
    yookassa_payment_id: paymentId,
    attempt_number: attemptNumber,
    error_code: errorCode,
    error_message: errorMessage,
  })
  if (!res.ok) {
    console.error(`renewal_attempts_log insert failed for ${userId}: ${res.error?.message}`)
  }
}

/**
 * Инкрементит renewal_attempts_count. Если после инкремента достигнут MAX_ATTEMPTS,
 * делает downgrade → free и возвращает true.
 */
async function incrementAttempts(
  admin: AdminClient,
  userId: string,
  currentCount: number | null,
  maxAttempts: number,
): Promise<boolean> {
  const newCount = (currentCount ?? 0) + 1
  const nowIso = new Date().toISOString()

  if (newCount >= maxAttempts) {
    // Downgrade → free
    const dgRes = await admin.update('user_entitlements', { user_id: userId }, {
      plan: 'free',
      valid_until: null,
      auto_renew: false,
      cancel_at_period_end: false,
      next_renewal_at: null,
      payment_method_id: null,
      renewal_attempts_count: newCount,
      last_renewal_attempt_at: nowIso,
      activated_at: nowIso,
      source: 'yookassa',
      notes: `renewal failed ${newCount} times — downgraded to free`,
    })
    if (!dgRes.ok) {
      console.error(`downgrade failed for ${userId}: ${dgRes.error?.message}`)
      return false
    }
    // renewal_failed email вызывается выше в основном loopе — там есть email/tier/attempt_no.
    return true
  }

  const updRes = await admin.update('user_entitlements', { user_id: userId }, {
    renewal_attempts_count: newCount,
    last_renewal_attempt_at: nowIso,
  })
  if (!updRes.ok) {
    console.error(`increment attempts failed for ${userId}: ${updRes.error?.message}`)
  }
  return false
}

/**
 * Детерминированный Idempotence-Key: SHA-256(user_id + valid_until + attempt_no).
 * ЮKassa требует не более 128 символов, hex-хеш = 64 символа.
 * Это гарантирует, что при повторном запуске cron с теми же аргументами
 * ЮKassa вернёт тот же payment, а не создаст дубль.
 */
async function deterministicIdempotenceKey(
  userId: string,
  validUntil: string,
  attemptNo: number,
): Promise<string> {
  const input = `taskflow-renew:${userId}:${validUntil}:${attemptNo}`
  const bytes = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const arr = Array.from(new Uint8Array(hash))
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
