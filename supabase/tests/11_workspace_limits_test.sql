-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
-- Copyright (c) 2026 Daniil Lebedev (danny-swan)
--
-- pgTAP: тарифные лимиты пространств (миграция 0029, Wave A, PR-5).
--
-- Проверяет:
--   1) get_workspace_limit: free personal=2, free shared=0, платный=7 (pro/trial),
--      истёкший pro трактуется как free (=2);
--   2) триггер enforce_workspace_limit существует;
--   3) поведение лимита на INSERT (гейт auth.uid() = owner_id):
--      • free с 1 personal → создание 2-го успех, 3-й падает (workspace_limit_exceeded);
--      • paid с 6 → создание 7-го успех, 8-й падает;
--   4) после 0030 guard block_shared_workspaces снят: kind='shared' у free и paid
--      отклоняется теперь тарифным лимитом (P0001 workspace_limit_exceeded), а не
--      check-constraint'ом 23514 (free shared лимит=0; paid уже упёрся в 7).
--
-- Гейт триггера срабатывает только когда auth.uid() = NEW.owner_id (клиент
-- создаёт своё пространство). Поэтому предзаполнение «уже N штук» делаем как
-- суперпользователь (auth.uid() IS NULL → триггер пропускает), а проверяемую
-- границу — под ролью authenticated с выставленным JWT (как реальный клиент).
--
-- Стиль — как 09/10. Выполняется на vanilla Postgres 15 (CI).

BEGIN;
SELECT plan(14);

-- ─── Пользователи и entitlements ────────────────────────────────────────────
DO $$
DECLARE
  u_free  uuid := 'f1111111-1111-1111-1111-111111111111'::uuid; -- free (нет строки)
  u_paid  uuid := 'f2222222-2222-2222-2222-222222222222'::uuid; -- pro активный
  u_trial uuid := 'f3333333-3333-3333-3333-333333333333'::uuid; -- trial активный
  u_exp   uuid := 'f4444444-4444-4444-4444-444444444444'::uuid; -- pro истёкший
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (u_free,  'lim-free@test'),
    (u_paid,  'lim-paid@test'),
    (u_trial, 'lim-trial@test'),
    (u_exp,   'lim-exp@test')
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_entitlements (user_id, plan, valid_until) VALUES
    (u_paid,  'pro',   now() + interval '30 days'),
    (u_trial, 'trial', now() + interval '7 days'),
    (u_exp,   'pro',   now() - interval '1 day')
    ON CONFLICT (user_id) DO UPDATE
      SET plan = excluded.plan, valid_until = excluded.valid_until;
END$$;

-- ─── 1. get_workspace_limit ─────────────────────────────────────────────────
SELECT has_function(
  'public', 'get_workspace_limit', ARRAY['uuid', 'text'],
  'get_workspace_limit(uuid, text) существует'
);
SELECT is(
  public.get_workspace_limit('f1111111-1111-1111-1111-111111111111'::uuid, 'personal'),
  2, 'free + personal → лимит 2'
);
SELECT is(
  public.get_workspace_limit('f1111111-1111-1111-1111-111111111111'::uuid, 'shared'),
  0, 'free + shared → лимит 0'
);
SELECT is(
  public.get_workspace_limit('f2222222-2222-2222-2222-222222222222'::uuid, 'personal'),
  7, 'pro (активный) + personal → лимит 7'
);
SELECT is(
  public.get_workspace_limit('f2222222-2222-2222-2222-222222222222'::uuid, 'shared'),
  7, 'pro (активный) + shared → лимит 7 (суммарно по kind)'
);
SELECT is(
  public.get_workspace_limit('f3333333-3333-3333-3333-333333333333'::uuid, 'personal'),
  7, 'trial (активный) → лимит 7'
);
SELECT is(
  public.get_workspace_limit('f4444444-4444-4444-4444-444444444444'::uuid, 'personal'),
  2, 'pro истёкший (valid_until в прошлом) → трактуется как free (лимит 2)'
);

-- ─── 2. Триггер существует ──────────────────────────────────────────────────
SELECT has_trigger(
  'public', 'sync_workspaces', 'enforce_workspace_limit',
  'триггер enforce_workspace_limit на sync_workspaces'
);

