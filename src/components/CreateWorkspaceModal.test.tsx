// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Рендер-тесты гейта тарифного лимита в модалке создания пространства
// (Wave A, PR-5). Проверяет: free/paid под лимитом → кнопка активна, апселла
// нет; free/paid на лимите → кнопка disabled + показан правильный апселл;
// createWorkspace не вызывается при достигнутом лимите.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const createWorkspace = vi.fn();
let storeState: any;

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector(storeState),
}));

let mockEntitlement: any = null;
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'u1@test' } }),
}));
vi.mock('../lib/entitlements', async (importActual) => {
  const actual = await importActual<typeof import('../lib/entitlements')>();
  return {
    ...actual,
    useEntitlement: () => ({ entitlement: mockEntitlement }),
  };
});

import { CreateWorkspaceModal } from './CreateWorkspaceModal';

const ws = (id: string) => ({ id, name: id, kind: 'personal' });

function setup(count: number, paid: boolean) {
  storeState = {
    language: 'ru',
    createWorkspace,
    workspaces: Array.from({ length: count }, (_, i) => ws('w' + i)),
  };
  mockEntitlement = { effectivePlan: paid ? 'pro' : 'free' };
}

const createBtn = () => screen.getByRole('button', { name: 'Создать' });

beforeEach(() => {
  createWorkspace.mockReset();
});

describe('CreateWorkspaceModal — тарифный лимит', () => {
  it('free под лимитом (1 из 2) → кнопка активна, апселла нет', () => {
    setup(1, false);
    render(<CreateWorkspaceModal open onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Название/i), { target: { value: 'X' } });
    expect((createBtn() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/лимит пространств/i)).toBeNull();
  });

  it('free на лимите (2 из 2) → кнопка disabled + free-апселл, createWorkspace не зовётся', () => {
    setup(2, false);
    render(<CreateWorkspaceModal open onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Название/i), { target: { value: 'X' } });
    expect((createBtn() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Обновите до Pro/i)).toBeTruthy();
    fireEvent.click(createBtn());
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('paid под лимитом (6 из 7) → кнопка активна', () => {
    setup(6, true);
    render(<CreateWorkspaceModal open onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Название/i), { target: { value: 'X' } });
    expect((createBtn() as HTMLButtonElement).disabled).toBe(false);
  });

  it('paid на лимите (7 из 7) → кнопка disabled + paid-апселл (максимум 7)', () => {
    setup(7, true);
    render(<CreateWorkspaceModal open onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Название/i), { target: { value: 'X' } });
    expect((createBtn() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/максимум пространств/i)).toBeTruthy();
  });
});
