// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6 — Supabase Edge Function: activation-notify
//
// Триггерится Database Webhook'ом на INSERT в activation_requests. Отправляет
// уведомление админу через Resend API.
//
// Настройка (одноразово):
//   1. Deploy:
//        supabase functions deploy activation-notify --project-ref sejpmzrmtgcvevukggkx --no-verify-jwt
//      (--no-verify-jwt обязателен: DB Webhook не отправляет пользовательский JWT.)
//   2. Secrets в Dashboard → Edge Functions → activation-notify → Secrets:
//        RESEND_API_KEY   — API-ключ Resend (https://resend.com/api-keys)
//        ADMIN_EMAIL      — по умолчанию 'lebedevdo.one@gmail.com'
//        RESEND_FROM      — например 'TaskFlow <noreply@taskflow.app>' (домен верифицирован в Resend)
//        WEBHOOK_SECRET   — общий секрет, устанавливаемый в заголовке Webhook'а
//   3. Database → Webhooks → Create:
//        Table: activation_requests
//        Events: INSERT
//        HTTP Request → Method POST, URL:
//          https://sejpmzrmtgcvevukggkx.functions.supabase.co/activation-notify
//        HTTP Headers:
//          x-webhook-secret: <WEBHOOK_SECRET>
//
// Идемпотентность: сама Postgres триггерит по одному разу на строку, но на
// всякий случай (retry со стороны Supabase) — записываем `notified_at` в
// activation_requests, чтобы повторное срабатывание не спамило админа.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ─── Payload от Supabase Database Webhook ─────────────────────────────────────
// См. https://supabase.com/docs/guides/database/webhooks — INSERT event.
interface DbWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  schema: string
  record: ActivationRequestRow | null
  old_record: ActivationRequestRow | null
}

interface ActivationRequestRow {
  id: string
  created_at: string
  user_id: string
  email: string
  plan_requested: 'monthly' | 'annual' | 'lifetime'
  provider_hint: string
  tx_ref: string
  admin_notes: string | null
  status: 'pending' | 'approved' | 'rejected'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    // ─── 1. Проверяем webhook secret ────────────────────────────────────────
    const expectedSecret = Deno.env.get('WEBHOOK_SECRET')
    const gotSecret = req.headers.get('x-webhook-secret') || ''
    if (!expectedSecret) {
      // Если секрет не сконфигурирован — отклоняем, чтобы не оставлять
      // публичную ручку для рассылки.
      return json({ error: 'Server not configured: WEBHOOK_SECRET missing' }, 500)
    }
    if (!constantTimeEquals(expectedSecret, gotSecret)) {
      return json({ error: 'Invalid webhook secret' }, 401)
    }

    // ─── 2. Парсим payload ──────────────────────────────────────────────────
    let payload: DbWebhookPayload
    try {
      payload = await req.json() as DbWebhookPayload
    } catch {
      return json({ error: 'Invalid JSON payload' }, 400)
    }

    if (payload.type !== 'INSERT' || payload.table !== 'activation_requests' || !payload.record) {
      // Ignore — не наше событие.
      return json({ ok: true, skipped: 'not an activation_requests INSERT' }, 200)
    }

    const row = payload.record

