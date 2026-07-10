// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// _shared/rate-limit.ts — N13: throttling публичных/платёжных эндпоинтов.
//
// Счётчики живут в public.rate_limits, инкремент — атомарный SECURITY DEFINER
// RPC public.rate_limit_hit (INSERT ... ON CONFLICT DO UPDATE ... RETURNING),
// см. миграцию 0024 и ADR 0004. Ключи:
//   ${fn}:user:${userId}  — на аутентифицированного юзера
//   ${fn}:ip:${realIp}    — на IP (для анонимных/webhook путей)
//
// ⚠️ Реальный IP берём ТОЛЬКО из cf-connecting-ip / x-real-ip. X-Forwarded-For
// тривиально подделывается (см. N8) и НЕ используется — иначе лимит по IP
// обходится подстановкой заголовка.
//
// Fail-open: если RPC/сеть упали, НЕ блокируем запрос (rate limiting — слой
// защиты, а не критичный путь; ложный отказ платежа хуже пропущенного лимита).
//
// Тестируется через `deno test` на MockServer (мок RPC, без сети).

// Мягкий тип клиента, чтобы модуль не тянул полный тип SupabaseClient.
// PromiseLike (не Promise): supabase-js .rpc() возвращает PostgrestFilterBuilder —
// thenable, но не настоящий Promise (нет catch/finally). await с ним работает.
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>
}

export interface RateLimitResult {
  allowed: boolean
  /** Секунды до сброса окна (только когда allowed=false). */
  retryAfter?: number
}

export interface RateLimitRule {
  /** Максимум запросов в окне. */
  max: number
  /** Длина окна в секундах. */
  windowSeconds: number
}

/**
 * Извлекает реальный IP клиента из доверенных заголовков платформы.
 * НЕ использует X-Forwarded-For (подделываемый, N8). Возвращает null, если
 * доверенного заголовка нет.
 */
export function clientIp(req: Request): string | null {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf && cf.trim()) return cf.trim()
  const real = req.headers.get('x-real-ip')
  if (real && real.trim()) return real.trim()
  return null
}

/**
 * Один атомарный инкремент счётчика через RPC. Fail-open при ошибке.
 */
export async function checkRateLimit(
  client: RpcClient,
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  try {
    const { data, error } = await client.rpc('rate_limit_hit', {
      p_key: key,
      p_max: rule.max,
      p_window_seconds: rule.windowSeconds,
    })
    if (error) {
      console.warn(`[rate-limit] rpc error for '${key}': ${error.message} — fail-open`)
      return { allowed: true }
    }
    const row = normalizeRow(data)
    if (!row || typeof row.allowed !== 'boolean') {
      console.warn(`[rate-limit] unexpected rpc shape for '${key}' — fail-open`)
      return { allowed: true }
    }
    if (row.allowed) return { allowed: true }
    const retryAfter = Math.max(1, Number(row.retry_after ?? rule.windowSeconds) || rule.windowSeconds)
    return { allowed: false, retryAfter }
  } catch (e) {
    console.warn(`[rate-limit] exception for '${key}': ${(e as Error).message} — fail-open`)
    return { allowed: true }
  }
}

/**
 * Прогоняет несколько правил (напр. per-user + per-ip). Возвращает первый
 * сработавший лимит (allowed=false) либо {allowed:true}. Ключи с пустым
 * идентификатором (напр. IP не определился) пропускаются.
 */
export async function checkRateLimits(
  client: RpcClient,
  checks: Array<{ key: string | null; rule: RateLimitRule }>,
): Promise<RateLimitResult> {
  for (const c of checks) {
    if (!c.key) continue
    const res = await checkRateLimit(client, c.key, c.rule)
    if (!res.allowed) return res
  }
  return { allowed: true }
}

/**
 * Готовый HTTP 429 с Retry-After. headers — CORS/прочие заголовки функции.
 */
export function tooManyRequests(
  retryAfter: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({ error: 'Too many requests', code: 'rate_limited', retry_after: retryAfter }),
    {
      status: 429,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
      },
    },
  )
}

function normalizeRow(data: unknown): { allowed?: boolean; retry_after?: number } | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null
  if (data && typeof data === 'object') return data as Record<string, unknown>
  return null
}
