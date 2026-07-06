// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.4 — Supabase Edge Function: create-payment
//
// Создаёт платёж в ЮKassa (API v3) и возвращает confirmation_url для redirect.
// Требует JWT пользователя (клиент вызывает как аутентифицированный юзер) —
// user_id и email резолвим из auth.getUser().
//
// Поддерживаемые тарифы (см. supabase/migrations/0007_entitlements.sql):
//   - "monthly"  → 299 ₽ / 30 дней  → plan 'pro'
//   - "annual"   → 2990 ₽ / 365 дней → plan 'pro'
//   - "lifetime" → 4990 ₽ бессрочно → plan 'lifetime'
//
// В метадату платежа кладём user_id + tier — webhook (payment-webhook)
// использует их для активации entitlement.
//
// Чек НПД (54-ФЗ + 422-ФЗ для самозанятого):
//   ЮKassa регистрирует чек в ФНС от нашего имени. Мы обязаны передать
//   receipt-объект с items[] и customer.email.
//   Параметры:
//     tax_system_code = 6  (НПД — самозанятый)
//     vat_code        = 1  (НДС не облагается / 0%)
//     payment_subject = "service"
//     payment_mode    = "full_payment"
//
// Deploy:
//   supabase functions deploy create-payment --project-ref "$SUPABASE_PROJECT_REF"
//   (JWT verification включена — endpoint приватный, требует authorization header)
//
// Secrets:
//   YOOKASSA_SHOP_ID       — идентификатор магазина ЮKassa
//   YOOKASSA_SECRET_KEY    — секретный ключ (Basic auth)
//   YOOKASSA_RETURN_URL_BASE — базовый URL для return_url, например
//                              https://yourtaskflow.app (без trailing slash)
//                              → return_url = ${base}/pay/success?tier=monthly
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY — стандартные.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ─── Прайс-лист (единственный источник истины в этой функции) ────────────────
// В случае изменения — синхронизировать с:
//   1. supabase/functions/payment-webhook/index.ts (расчёт valid_until)
//   2. Frontend /checkout page (отображаемые цены)
//   3. yourtaskflow.app/legal/offer.html (юридическая оферта)
const TIERS = {
  monthly: {
    amount: '299.00',
    currency: 'RUB',
    description: 'Подписка TaskFlow Pro — 1 месяц',
    days: 30,
    plan: 'pro' as const,
  },
  annual: {
    amount: '2990.00',
    currency: 'RUB',
    description: 'Подписка TaskFlow Pro — 1 год',
    days: 365,
    plan: 'pro' as const,
  },
  lifetime: {
    amount: '4990.00',
    currency: 'RUB',
    description: 'TaskFlow Lifetime — бессрочный доступ',
    days: null,
    plan: 'lifetime' as const,
  },
} as const

type Tier = keyof typeof TIERS

// ─── Main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    // ─── 1. Валидация env ────────────────────────────────────────────────────
    const shopId = Deno.env.get('YOOKASSA_SHOP_ID')
    const secretKey = Deno.env.get('YOOKASSA_SECRET_KEY')
    const returnBase = Deno.env.get('YOOKASSA_RETURN_URL_BASE')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')

    if (!shopId || !secretKey) {
      return json({ error: 'Server not configured: YOOKASSA credentials missing' }, 500)
    }
    if (!returnBase) {
      return json({ error: 'Server not configured: YOOKASSA_RETURN_URL_BASE missing' }, 500)
    }
    if (!supabaseUrl || !anonKey) {
      return json({ error: 'Server not configured: SUPABASE env missing' }, 500)
    }

    // ─── 2. Auth пользователя ────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Missing Authorization: Bearer <jwt>' }, 401)
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: userData, error: userErr } = await supabase.auth.getUser()
    if (userErr || !userData?.user) {
      return json({ error: 'Invalid or expired JWT' }, 401)
    }
    const user = userData.user
    const email = user.email
    if (!email) {
      return json({ error: 'User has no email — cannot issue receipt' }, 400)
    }

    // ─── 3. Валидация payload ────────────────────────────────────────────────
    let body: { tier?: string }
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }
    const tier = body.tier as Tier | undefined
    if (!tier || !(tier in TIERS)) {
      return json({ error: `Invalid tier. Expected one of: ${Object.keys(TIERS).join(', ')}` }, 400)
    }
    const spec = TIERS[tier]

    // ─── 4. Проверка "нельзя купить lifetime поверх lifetime" (мягкий guard) ─
    // Полная проверка (нельзя даунгрейдить активный pro/lifetime) — на уровне
    // webhook + UI. Здесь только предохранитель от очевидного дубля.
    // (пропустим для dev.6.4, добавим в 6.5 если понадобится)

    // ─── 5. Собираем payload для ЮKassa ──────────────────────────────────────
    const idempotenceKey = crypto.randomUUID()
    const returnUrl = `${returnBase.replace(/\/$/, '')}/pay/success?tier=${tier}`

    const yooPayload = {
      amount: {
        value: spec.amount,
        currency: spec.currency,
      },
      capture: true, // одностадийный платёж — списываем сразу
      confirmation: {
        type: 'redirect',
        return_url: returnUrl,
      },
      description: spec.description,
      metadata: {
        user_id: user.id,
        tier,
        plan: spec.plan,
        // Web-app версия, полезно для отладки в личном кабинете ЮKassa
        source: 'taskflow-app',
      },
      // ─── Чек НПД для самозанятого (54-ФЗ) ────────────────────────────────
      receipt: {
        customer: { email },
        tax_system_code: 6, // 6 = НПД (самозанятый)
        items: [
          {
            description: spec.description,
            quantity: '1.00',
            amount: {
              value: spec.amount,
              currency: spec.currency,
            },
            vat_code: 1, // 1 = без НДС
            payment_subject: 'service', // услуга
            payment_mode: 'full_payment', // полный расчёт
          },
        ],
      },
    }

    // ─── 6. Вызов ЮKassa API ─────────────────────────────────────────────────
    const basicAuth = btoa(`${shopId}:${secretKey}`)
    const yooResp = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Idempotence-Key': idempotenceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(yooPayload),
    })

    const yooJson = await yooResp.json().catch(() => ({}))

    if (!yooResp.ok) {
      // Возвращаем структурированную ошибку без раскрытия секретов
      return json({
        error: 'YooKassa API error',
        status: yooResp.status,
        code: yooJson?.code ?? 'unknown',
        description: yooJson?.description ?? null,
      }, 502)
    }

    // ─── 7. Ответ клиенту ────────────────────────────────────────────────────
    // yooJson имеет структуру:
    //   { id, status: "pending", amount, confirmation: { type, confirmation_url }, ... }
    const confirmationUrl = yooJson?.confirmation?.confirmation_url as string | undefined
    if (!confirmationUrl) {
      return json({
        error: 'YooKassa response missing confirmation_url',
        raw: yooJson,
      }, 502)
    }

    return json({
      ok: true,
      payment_id: yooJson.id,
      status: yooJson.status,
      confirmation_url: confirmationUrl,
      tier,
      amount: spec.amount,
      currency: spec.currency,
    }, 200)
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unknown error' }, 500)
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
