-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- 0042_profile_avatar_color.sql — явный цвет аватара в профиле (F41, ADR 0032).
--
-- ПРОБЛЕМА: цвет глифа аватара брался из CSS-переменной темы (класс
-- `text-accent`), поэтому «свой» цвет аватара менялся вместе с темой приложения
-- и не мог быть выбран пользователем. Форма (avatar_variant 1..8) хранилась, а
-- цвет — нет.
--
-- РЕШЕНИЕ: косметическая колонка profiles.avatar_color — hex-строка `#rrggbb`.
--   • NULL = «цвет не задан» → клиент рисует аватар акцентом темы (поведение
--     старых клиентов и старых профилей не меняется);
--   • не-NULL = явно выбранный пользователем цвет, от темы не зависит.
--
-- CHECK повторяет клиентскую валидацию (src/lib/profile.ts: AVATAR_COLOR_RE).
-- Колонка входит в own-row RLS `profiles_update_own` (политика по строке, не по
-- колонкам) — отдельных политик не требуется. public_user_id / id по-прежнему
-- защищены guard-триггером profiles_guard_immutable, его не трогаем.
--
-- Идемпотентна: add column if not exists + пересоздание CHECK через drop if exists.
-- ============================================================================

alter table public.profiles
  add column if not exists avatar_color text;

alter table public.profiles
  drop constraint if exists profiles_avatar_color_format;

alter table public.profiles
  add constraint profiles_avatar_color_format
  check (avatar_color is null or avatar_color ~* '^#[0-9a-f]{6}$');

comment on column public.profiles.avatar_color is
  'Косметика профиля: явный цвет аватара в формате #rrggbb. NULL = цвет берётся '
  'из акцента текущей темы (старое поведение). Задаётся пользователем, от темы '
  'не зависит. См. ADR 0032.';
