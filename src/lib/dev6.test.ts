/**
 * v0.9.35-dev.6 — Unit-тесты Freemium + Trial + Subscription + Lifetime.
 *
 * Основа тестирования:
 *   1. resolveEntitlement — чистая функция, легко покрывается всеми 5 case'ами.
 *   2. Хелперы (isPro, isProOrTrial, isAdmin, daysLeftInTrial).
 *   3. Кэш settings (readCachedRow / writeCachedRow).
 *   4. HMAC-SHA256 signature verification для payment-webhook (та же формула).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolveEntitlement,
  isPro,
  isProOrTrial,
  isAdmin,
  daysLeftInTrial,
  daysLeftInSubscription,
  readCachedRow,
  writeCachedRow,
  ADMIN_EMAILS,
  TRIAL_DAYS,
  type EntitlementRow,
} from './entitlements';

// ─── mock db (kv-store в settings-таблице) для кэша ───────────────────────────
// entitlements.ts использует db.get / db.run с ключом ENTITLEMENT_CACHE_KEY.

const settingsStore = new Map<string, string>();

vi.mock('./db', () => ({
  get: (sql: string, params: unknown[]) => {
    // 'SELECT value FROM settings WHERE key=?' с params[0] = key
    const key = params?.[0] as string | undefined;
    if (!key) return null;
    const val = settingsStore.get(key);
    return val ? { value: val } : null;
  },
  run: (sql: string, params: unknown[]) => {
    const key = params?.[0] as string;
    if (sql.startsWith('DELETE FROM settings')) {
      settingsStore.delete(key);
    } else if (sql.startsWith('INSERT OR REPLACE INTO settings')) {
      const value = params?.[1] as string;
      settingsStore.set(key, value);
    }
  },
  all: () => [],
}));

// Также нужен мок supabase (entitlements.ts импортирует его) и logger.
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => ({ data: null, error: null }) }) }) }),
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), unsubscribe: () => {} }),
    removeChannel: () => {},
  },
}));

vi.mock('./logger', () => ({
  logger: {
    warn: () => {},
    info: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// ─── helpers для конструирования EntitlementRow ───────────────────────────────

function row(overrides: Partial<EntitlementRow> = {}): EntitlementRow {
  return {
    user_id: 'user-1',
    plan: 'free',
    valid_until: null,
    activated_at: null,
    source: null,
    trial_used: false,
    notes: null,
    updated_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    ...overrides,
  };
}

const NOW = new Date('2026-07-06T12:00:00Z');

// ═══════════════════════════════════════════════════════════════════════════════
// 1. resolveEntitlement — все 5 case'ов
// ═══════════════════════════════════════════════════════════════════════════════

describe('resolveEntitlement — admin override', () => {
  it('email из ADMIN_EMAILS → всегда lifetime, даже если row=null', () => {
    const e = resolveEntitlement(null, 'admin@example.test', NOW.getTime());
    expect(e.effectivePlan).toBe('lifetime');
    expect(e.isAdmin).toBe(true);
    expect(isPro(e)).toBe(true);
    expect(isProOrTrial(e)).toBe(true);
  });

  it('admin email + free row → override lifetime', () => {
    const e = resolveEntitlement(row({ plan: 'free' }), 'admin@example.test', NOW.getTime());
    expect(e.effectivePlan).toBe('lifetime');
    expect(e.isAdmin).toBe(true);
  });

  it('email вне ADMIN_EMAILS → isAdmin = false', () => {
    const e = resolveEntitlement(null, 'someone@else.com', NOW.getTime());
    expect(e.isAdmin).toBe(false);
    expect(e.effectivePlan).toBe('free');
  });

  it('ADMIN_EMAILS содержит admin@example.test (защита от опечаток)', () => {
    expect(ADMIN_EMAILS).toContain('admin@example.test');
  });
});

describe('resolveEntitlement — row=null (первый вход)', () => {
  it('non-admin, row=null → free', () => {
    const e = resolveEntitlement(null, 'new@user.com', NOW.getTime());
    expect(e.effectivePlan).toBe('free');
    expect(e.rawPlan).toBe('free');
    expect(e.trialUsed).toBe(false);
    expect(e.validUntil).toBeNull();
    expect(isPro(e)).toBe(false);
    expect(isProOrTrial(e)).toBe(false);
  });
});

describe('resolveEntitlement — lifetime', () => {
  it('plan=lifetime → всегда pro, validUntil null (или игнорим)', () => {
    const e = resolveEntitlement(row({ plan: 'lifetime' }), 'user@x.com', NOW.getTime());
    expect(e.effectivePlan).toBe('lifetime');
    expect(isPro(e)).toBe(true);
    expect(e.msLeft).toBeNull();
  });
});

describe('resolveEntitlement — trial', () => {
  it('trial с valid_until в будущем → effectivePlan trial', () => {
    const future = new Date(NOW.getTime() + 3 * 86_400_000); // +3 дня
    const e = resolveEntitlement(
      row({ plan: 'trial', valid_until: future.toISOString(), trial_used: true }),
      'user@x.com',
      NOW.getTime(),
    );
    expect(e.effectivePlan).toBe('trial');
    expect(isProOrTrial(e)).toBe(true);
    expect(daysLeftInTrial(e)).toBe(3);
  });

  it('trial с истёкшим valid_until → effectivePlan=free, rawPlan=trial', () => {
    const past = new Date(NOW.getTime() - 86_400_000); // вчера
    const e = resolveEntitlement(
      row({ plan: 'trial', valid_until: past.toISOString(), trial_used: true }),
      'user@x.com',
      NOW.getTime(),
    );
    expect(e.effectivePlan).toBe('free');
    expect(e.rawPlan).toBe('trial');
    expect(e.trialUsed).toBe(true);
    expect(isProOrTrial(e)).toBe(false);
  });

  it('trial без valid_until → безопасно, free', () => {
    const e = resolveEntitlement(
      row({ plan: 'trial', valid_until: null }),
      'user@x.com',
      NOW.getTime(),
    );
    expect(e.effectivePlan).toBe('free');
  });
});

describe('resolveEntitlement — pro', () => {
  it('pro с valid_until в будущем → effectivePlan pro', () => {
    const future = new Date(NOW.getTime() + 30 * 86_400_000);
    const e = resolveEntitlement(
      row({ plan: 'pro', valid_until: future.toISOString() }),
      'user@x.com',
      NOW.getTime(),
    );
    expect(e.effectivePlan).toBe('pro');
    expect(isPro(e)).toBe(true);
    expect(daysLeftInSubscription(e)).toBe(30);
  });

  it('pro с истёкшим valid_until → effectivePlan=free', () => {
    const past = new Date(NOW.getTime() - 10 * 86_400_000);
    const e = resolveEntitlement(
      row({ plan: 'pro', valid_until: past.toISOString() }),
      'user@x.com',
      NOW.getTime(),
    );
    expect(e.effectivePlan).toBe('free');
    expect(e.rawPlan).toBe('pro');
  });
});

describe('resolveEntitlement — unknown plan', () => {
  it('невалидный plan → fallback free', () => {
    const e = resolveEntitlement(
      row({ plan: 'exotic' as unknown as EntitlementRow['plan'] }),
      'user@x.com',
      NOW.getTime(),
    );
    expect(e.effectivePlan).toBe('free');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. TRIAL_DAYS константа
// ═══════════════════════════════════════════════════════════════════════════════

describe('константы', () => {
  it('TRIAL_DAYS = 14', () => {
    expect(TRIAL_DAYS).toBe(14);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Кэш settings
// ═══════════════════════════════════════════════════════════════════════════════

describe('cache (readCachedRow / writeCachedRow)', () => {
  beforeEach(() => {
    settingsStore.clear();
  });

  it('пустой кэш → null', () => {
    expect(readCachedRow()).toBeNull();
  });

  it('write → read → тот же row', () => {
    const r = row({ plan: 'pro', valid_until: '2027-01-01T00:00:00Z' });
    writeCachedRow(r);
    const read = readCachedRow();
    expect(read?.plan).toBe('pro');
    expect(read?.valid_until).toBe('2027-01-01T00:00:00Z');
  });

  it('write(null) → read null', () => {
    writeCachedRow(row({ plan: 'pro' }));
    expect(readCachedRow()).not.toBeNull();
    writeCachedRow(null);
    expect(readCachedRow()).toBeNull();
  });

  it('битый JSON → read null (не падает)', () => {
    settingsStore.set('entitlement_cache_v1', '{bad json');
    expect(readCachedRow()).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. HMAC-SHA256 подпись — та же формула, что в payment-webhook Edge Function.
// ═══════════════════════════════════════════════════════════════════════════════

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const bytes = new Uint8Array(sigBuf);
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

describe('payment-webhook HMAC (формула, дублированная в Edge Function)', () => {
  it('известный вектор: секрет "key", сообщение "The quick brown fox jumps over the lazy dog"', async () => {
    // RFC 4231 не покрывает этот пример, но известная эталонная HMAC-SHA256
    // из https://en.wikipedia.org/wiki/HMAC#Examples
    const sig = await hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog');
    expect(sig).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });

  it('пустое сообщение с "test-secret" даёт стабильный дайджест', async () => {
    const s1 = await hmacSha256Hex('test-secret', '');
    const s2 = await hmacSha256Hex('test-secret', '');
    expect(s1).toBe(s2);
    expect(s1).toHaveLength(64);
  });

  it('разные ключи → разные подписи', async () => {
    const msg = '{"external_id":"tx-1"}';
    const a = await hmacSha256Hex('secret-a', msg);
    const b = await hmacSha256Hex('secret-b', msg);
    expect(a).not.toBe(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. daysLeftInTrial / daysLeftInSubscription — граничные значения
// ═══════════════════════════════════════════════════════════════════════════════

describe('daysLeftInTrial / daysLeftInSubscription', () => {
  it('free → 0', () => {
    const e = resolveEntitlement(null, 'x@y.com', NOW.getTime());
    expect(daysLeftInTrial(e)).toBe(0);
    expect(daysLeftInSubscription(e)).toBe(0);
  });

  it('lifetime → 0 (нет expiry)', () => {
    const e = resolveEntitlement(row({ plan: 'lifetime' }), 'x@y.com', NOW.getTime());
    expect(daysLeftInSubscription(e)).toBe(0);
  });

  it('trial за 30 минут до истечения → 1 (ceil)', () => {
    const almostExpired = new Date(NOW.getTime() + 30 * 60_000);
    const e = resolveEntitlement(
      row({ plan: 'trial', valid_until: almostExpired.toISOString(), trial_used: true }),
      'x@y.com',
      NOW.getTime(),
    );
    expect(daysLeftInTrial(e)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. isAdmin — проверка через хелпер
// ═══════════════════════════════════════════════════════════════════════════════

describe('isAdmin helper', () => {
  it('true для email из списка', () => {
    const e = resolveEntitlement(null, 'admin@example.test', NOW.getTime());
    expect(isAdmin(e)).toBe(true);
  });
  it('false для остальных', () => {
    const e = resolveEntitlement(null, 'random@x.com', NOW.getTime());
    expect(isAdmin(e)).toBe(false);
  });
  it('true даже с явным Pro row (admin > row)', () => {
    const future = new Date(NOW.getTime() + 86_400_000).toISOString();
    const e = resolveEntitlement(
      row({ plan: 'pro', valid_until: future }),
      'admin@example.test',
      NOW.getTime(),
    );
    expect(isAdmin(e)).toBe(true);
    expect(e.effectivePlan).toBe('lifetime'); // override
  });
});