    // ─── 3. Идемпотентность: помечаем notified_at ───────────────────────────
    // Колонка notified_at добавлена миграцией 0007 (см. supabase/migrations).
    // Если она уже установлена — значит нотификацию уже отправляли, скипаем.
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'Server not configured: SUPABASE_URL / SERVICE_ROLE missing' }, 500)
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Атомарный UPDATE ... WHERE notified_at IS NULL — если 0 строк обновилось,
    // значит кто-то уже нотифицировал (например, retry).
    const { data: updRows, error: updErr } = await admin
      .from('activation_requests')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('notified_at', null)
      .select('id')

    if (updErr) {
      return json({ error: 'Failed to mark notified_at: ' + updErr.message }, 500)
    }
    if (!updRows || updRows.length === 0) {
      return json({ ok: true, skipped: 'already notified' }, 200)
    }

    // ─── 4. Отправляем email через Resend ───────────────────────────────────
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const adminEmail = Deno.env.get('ADMIN_EMAIL') || 'lebedevdo.one@gmail.com'
    const fromAddr = Deno.env.get('RESEND_FROM') || 'TaskFlow <onboarding@resend.dev>'
    if (!resendKey) {
      // Если Resend ещё не сконфигурирован — возвращаем 200, чтобы Supabase
      // не ретраил бесконечно; но лог оставляем в admin_notes для admin'а.
      console.warn('[activation-notify] RESEND_API_KEY not set, skipping email')
      return json({ ok: true, skipped: 'RESEND_API_KEY not set' }, 200)
    }

    const priceMap: Record<string, string> = {
      monthly: '299 ₽/мес',
      annual: '2 990 ₽/год',
      lifetime: '4 990 ₽ (Lifetime)',
    }
    const priceStr = priceMap[row.plan_requested] ?? row.plan_requested

    const subject = `[TaskFlow] Заявка на активацию: ${row.email} — ${priceStr}`
    const bodyText = [
      `Новая заявка на ручную активацию подписки.`,
      ``,
      `Пользователь:  ${row.email}`,
      `User ID:       ${row.user_id}`,
      `Тариф:         ${priceStr}`,
      `Метод оплаты:  ${row.provider_hint}`,
      `TX / хэш:      ${row.tx_ref}`,
      `Комментарий:   ${row.admin_notes ?? '(нет)'}`,
      `Создана:       ${row.created_at}`,
      `Request ID:    ${row.id}`,
      ``,
      `Проверить платёж и активировать через SQL или admin-панель /admin (dev.6.3).`,
    ].join('\n')

    const bodyHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #28251D; max-width: 560px;">
        <h2 style="color: #01696F; margin-bottom: 8px;">Заявка на активацию подписки TaskFlow</h2>
        <p style="color: #7A7974; margin-top: 0;">Пользователь оставил заявку на ручную активацию.</p>
        <table style="border-collapse: collapse; width: 100%; margin-top: 16px; font-size: 14px;">
          <tbody>
            ${row2html('Пользователь', escapeHtml(row.email))}
            ${row2html('User ID', `<code>${escapeHtml(row.user_id)}</code>`)}
            ${row2html('Тариф', `<b>${escapeHtml(priceStr)}</b>`)}
            ${row2html('Метод оплаты', escapeHtml(row.provider_hint))}
            ${row2html('TX / хэш', `<code style="word-break: break-all;">${escapeHtml(row.tx_ref)}</code>`)}
            ${row2html('Комментарий', row.admin_notes ? escapeHtml(row.admin_notes) : '<i style="color:#BAB9B4;">(нет)</i>')}
            ${row2html('Создана', escapeHtml(new Date(row.created_at).toLocaleString('ru-RU')))}
            ${row2html('Request ID', `<code style="font-size: 11px;">${escapeHtml(row.id)}</code>`)}
          </tbody>
        </table>
        <p style="color: #7A7974; margin-top: 24px; font-size: 12px; border-top: 1px solid #D4D1CA; padding-top: 12px;">
          TaskFlow · v0.9.35-dev.6 · автоматическое уведомление
        </p>
      </div>
    `

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: [adminEmail],
        subject,
        text: bodyText,
        html: bodyHtml,
      }),
    })

    if (!resendResp.ok) {
      const errBody = await resendResp.text().catch(() => '(no body)')
      console.error('[activation-notify] Resend failed:', resendResp.status, errBody)
      // Не откатываем notified_at: retry уместен только при 5xx. Возвращаем
      // 502, чтобы Supabase зарегистрировал ошибку в логах Webhook'а.
      return json({ error: `Resend failed: ${resendResp.status}`, detail: errBody }, 502)
    }

    return json({ ok: true, notified_admin: adminEmail, request_id: row.id }, 200)
  } catch (e) {
    return json({ error: (e as Error).message ?? 'Unknown error' }, 500)
  }
})

// ─── helpers ──────────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

/** Timing-safe comparison to prevent side-channel token guessing. */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function row2html(label: string, value: string): string {
  return `
    <tr>
      <td style="padding: 6px 12px 6px 0; color: #7A7974; vertical-align: top; white-space: nowrap;">${label}</td>
      <td style="padding: 6px 0; color: #28251D;">${value}</td>
    </tr>
  `
}
