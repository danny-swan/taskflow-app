// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.5.1 — Supabase Edge Function: reactivate-subscription
//
// Обратный toggle cancel-subscription: включает автопродление у ранее отменённой
// подписки. Работает ТОЛЬКО пока valid_until не истёк — если срок вышел,
// пользователь должен купить подписку заново через /checkout.
//
// Auth: JWT required.
// Body: {} — user_id из JWT.
// Response:
//   200 OK: { ok: true, reactivated_at, access_until, plan, next_renewal_at }
//   401: { error }
//   400: { error: 'subscription already active' | 'subscription expired' | ... }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    let supabaseSecretKey: string | undefined
    try {
      const raw = Deno.env.get('SUPABASE_SECRET_KEYS')
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>
        if (parsed && typeof parsed.default === 'string' && parsed.default.length > 0) {
          supabaseSecretKey = parsed.default
        }
      }
    } catch (_e) { /* ignore */ }
    if (!supabaseSecretKey) {
      supabaseSecretKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || undefined
    }

    if (!supabaseUrl || !anonKey || !supabaseSecretKey) {
      return json({ error: 'Server not configured: SUPABASE env missing' }, 500)
    }

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
    const userId = userData.user.id

    // Читаем текущий entitlement
    const entResp = await fetch(
      `${supabaseUrl}/rest/v1/user_entitlements?select=plan,valid_until,auto_renew,cancel_at_period_end,payment_method_id&user_id=eq.${userId}&limit=1`,
      { method: 'GET', headers: { apikey: supabaseSecretKey, Accept: 'application/json' } },
    )
    if (!entResp.ok) {
      return json({ error: 'Failed to load entitlement' }, 500)
    }
    const rows = await entResp.json() as Array<{
      plan: string
      valid_until: string | null
      auto_renew: boolean
      cancel_at_period_end: boolean
      payment_method_id: string | null
    }>
    if (rows.length === 0) {
      return json({ error: 'No entitlement found' }, 404)
    }
    const ent = rows[0]

    if (ent.plan !== 'pro') {
      return json({ error: `Cannot reactivate plan='${ent.plan}'. Only 'pro' subscriptions.` }, 400)
    }
    if (!ent.cancel_at_period_end && ent.auto_renew) {
      return json({
        ok: true,
        already_active: true,
        access_until: ent.valid_until,
        plan: ent.plan,
      }, 200)
    }
    if (!ent.valid_until || new Date(ent.valid_until) <= new Date()) {
      return json({
        error: 'Subscription expired — purchase a new one via /checkout',
        expired_at: ent.valid_until,
      }, 400)
    }
    if (!ent.payment_method_id) {
      return json({
        error: 'No saved payment method — reactivate not possible. Update card via /checkout?mode=update-card',
      }, 400)
    }

    const nowIso = new Date().toISOString()
    const updResp = await fetch(
      `${supabaseUrl}/rest/v1/user_entitlements?user_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          apikey: supabaseSecretKey,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          cancel_at_period_end: false,
          auto_renew: true,
          next_renewal_at: ent.valid_until, // продлится в день окончания
          renewal_attempts_count: 0,
          notes: `reactivated by user at ${nowIso}`,
        }),
      },
    )
    if (!updResp.ok) {
      const errJson = await updResp.json().catch(() => ({}))
      return json({ error: 'DB update failed', db_error: errJson }, 500)
    }

    return json({
      ok: true,
      reactivated_at: nowIso,
      access_until: ent.valid_until,
      next_renewal_at: ent.valid_until,
      plan: ent.plan,
    }, 200)
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unknown error' }, 500)
  }
}

Deno.serve(handler)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
