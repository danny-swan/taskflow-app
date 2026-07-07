// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// v0.9.35-dev.6.5.1 — Mock HTTP server for Edge Function tests.
//
// Поднимает локальный HTTP-сервер на случайном порту, регистрирует роуты
// (path + method → handler) и позволяет ассертить какие запросы прилетели.
// Используется в *.test.ts для мокинга Supabase REST + Auth + ЮKassa + Resend.
//
// Пример:
//   const server = await MockServer.start()
//   server.on('POST', '/rest/v1/user_entitlements', () => ({ status: 200, body: [] }))
//   Deno.env.set('SUPABASE_URL', server.url)
//   // ... вызов handler ...
//   assertEquals(server.calls.length, 1)
//   await server.stop()

export interface MockCall {
  method: string
  path: string
  headers: Record<string, string>
  body: string
  query: URLSearchParams
}

export interface MockResponse {
  status: number
  body?: unknown
  headers?: Record<string, string>
}

export type MockHandler = (call: MockCall) => MockResponse | Promise<MockResponse>

interface RouteKey {
  method: string
  pathPrefix: string
}

export class MockServer {
  private server: Deno.HttpServer<Deno.NetAddr> | null = null
  private routes: Array<{ key: RouteKey; handler: MockHandler }> = []
  public calls: MockCall[] = []
  public url = ''
  public port = 0

  static async start(): Promise<MockServer> {
    const m = new MockServer()
    // Deno.serve с port=0 — выбирает свободный порт
    m.server = Deno.serve({ port: 0, hostname: '127.0.0.1', onListen: () => {} }, m.handle.bind(m))
    const addr = m.server.addr
    m.port = addr.port
    m.url = `http://127.0.0.1:${addr.port}`
    return m
  }

  /** Регистрирует роут. pathPrefix сравнивается через startsWith. */
  on(method: string, pathPrefix: string, handler: MockHandler): this {
    this.routes.push({ key: { method: method.toUpperCase(), pathPrefix }, handler })
    return this
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const call: MockCall = {
      method: req.method,
      path: url.pathname,
      headers: Object.fromEntries(req.headers.entries()),
      body: req.body ? await req.text() : '',
      query: url.searchParams,
    }
    this.calls.push(call)

    for (const { key, handler } of this.routes) {
      if (key.method === call.method && call.path.startsWith(key.pathPrefix)) {
        const res = await handler(call)
        return new Response(
          res.body === undefined ? null : (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
          {
            status: res.status,
            headers: {
              'Content-Type': 'application/json',
              ...res.headers,
            },
          },
        )
      }
    }

    return new Response(
      JSON.stringify({ error: `Mock route not found: ${call.method} ${call.path}` }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.shutdown()
      this.server = null
    }
  }

  /** Сбросить историю запросов (роуты остаются). */
  reset(): void {
    this.calls = []
  }

  /** Найти первый вызов подходящий фильтру. */
  findCall(method: string, pathContains: string): MockCall | undefined {
    return this.calls.find((c) => c.method === method.toUpperCase() && c.path.includes(pathContains))
  }
}

/**
 * Устанавливает env vars и возвращает функцию для восстановления.
 * Используй в setUp/tearDown блоках теста.
 */
export function withEnv(vars: Record<string, string>): () => void {
  const original: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(vars)) {
    original[k] = Deno.env.get(k)
    Deno.env.set(k, v)
  }
  return () => {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) Deno.env.delete(k)
      else Deno.env.set(k, v)
    }
  }
}

/** Валидный JWT для юзера (без подписи — просто структура). */
export function fakeUserJwt(userId = 'test-user-id'): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(JSON.stringify({ sub: userId, aud: 'authenticated', exp: 9999999999 }))
  return `${header}.${payload}.fake-signature`
}
