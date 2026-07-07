-- ============================================================================
-- 0014_payment_methods_and_recurring.sql
--
-- v0.9.35-dev.6.5 — Recurring subscriptions foundation.
--
-- Adds:
--   1. public.payment_methods           — saved cards for auto-renewal
--   2. public.renewal_attempts_log      — audit log of every renewal attempt
--   3. ALTER public.user_entitlements   — 5 new columns for auto-renew state
--   4. GRANTs + RLS per docs/migrations.md rules
--
-- Design doc: taskflow_v0.9.35_dev6.5_design.md §3
--
-- Roles model (unchanged, per prior migrations):
--   - authenticated : SELECT only through RLS (own rows)
--   - service_role  : ALL (Edge Functions write here)
--   - anon          : no access
--
-- Idempotence:
--   IF NOT EXISTS on tables/columns/indexes so the migration is safe to re-run.
-- ============================================================================

BEGIN;

-- ─── 1. payment_methods ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_methods (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider          TEXT NOT NULL DEFAULT 'yookassa',
    external_id       TEXT NOT NULL,
    card_brand        TEXT,
    card_last4        TEXT,
    card_expiry_month INT,
    card_expiry_year  INT,
    title             TEXT,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payment_methods_provider_external_id_uniq
        UNIQUE (provider, external_id),
    CONSTRAINT payment_methods_expiry_month_range
        CHECK (card_expiry_month IS NULL OR (card_expiry_month BETWEEN 1 AND 12)),
    CONSTRAINT payment_methods_expiry_year_range
        CHECK (card_expiry_year IS NULL OR (card_expiry_year BETWEEN 2020 AND 2099)),
    CONSTRAINT payment_methods_last4_len
        CHECK (card_last4 IS NULL OR char_length(card_last4) = 4)
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_user_active
    ON public.payment_methods (user_id)
    WHERE is_active = true;

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION public.tg_payment_methods_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Owned by postgres → executes with owner privileges; do NOT grant EXECUTE
REVOKE ALL ON FUNCTION public.tg_payment_methods_touch_updated_at() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_payment_methods_touch_updated_at ON public.payment_methods;
CREATE TRIGGER trg_payment_methods_touch_updated_at
    BEFORE UPDATE ON public.payment_methods
    FOR EACH ROW
    EXECUTE FUNCTION public.tg_payment_methods_touch_updated_at();

-- RLS
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_methods_select ON public.payment_methods;
CREATE POLICY payment_methods_select ON public.payment_methods
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- GRANTs per docs/migrations.md rule "GRANT ↔ RLS"
GRANT SELECT ON public.payment_methods TO authenticated;
GRANT ALL    ON public.payment_methods TO service_role;

-- ─── 2. renewal_attempts_log ────────────────────────────────────────────────

-- НОТЕ: entitlement_id убран — в user_entitlements PK = user_id, отдельной id колонки нет.
-- Связь с entitlement полностью покрывается через user_id (у юзера одно entitlement).
CREATE TABLE IF NOT EXISTS public.renewal_attempts_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    payment_method_id   UUID REFERENCES public.payment_methods(id) ON DELETE SET NULL,
    attempt_number      INT  NOT NULL,
    status              TEXT NOT NULL,
    yookassa_payment_id TEXT,
    error_code          TEXT,
    error_message       TEXT,
    attempted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT renewal_log_attempt_range
        CHECK (attempt_number BETWEEN 1 AND 10),
    CONSTRAINT renewal_log_status_valid
        CHECK (status IN ('succeeded', 'canceled', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_renewal_log_user
    ON public.renewal_attempts_log (user_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_renewal_log_status
    ON public.renewal_attempts_log (status, attempted_at DESC);

-- RLS
ALTER TABLE public.renewal_attempts_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS renewal_log_select ON public.renewal_attempts_log;
CREATE POLICY renewal_log_select ON public.renewal_attempts_log
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

GRANT SELECT ON public.renewal_attempts_log TO authenticated;
GRANT ALL    ON public.renewal_attempts_log TO service_role;

-- ─── 3. Extend user_entitlements ────────────────────────────────────────────

ALTER TABLE public.user_entitlements
    ADD COLUMN IF NOT EXISTS auto_renew           BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE public.user_entitlements
    ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN     NOT NULL DEFAULT false;
ALTER TABLE public.user_entitlements
    ADD COLUMN IF NOT EXISTS next_renewal_at      TIMESTAMPTZ;
ALTER TABLE public.user_entitlements
    ADD COLUMN IF NOT EXISTS renewal_attempts     INT         NOT NULL DEFAULT 0;
ALTER TABLE public.user_entitlements
    ADD COLUMN IF NOT EXISTS payment_method_id    UUID        REFERENCES public.payment_methods(id) ON DELETE SET NULL;

-- Partial index used by cron: "who to renew right now"
CREATE INDEX IF NOT EXISTS idx_entitlements_next_renewal
    ON public.user_entitlements (next_renewal_at)
    WHERE auto_renew = true AND cancel_at_period_end = false;

COMMIT;
