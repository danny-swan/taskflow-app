// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.6 — Supabase Edge Function: admin-actions
//
// Единая точка для административных действий над entitlements.
// ТОЛЬКО для пользователей с user_role='admin' (проверяется через service_role).
//
// Auth: JWT required. Пользователь должен быть admin — проверка через
//       profiles.user_role = 'admin' (или VITE_ADMIN_EMAILS в env).
//
// Поддерживаемые действия (action в body):
//
//   set-plan      — ручная установка плана
//     { action: 'set-plan', target_user_id, plan, valid_until?, notes? }
//     → 200: { ok: true, user_id, plan, valid_until }
//
//   extend        — добавить N дней к valid_until
//     { action: 'extend', target_user_id, days, notes? }
//     → 200: { ok: true, user_id, new_valid_until, added_days }
//
//   cancel        — поставить cancel_at_period_end=true (мягкая отмена)
//     { action: 'cancel', target_user_id }
//     → 200: { ok: true, user_id, access_until }
//
// HTTP:
//   POST /functions/v1/admin-actions
//   Authorization: Bearer <jwt>
//   Content-Type: application/json
//   Body: { action, ...params }
//
// Errors:
//   401 — нет JWT / invalid
//   403 — не администратор
//   400 — неверные параметры
//   404 — target_user_id не найден
//   500 — серверная ошибка

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

