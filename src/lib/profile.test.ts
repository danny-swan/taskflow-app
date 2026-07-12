/**
 * Unit-тесты модуля профиля (v1.0.x).
 *
 * Покрывает:
 *   • validateProfileUpdate — лимиты nickname/bio, диапазон avatar_variant;
 *   • fetchProfile — маппинг select и передача id в .eq();
 *   • updateProfile — НЕ шлёт public_user_id/id/email, шлёт только косметику.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Управляемый мок supabase с записью аргументов ──────────────────────────
const calls = {
  from: null as string | null,
  selectCols: null as string | null,
  eq: null as [string, unknown] | null,
  updatePayload: null as Record<string, unknown> | null,
};
let fetchResult: { data: unknown; error: unknown } = { data: null, error: null };
let updateResult: { data: unknown; error: unknown } = { data: null, error: null };

vi.mock('./supabase', () => {
  const makeBuilder = () => {
    const builder: Record<string, any> = {};
    builder.select = (cols: string) => { calls.selectCols = cols; return builder; };
    builder.update = (payload: Record<string, unknown>) => { calls.updatePayload = payload; return builder; };
    builder.eq = (col: string, val: unknown) => { calls.eq = [col, val]; return builder; };
    builder.maybeSingle = () => Promise.resolve(fetchResult);
    builder.single = () => Promise.resolve(updateResult);
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => { calls.from = table; return makeBuilder(); },
    },
  };
});

vi.mock('./logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  validateProfileUpdate,
  fetchProfile,
  updateProfile,
  NICKNAME_MAX,
  BIO_MAX,
} from './profile';

beforeEach(() => {
  calls.from = null;
  calls.selectCols = null;
  calls.eq = null;
  calls.updatePayload = null;
  fetchResult = { data: null, error: null };
  updateResult = { data: null, error: null };
});

describe('validateProfileUpdate', () => {
  it('пропускает ник в пределах лимита', () => {
    expect(validateProfileUpdate({ nickname: 'x'.repeat(NICKNAME_MAX) })).toEqual({
      nickname: 'x'.repeat(NICKNAME_MAX),
    });
  });

  it('бросает при нике длиннее лимита', () => {
    expect(() => validateProfileUpdate({ nickname: 'x'.repeat(NICKNAME_MAX + 1) })).toThrow();
  });

  it('пустой ник нормализуется в null', () => {
    expect(validateProfileUpdate({ nickname: '' })).toEqual({ nickname: null });
  });

  it('бросает при bio длиннее лимита', () => {
    expect(() => validateProfileUpdate({ bio: 'y'.repeat(BIO_MAX + 1) })).toThrow();
  });

  it('пропускает bio на границе лимита', () => {
    expect(validateProfileUpdate({ bio: 'y'.repeat(BIO_MAX) })).toEqual({ bio: 'y'.repeat(BIO_MAX) });
  });

  it.each([0, 9, 1.5, -1, NaN])('бросает при avatar_variant=%s', v => {
    expect(() => validateProfileUpdate({ avatar_variant: v })).toThrow();
  });

  it.each([1, 4, 8])('пропускает валидный avatar_variant=%s', v => {
    expect(validateProfileUpdate({ avatar_variant: v })).toEqual({ avatar_variant: v });
  });
});

describe('fetchProfile', () => {
  it('читает из profiles по id и возвращает строку', async () => {
    fetchResult = {
      data: {
        public_user_id: 'TF-ABC234',
        nickname: 'Ник',
        avatar_variant: 3,
        bio: null,
        email: 'a@b.test',
        created_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    };
    const p = await fetchProfile('user-1');
    expect(calls.from).toBe('profiles');
    expect(calls.eq).toEqual(['id', 'user-1']);
    expect(calls.selectCols).toContain('public_user_id');
    expect(p?.public_user_id).toBe('TF-ABC234');
  });

  it('возвращает null, если строки нет', async () => {
    fetchResult = { data: null, error: null };
    expect(await fetchProfile('user-x')).toBeNull();
  });

  it('бросает при ошибке', async () => {
    fetchResult = { data: null, error: { message: 'boom' } };
    await expect(fetchProfile('user-1')).rejects.toBeTruthy();
  });
});

describe('updateProfile', () => {
  it('шлёт только косметические поля, без public_user_id/id/email', async () => {
    updateResult = {
      data: {
        public_user_id: 'TF-ABC234',
        nickname: 'Новый',
        avatar_variant: 5,
        bio: 'hi',
        email: 'a@b.test',
        created_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    };
    await updateProfile('user-1', {
      nickname: 'Новый',
      avatar_variant: 5,
      bio: 'hi',
      // @ts-expect-error — намеренно пытаемся протащить запрещённые поля
      public_user_id: 'TF-HACKED',
      id: 'other',
      email: 'evil@test',
    });
    expect(calls.updatePayload).toEqual({ nickname: 'Новый', avatar_variant: 5, bio: 'hi' });
    expect(calls.updatePayload).not.toHaveProperty('public_user_id');
    expect(calls.updatePayload).not.toHaveProperty('id');
    expect(calls.updatePayload).not.toHaveProperty('email');
    expect(calls.eq).toEqual(['id', 'user-1']);
  });

  it('бросает при нарушении лимита ещё до запроса', async () => {
    await expect(
      updateProfile('user-1', { bio: 'z'.repeat(BIO_MAX + 1) }),
    ).rejects.toThrow();
    expect(calls.updatePayload).toBeNull();
  });
});
