// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Wave 4 PR-A — N11: единый CORS-хелпер для state-changing edge-функций.
//
// Проблема: раньше каждая функция отдавала `Access-Control-Allow-Origin: *` на
// POST/DELETE/PATCH. Для функций, меняющих состояние под пользовательским JWT,
// это ослабляет защиту (любой сайт мог инициировать запрос из браузера жертвы).
// Заменяем `*` на allowlist: эхо-Origin только если он в списке разрешённых,
// иначе — безопасный фолбэк (первый разрешённый Origin), который браузер не
// сматчит с чужим сайтом.
//
// Источник allowlist:
//   • APP_ALLOWED_ORIGINS — comma-separated список (основной источник);
//   • PUBLIC_APP_URL      — уже существующий секрет с URL веб-приложения,
//                           добавляется автоматически (страховка на случай,
//                           если его забыли продублировать в APP_ALLOWED_ORIGINS).
//
// Рекомендуемое значение APP_ALLOWED_ORIGINS (см. deploy-checklist PR):
//   tauri://localhost,https://tauri.localhost,<PUBLIC_APP_URL>
// где tauri://localhost / https://tauri.localhost — Origin webview Tauri
// (Linux/macOS и Windows соответственно).

function getAllowedOrigins(): string[] {
  const fromList = (Deno.env.get('APP_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const appUrl = (Deno.env.get('PUBLIC_APP_URL') ?? '').trim()
  const merged = appUrl ? [...fromList, appUrl] : fromList
  return [...new Set(merged)]
}

/**
 * Возвращает CORS-заголовки с Origin-allowlist.
 *
 * @param requestOrigin значение заголовка `Origin` входящего запроса
 *                      (req.headers.get('origin')), может быть null.
 * @returns заголовки для ответа. Если Origin в allowlist — эхо-Origin; иначе —
 *          первый разрешённый Origin как фолбэк (браузер не сматчит его с чужим
 *          сайтом, поэтому CORS-запрос отклоняется на стороне браузера).
 *          Vary: Origin обязателен, т.к. ответ зависит от заголовка запроса.
 */
export function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const allowed = getAllowedOrigins()
  const isAllowed = requestOrigin != null && allowed.includes(requestOrigin)
  const allowOrigin = isAllowed ? requestOrigin : (allowed[0] ?? '')
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  }
}
