// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.5.2 — Supabase Edge Function: detach-payment-method
//
// Отвязывает (деактивирует) сохранённую карту текущего юзера. Требование ЮKassa:
// пользователь должен иметь возможность самостоятельно отвязать карту от сервиса
// без обращения в поддержку — это условие для включения автоплатежей.
//
// Что делает:
//   1) Помечает все активные payment_methods юзера как is_active=false.
//   2) В user_entitlements: обнуляет payment_method_id, выключает auto_renew,
//      ставит cancel_at_period_end=true (доступ по valid_until сохраняется,
//      но автопродления больше не будет — cron не найдёт метод для списания).
//
// Мы НЕ вызываем ЮKassa для удаления payment_method: у ЮKassa нет отдельного
// метода "забыть карту" — сохранённый payment_method_id просто перестаёт
// использоваться, потому что мы больше не отправляем по нему рекуррентные
// списания. Достаточно локальной деактивации.
//
// Auth: JWT required — user_id из auth.getUser().
// Body: {} (или отсутствует) — user_id берётся из JWT.
// Response:
//   200 OK: { ok: true, detached_at: ISO, detached_count: number, already_detached?: true }
//   401: { error } — нет JWT / invalid
//   500: { error }

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

    // ─── Auth: JWT required ──
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Missing Authorization: Bearer <jwt>' }, 401)
    }

    // anon client с JWT юзера — supabase-js сам вызовет getUser
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: userData, error: userErr } = await supabase.auth.getUser()
    if (userErr || !userData?.user) {
      return json({ error: 'Invalid or expired JWT' }, 401)
    }
    const userId = userData.user.id

    const nowIso = new Date().toISOString()

    // ─── 1) Читаем активные карты (admin, чтобы точно посчитать что деактивируем) ──
    const pmRes = await fetch(
      `${supabaseUrl}/rest/v1/payment_methods?select=id&user_id=eq.${userId}&is_active=eq.true`,
      { method: 'GET', headers: { apikey: supabaseSecretKey, Accept: 'application/json' } },
    )
    if (!pmRes.ok) {
      return json({ error: 'Failed to load payment methods' }, 500)
    }
    const activeCards = await pmRes.json() as Array<{ id: string }>

    // Идемпотентность: нет активных карт — но всё равно чистим entitlement на
    // случай рассинхрона (auto_renew мог остаться true без карты).
    if (activeCards.length === 0) {
      await clearEntitlement(supabaseUrl, supabaseSecretKey, userId, nowIso)
      return json({
        ok: true,
        already_detached: true,
        detached_at: nowIso,
        detached_count: 0,
      }, 200)
    }

    // ─── 2) Деактивируем все активные карты юзера ──
    const deactResp = await fetch(
      `${supabaseUrl}/rest/v1/payment_methods?user_id=eq.${userId}&is_active=eq.true`,
      {
        method: 'PATCH',
        headers: {
          apikey: supabaseSecretKey,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ is_active: false, updated_at: nowIso }),
      },
    )
    if (!deactResp.ok) {
      const errJson = await deactResp.json().catch(() => ({}))
      return json({ error: 'Failed to deactivate payment methods', db_error: errJson }, 500)
    }

    // ─── 3) Чистим entitlement (обнуляем payment_method_id, выключаем автопродление) ──
    const cleared = await clearEntitlement(supabaseUrl, supabaseSecretKey, userId, nowIso)
    if (!cleared.ok) {
      return json({ error: 'Failed to update entitlement', db_error: cleared.error }, 500)
    }

    return json({
      ok: true,
      detached_at: nowIso,
      detached_count: activeCards.length,
    }, 200)
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unknown error' }, 500)
  }
}

/**
 * Обнуляет привязку карты в user_entitlements: payment_method_id=null,
 * auto_renew=false, cancel_at_period_end=true. Доступ (valid_until) не трогаем.
 * Возвращает { ok } или { ok:false, error } — но не бросает (best-effort в
 * идемпотентной ветке).
 */
async function clearEntitlement(
  supabaseUrl: string,
  secretKey: string,
  userId: string,
  nowIso: string,
): Promise<{ ok: boolean; error?: unknown }> {
  const resp = await fetch(
    `${supabaseUrl}/rest/v1/user_entitlements?user_id=eq.${userId}`,
    {
      method: 'PATCH',
      headers: {
        apikey: secretKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        payment_method_id: null,
        auto_renew: false,
        cancel_at_period_end: true,
        notes: `card detached by user at ${nowIso}`,
        updated_at: nowIso,
      }),
    },
  )
  if (!resp.ok) {
    const errJson = await resp.json().catch(() => ({}))
    return { ok: false, error: errJson }
  }
  return { ok: true }
}

Deno.serve(handler)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
