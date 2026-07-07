-- 0010_grant_service_role_on_payment_tables.sql
-- v0.9.35-dev.6.4.2
--
-- Fix: service_role роль не имела CRUD прав на таблицы платёжного контура,
-- из-за чего Edge Function payment-webhook падала с
--   "permission denied for table payment_events" (даже с корректным sb_secret_* ключом).
--
-- PostgREST hint из логов:
--   "Grant the required privileges to the current role with:
--    GRANT SELECT ON public.payment_events TO service_role"
--
-- Причина: в 0007_entitlements.sql таблицы созданы, RLS-политики настроены,
-- но GRANT'ы на роль service_role не выданы. RLS policies действуют
-- поверх table-level privileges — без GRANT PostgREST отклоняет запрос
-- ещё до применения policy.
--
-- Также ALTER DEFAULT PRIVILEGES — чтобы будущие таблицы в public
-- сразу получали права для service_role.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_events        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_entitlements     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activation_requests   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.usage_events          TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
