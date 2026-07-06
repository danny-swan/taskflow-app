-- ============================================================================
-- 0009_admin_seed.sql — seed grandfathered / admin lifetime по email
-- ============================================================================
--
-- v0.9.35-dev.6.1: раньше в 0007 был хардкод email админа. С этой версии
-- email не хранится в истории кода. Seed выполняется по значению из
-- postgres session GUC `app.admin_email`:
--
--   1. В Supabase SQL editor (или psql) выставить переменную сессии:
--        set app.admin_email = 'admin@example.com';
--   2. Прогнать эту миграцию:
--        supabase db push
--      Или выполнить блок вручную из SQL editor'а.
--   3. Если GUC пустой/не задан — миграция становится no-op и молча
--      выходит, не роняя pipeline.
--
-- Для production-окружения (где миграции идут через CI) вариант такой:
--   а) выставить GUC на уровне роли: alter role postgres set app.admin_email = '…';
--   б) либо выполнить seed вручную один раз через SQL editor после deploy.
--
-- В обоих случаях email в git-историю не попадает.
-- ============================================================================

do $$
declare
  admin_email text;
  admin_id    uuid;
begin
  -- current_setting(..., true) — true = вернуть NULL, если GUC не задан,
  -- вместо raise.
  admin_email := nullif(current_setting('app.admin_email', true), '');
  if admin_email is null then
    raise notice '[0009_admin_seed] app.admin_email не задан — seed пропущен';
    return;
  end if;

  select id into admin_id from auth.users where email = admin_email;
  if admin_id is null then
    raise notice '[0009_admin_seed] пользователь % ещё не зарегистрирован — seed пропущен', admin_email;
    return;
  end if;

  insert into public.user_entitlements (user_id, plan, valid_until, source, notes, trial_used)
  values (admin_id, 'lifetime'::public.plan_kind, null, 'seed'::public.entitlement_source,
          'grandfathered admin (v0.9.35-dev.6.1)', true)
  on conflict (user_id) do update
    set plan        = 'lifetime',
        valid_until = null,
        source      = 'seed',
        notes       = coalesce(public.user_entitlements.notes, '')
                      || case when public.user_entitlements.notes is null then '' else E'\n' end
                      || 'grandfathered admin (v0.9.35-dev.6.1)',
        trial_used  = true;

  raise notice '[0009_admin_seed] seed OK для user_id=%', admin_id;
end $$;
