// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Юнит-тесты пина непринятых приглашений (Wave C, PR-c-02).
//
// Проверяет пороги рендера: 0 → null, 1 → точка без числа, 2 → бейдж «2»,
// 100 → «99+», и корректный aria-label с числом.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector({ language: 'ru' }),
}));

import { InvitePinBadge } from './InvitePinBadge';

describe('InvitePinBadge', () => {
  it('count=0 → рендерит null', () => {
    const { container } = render(<InvitePinBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('count=1 → точка без числа', () => {
    render(<InvitePinBadge count={1} />);
    const pin = screen.getByTestId('invite-pin');
    expect(pin.textContent).toBe('');
    expect(pin.getAttribute('aria-label')).toBe('Неотвеченных приглашений: 1');
  });

  it('count=2 → бейдж с числом «2»', () => {
    render(<InvitePinBadge count={2} />);
    const pin = screen.getByTestId('invite-pin');
    expect(pin.textContent).toBe('2');
    expect(pin.getAttribute('aria-label')).toBe('Неотвеченных приглашений: 2');
  });

  it('count=100 → «99+», aria содержит настоящее число', () => {
    render(<InvitePinBadge count={100} />);
    const pin = screen.getByTestId('invite-pin');
    expect(pin.textContent).toBe('99+');
    expect(pin.getAttribute('aria-label')).toBe('Неотвеченных приглашений: 100');
  });
});
