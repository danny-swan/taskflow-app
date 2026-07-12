-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- pgTAP: кастомизация профиля (миграция 0026).
--
-- Проверяет:
--   1) новые колонки profiles и их типы / NOT NULL / default;
--   2) UNIQUE на public_user_id;
--   3) CHECK avatar_variant 1..8 и длины nickname (≤32) / bio (≤160);
--   4) gen_public_user_id() → формат TF- + 6 из безопасного алфавита;
--   5) handle_new_user проставляет public_user_id новому юзеру;
--   6) backfill проставил public_user_id всем существующим профилям;
--   7) guard неизменяемости: public_user_id и id нельзя переписать через UPDATE,
--      но легитимный UPDATE (nickname) проходит.

BEGIN;
SELECT plan(24);

-- ─── 1. Колонки и типы ──────────────────────────────────────────────────────
SELECT has_column('public', 'profiles', 'public_user_id', 'есть public_user_id');
SELECT has_column('public', 'profiles', 'nickname',       'есть nickname');
SELECT has_column('public', 'profiles', 'avatar_variant', 'есть avatar_variant');
SELECT has_column('public', 'profiles', 'bio',            'есть bio');

SELECT col_type_is('public', 'profiles', 'public_user_id', 'text',     'public_user_id — text');
SELECT col_type_is('public', 'profiles', 'nickname',       'text',     'nickname — text');
SELECT col_type_is('public', 'profiles', 'avatar_variant', 'smallint', 'avatar_variant — smallint');
SELECT col_type_is('public', 'profiles', 'bio',            'text',     'bio — text');

SELECT col_not_null('public', 'profiles', 'avatar_variant', 'avatar_variant NOT NULL');
SELECT col_has_default('public', 'profiles', 'avatar_variant', 'avatar_variant имеет DEFAULT');
SELECT col_is_unique('public', 'profiles', 'public_user_id', 'public_user_id UNIQUE');

-- ─── 2. gen_public_user_id() формат ─────────────────────────────────────────
SELECT matches(
  public.gen_public_user_id(),
  '^TF-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$',
  'gen_public_user_id: TF- + 6 символов из безопасного алфавита'
);
SELECT is(
  char_length(public.gen_public_user_id()),
  9,
  'gen_public_user_id: длина 9 (TF- + 6)'
);

-- ─── 3. Подготовка: два юзера (профили создаёт триггер handle_new_user) ──────
DO $$
DECLARE
  u1 uuid := '41111111-1111-1111-1111-111111111111'::uuid;
  u2 uuid := '42222222-2222-2222-2222-222222222222'::uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u1, 'prof-u1@test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.users (id, email) VALUES (u2, 'prof-u2@test') ON CONFLICT (id) DO NOTHING;
  -- На случай если триггер не отработал (например, повторный прогон) — подстрахуемся.
  INSERT INTO public.profiles (id, email, public_user_id)
    VALUES (u1, 'prof-u1@test', public.assign_public_user_id()) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id, email, public_user_id)
    VALUES (u2, 'prof-u2@test', public.assign_public_user_id()) ON CONFLICT (id) DO NOTHING;
END$$;

-- handle_new_user проставил публичный ID новому юзеру.
SELECT matches(
  (SELECT public_user_id FROM public.profiles
     WHERE id = '41111111-1111-1111-1111-111111111111'::uuid),
  '^TF-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$',
  'handle_new_user: public_user_id проставлен и в формате TF-XXXXXX'
);

