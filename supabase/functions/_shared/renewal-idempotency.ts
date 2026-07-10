// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// _shared/renewal-idempotency.ts — N10: защита автопродления от дубля списания.
//
// Idempotence-Key ЮKassa в renew-subscription детерминирован по
// (user_id, valid_until, attempt_no) — повтор с теми же аргументами возвращает
// тот же платёж (ЮKassa-side дедуп). Но если предыдущий POST /v3/payments
// оборвался таймаутом, ответ не дошёл и last_renewal_attempt_at не выставился,
// cron мог бы дёрнуть кандидата повторно. Как страховочный слой перед созданием
// нового платежа мы сверяемся с ЮKassa (GET /v3/payments) и, если по этому юзеру
// в текущем окне уже есть активный (pending/waiting_for_capture/succeeded)
// платёж автопродления, второй не создаём — итог доведёт webhook.
//
// Чистый модуль без Deno-зависимостей — тестируется через vitest.

export interface YooPaymentListItem {
  id?: string
  status?: string
  metadata?: { user_id?: string; renewal?: string; [k: string]: unknown } | null
}

// Статусы, при которых списание уже инициировано/произошло и второй платёж
// создавать нельзя.
const ACTIVE_STATUSES = new Set(['pending', 'waiting_for_capture', 'succeeded'])

function isRenewal(meta: YooPaymentListItem['metadata']): boolean {
  return meta?.renewal === 'true' || meta?.renewal === '1'
}

/**
 * Ищет в списке платежей ЮKassa активный платёж автопродления данного юзера.
 * Возвращает найденный платёж (→ создавать новый НЕ нужно) либо null.
 */
export function selectActiveRenewalPayment(
  payments: YooPaymentListItem[],
  userId: string,
): YooPaymentListItem | null {
  for (const p of payments) {
    if (
      p.metadata?.user_id === userId &&
      isRenewal(p.metadata) &&
      typeof p.status === 'string' &&
      ACTIVE_STATUSES.has(p.status)
    ) {
      return p
    }
  }
  return null
}
