// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.6 — Supabase Edge Function: change-plan
//
// Апгрейд тарифа: monthly → annual.
// Создаёт новый платёж в ЮKassa (через сохранённый payment_method_id).
// При успехе добавляет +365 дней к valid_until (отсчёт от текущего valid_until).
//
// Даунгрейд (annual → monthly) НЕ поддерживается — пользователь уже оплатил год.
//
// Auth: JWT required.
// Body: {} (user_id берётся из JWT)
// Response:
//   200: { ok: true, confirmation_url?, new_valid_until, payment_id }
//         confirmation_url — если требуется 3DS
//         undefined        — если списание прошло сразу (метод без 3DS)
//   400: не monthly-тариф, нет сохранённой карты, уже annual
//   401: нет JWT
//   402: платёж отклонён ЮKassa
//   500: серверная ошибка

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// Цена апгрейда — полная сумма за год (без зачёта остатка; см. комментарий в описании)
const ANNUAL_AMOUNT = '2990.00'
const ANNUAL_DAYS   = 365

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')
    const shopId      = Deno.env.get('YOOKASSA_SHOP_ID')
    const secretKey   = Deno.env.get('YOOKASSA_SECRET_KEY')
    const returnBase  = Deno.env.get('YOOKASSA_RETURN_URL_BASE') ?? 'https://yourtaskflow.app'

    let serviceRoleKey: string | undefined
    try {
      const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>
        if (parsed?.default?.length > 0) serviceRoleKey = parsed.default
      }
    } catch (_e) { /* ignore */ }
    if (!serviceRoleKey) serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || undefined

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: 'Server not configured: SUPABASE env missing' }, 500)
    }
    if (!shopId || !secretKey) {
      return json({ error: 'Server not configured: YOOKASSA env missing' }, 500)
    }

    // ─── Auth ────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Missing Authorization: Bearer <jwt>' }, 401)
    }
    const jwt = authHeader.slice(7)

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) {
      return json({ error: 'Unauthorized: ' + (authErr?.message ?? 'no user') }, 401)
    }
    const userId    = user.id
    const userEmail = user.email

    if (!userEmail) return json({ error: 'User has no email — cannot issue receipt' }, 400)

    // ─── Загружаем текущий entitlement ───────────────────────────────────────
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: ent, error: entErr } = await adminClient
      .from('user_entitlements')
      .select('plan, valid_until, auto_renew, payment_method_id, cancel_at_period_end')
      .eq('user_id', userId)
      .maybeSingle()

    if (entErr) return json({ error: 'DB error: ' + entErr.message }, 500)
    if (!ent) return json({ error: 'No active subscription found' }, 400)

    // ─── Бизнес-правила ──────────────────────────────────────────────────────
    if (ent.plan !== 'pro') {
      return json({ error: 'Upgrade is only available for active Pro subscription' }, 400)
    }
    if (!ent.valid_until) {
      return json({ error: 'Cannot determine current period end' }, 400)
    }

    // Проверяем, не является ли подписка уже annual (valid_until > 300 дней = точно annual)
    const daysLeft = Math.ceil((new Date(ent.valid_until).getTime() - Date.now()) / 86_400_000)
    if (daysLeft > 300) {
      return json({ error: 'Already on annual plan (or close to it). No upgrade needed.' }, 400)
    }

    // ─── Проверяем сохранённую карту ─────────────────────────────────────────
    const { data: pm, error: pmErr } = await adminClient
      .from('payment_methods')
      .select('id, external_id, card_last4, card_brand, title')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle()

    if (pmErr) return json({ error: 'DB error: ' + pmErr.message }, 500)
    if (!pm) {
      return json({
        error: 'No saved payment method. Please add a card first via the checkout.',
        code: 'no_payment_method',
      }, 400)
    }

    // ─── Считаем новый valid_until: текущий + 365 дней ───────────────────────
    const currentUntil = new Date(ent.valid_until)
    const newValidUntil = new Date(currentUntil.getTime() + ANNUAL_DAYS * 86_400_000)

    // ─── Создаём платёж в ЮKassa через сохранённый payment_method_id ─────────
    const idempotenceKey = crypto.randomUUID()
    const description = `TaskFlow Pro Annual (upgrade from monthly) — ${userEmail}`

    const paymentBody = {
      amount: { value: ANNUAL_AMOUNT, currency: 'RUB' },
      capture: true,
      payment_method_id: pm.external_id, // id карты в ЮKassa
      description,
      metadata: {
        user_id: userId,
        tier: 'annual',
        plan: 'pro',
        source: 'taskflow-app',
        upgrade_from: 'monthly',
        renewal: false,
      },
      receipt: {
        customer: { email: userEmail },
        items: [{
          description: 'TaskFlow Pro Annual (upgrade)',
          quantity: '1.00',
          amount: { value: ANNUAL_AMOUNT, currency: 'RUB' },
          vat_code: 1,
          payment_subject: 'service',
          payment_mode: 'full_payment',
        }],
        tax_system_code: 6,
      },
    }

    const basicAuth = btoa(`${shopId}:${secretKey}`)
    const ykRes = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${basicAuth}`,
        'Idempotence-Key': idempotenceKey,
      },
      body: JSON.stringify(paymentBody),
    })

    const ykData = await ykRes.json() as Record<string, unknown>

    if (!ykRes.ok) {
      console.error('[change-plan] YooKassa error:', JSON.stringify(ykData))
      const ykError = (ykData.description as string) ?? `YooKassa error ${ykRes.status}`
      return json({ error: ykError, yookassa_code: ykData.code }, 402)
    }

    const paymentId     = ykData.id as string
    const paymentStatus = ykData.status as string

    // confirmation_url — если ЮKassa требует 3DS
    const confirmationUrl = (ykData.confirmation as Record<string, unknown>)?.confirmation_url as string | undefined

    // ─── Обновляем entitlement ────────────────────────────────────────────────
    // Даже если payment pending (ждём webhook) — но для recurring через
    // saved_method обычно сразу succeeded. Обновляем оптимистично:
    // если платёж вдруг упадёт — webhook обработает refund.
    const isSucceeded = paymentStatus === 'succeeded'
    const isPending   = paymentStatus === 'pending'

    if (isSucceeded || isPending) {
      const { error: updateErr } = await adminClient
        .from('user_entitlements')
        .update({
          valid_until: newValidUntil.toISOString(),
          // Обновляем next_renewal_at — следующее списание через год
          next_renewal_at: new Date(newValidUntil.getTime() - 86_400_000).toISOString(),
          last_payment_id: paymentId,
          last_payment_at: new Date().toISOString(),
          renewal_attempts_count: 0,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)

      if (updateErr) {
        console.error('[change-plan] entitlement update error:', updateErr.message)
        // Не фейлим — платёж прошёл, webhook его тоже обработает
      }

      // Логируем в payment_events для истории
      await adminClient
        .from('payment_events')
        .insert({
          provider: 'yookassa',
          external_id: paymentId,
          user_id: userId,
          event_type: 'payment.succeeded',
          raw_payload: {
            id: paymentId,
            status: paymentStatus,
            amount: { value: ANNUAL_AMOUNT, currency: 'RUB' },
            metadata: { user_id: userId, tier: 'annual', upgrade_from: 'monthly' },
          },
        })
        .then(({ error }) => {
          if (error && error.code !== '23505') { // игнорируем дубли (idempotency)
            console.warn('[change-plan] payment_events insert:', error.message)
          }
        })
    }

    return json({
      ok: true,
      payment_id: paymentId,
      payment_status: paymentStatus,
      new_valid_until: newValidUntil.toISOString(),
      confirmation_url: confirmationUrl ?? null,
      amount: ANNUAL_AMOUNT,
    })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[change-plan] unexpected error:', msg)
    return json({ error: 'Internal server error: ' + msg }, 500)
  }
}

Deno.serve(handler)
