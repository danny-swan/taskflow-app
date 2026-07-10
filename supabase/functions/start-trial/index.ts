// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6 — Supabase Edge Function: start-trial
//
// Активирует 14-дневный trial для аутентифицированного пользователя.
// Клиент вызывает через supabase.functions.invoke('start-trial').
//
// Идемпотентность гарантируется двумя уровнями:
//   1. Уникальность user_id в user_entitlements (PK).
//   2. Флаг trial_used — если true, отказываем (trial уже был).
//
// Deploy:
//   supabase functions deploy start-trial --project-ref "$SUPABASE_PROJECT_REF"
//
// Secrets (Dashboard → Edge Functions → start-trial → Secrets):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (Supabase проставит сама)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'
import { corsHeaders } from '../_shared/cors.ts'

const TRIAL_DAYS = 14

Deno.serve(async (req) => {
  const CORS_HEADERS = corsHeaders(req.headers.get('origin'))
  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    // ─── 1. JWT из клиента ────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json({ error: 'Server not configured' }, 500)
    }

    // ─── 2. Проверяем JWT ─────────────────────────────────────────────────
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user) {
      return json({ error: 'Invalid or expired token', detail: userErr?.message }, 401)
    }
    const user = userData.user
    const userId = user.id

    // ─── 3. Admin client для read/write user_entitlements ─────────────────
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Читаем существующий row, чтобы проверить trial_used и уже активный plan.
    const { data: existingRow, error: fetchErr } = await admin
      .from('user_entitlements')
      .select('user_id, plan, valid_until, trial_used, source')
      .eq('user_id', userId)
      .maybeSingle()

    if (fetchErr) {
      return json({ error: 'Failed to fetch entitlement: ' + fetchErr.message }, 500)
    }

    // ─── 4. Guard: уже Pro / Lifetime / был Trial ─────────────────────────
    if (existingRow) {
      if (existingRow.plan === 'lifetime') {
        return json({ error: 'You already have a Lifetime plan', code: 'already_lifetime' }, 409)
      }
      if (existingRow.plan === 'pro') {
        // Проверяем не истёк ли pro
        const now = new Date()
        const validUntil = existingRow.valid_until ? new Date(existingRow.valid_until) : null
        if (!validUntil || validUntil > now) {
          return json({ error: 'You already have an active Pro subscription', code: 'already_pro' }, 409)
        }
      }
      if (existingRow.trial_used) {
        return json({ error: 'Trial has already been used for this account', code: 'trial_already_used' }, 409)
      }
      // Кейс plan='trial' с trial_used=false невозможен (наши миграции ставят
      // trial_used=true при создании trial), но проверим на всякий случай.
      if (existingRow.plan === 'trial') {
        return json({ error: 'Trial already active', code: 'trial_active' }, 409)
      }
    }

    // ─── 5. Активируем trial ──────────────────────────────────────────────
    const now = new Date()
    const validUntil = new Date(now.getTime() + TRIAL_DAYS * 86_400_000)

    const { data: upserted, error: upsertErr } = await admin
      .from('user_entitlements')
      .upsert({
        user_id: userId,
        plan: 'trial',
        valid_until: validUntil.toISOString(),
        activated_at: now.toISOString(),
        source: 'trial',
        trial_used: true,
        notes: 'Started via start-trial Edge Function',
        updated_at: now.toISOString(),
      }, {
        onConflict: 'user_id',
      })
      .select('user_id, plan, valid_until, trial_used')
      .single()

    if (upsertErr) {
      return json({ error: 'Failed to upsert entitlement: ' + upsertErr.message }, 500)
    }

    return json({
      ok: true,
      user_id: userId,
      plan: upserted.plan,
      valid_until: upserted.valid_until,
      trial_days: TRIAL_DAYS,
    }, 200)
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unknown error' }, 500)
  }
})