-- ─── 3a. FREE: 1 personal уже есть → 2-й успех, 3-й падает ───────────────────
-- Предзаполняем 1 personal как суперпользователь (триггер пропускает: auth.uid() NULL).
INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
  VALUES ('wsf-1', 'f1111111-1111-1111-1111-111111111111'::uuid,
          'f1111111-1111-1111-1111-111111111111'::uuid, 'Free 1', 'personal');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'f1111111-1111-1111-1111-111111111111';

-- 2-е пространство (под лимитом: было 1, лимит 2) → успех.
SELECT lives_ok(
  $$ INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
       VALUES ('wsf-2', 'f1111111-1111-1111-1111-111111111111'::uuid,
               'f1111111-1111-1111-1111-111111111111'::uuid, 'Free 2', 'personal') $$,
  'free: создание 2-го personal (под лимитом) — успех'
);
-- 3-е пространство (на лимите: стало 2, лимит 2) → падает.
SELECT throws_ok(
  $$ INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
       VALUES ('wsf-3', 'f1111111-1111-1111-1111-111111111111'::uuid,
               'f1111111-1111-1111-1111-111111111111'::uuid, 'Free 3', 'personal') $$,
  'P0001', 'workspace_limit_exceeded',
  'free: создание 3-го personal (лимит 2 достигнут) — отклонено'
);
-- shared у free — теперь отклонено тарифным лимитом (0030 снял guard; лимит shared=0).
-- Раньше падало 23514 (block_shared_workspaces), теперь P0001 workspace_limit_exceeded.
SELECT throws_ok(
  $$ INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
       VALUES ('wsf-sh', 'f1111111-1111-1111-1111-111111111111'::uuid,
               'f1111111-1111-1111-1111-111111111111'::uuid, 'Free Shared', 'shared') $$,
  'P0001', 'workspace_limit_exceeded',
  'free: kind=shared отклонён тарифным лимитом shared=0 (0030 снял guard)'
);
RESET ROLE;

-- ─── 3b. PAID: 6 уже есть → 7-й успех, 8-й падает ───────────────────────────
-- Предзаполняем 6 personal как суперпользователь (триггер пропускает).
DO $$
DECLARE
  u_paid uuid := 'f2222222-2222-2222-2222-222222222222'::uuid;
  i int;
BEGIN
  FOR i IN 1..6 LOOP
    INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
      VALUES ('wsp-' || i, u_paid, u_paid, 'Paid ' || i, 'personal');
  END LOOP;
END$$;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO 'f2222222-2222-2222-2222-222222222222';

-- 7-е пространство (под лимитом: было 6, лимит 7) → успех.
SELECT lives_ok(
  $$ INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
       VALUES ('wsp-7', 'f2222222-2222-2222-2222-222222222222'::uuid,
               'f2222222-2222-2222-2222-222222222222'::uuid, 'Paid 7', 'personal') $$,
  'paid: создание 7-го (под лимитом) — успех'
);
-- 8-е пространство (на лимите: стало 7, лимит 7) → падает.
SELECT throws_ok(
  $$ INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
       VALUES ('wsp-8', 'f2222222-2222-2222-2222-222222222222'::uuid,
               'f2222222-2222-2222-2222-222222222222'::uuid, 'Paid 8', 'personal') $$,
  'P0001', 'workspace_limit_exceeded',
  'paid: создание 8-го (лимит 7 достигнут) — отклонено'
);
-- shared у paid — теперь отклонено тарифным лимитом (0030 снял guard). Счётчик
-- суммарный по всем kind: у paid уже 7 пространств = лимит 7 → P0001 (не 23514).
SELECT throws_ok(
  $$ INSERT INTO public.sync_workspaces (id, user_id, owner_id, name, kind)
       VALUES ('wsp-sh', 'f2222222-2222-2222-2222-222222222222'::uuid,
               'f2222222-2222-2222-2222-222222222222'::uuid, 'Paid Shared', 'shared') $$,
  'P0001', 'workspace_limit_exceeded',
  'paid: kind=shared отклонён тарифным лимитом (7 из 7 занято; 0030 снял guard)'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
