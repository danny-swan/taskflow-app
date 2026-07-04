/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.23 — Sentry (Frontend Error Tracking).
 *
 * Инициализация клиентского Sentry. Инит происходит только если задан
 * VITE_SENTRY_DSN (в dev — из .env.local, в CI — из GitHub Secrets через
 * envSubst в build.yml). Если DSN не задан, initSentry — no-op, и весь
 * прод-код (captureException и т.п.) продолжает работать без ошибок.
 *
 * Privacy:
 * - sendDefaultPii = false — Sentry не собирает IP и user-agent сам.
 * - beforeSend — вычищаем email/пароли из breadcrumbs и messages
 *   на случай, если что-то случайно попало в лог.
 * - tracesSampleRate = 0.1 — 10% транзакций (browser performance),
 *   этого достаточно для тренда и не перегружает free-tier.
 */
import * as Sentry from '@sentry/react';

/**
 * true, если Sentry реально инициализирован. Используется в logger и
 * тестах, чтобы не пытаться отправлять события в неподключённый SDK.
 */
let initialized = false;

export function isSentryEnabled(): boolean {
  return initialized;
}

/**
 * Простые regex для redaction чувствительных строк.
 * Не претендуем на полноту — это last-mile защита от случайных утечек.
 */
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

function scrubString(value: string): string {
  return value.replace(EMAIL_RE, '[email]').replace(JWT_RE, '[jwt]');
}

/**
 * Рекурсивно чистит PII в объектах событий Sentry (message, breadcrumb.message,
 * exception.value). Ограничиваемся строковыми полями — не трогаем стек-трейсы
 * и request-заголовки, там Sentry сам делает scrubbing по своим настройкам.
 */
function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.message) event.message = scrubString(event.message);

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(bc => ({
      ...bc,
      message: bc.message ? scrubString(bc.message) : bc.message,
    }));
  }

  if (event.exception?.values) {
    event.exception.values = event.exception.values.map(ex => ({
      ...ex,
      value: ex.value ? scrubString(ex.value) : ex.value,
    }));
  }

  return event;
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) {
    // В dev без .env.local это ок — просто ничего не отправляем.
    return;
  }

  // __APP_VERSION__ инжектится Vite из package.json (см. vite.config.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const release = (globalThis as any).__APP_VERSION__ as string | undefined;

  Sentry.init({
    dsn,
    release: release ? `taskflow@${release}` : undefined,
    environment: import.meta.env.MODE, // 'development' | 'production'
    // Browser performance — 10% транзакций, чтобы уложиться в free-tier.
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
    // Privacy: не собираем IP/UA автоматически, redact email/JWT в событиях.
    sendDefaultPii: false,
    beforeSend: scrubEvent,
    // v0.9.23: в dev не отправляем — лишний шум в проекте.
    enabled: import.meta.env.PROD,
  });

  initialized = true;
}
