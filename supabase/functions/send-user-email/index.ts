/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.35-dev.6.5.1 — Edge Function send-user-email.
 *
 * Единая точка отправки транзакционных писем пользователю через Resend
 * для recurring-цикла (авторенью и рефанды). Поддерживает три шаблона:
 *
 *   1. subscription_renewed — подписка успешно продлена автосписанием.
 *   2. renewal_failed        — очередная попытка автосписания не прошла
 *                               (attempt_no + retry_at + CTA обновить карту).
 *   3. refund_completed      — возврат средств завершён (обычно 1₽ трейл
 *                               update-card или downgrade-refund).
 *
 * Каждый шаблон рендерится по языку пользователя (`ru` | `en`) — язык
 * приходит в теле запроса или дефолтом ставится 'ru'. Все шаблоны
 * содержат plain-text и HTML версии.
 *
 * Вызов (только с service_role, cross-function):
 *
 *   POST /functions/v1/send-user-email
 *   Headers: Authorization: Bearer <SERVICE_ROLE_KEY>
 *            (opcode Supabase — verify_jwt off, аутентификация ключом)
 *   Body: {
 *     "to":         "user@example.com",
 *     "language":   "ru" | "en",              // default 'ru'
 *     "template":   "subscription_renewed" | "renewal_failed" | "refund_completed",
 *     "params":     { ...template-specific... }
 *   }
 *
 *   Response 200: { ok: true, email_id: "..." }
 *   Response 4xx: { error: "..." }
 *
 * Env vars (Supabase secrets):
 *   RESEND_API_KEY     — API-ключ Resend.
 *   RESEND_FROM        — from-адрес, напр. `TaskFlow <no-reply@yourtaskflow.app>`.
 *   INTERNAL_SHARED_SECRET — secret для проверки, что вызов идёт из наших
 *                            Edge Functions (payment-webhook / renew-subscription).
 *                            Передаётся в заголовке `x-internal-token`.
 *   PUBLIC_APP_URL     — базовый URL приложения (напр. https://yourtaskflow.app),
 *                        используется для CTA-ссылок «Обновить карту».
 */

// deno-lint-ignore-file no-explicit-any

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Language = 'ru' | 'en'
type TemplateName = 'subscription_renewed' | 'renewal_failed' | 'refund_completed'

interface RequestBody {
  to?: string
  language?: string
  template?: string
  params?: Record<string, any>
}

interface RenderedEmail {
  subject: string
  text: string
  html: string
}

// ─── Server ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    // ─── 1. Внутренняя аутентификация ───────────────────────────────────────
    // Функция вызывается только другими Edge Functions или CRON, никогда с
    // клиента. Проверяем x-internal-token, чтобы не превратиться в спам-шлюз.
    const internalSecret = Deno.env.get('INTERNAL_SHARED_SECRET')
    if (!internalSecret) {
      console.error('[send-user-email] INTERNAL_SHARED_SECRET not set')
      return json({ error: 'Server misconfigured (secret missing)' }, 500)
    }
    const providedToken = req.headers.get('x-internal-token') ?? ''
    if (!constantTimeEquals(providedToken, internalSecret)) {
      return json({ error: 'Forbidden' }, 403)
    }

    // ─── 2. Разбор запроса ──────────────────────────────────────────────────
    let body: RequestBody
    try {
      body = await req.json()
    } catch {
      return json({ error: 'Invalid JSON body' }, 400)
    }

    const to = body.to
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return json({ error: 'Missing or invalid `to`' }, 400)
    }

    const language: Language = body.language === 'en' ? 'en' : 'ru'
    const template = body.template as TemplateName | undefined
    if (!template || !['subscription_renewed', 'renewal_failed', 'refund_completed'].includes(template)) {
      return json({ error: 'Missing or invalid `template`' }, 400)
    }
    const params = (body.params && typeof body.params === 'object') ? body.params : {}

    // ─── 3. Рендер письма ────────────────────────────────────────────────────
    let rendered: RenderedEmail
    try {
      rendered = renderTemplate(template, language, params)
    } catch (e) {
      return json({ error: `Render failed: ${(e as Error).message}` }, 400)
    }

    // ─── 4. Отправка через Resend ────────────────────────────────────────────
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const fromAddr = Deno.env.get('RESEND_FROM') || 'TaskFlow <no-reply@yourtaskflow.app>'
    if (!resendKey) {
      console.warn('[send-user-email] RESEND_API_KEY not set — email skipped')
      return json({ ok: true, skipped: 'RESEND_API_KEY not set' }, 200)
    }

    const resendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddr,
        to: [to],
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        tags: [
          { name: 'template', value: template },
          { name: 'language', value: language },
        ],
      }),
    })

    if (!resendResp.ok) {
      const errBody = await resendResp.text().catch(() => '(no body)')
      console.error('[send-user-email] Resend failed:', resendResp.status, errBody)
      return json({ error: `Resend failed: ${resendResp.status}`, detail: errBody }, 502)
    }

    const respJson = await resendResp.json().catch(() => ({}))
    return json({ ok: true, email_id: respJson?.id ?? null, template, language }, 200)
  } catch (e) {
    console.error('[send-user-email] unexpected:', e)
    return json({ error: (e as Error).message ?? 'Unknown error' }, 500)
  }
})

