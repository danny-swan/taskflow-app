// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Wave 4 PR-B — N13: общий table-based rate limiter для публичных edge-функций.
//
// Счётчики живут в public.rate_limits, атомарный инкремент — RPC
// public.check_rate_limit (SECURITY DEFINER). Edge-функции stateless и
// многоинстансные, поэтому in-memory счётчик не подходит (см. ADR 0004).
//
// fail-open by design: если сам rate-limiter упал (RPC error, БД недоступна),
// мы НЕ блокируем запрос. Лучше пропустить лишний запрос, чем уронить платежи
// из-за проблемы во вспомогательной подсистеме.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

export interface RateLimitResult {
  allowed: boolean
  retryAfter: number
}

// Минимальный контракт клиента — только .rpc(). Позволяет подменять реализацию
// в тестах без обращения к сети / реальному Supabase.
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>
}

function defaultClient(): RpcClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  ) as unknown as RpcClient
}

/**
 * Проверяет и инкрементит счётчик для `key`. Возвращает allowed=false с
 * retryAfter (сек) если лимит превышен.
 *
 * @param client опциональный клиент (для тестов); по умолчанию — service-role
 *               клиент из env SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
 */
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowSeconds: number,
  client?: RpcClient,
): Promise<RateLimitResult> {
  try {
    const supabase = client ?? defaultClient()
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: key,
      p_max_requests: maxRequests,
      p_window_seconds: windowSeconds,
    })
    if (error) {
      // fail-open: при ошибке лимитера НЕ блокируем легитимные запросы.
      console.error('[rate-limit] error, failing open:', error.message)
      return { allowed: true, retryAfter: 0 }
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { allowed?: boolean; retry_after?: number }
      | null
      | undefined
    return { allowed: row?.allowed ?? true, retryAfter: row?.retry_after ?? 0 }
  } catch (e) {
    // fail-open также при любом брошенном исключении (клиент не собрался,
    // сеть недоступна и т.п.) — лимитер не должен ронять защищаемый эндпоинт.
    console.error('[rate-limit] exception, failing open:', (e as Error)?.message ?? e)
    return { allowed: true, retryAfter: 0 }
  }
}

/**
 * IP клиента для построения per-IP ключа. Порядок согласован с
 * `payment-webhook` (там та же логика для сверки IP ЮKassa): первый адрес из
 * `x-forwarded-for` (именно его ставит edge-runtime Supabase/Deno Deploy) →
 * `x-real-ip` → `cf-connecting-ip`. Возвращает `null`, если достоверный IP
 * определить нельзя.
 *
 * ВАЖНО (замена прежнего 'unknown'): при отсутствии IP НЕ схлопываем всех в
 * один общий бакет — вызывающий код пропускает per-IP лимит целиком (per-user
 * лимит остаётся). Иначе общий ключ `ip:unknown` превратил бы per-IP лимит в
 * глобальный, и один аноним мог бы заблокировать эндпоинт всем.
 *
 * Про подделку (N8): `x-forwarded-for` теоретически подделываем, но подмена
 * лишь перемещает атакующего в ДРУГОЙ per-IP бакет — она не снижает лимит
 * чужого IP и не обходит per-user лимит. Сверка источника платежей (allowlist
 * IP ЮKassa) — это отдельная, более строгая проверка в самом вебхуке.
 */
export function getClientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0].trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip')
    ?? req.headers.get('cf-connecting-ip')
    ?? null
}

/**
 * Стандартный 429-ответ. Ставит Retry-After (сек) и переносит CORS-заголовки
 * вызывающей функции.
 */
export function rateLimitResponse(
  retryAfter: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({ error: 'rate_limited', message: 'Too many requests', retry_after: retryAfter }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
      },
    },
  )
}
