// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Vitest: клиентский UX-гейт тарифных лимитов пространств (Wave A, PR-5).
// Зеркалит серверный триггер enforce_workspace_limit (миграция 0029).

import { describe, it, expect } from 'vitest';
import {
  evaluateWorkspaceLimit,
  isWorkspaceLimitError,
  FREE_WORKSPACE_LIMIT,
  PAID_WORKSPACE_LIMIT,
  WORKSPACE_LIMIT_ERROR,
} from './workspaceLimits';

describe('evaluateWorkspaceLimit', () => {
  it('free под лимитом (1 из 2) → создание разрешено, апселла нет', () => {
    const s = evaluateWorkspaceLimit({ isPaid: false, activeWorkspaceCount: 1 });
    expect(s.limit).toBe(FREE_WORKSPACE_LIMIT);
    expect(s.atLimit).toBe(false);
    expect(s.reason).toBeNull();
  });

  it('free на лимите (2 из 2) → создание заблокировано, reason=free', () => {
    const s = evaluateWorkspaceLimit({ isPaid: false, activeWorkspaceCount: 2 });
    expect(s.atLimit).toBe(true);
    expect(s.reason).toBe('free');
  });

  it('free сверх лимита (3) → тоже заблокировано, reason=free', () => {
    const s = evaluateWorkspaceLimit({ isPaid: false, activeWorkspaceCount: 3 });
    expect(s.atLimit).toBe(true);
    expect(s.reason).toBe('free');
  });

  it('paid под лимитом (6 из 7) → создание разрешено', () => {
    const s = evaluateWorkspaceLimit({ isPaid: true, activeWorkspaceCount: 6 });
    expect(s.limit).toBe(PAID_WORKSPACE_LIMIT);
    expect(s.atLimit).toBe(false);
    expect(s.reason).toBeNull();
  });

  it('paid на лимите (7 из 7) → создание заблокировано, reason=paid', () => {
    const s = evaluateWorkspaceLimit({ isPaid: true, activeWorkspaceCount: 7 });
    expect(s.atLimit).toBe(true);
    expect(s.reason).toBe('paid');
  });

  it('нулевое число пространств → всегда под лимитом', () => {
    expect(evaluateWorkspaceLimit({ isPaid: false, activeWorkspaceCount: 0 }).atLimit).toBe(false);
    expect(evaluateWorkspaceLimit({ isPaid: true, activeWorkspaceCount: 0 }).atLimit).toBe(false);
  });
});

describe('isWorkspaceLimitError', () => {
  it('Error с сообщением лимита → true', () => {
    expect(isWorkspaceLimitError(new Error(`push failed: ${WORKSPACE_LIMIT_ERROR}`))).toBe(true);
  });

  it('строка с сообщением лимита → true', () => {
    expect(isWorkspaceLimitError(WORKSPACE_LIMIT_ERROR)).toBe(true);
  });

  it('объект с полем message → true', () => {
    expect(isWorkspaceLimitError({ message: `ERROR: ${WORKSPACE_LIMIT_ERROR}` })).toBe(true);
  });

  it('прочие ошибки → false', () => {
    expect(isWorkspaceLimitError(new Error('network down'))).toBe(false);
    expect(isWorkspaceLimitError('rls violation')).toBe(false);
    expect(isWorkspaceLimitError(null)).toBe(false);
    expect(isWorkspaceLimitError(undefined)).toBe(false);
  });
});
