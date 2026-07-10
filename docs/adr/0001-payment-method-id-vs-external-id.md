# 0001. payment_method_id vs external_id — источник истины для токена ЮKassa

- Статус: accepted
- Дата: 2026-07-10
- Связано: PR #61 (merge bc55c09), находка F1, коммит 408cf50

## Контекст

`payment-webhook` записывал внутренний uuid в поле `payment_method_id`, а
`renew-subscription` слал этот uuid в ЮKassa как `payment_method_id` токен →
ЮKassa его не распознавала → автопродление не работало ни у кого.

## Решение

Единственный источник истины для токена ЮKassa — `payment_methods.external_id`.
Внутреннее поле `payment_method_id` остаётся только внутренним FK на uuid записи
`payment_methods` и НИКОГДА не отправляется в ЮKassa. `renew-subscription` перед
вызовом ЮKassa всегда резолвит `external_id` по внутреннему uuid.

Сверено с фактическим кодом (`origin/develop` = bc55c09):

- `renew-subscription/index.ts:293-306` — `selectOne('payment_methods', 'external_id,is_active,provider', { id: cand.payment_method_id, user_id, provider: 'yookassa' })`,
  то есть резолв идёт по внутреннему uuid (`id`), а в ЮKassa уходит именно
  `external_id` (`yooPaymentMethodToken`, строка 306).
- `renew-subscription/index.ts:329` — в теле `POST /v3/payments` поле
  `payment_method_id` заполняется значением `yooPaymentMethodToken` (= external_id),
  а не внутренним uuid.
- `payment-webhook/index.ts:369-376, 490-492, 576-579` — в FK-колонку
  `user_entitlements.payment_method_id` пишется ВНУТРЕННИЙ uuid строки
  `payment_methods` (`savedMethodRowId`), а токен ЮKassa хранится отдельно в
  `payment_methods.external_id` (`savePaymentMethod`, строки 831-883).

Описание решения полностью соответствует текущей реализации — корректировок не
потребовалось.

## Последствия

Плюсы: автопродление работает; правило явно зафиксировано в коде и в docs/adr.

Минусы: нужен дополнительный SELECT для резолва `external_id` — незначительно.

Задеплоено на прод: renew-subscription v8, payment-webhook v23.
