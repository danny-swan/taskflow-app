// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// _shared/cors.ts — N11: CORS-аллоулист для state-changing edge-функций.
//
// Раньше state-changing функции (start-trial, cancel-subscription, …) отдавали
// `Access-Control-Allow-Origin: *`. Это позволяло любому origin'у дёргать их из
// браузера. JWT в Authorization — основная защита, но `*` снимает даже
// браузерный слой defense-in-depth. Ограничиваем Allow-Origin аллоулистом
// доменов приложения:
//   • эхо только разрешённого Origin (никогда `*`);
//   • `Vary: Origin`, чтобы CDN/кэш не смешивал ответы для разных origin'ов.
//
// Аллоулист по умолчанию покрывает web-домен и Tauri-desktop (origin отличается
// по ОС/webview). Переопределяется/расширяется env `APP_ALLOWED_ORIGINS`
// (список через запятую) — задаётся в Edge-secrets. Дефолт безопасен: если env
// не задан, работают только известные origin'ы приложения.
//
// НЕ применять к:
//   • payment-webhook — публичный вебхук ЮKassa, приходит без браузерного Origin;
//   • renew-subscription — pg_cron, без Origin;
//   • activation-notify — Database Webhook, без Origin;
//   • send-user-email — cross-function, без Origin.
// Этим функциям CORS не нужен вовсе — их не трогаем.
//
// Не-браузерные запросы приходят без заголовка Origin. Для них CORS-заголовки
// не проверяются браузером, поэтому echo дефолтного origin'а их не ломает.
//
// Тестируется через `deno test` (мок Deno.env, без сети).

// Origin'ы приложения по умолчанию.
export const DEFAULT_ALLOWED_ORIGINS: readonly string[] = [
  'https://yourtaskflow.app', // прод web/лендинг
  'tauri://localhost', // Tauri desktop (Linux / Windows WebView2)
  'https://tauri.localhost', // Tauri desktop (Windows, https-схема webview)
  'http://localhost:5173', // Vite dev (tauri devUrl)
  'http://localhost:1420', // Tauri dev по умолчанию
]

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type'

export interface CorsOptions {
  /** Разрешённые методы. По умолчанию 'POST, OPTIONS'. */
  methods?: string
  /** Явный аллоулист (для тестов). По умолчанию — из env / DEFAULT_ALLOWED_ORIGINS. */
  allowedOrigins?: readonly string[]
  /** Инъекция чтения env (для тестов). По умолчанию Deno.env.get. */
  env?: (key: string) => string | undefined
}

/**
 * Итоговый аллоулист: из env `APP_ALLOWED_ORIGINS` (CSV) либо дефолт.
 */
export function resolveAllowedOrigins(
  env: (key: string) => string | undefined = defaultEnv,
): string[] {
  const raw = env('APP_ALLOWED_ORIGINS')
  if (raw && raw.trim()) {
    const parsed = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parsed.length > 0) return parsed
  }
  return [...DEFAULT_ALLOWED_ORIGINS]
}

/**
 * Строит CORS-заголовки для запроса: эхо Origin только если он в аллоулисте,
 * иначе — первый origin из аллоулиста (никогда `*`). Всегда `Vary: Origin`.
 */
export function corsHeaders(
  req: Request,
  opts: CorsOptions = {},
): Record<string, string> {
  const allowed = opts.allowedOrigins ?? resolveAllowedOrigins(opts.env)
  const origin = req.headers.get('Origin') ?? ''
  const allowOrigin = allowed.includes(origin) ? origin : (allowed[0] ?? '')
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': opts.methods ?? 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function defaultEnv(key: string): string | undefined {
  // Deno может отсутствовать в тестовой среде — читаем безопасно.
  try {
    return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } })
      .Deno?.env.get(key)
  } catch {
    return undefined
  }
}
