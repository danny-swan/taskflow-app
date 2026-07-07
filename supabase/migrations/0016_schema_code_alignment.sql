-- ============================================================================
-- 0016_schema_code_alignment.sql
--
-- v0.9.35-dev.6.5.3 — Schema ↔ Code alignment.
--
-- Устраняет рассинхронизацию между миграцией 0014 и кодом Edge Functions,
-- написанным под расширенную схему. Подход: добавляем недостающие колонки
-- (backward-compatible), не удаляем старые — ничего не ломается.
--
-- Изменения:
--
--   1. payment_methods
--      + card_first6        TEXT              — первые 6 цифр карты (BIN)
--      + card_type          TEXT              — Visa / MasterCard / Mir (тип карты)
--      + method_type        TEXT DEFAULT 'bank_card' — тип метода (bank_card / sber_pay / sbp / t_pay)
--      + saved_at           TIMESTAMPTZ       — алиас для UI (=created_at по смыслу; заполняется кодом)
--
--   2. user_entitlements
--      + renewal_attempts_count  INT NOT NULL DEFAULT 0  — счётчик провалов (код пишет это имя)
--      + last_renewal_attempt_at TIMESTAMPTZ             — последняя попытка продления
--      + last_payment_id         TEXT                    — YooKassa payment.id последней успешной оплаты
--      + last_payment_at         TIMESTAMPTZ             — время последней успешной оплаты
--
--   3. renewal_attempts_log
--      + payment_id              TEXT                    — алиас для кода (код пишет payment_id, схема хранит yookassa_payment_id)
--        (НЕ дублируем данные — payment_id становится VIEW-alias через generated column нецелесообразно;
--         вместо этого выбираем: код пишет в yookassa_payment_id, поле payment_id убираем —
--         вместо этого ДОБАВЛЯЕМ payment_id как TEXT алиас-колонку и заполняем в коде оба поля)
--        Проще: добавляем колонку payment_id TEXT (=yookassa_payment_id дублируется) — OR —
--        правим код: писать в yookassa_payment_id вместо payment_id. Выбираем вариант 2:
--        добавляем НЕТ новой колонки, а правим код в EF (payment_id → yookassa_payment_id).
--        attempt_number — обязательно добавить в INSERT из кода.
--
--   NOTE: renewal_attempts_log.payment_id → в коде переименован в yookassa_payment_id.
--         attempt_number → код вычисляет как (renewal_attempts_count + 1) перед INSERT.
--
-- Idempotence: все ADD COLUMN IF NOT EXISTS.
-- ============================================================================

BEGIN;

-- ─── 1. payment_methods — добавляем недостающие колонки ─────────────────────

ALTER TABLE public.payment_methods
    ADD COLUMN IF NOT EXISTS card_first6   TEXT,
    ADD COLUMN IF NOT EXISTS card_type     TEXT,
    ADD COLUMN IF NOT EXISTS method_type   TEXT NOT NULL DEFAULT 'bank_card',
    ADD COLUMN IF NOT EXISTS saved_at      TIMESTAMPTZ;

-- Заполняем saved_at из created_at для существующих строк
UPDATE public.payment_methods
    SET saved_at = created_at
    WHERE saved_at IS NULL;

-- После бэкфилла делаем NOT NULL (новые строки заполняет код)
ALTER TABLE public.payment_methods
    ALTER COLUMN saved_at SET DEFAULT now();

COMMENT ON COLUMN public.payment_methods.card_first6  IS 'First 6 digits of card (BIN). Nullable for non-card methods.';
COMMENT ON COLUMN public.payment_methods.card_type    IS 'Card network: Visa, MasterCard, Mir, etc. Nullable for non-card methods.';
COMMENT ON COLUMN public.payment_methods.method_type  IS 'Payment method type: bank_card, sber_pay, sbp, t_pay, yoo_money, etc.';
COMMENT ON COLUMN public.payment_methods.saved_at     IS 'When this method was saved (UI alias; mirrors created_at for new rows).';

-- ─── 2. user_entitlements — добавляем недостающие колонки ───────────────────

ALTER TABLE public.user_entitlements
    ADD COLUMN IF NOT EXISTS renewal_attempts_count   INT         NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_renewal_attempt_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_payment_id          TEXT,
    ADD COLUMN IF NOT EXISTS last_payment_at          TIMESTAMPTZ;

-- Синхронизируем счётчик: если renewal_attempts уже заполнен — переносим
UPDATE public.user_entitlements
    SET renewal_attempts_count = renewal_attempts
    WHERE renewal_attempts_count = 0 AND renewal_attempts > 0;

COMMENT ON COLUMN public.user_entitlements.renewal_attempts_count   IS 'Number of consecutive renewal failures. Reset to 0 on success. Alias for renewal_attempts (code-facing name).';
COMMENT ON COLUMN public.user_entitlements.last_renewal_attempt_at  IS 'Timestamp of last renewal attempt (success or failure). Used by cron to enforce ATTEMPT_WINDOW_HOURS.';
COMMENT ON COLUMN public.user_entitlements.last_payment_id          IS 'YooKassa payment.id of the last successful payment.';
COMMENT ON COLUMN public.user_entitlements.last_payment_at          IS 'Timestamp of the last successful payment.';

-- ─── 3. renewal_attempts_log — НИКАКИХ новых колонок ────────────────────────
-- Код будет исправлен: писать yookassa_payment_id вместо payment_id,
-- и вычислять attempt_number = (renewal_attempts_count + 1).
-- payment_method_id в лог — пока не пишем (нет UUID метода в контексте webhook).

COMMIT;