// ─── Templates ───────────────────────────────────────────────────────────────

function renderTemplate(
  template: TemplateName,
  lang: Language,
  params: Record<string, any>,
): RenderedEmail {
  const appUrl = Deno.env.get('PUBLIC_APP_URL') || 'https://yourtaskflow.app'
  const updateCardUrl = `${appUrl.replace(/\/$/, '')}/checkout?mode=update-card`

  switch (template) {
    case 'subscription_renewed':
      return renderSubscriptionRenewed(lang, params, appUrl)
    case 'renewal_failed':
      return renderRenewalFailed(lang, params, updateCardUrl)
    case 'refund_completed':
      return renderRefundCompleted(lang, params)
  }
}

// ── 1. subscription_renewed ──────────────────────────────────────────────────
// params: { plan: 'monthly'|'annual', amount_rub: number, next_renewal_at: ISO,
//           payment_last4?: string }

function renderSubscriptionRenewed(
  lang: Language,
  params: Record<string, any>,
  _appUrl: string,
): RenderedEmail {
  const plan = String(params.plan ?? 'monthly')
  const amount = formatRub(params.amount_rub, lang)
  const nextRenewalAt = formatDate(params.next_renewal_at, lang)
  const last4 = params.payment_last4 ? String(params.payment_last4) : null

  if (lang === 'en') {
    const subject = `TaskFlow Pro renewed — ${amount}`
    const planLabel = plan === 'annual' ? 'annual' : 'monthly'
    const cardLine = last4 ? `Card: •••• ${last4}\n` : ''
    const text = [
      `Your TaskFlow Pro ${planLabel} plan has been renewed.`,
      ``,
      `Amount charged: ${amount}`,
      cardLine + `Next renewal:   ${nextRenewalAt}`,
      ``,
      `Thank you for staying with TaskFlow.`,
      ``,
      `If you need a receipt or want to cancel auto-renewal, open Settings → Subscription management inside the app.`,
    ].join('\n')
    const html = wrapHtml(
      `TaskFlow Pro renewed`,
      `Your <b>${planLabel}</b> plan was renewed successfully.`,
      [
        ['Amount charged', escapeHtml(amount)],
        ...(last4 ? [['Card', `•••• ${escapeHtml(last4)}`] as const] : []),
        ['Next renewal', escapeHtml(nextRenewalAt)],
      ],
      `You can cancel auto-renewal or manage payment methods anytime in Settings → Subscription management.`,
      'en',
    )
    return { subject, text, html }
  }

  const subject = `TaskFlow Pro продлён — ${amount}`
  const planLabel = plan === 'annual' ? 'годовой' : 'месячный'
  const cardLine = last4 ? `Карта:            •••• ${last4}\n` : ''
  const text = [
    `Ваш тариф TaskFlow Pro (${planLabel}) успешно продлён.`,
    ``,
    `Сумма списания:   ${amount}`,
    cardLine + `Следующее продление: ${nextRenewalAt}`,
    ``,
    `Спасибо, что остаётесь с TaskFlow.`,
    ``,
    `Если нужна квитанция или вы хотите отключить автопродление — откройте Настройки → Управление подпиской в приложении.`,
  ].join('\n')
  const html = wrapHtml(
    `TaskFlow Pro продлён`,
    `Ваш тариф <b>${planLabel}</b> успешно продлён автосписанием.`,
    [
      ['Сумма списания', escapeHtml(amount)],
      ...(last4 ? [['Карта', `•••• ${escapeHtml(last4)}`] as const] : []),
      ['Следующее продление', escapeHtml(nextRenewalAt)],
    ],
    `Отключить автопродление или обновить карту можно в любое время: Настройки → Управление подпиской.`,
    'ru',
  )
  return { subject, text, html }
}

// ── 2. renewal_failed ────────────────────────────────────────────────────────
// params: { plan, amount_rub, attempt_no (1..3), max_attempts (3), retry_at?: ISO,
//           access_until: ISO, reason?: string }

