// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.5.1 — Supabase Edge Function: cancel-subscription
//
// Ставит cancel_at_period_end=true для активной pro-подписки текущего юзера.
// Доступ сохраняется до окончания valid_until — просто не будет автопродления.
//
// Auth: JWT required — user_id из auth.getUser().
// Body: {} (или отсутствует) — user_id берётся из JWT.
// Response:
//   200 OK: { ok: true, cancelled_at: ISO, access_until: ISO | null, plan }
//   401: { error } — нет JWT / invalid
//   404: { error: 'no active pro subscription' }
//   500: { error }
//
// Мы НЕ удаляем payment_method из ЮKassa — вдруг юзер передумает и включит
// автопродление обратно через reactivate-subscription. Метод остаётся
// is_active=true до момента, когда юзер явно поменяет карту.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { corsHeaders } from '../_shared/cors.ts'

export const handler = async (req: Request): Promise<Response> => {
  const CORS_HEADERS = corsHeaders(req)

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })

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

    // ─── Auth: JWT required ──
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Missing Authorization: Bearer <jwt>' }, 401)
    }

    // Используем anon client с JWT юзера — supabase-js сам вызовет getUser
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: userData, error: userErr } = await supabase.auth.getUser()
    if (userErr || !userData?.user) {
      return json({ error: 'Invalid or expired JWT' }, 401)
    }
    const userId = userData.user.id

    // ─── Читаем текущий entitlement (через admin, чтобы обойти RLS для точной проверки) ──
    // Строгий фильтр plan='pro' на UPDATE — lifetime отменять нельзя (у него нет автопродления).
    const entRes = await fetch(
      `${supabaseUrl}/rest/v1/user_entitlements?select=plan,valid_until,auto_renew,cancel_at_period_end&user_id=eq.${userId}&limit=1`,
      { method: 'GET', headers: { apikey: supabaseSecretKey, Accept: 'application/json' } },
    )
    if (!entRes.ok) {
      return json({ error: 'Failed to load entitlement' }, 500)
    }
    const rows = await entRes.json() as Array<{
      plan: string
      valid_until: string | null
      auto_renew: boolean
      cancel_at_period_end: boolean
    }>
    if (rows.length === 0) {
      return json({ error: 'No entitlement found for this user' }, 404)
    }
    const ent = rows[0]

    if (ent.plan !== 'pro') {
      // lifetime отменять бессмысленно; free нечего отменять
      return json({
        error: `Cannot cancel plan='${ent.plan}'. Only 'pro' subscriptions can be cancelled.`,
      }, 400)
    }
    if (ent.cancel_at_period_end) {
      // Идемпотентный ответ — уже отменено
      return json({
        ok: true,
        already_cancelled: true,
        cancelled_at: new Date().toISOString(),
        access_until: ent.valid_until,
        plan: ent.plan,
      }, 200)
    }

    // ─── Ставим cancel_at_period_end=true ──
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
          cancel_at_period_end: true,
          auto_renew: false, // сразу отключаем, чтобы cron не пытался списать
          notes: `cancelled by user at ${nowIso}`,
        }),
      },
    )
    if (!updResp.ok) {
      const errJson = await updResp.json().catch(() => ({}))
      return json({ error: 'DB update failed', db_error: errJson }, 500)
    }

    return json({
      ok: true,
      cancelled_at: nowIso,
      access_until: ent.valid_until,
      plan: ent.plan,
    }, 200)
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unknown error' }, 500)
  }
}

Deno.serve(handler)

