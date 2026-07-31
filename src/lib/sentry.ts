/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.23 — Sentry (Frontend Error Tracking).
 *
 * Инициализация клиентского Sentry. Инит происходит только если ОДНОВРЕМЕННО:
 *  1) VITE_SENTRY_ENABLED === 'true' | '1' (kill-switch, по умолчанию OFF);
 *  2) задан VITE_SENTRY_DSN (в dev — из .env.local, в CI — из GitHub Secrets
 *     через envSubst в build.yml).
 * Иначе initSentry — no-op, и весь прод-код (captureException и т.п.)
 * продолжает работать без ошибок.
 *
 * v1.0.3 — Sentry ВРЕМЕННО ВЫКЛЮЧЕН (закончился бесплатный период подписки).
 * Транспорт Sentry блокируется CSP (в connect-src нет доменов Sentry), из-за
 * чего в консоли сыпались CSP-ошибки и «Uncaught TypeError: Cannot create
 * property '_id' on number 'N'» (SDK пытается пометить примитив в своей
 * breadcrumb-инструментации при заблокированной отправке).
 *
 * Код SDK специально НЕ удалён. Чтобы вернуть Sentry, нужно:
 *  1) выставить VITE_SENTRY_ENABLED=true (+ непустой VITE_SENTRY_DSN);
 *  2) добавить домены Sentry (https://*.ingest.sentry.io и т.п.) в connect-src
 *     CSP — см. src-tauri/tauri.conf.json → app.security.csp;
 *  3) иметь активную подписку/квоту в Sentry.
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
 * Kill-switch: Sentry включается ТОЛЬКО при VITE_SENTRY_ENABLED=true|1.
 * По умолчанию (флаг не задан / любое другое значение) — выключен, чтобы SDK
 * не поднимал транспорт и не инструментировал глобалы.
 *
 * Экспортируется для тестов и для диагностики в UI/логах.
 */
export function isSentryAllowed(): boolean {
  const flag = import.meta.env.VITE_SENTRY_ENABLED as string | undefined;
  const normalized = String(flag ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
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
  // v1.0.3: ранний return по kill-switch — Sentry.init не вызывается вовсе,
  // SDK не навешивает свои обёртки на fetch/XHR/console (источник TypeError
  // «Cannot create property '_id'»), транспорт не стучится в заблокированный
  // CSP-домен. Возврат: VITE_SENTRY_ENABLED=true.
  if (!isSentryAllowed()) return;

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
