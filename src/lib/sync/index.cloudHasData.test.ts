/**
 * Тест cloudHasData() (Баг #2, v0.9.35-dev.6.10.0).
 *
 * Контекст бага: AccountSwitchGate при выборе «Загрузить облачные» вызывал
 * clearUserData() ВСЛЕПУЮ — стирал локальную базу до проверки, есть ли вообще
 * данные в облаке. Если облако пустое (первый вход нового аккаунта), локальные
 * задачи терялись безвозвратно. Именно так исчезли задачи test1.
 *
 * cloudHasData(userId) — быстрая проверка (COUNT head-запрос к sync_statuses):
 * возвращает true, если в облаке есть хоть один статус пользователя. Гейт теперь
 * зовёт её перед стиранием и показывает предупреждение, если облако пусто.
 *
 * Критично для безопасности: при ЛЮБОЙ ошибке/оффлайне функция возвращает true
 * («данные вроде есть» — не блокируем и не провоцируем потерю данных на пустом
 * ложном ответе). Проверяем это тоже.
 *
 * Мокаем supabase гибкой цепочкой (from().select().eq().is() → результат) и
 * все тяжёлые зависимости sync/index, чтобы импорт был лёгким.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Настраиваемый результат последнего звена цепочки (.is()).
let chainResult: { count: number | null; error: unknown } = { count: 0, error: null };
// Спай на .eq(), чтобы проверить, что фильтруем по user_id.
const eqSpy = vi.fn();

vi.mock('../supabase', () => {
  // Цепочка: from(table).select(cols,{count,head}).eq(col,val).is(col,val) → chainResult
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((col: string, val: unknown) => {
      eqSpy(col, val);
      return chain;
    }),
    is: vi.fn(() => Promise.resolve(chainResult)),
  };
  return {
    supabase: { from: vi.fn(() => chain) },
    isSupabaseReachable: async () => true,
  };
});

// Тяжёлые зависимости sync/index — заглушки (cloudHasData их не использует).
vi.mock('../clientId', () => ({ getClientId: () => 'test-client' }));
vi.mock('../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('./push', () => ({ pushAll: vi.fn() }));
vi.mock('./pull', () => ({ pullAll: vi.fn() }));
vi.mock('./realtime', () => ({ subscribeRealtime: vi.fn(), unsubscribeRealtime: vi.fn() }));
vi.mock('../entitlements', () => ({ getEntitlement: vi.fn(), isProOrTrial: vi.fn(() => true) }));

import { cloudHasData } from './index';

beforeEach(() => {
  chainResult = { count: 0, error: null };
  eqSpy.mockClear();
});

describe('cloudHasData (Баг #2 — защита от потери данных)', () => {
  it('облако с данными (count>0) → true', async () => {
    chainResult = { count: 7, error: null };
    expect(await cloudHasData('user-A')).toBe(true);
  });

  it('пустое облако (count=0) → false', async () => {
    chainResult = { count: 0, error: null };
    expect(await cloudHasData('user-A')).toBe(false);
  });

  it('count=null трактуется как 0 → false', async () => {
    chainResult = { count: null, error: null };
    expect(await cloudHasData('user-A')).toBe(false);
  });

  it('ошибка запроса → true (безопасно: НЕ провоцируем стирание)', async () => {
    chainResult = { count: null, error: { message: 'boom' } };
    expect(await cloudHasData('user-A')).toBe(true);
  });

  it('исключение/оффлайн → true (не блокируем)', async () => {
    // Заставляем .is() бросить исключение.
    chainResult = null as unknown as { count: number | null; error: unknown };
    // При chainResult=null промис зарезолвится в null → деструктуризация { count, error }
    // из null бросит TypeError → catch вернёт true.
    expect(await cloudHasData('user-A')).toBe(true);
  });

  it('фильтрует по user_id', async () => {
    chainResult = { count: 3, error: null };
    await cloudHasData('user-XYZ');
    expect(eqSpy).toHaveBeenCalledWith('user_id', 'user-XYZ');
  });
});
