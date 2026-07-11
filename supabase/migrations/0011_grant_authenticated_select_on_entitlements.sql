-- 0011_grant_authenticated_select_on_entitlements.sql
-- v0.9.35-dev.6.4.3
--
-- Fix: authenticated роль не имела SELECT на таблицах платёжного контура.
--
-- После миграции 0010 (GRANT'ы для service_role) webhook начал успешно писать
-- в user_entitlements, но клиент всё равно не видел свой Pro-план: возвращал
-- пустой ответ. При SET LOCAL ROLE authenticated + SELECT воспроизведено:
--
--   ERROR: 42501: permission denied for table user_entitlements
--   HINT:  Grant the required privileges to the current role with:
--          GRANT SELECT ON public.user_entitlements TO authenticated;
--
-- RLS policy `user_entitlements_select_own (auth.uid() = user_id)` проверяется
-- ПОСЛЕ table-level GRANT. Без GRANT SELECT PostgREST отклоняет запрос ещё
-- до применения policy → клиент получает "permission denied" и fallback'ит
-- на кэш settings (last plan = free) → пользователь видит Free даже после оплаты.
--
-- Root cause: в 0007_entitlements.sql создали таблицы + настроили RLS, но
-- забыли GRANT'ы. Обычный Supabase workflow (создание таблицы через Dashboard)
-- автоматически добавляет ALTER DEFAULT PRIVILEGES для authenticated/anon,
-- но при миграциях через CLI/API этот default не срабатывает.
--
-- Также добавляем ALTER DEFAULT PRIVILEGES, чтобы будущие таблицы в public
-- сразу получали SELECT для authenticated (согласуется с Supabase default).

GRANT SELECT ON public.user_entitlements     TO authenticated;
GRANT SELECT ON public.activation_requests   TO authenticated;
GRANT SELECT ON public.payment_events        TO authenticated;
GRANT SELECT ON public.usage_events          TO authenticated;

-- INSERT для activation_requests: юзер отправляет заявку на активацию
-- (submitActivationRequest в src/lib/entitlements.ts). RLS policy INSERT
-- защищает данные, GRANT нужен для доступа PostgREST к таблице.
GRANT INSERT ON public.activation_requests   TO authenticated;

-- Default для будущих таблиц.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO authenticated;
