# TaskFlow v0.9.35-dev.6.5.3 — Release Notes

**Дата:** 07.07.2026  
**Ветка:** develop  
**Тип:** Bugfix / Schema alignment

---

## Что исправлено

### Критическая рассинхронизация код↔схема

Код Edge Functions был написан под расширенную схему, которая не была применена в prod. Без этого фикса первый реальный рекуррентный платёж (автосписание) упал бы с ошибкой DB на INSERT/PATCH.

---

## Изменения

### 1. Migration 0016 — Schema ↔ Code alignment (applied to prod)

**`payment_methods`** — добавлены колонки:
| Колонка | Тип | Описание |
|---|---|---|
| `card_first6` | TEXT | Первые 6 цифр карты (BIN) |
| `card_type` | TEXT | Тип карты: Visa / MasterCard / Mir |
| `method_type` | TEXT NOT NULL DEFAULT 'bank_card' | Тип метода: bank_card / sber_pay / sbp / t_pay |
| `saved_at` | TIMESTAMPTZ DEFAULT now() | Когда метод сохранён (алиас created_at для UI) |

**`user_entitlements`** — добавлены колонки:
| Колонка | Тип | Описание |
|---|---|---|
| `renewal_attempts_count` | INT NOT NULL DEFAULT 0 | Счётчик провалов автопродления |
| `last_renewal_attempt_at` | TIMESTAMPTZ | Время последней попытки (для контроля окна 20ч) |
| `last_payment_id` | TEXT | YooKassa payment.id последней успешной оплаты |
| `last_payment_at` | TIMESTAMPTZ | Время последней успешной оплаты |

Бэкфилл: `saved_at = created_at` для существующих строк, `renewal_attempts_count = renewal_attempts` если >0.

### 2. Edge Function: payment-webhook → v14

- `renewal_attempts_log` INSERT: `payment_id` → `yookassa_payment_id`, добавлен `attempt_number`
- При renewal-succeeded: читаем текущий `renewal_attempts_count` до upsert (для корректного `attempt_number`)
- Все поля `user_entitlements` (renewal_attempts_count, last_payment_id, last_payment_at) теперь корректно пишутся в схему

### 3. Edge Function: renew-subscription → v2

- `logAttempt()`: `payment_id` → `yookassa_payment_id`, добавлен параметр `attemptNumber` (default=1)
- Все 4 вызова `logAttempt` передают корректный `attemptNo = (renewal_attempts_count ?? 0) + 1`
- `incrementAttempts()` при downgrade пишет `renewal_attempts_count` вместо несуществующего поля

### 4. Frontend: entitlements.ts + Settings.tsx

- `PaymentMethodRow` interface: `card_exp_month/year` → `card_expiry_month/year` (имена совпадают со схемой)
- `fetchActivePaymentMethods` SELECT: исправлены имена колонок
- `Settings.tsx`: отображение срока карты использует `card_expiry_month/year`

---

## Задеплоено

| Функция | Версия | verify_jwt | ID |
|---|---|---|---|
| payment-webhook | **v14** | false | 73f8fc4c |
| renew-subscription | **v2** | false | 27d6ffbb |

Migration 0016 применена к prod (sejpmzrmtgcvevukggkx).

---

## Testing Matrix

| Сценарий | Ожидаемый результат | Статус |
|---|---|---|
| payment.succeeded (renewal) → renewal_attempts_log INSERT | yookassa_payment_id=<id>, attempt_number=1 | ✅ код исправлен |
| payment.canceled (renewal) → renewal_attempts_log INSERT | yookassa_payment_id=<id>, attempt_number=currentCount+1 | ✅ код исправлен |
| renew-subscription → logAttempt | yookassa_payment_id + attempt_number переданы | ✅ код исправлен |
| payment.succeeded → user_entitlements PATCH | renewal_attempts_count=0, last_payment_id, last_payment_at | ✅ колонки в схеме |
| payment.succeeded → payment_methods upsert | card_first6, card_type, method_type, saved_at | ✅ колонки в схеме |
| fetchActivePaymentMethods | card_expiry_month/year, saved_at — всё в схеме | ✅ код исправлен |
| Settings.tsx карта | Отображает срок через card_expiry_month/year | ✅ исправлено |
| Migration 0016 idempotence | Повторный запуск — никаких ошибок (IF NOT EXISTS) | ✅ |

### E2E тест (ручной — после включения ЮKassa автоплатежей)
- Привязать карту (update-card flow) → проверить payment_methods строку (card_first6, card_type, method_type, saved_at заполнены)
- Первый рекуррентный платёж → renewal_attempts_log с yookassa_payment_id + attempt_number=1
- Проверить Settings.tsx: срок карты отображается корректно

---

## Известные ограничения

- `renewal_attempts_log.payment_method_id` (UUID FK) — не заполняется в текущей реализации (нет UUID в контексте webhook). Оставлено nullable. Может быть добавлено позже через lookup external_id → id.
- `renewal_attempts` (старое поле в user_entitlements) — не удалено (backward compatible). Синхронизируется с `renewal_attempts_count` через бэкфилл в миграции.
