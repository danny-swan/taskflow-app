/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * Wave A, PR-5 — тарифные лимиты на количество пространств (клиентский UX-гейт).
 *
 * Единая точка правды для клиента о том, можно ли создать ещё одно пространство.
 * Это UX-слой, НЕ security-барьер: реальная защита — серверный триггер
 * public.enforce_workspace_limit (миграция 0029), который на INSERT в
 * sync_workspaces проверяет тот же лимит и при превышении бросает
 * `workspace_limit_exceeded`. Клиентский гейт лишь заранее дизейблит кнопку и
 * показывает апселл, а серверную ошибку ловим как fallback (race между
 * устройствами).
 *
 * Лимиты (согласованы в docs/architecture/workspaces-plan.md, зеркалят 0029):
 *   • Free (нет активного entitlement)         → 2 пространства;
 *   • Pro / trial / lifetime (isProOrTrial)     → 7 пространств суммарно.
 *
 * Счёт ведём по ВСЕМ активным пространствам (любого kind), как и сервер, — в
 * Wave A это только personal, но при открытии shared в Wave B пересчёт не нужен.
 */

/** Лимит пространств на бесплатном тарифе. Зеркалит get_workspace_limit (free personal). */
export const FREE_WORKSPACE_LIMIT = 2;

/** Лимит пространств на платном тарифе (Pro/trial/lifetime). Зеркалит get_workspace_limit (paid). */
export const PAID_WORKSPACE_LIMIT = 7;

/**
 * Машиночитаемый текст серверной ошибки лимита (RAISE в 0029). Клиент ищет его
 * подстрокой в message ошибки push'а/RPC, чтобы показать апселл вместо generic.
 */
export const WORKSPACE_LIMIT_ERROR = 'workspace_limit_exceeded';

export interface WorkspaceLimitState {
  /** Есть ли активный платный entitlement (Pro/trial/lifetime). */
  isPaid: boolean;
  /** Максимум активных пространств для этого тарифа. */
  limit: number;
  /** Текущее число активных пространств. */
  count: number;
  /** Достигнут ли лимит (count >= limit) — если да, создание нужно заблокировать. */
  atLimit: boolean;
  /** Какой апселл показывать при atLimit: 'free' → «обновите до Pro», 'paid' → «максимум 7». */
  reason: 'free' | 'paid' | null;
}

/**
 * Чистый резолвер лимита. Тестируется в изоляции; используется модалкой создания.
 */
export function evaluateWorkspaceLimit(args: {
  isPaid: boolean;
  activeWorkspaceCount: number;
}): WorkspaceLimitState {
  const { isPaid, activeWorkspaceCount } = args;
  const limit = isPaid ? PAID_WORKSPACE_LIMIT : FREE_WORKSPACE_LIMIT;
  const atLimit = activeWorkspaceCount >= limit;
  return {
    isPaid,
    limit,
    count: activeWorkspaceCount,
    atLimit,
    reason: atLimit ? (isPaid ? 'paid' : 'free') : null,
  };
}

/**
 * Распознаёт серверную ошибку тарифного лимита (для fallback-апселла при race).
 * Принимает Error / строку / объект с полем message.
 */
export function isWorkspaceLimitError(err: unknown): boolean {
  if (err == null) return false;
  let msg: string;
  if (typeof err === 'string') {
    msg = err;
  } else if (err instanceof Error) {
    msg = err.message;
  } else if (typeof (err as { message?: unknown }).message === 'string') {
    msg = (err as { message: string }).message;
  } else {
    msg = String(err);
  }
  return msg.includes(WORKSPACE_LIMIT_ERROR);
}
