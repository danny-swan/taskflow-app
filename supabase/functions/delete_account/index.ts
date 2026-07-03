// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.11 — Supabase Edge Function: delete_account
//
// Позволяет аутентифицированному пользователю удалить собственную учётную запись
// вместе со связанными строками (profiles, telemetry_events и т.п.) через каскад
// на уровне БД. Anon key такого делать не даёт — нужен service_role, поэтому
// логика вынесена в Edge Function.
//
// Deploy:
//   supabase functions deploy delete_account --project-ref sejpmzrmtgcvevukggkx
//
// Клиент вызывает:
//   const { error } = await supabase.functions.invoke('delete_account');
//
// SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY подставляются Supabase runtime'ом
// автоматически (secrets управляются в Dashboard → Edge Functions → Secrets).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!jwt) {
      return json({ error: 'Missing Authorization header' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Server not configured' }, 500)
    }

    // Admin-клиент (service role) — только для admin.deleteUser.
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Проверяем JWT и достаём user из него.
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !userData?.user) {
      return json({ error: 'Invalid or expired token' }, 401)
    }
    const userId = userData.user.id

    // Каскад на уровне БД удалит profiles и т.п. (см. миграцию 0001_init.sql).
    const { error: delErr } = await admin.auth.admin.deleteUser(userId)
    if (delErr) {
      return json({ error: delErr.message }, 500)
    }

    return json({ ok: true, deleted_user_id: userId }, 200)
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unknown error' }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
