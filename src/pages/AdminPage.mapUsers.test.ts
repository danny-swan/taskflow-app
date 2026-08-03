// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * AdminPage.mapUsers.test.ts — P4/F12: маппинг строк RPC get_admin_users_summary.
 *
 * Баг P4: список админки строился ОТ user_entitlements + get_users_emails, из-за
 * чего free-юзеры без строки entitlement были невидимы (их email не показывался).
 * Фикс: один вызов SECURITY DEFINER RPC get_admin_users_summary() (миграция 0039),
 * возвращающего ВСЕХ пользователей из profiles с nullable entitlement-полями.
 *
 * Контракт mapAdminUserRow:
 *  - free-юзер (plan=null) → entitlement=null, но строка присутствует (регрессия P4);
 *  - платный юзер → entitlement собран из плоских полей, updated_at из ent_updated_at;
 *  - public_user_id (TF-XXXXXX) пробрасывается как есть (в т.ч. null).
 */
import { describe, it, expect } from 'vitest';
import { mapAdminUserRow } from './AdminPage';

describe('P4/F12: mapAdminUserRow', () => {
  it('free-юзер без entitlement (plan=null) → entitlement=null, но остаётся в списке', () => {
    const row = {
      id: 'u-free',
      public_user_id: 'TF-ABC123',
      email: 'free@test',
      registered_at: '2026-07-22T10:00:00Z',
      last_sign_in_at: null,
      plan: null,
      valid_until: null,
      auto_renew: null,
      cancel_at_period_end: null,
      source: null,
      notes: null,
      ent_updated_at: null,
      renewal_attempts_count: null,
      last_payment_at: null,
      sessions_count: 3,
      tasks_created_count: 0,
      latest_app_version: null,
      latest_os: null,
    };
    const mapped = mapAdminUserRow(row);
    expect(mapped.id).toBe('u-free');
    expect(mapped.public_user_id).toBe('TF-ABC123');
    expect(mapped.email).toBe('free@test');
    expect(mapped.entitlement).toBeNull();
  });

  it('платный юзер → entitlement собран, updated_at берётся из ent_updated_at', () => {
    const row = {
      id: 'u-pro',
      public_user_id: 'TF-999999',
      email: 'pro@test',
      registered_at: '2026-01-01T00:00:00Z',
      last_sign_in_at: '2026-07-20T12:00:00Z',
      plan: 'pro',
      valid_until: '2026-12-31T00:00:00Z',
      auto_renew: true,
      cancel_at_period_end: false,
      source: 'yookassa',
      notes: 'note',
      ent_updated_at: '2026-07-19T09:00:00Z',
      renewal_attempts_count: 2,
      last_payment_at: '2026-07-01T00:00:00Z',
      sessions_count: 42,
      tasks_created_count: 17,
      latest_app_version: '1.0.0',
      latest_os: 'macos',
    };
    const mapped = mapAdminUserRow(row);
    expect(mapped.entitlement).not.toBeNull();
    expect(mapped.entitlement?.plan).toBe('pro');
    expect(mapped.entitlement?.auto_renew).toBe(true);
    expect(mapped.entitlement?.updated_at).toBe('2026-07-19T09:00:00Z');
    expect(mapped.entitlement?.renewal_attempts_count).toBe(2);
    expect(mapped.last_sign_in_at).toBe('2026-07-20T12:00:00Z');
  });

  it('public_user_id может быть null (старый профиль без TF-ID)', () => {
    const row = {
      id: 'u-old',
      public_user_id: null,
      email: 'old@test',
      registered_at: '2025-12-01T00:00:00Z',
      last_sign_in_at: null,
      plan: 'lifetime',
      valid_until: null,
      auto_renew: false,
      cancel_at_period_end: false,
      source: 'seed',
      notes: null,
      ent_updated_at: '2025-12-01T00:00:00Z',
      renewal_attempts_count: 0,
      last_payment_at: null,
      sessions_count: 0,
      tasks_created_count: 0,
      latest_app_version: null,
      latest_os: null,
    };
    const mapped = mapAdminUserRow(row);
    expect(mapped.public_user_id).toBeNull();
    expect(mapped.entitlement?.plan).toBe('lifetime');
  });
});
