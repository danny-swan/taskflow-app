// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// _shared/yookassa-verify.ts — N8: оценка результата dual-verify.
//
// ЮKassa НЕ подписывает вебхуки. Источник истины о платеже — независимый
// GET /v3/payments/{id} с нашими Basic-credentials (dual-verify). Клиентский
// заголовок X-Forwarded-For тривиально подделывается и НЕ может служить
// основанием для выдачи entitlement (см. payment-webhook/index.ts).
//
// Раньше вебхук диспетчеризовал по event из ТЕЛА уведомления, не сверяя его
// со статусом РЕАЛЬНОГО платежа из dual-verify. Значит подделанное
// payment.succeeded по реально pending/canceled платежу всё равно активировало
// бы подписку. Эта функция закрывает разрыв: статус проверенного платежа
// должен соответствовать событию, иначе платёж отклоняется.
//
// Чистый модуль без Deno-зависимостей — тестируется через vitest.

export interface VerifiedPaymentLike {
  status?: string
  paid?: boolean
}

export interface VerifyAssessment {
  ok: boolean
  reason?: string
}

/**
 * Сверяет event уведомления со статусом платежа, полученным из dual-verify.
 * Строгие проверки для критичных событий (грант/отзыв entitlement):
 *   payment.succeeded → verified.status === 'succeeded' (и paid !== false)
 *   payment.canceled  → verified.status === 'canceled'
 * Прочие события (refund.succeeded, неподписанные) пропускаются без изменения
 * прежнего поведения.
 */
export function assessVerifiedPayment(event: string, verified: VerifiedPaymentLike): VerifyAssessment {
  switch (event) {
    case 'payment.succeeded':
      if (verified.status !== 'succeeded') {
        return { ok: false, reason: `verified status '${verified.status ?? 'unknown'}' != succeeded` }
      }
      if (verified.paid === false) {
        return { ok: false, reason: 'verified payment not marked paid' }
      }
      return { ok: true }
    case 'payment.canceled':
      if (verified.status !== 'canceled') {
        return { ok: false, reason: `verified status '${verified.status ?? 'unknown'}' != canceled` }
      }
      return { ok: true }
    default:
      return { ok: true }
  }
}