function renderRenewalFailed(
  lang: Language,
  params: Record<string, any>,
  updateCardUrl: string,
): RenderedEmail {
  const plan = String(params.plan ?? 'monthly')
  const amount = formatRub(params.amount_rub, lang)
  const attemptNo = Number(params.attempt_no ?? 1)
  const maxAttempts = Number(params.max_attempts ?? 3)
  const retryAt = params.retry_at ? formatDate(params.retry_at, lang) : null
  const accessUntil = formatDate(params.access_until, lang)
  const isLast = attemptNo >= maxAttempts

  if (lang === 'en') {
    const subject = isLast
      ? `TaskFlow Pro: renewal failed — action required`
      : `TaskFlow Pro: renewal attempt ${attemptNo}/${maxAttempts} failed`
    const planLabel = plan === 'annual' ? 'annual' : 'monthly'
    const nextLine = retryAt
      ? `We will try again on ${retryAt}. If that also fails, your Pro access will end on ${accessUntil}.`
      : `This was the final attempt. Your Pro access will end on ${accessUntil}.`
    const text = [
      `We couldn't renew your TaskFlow Pro ${planLabel} plan (${amount}).`,
      ``,
      `Attempt:        ${attemptNo} of ${maxAttempts}`,
      `Access until:   ${accessUntil}`,
      ``,
      nextLine,
      ``,
      `Please update your card to keep TaskFlow Pro active:`,
      updateCardUrl,
    ].join('\n')
    const html = wrapHtml(
      `Renewal failed`,
      `We couldn't renew your <b>${planLabel}</b> plan (${escapeHtml(amount)}). This is attempt <b>${attemptNo}/${maxAttempts}</b>.`,
      [
        ['Access until', escapeHtml(accessUntil)],
        ...(retryAt ? [['Next attempt', escapeHtml(retryAt)] as const] : [['Next attempt', 'No further attempts'] as const]),
      ],
      `<a href="${escapeAttr(updateCardUrl)}" style="display: inline-block; padding: 10px 18px; border-radius: 8px; background: #01696F; color: #ffffff; text-decoration: none; font-weight: 500;">Update payment method</a>`,
      'en',
      true,
    )
    return { subject, text, html }
  }

  const subject = isLast
    ? `TaskFlow Pro: не удалось продлить подписку — нужно действие`
    : `TaskFlow Pro: попытка автопродления ${attemptNo}/${maxAttempts} не прошла`
  const planLabel = plan === 'annual' ? 'годовой' : 'месячный'
  const nextLine = retryAt
    ? `Мы попробуем снова ${retryAt}. Если и эта попытка не пройдёт, доступ к Pro прекратится ${accessUntil}.`
    : `Это была финальная попытка. Доступ к Pro прекратится ${accessUntil}.`
  const text = [
    `Не удалось продлить ваш тариф TaskFlow Pro (${planLabel}) на сумму ${amount}.`,
    ``,
    `Попытка:        ${attemptNo} из ${maxAttempts}`,
    `Доступ активен до: ${accessUntil}`,
    ``,
    nextLine,
    ``,
    `Пожалуйста, обновите карту, чтобы сохранить доступ к TaskFlow Pro:`,
    updateCardUrl,
  ].join('\n')
  const html = wrapHtml(
    `Не удалось продлить подписку`,
    `Не удалось продлить ваш <b>${planLabel}</b> тариф на сумму ${escapeHtml(amount)}. Это попытка <b>${attemptNo}/${maxAttempts}</b>.`,
    [
      ['Доступ активен до', escapeHtml(accessUntil)],
      ...(retryAt
        ? [['Следующая попытка', escapeHtml(retryAt)] as const]
        : [['Следующая попытка', 'Больше попыток не будет'] as const]),
    ],
    `<a href="${escapeAttr(updateCardUrl)}" style="display: inline-block; padding: 10px 18px; border-radius: 8px; background: #01696F; color: #ffffff; text-decoration: none; font-weight: 500;">Обновить способ оплаты</a>`,
    'ru',
    true,
  )
  return { subject, text, html }
}

// ── 3. refund_completed ──────────────────────────────────────────────────────
// params: { amount_rub, reason: 'update-card'|'downgrade'|'manual',
//           payment_last4?, payment_id? }