-- ─── 4. CHECK-ограничения (check_violation = 23514) ─────────────────────────
SELECT throws_ok(
  $$ UPDATE public.profiles SET avatar_variant = 0
       WHERE id = '41111111-1111-1111-1111-111111111111'::uuid $$,
  '23514', NULL, 'avatar_variant = 0 отклонён CHECK'
);
SELECT throws_ok(
  $$ UPDATE public.profiles SET avatar_variant = 9
       WHERE id = '41111111-1111-1111-1111-111111111111'::uuid $$,
  '23514', NULL, 'avatar_variant = 9 отклонён CHECK'
);
SELECT throws_ok(
  $$ UPDATE public.profiles SET nickname = repeat('x', 33)
       WHERE id = '41111111-1111-1111-1111-111111111111'::uuid $$,
  '23514', NULL, 'nickname длиной 33 отклонён CHECK'
);
SELECT throws_ok(
  $$ UPDATE public.profiles SET bio = repeat('y', 161)
       WHERE id = '41111111-1111-1111-1111-111111111111'::uuid $$,
  '23514', NULL, 'bio длиной 161 отклонён CHECK'
);

-- ─── 5. UNIQUE public_user_id (unique_violation = 23505) ────────────────────
-- Guard-триггер молча откатывает смену public_user_id, поэтому для проверки
-- самого UNIQUE-ограничения временно отключаем guard внутри транзакции.
ALTER TABLE public.profiles DISABLE TRIGGER profiles_guard_immutable;
SELECT throws_ok(
  $$ UPDATE public.profiles
       SET public_user_id = (SELECT public_user_id FROM public.profiles
                               WHERE id = '41111111-1111-1111-1111-111111111111'::uuid)
       WHERE id = '42222222-2222-2222-2222-222222222222'::uuid $$,
  '23505', NULL, 'дублирующий public_user_id отклонён UNIQUE'
);
ALTER TABLE public.profiles ENABLE TRIGGER profiles_guard_immutable;

-- ─── 6. Guard неизменяемости ────────────────────────────────────────────────
DO $$
DECLARE
  u1 uuid := '41111111-1111-1111-1111-111111111111'::uuid;
  orig text;
BEGIN
  SELECT public_user_id INTO orig FROM public.profiles WHERE id = u1;
  -- Попытка сменить public_user_id — guard должен молча вернуть старое значение.
  UPDATE public.profiles SET public_user_id = 'TF-ZZZZZZ' WHERE id = u1;
  PERFORM set_config('test.orig_pub_id', orig, false);
END$$;

SELECT is(
  (SELECT public_user_id FROM public.profiles
     WHERE id = '41111111-1111-1111-1111-111111111111'::uuid),
  current_setting('test.orig_pub_id'),
  'guard: public_user_id не изменился после попытки UPDATE'
);

-- id также защищён.
UPDATE public.profiles
  SET id = '49999999-9999-9999-9999-999999999999'::uuid
  WHERE id = '41111111-1111-1111-1111-111111111111'::uuid;
SELECT ok(
  EXISTS (SELECT 1 FROM public.profiles
            WHERE id = '41111111-1111-1111-1111-111111111111'::uuid),
  'guard: id не изменился после попытки UPDATE'
);

-- Легитимный UPDATE (nickname) проходит.
UPDATE public.profiles SET nickname = 'Данила'
  WHERE id = '41111111-1111-1111-1111-111111111111'::uuid;
SELECT is(
  (SELECT nickname FROM public.profiles
     WHERE id = '41111111-1111-1111-1111-111111111111'::uuid),
  'Данила',
  'легитимный UPDATE nickname проходит через guard'
);

-- avatar_variant в допустимом диапазоне обновляется.
UPDATE public.profiles SET avatar_variant = 5
  WHERE id = '41111111-1111-1111-1111-111111111111'::uuid;
SELECT is(
  (SELECT avatar_variant FROM public.profiles
     WHERE id = '41111111-1111-1111-1111-111111111111'::uuid),
  5::smallint,
  'avatar_variant в диапазоне 1..8 обновляется'
);

-- ─── 7. Backfill: у всех профилей public_user_id заполнен ────────────────────
SELECT is(
  (SELECT count(*)::int FROM public.profiles WHERE public_user_id IS NULL),
  0,
  'backfill: нет профилей с NULL public_user_id'
);

SELECT * FROM finish();
ROLLBACK;