// Допустимые планы для set-plan
const VALID_PLANS = ['free', 'trial', 'pro', 'lifetime'] as const
type PlanKind = typeof VALID_PLANS[number]

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')

    // service_role key — поддерживаем оба варианта хранения
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

    // ─── Auth: JWT required ───────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Missing Authorization: Bearer <jwt>' }, 401)
    }
    const jwt = authHeader.slice(7)

    // Используем anon-client с JWT юзера — getUser верифицирует токен
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) {
      return json({ error: 'Unauthorized: ' + (authErr?.message ?? 'no user') }, 401)
    }
    const callerId = user.id

    // ─── Admin check ──────────────────────────────────────────────────────────
    // Проверяем через service_role, чтобы caller не мог подделать
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // Проверяем через ADMIN_EMAILS env (те же, что во VITE_ADMIN_EMAILS)
    const adminEmailsEnv = Deno.env.get('ADMIN_EMAILS') || ''
    const adminEmails = adminEmailsEnv
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0)

    const callerEmail = user.email?.toLowerCase() ?? ''
    const isAdminByEmail = adminEmails.length > 0 && adminEmails.includes(callerEmail)

    // Fallback: проверяем user_entitlements.source = 'seed' (гранфазированный admin)
    let isAdminBySeed = false
    if (!isAdminByEmail) {
      const { data: ent } = await adminClient
        .from('user_entitlements')
        .select('source, plan')
        .eq('user_id', callerId)
        .maybeSingle()
      isAdminBySeed = ent?.source === 'seed' && ent?.plan === 'lifetime'
    }

    if (!isAdminByEmail && !isAdminBySeed) {
      return json({ error: 'Forbidden: admin access required' }, 403)
    }

    // ─── Parse body ───────────────────────────────────────────────────────────
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const action = body.action as string
    if (!action) return json({ error: 'Missing action' }, 400)

    // ─── Actions ──────────────────────────────────────────────────────────────

    // ── set-plan ──
    if (action === 'set-plan') {
      const targetUserId = body.target_user_id as string
      const plan = body.plan as string
      const validUntil = body.valid_until as string | null | undefined
      const notes = body.notes as string | undefined

      if (!targetUserId) return json({ error: 'Missing target_user_id' }, 400)
      if (!VALID_PLANS.includes(plan as PlanKind)) {
        return json({ error: `Invalid plan: ${plan}. Must be one of: ${VALID_PLANS.join(', ')}` }, 400)
      }

      // Validate valid_until
      let parsedValidUntil: string | null = null
      if (plan === 'pro' || plan === 'trial') {
        if (!validUntil) return json({ error: 'valid_until required for pro/trial plan' }, 400)
        const d = new Date(validUntil)
        if (isNaN(d.getTime())) return json({ error: 'Invalid valid_until date' }, 400)
        parsedValidUntil = d.toISOString()
      } else if (plan === 'lifetime') {
        parsedValidUntil = null
      } else if (plan === 'free') {
        parsedValidUntil = null
      }

      // Verify target user exists
      const { data: targetUser, error: targetErr } = await adminClient.auth.admin.getUserById(targetUserId)
      if (targetErr || !targetUser?.user) {
        return json({ error: `User not found: ${targetUserId}` }, 404)
      }

      const adminNote = `[admin:${callerEmail}] set-plan → ${plan} at ${new Date().toISOString()}` +
        (notes ? `\n${notes}` : '')

      const { data: updated, error: upsertErr } = await adminClient
        .from('user_entitlements')
        .upsert({
          user_id: targetUserId,
          plan: plan as PlanKind,
          valid_until: parsedValidUntil,
          source: 'admin',
          notes: adminNote,
          updated_at: new Date().toISOString(),
          // Если ставим free — сбрасываем авто-продление
          ...(plan === 'free' ? { auto_renew: false, cancel_at_period_end: false } : {}),
        }, { onConflict: 'user_id' })
        .select('user_id, plan, valid_until, updated_at')
        .single()

      if (upsertErr) return json({ error: 'DB error: ' + upsertErr.message }, 500)

      return json({ ok: true, user_id: targetUserId, plan, valid_until: parsedValidUntil, updated_at: updated?.updated_at })
    }

    // ── extend ──
    if (action === 'extend') {
      const targetUserId = body.target_user_id as string
      const days = Number(body.days)
      const notes = body.notes as string | undefined

      if (!targetUserId) return json({ error: 'Missing target_user_id' }, 400)
      if (!days || days < 1 || days > 3650) return json({ error: 'days must be 1–3650' }, 400)

      // Получаем текущий entitlement
      const { data: ent, error: entErr } = await adminClient
        .from('user_entitlements')
        .select('plan, valid_until')
        .eq('user_id', targetUserId)
        .maybeSingle()

      if (entErr) return json({ error: 'DB error: ' + entErr.message }, 500)
      if (!ent) return json({ error: `No entitlement found for user ${targetUserId}` }, 404)
      if (ent.plan === 'lifetime') return json({ error: 'Cannot extend lifetime plan' }, 400)

      // Считаем новую дату: от MAX(valid_until, now) + days
      const base = ent.valid_until ? new Date(ent.valid_until) : new Date()
      const now = new Date()
      const from = base > now ? base : now
      const newValidUntil = new Date(from.getTime() + days * 86_400_000)

      const adminNote = `[admin:${callerEmail}] extend +${days}d → ${newValidUntil.toISOString()} at ${new Date().toISOString()}` +
        (notes ? `\n${notes}` : '')

      const { error: updateErr } = await adminClient
        .from('user_entitlements')
        .update({
          valid_until: newValidUntil.toISOString(),
          notes: adminNote,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', targetUserId)

      if (updateErr) return json({ error: 'DB error: ' + updateErr.message }, 500)

      return json({ ok: true, user_id: targetUserId, added_days: days, new_valid_until: newValidUntil.toISOString() })
    }

    // ── cancel ──
    if (action === 'cancel') {
      const targetUserId = body.target_user_id as string
      if (!targetUserId) return json({ error: 'Missing target_user_id' }, 400)

      const { data: ent, error: entErr } = await adminClient
        .from('user_entitlements')
        .select('plan, valid_until, cancel_at_period_end')
        .eq('user_id', targetUserId)
        .maybeSingle()

      if (entErr) return json({ error: 'DB error: ' + entErr.message }, 500)
      if (!ent) return json({ error: `No entitlement found for user ${targetUserId}` }, 404)

      const adminNote = `[admin:${callerEmail}] cancel (set cancel_at_period_end) at ${new Date().toISOString()}`

      const { error: updateErr } = await adminClient
        .from('user_entitlements')
        .update({
          cancel_at_period_end: true,
          auto_renew: false,
          notes: adminNote,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', targetUserId)

      if (updateErr) return json({ error: 'DB error: ' + updateErr.message }, 500)

      return json({ ok: true, user_id: targetUserId, access_until: ent.valid_until })
    }

    return json({ error: `Unknown action: ${action}` }, 400)

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[admin-actions] unexpected error:', msg)
    return json({ error: 'Internal server error: ' + msg }, 500)
  }
}

Deno.serve(handler)