function renderRefundCompleted(
  lang: Language,
  params: Record<string, any>,
): RenderedEmail {
  const amount = formatRub(params.amount_rub, lang)
  const reason = String(params.reason ?? 'manual')
  const last4 = params.payment_last4 ? String(params.payment_last4) : null
  const paymentId = params.payment_id ? String(params.payment_id) : null

  const reasonLabelsRu: Record<string, string> = {
    'update-card': 'возврат пробного платежа 1 ₽ (обновление способа оплаты)',
    'downgrade':   'возврат при отмене подписки',
    'manual':      'ручной возврат',
  }
  const reasonLabelsEn: Record<string, string> = {
    'update-card': 'refund of the ₽1 trial charge (payment method update)',
    'downgrade':   'refund due to subscription cancellation',
    'manual':      'manual refund',
  }

  if (lang === 'en') {
    const subject = `TaskFlow: refund completed — ${amount}`
    const text = [
      `We've completed a refund on your TaskFlow account.`,
      ``,
      `Amount:  ${amount}`,
      `Reason:  ${reasonLabelsEn[reason] ?? reason}`,
      ...(last4 ? [`Card:    •••• ${last4}`] : []),
      ...(paymentId ? [`Payment: ${paymentId}`] : []),
      ``,
      `Refunds usually appear on your statement within a few minutes, but some banks take up to several business days.`,
    ].join('\n')
    const html = wrapHtml(
      `Refund completed`,
      `We've completed a refund on your TaskFlow account.`,
      [
        ['Amount', escapeHtml(amount)],
        ['Reason', escapeHtml(reasonLabelsEn[reason] ?? reason)],
        ...(last4 ? [['Card', `•••• ${escapeHtml(last4)}`] as const] : []),
        ...(paymentId ? [['Payment ID', `<code>${escapeHtml(paymentId)}</code>`] as const] : []),
      ],
      `Refunds usually appear within a few minutes, but some banks take up to several business days.`,
      'en',
    )
    return { subject, text, html }
  }

  const subject = `TaskFlow: возврат средств выполнен — ${amount}`
  const text = [
    `Мы выполнили возврат средств на ваш счёт TaskFlow.`,
    ``,
    `Сумма:      ${amount}`,
    `Причина:    ${reasonLabelsRu[reason] ?? reason}`,
    ...(last4 ? [`Карта:      •••• ${last4}`] : []),
    ...(paymentId ? [`Платёж:     ${paymentId}`] : []),
    ``,
    `Обычно возврат отражается на вашей карте в течение нескольких минут, но иногда банк может обрабатывать возврат до нескольких банковских дней.`,
  ].join('\n')
  const html = wrapHtml(
    `Возврат средств выполнен`,
    `Мы выполнили возврат средств на ваш счёт TaskFlow.`,
    [
      ['Сумма', escapeHtml(amount)],
      ['Причина', escapeHtml(reasonLabelsRu[reason] ?? reason)],
      ...(last4 ? [['Карта', `•••• ${escapeHtml(last4)}`] as const] : []),
      ...(paymentId ? [['ID платежа', `<code>${escapeHtml(paymentId)}</code>`] as const] : []),
    ],
    `Обычно возврат отражается на карте в течение нескольких минут, но иногда банк обрабатывает возврат до нескольких банковских дней.`,
    'ru',
  )
  return { subject, text, html }
}

// ─── HTML helpers ────────────────────────────────────────────────────────────

function wrapHtml(
  title: string,
  intro: string,
  rows: readonly (readonly [string, string])[],
  footer: string,
  lang: Language,
  isAlert = false,
): string {
  const dir = 'ltr'
  const accent = isAlert ? '#964219' : '#01696F' // warning vs primary (Nexus palette)
  const brand = lang === 'ru' ? 'TaskFlow · автоматическое уведомление' : 'TaskFlow · automated notification'
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0; padding:24px 12px; background:#F7F6F2; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #D4D1CA; border-radius: 12px; padding: 28px; color: #28251D;">
    <h1 style="margin: 0 0 12px 0; color: ${accent}; font-size: 22px; line-height: 1.3;">${escapeHtml(title)}</h1>
    <p style="margin: 0 0 20px 0; color: #28251D; font-size: 15px; line-height: 1.55;">${intro}</p>
    <table style="border-collapse: collapse; width: 100%; margin-bottom: 20px; font-size: 14px;">
      <tbody>
        ${rows.map(([k, v]) => `
          <tr>
            <td style="padding: 6px 12px 6px 0; color: #7A7974; vertical-align: top; white-space: nowrap;">${escapeHtml(k)}</td>
            <td style="padding: 6px 0; color: #28251D;">${v}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <p style="margin: 0 0 8px 0; color: #28251D; font-size: 14px; line-height: 1.55;">${footer}</p>
    <p style="margin: 24px 0 0 0; padding-top: 16px; border-top: 1px solid #D4D1CA; color: #7A7974; font-size: 12px;">${escapeHtml(brand)}</p>
  </div>
</body>
</html>`
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s)
}

function formatRub(v: unknown, lang: Language): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v ?? '')
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US'
  // Целые суммы — без копеек; с копейками — 2 знака.
  const isInt = Number.isInteger(n)
  const nf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: isInt ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${nf.format(n)} ₽`
}

function formatDate(iso: unknown, lang: Language): string {
  if (!iso) return lang === 'ru' ? 'неизвестно' : 'unknown'
  const d = new Date(String(iso))
  if (isNaN(d.getTime())) return String(iso)
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US'
  return d.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}
