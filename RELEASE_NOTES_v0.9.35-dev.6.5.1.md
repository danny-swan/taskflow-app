# TaskFlow v0.9.35-dev.6.5.1 — recurring / refund / cancel — единым релизом

Полный цикл управления подпиской: автоплатежи (сохранённая карта), отмена и реактивация, полный/частичный refund с автоматическим downgrade, обновление платёжного метода, письма Resend, регламентный запуск через pg_cron, Deno-моки для всех Edge Functions.

---

## Что нового

### База данных

**Migration `0014_payment_methods_and_recurring.sql`** — уже применена в prod (`20260707140740`):
- Новая таблица `payment_methods` — токенизированные карты ЮKassa (`user_id`, `provider_payment_method_id`, `card_last4`, `card_type`, `merchant_customer_id`, `is_default`, `is_active`). RLS: `SELECT` для владельца, `INSERT/UPDATE/DELETE` только для `service_role`.
- Новая таблица `renewal_attempts_log` — трейс каждого автосписания (`user_entitlement_id`, `attempt_no` 1..3, `status`, `payment_id`, `error_code`, `attempted_at`). Retention — 90 дней, чистится через `cleanup_old_renewal_logs()`.
- `user_entitlements ALTER`: добавлены `payment_method_id UUID`, `cancel_at_period_end BOOLEAN DEFAULT false`, `next_renewal_at TIMESTAMPTZ`, `last_renewal_attempt_at TIMESTAMPTZ`, `renewal_failures_count INT DEFAULT 0`. Индексы: `idx_user_entitlements_next_renewal_at WHERE next_renewal_at IS NOT NULL AND cancel_at_period_end = false`.
- Функция `pick_default_payment_method(p_user_id UUID)` — `SECURITY DEFINER`, возвращает `id` активного дефолтного метода.

**Migration `0015_pg_cron_recurring.sql`** — применяется вручную **после апгрейда до Pro**:
- `CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net;`
- `cron.schedule('renew-subscriptions-hourly', '0 * * * *', $$...net.http_post to renew-subscription...$$);`
- На free-плане расширения недоступны → миграция помечена как no-op guard (проверка `to_regnamespace('cron') IS NOT NULL`).

### Edge Functions (5 новых/обновлённых)

**`create-payment` — обновлено (dev.6.5.1)**
- Для `plan=pro` (monthly/annual) теперь передаёт в ЮKassa `save_payment_method: true` + `metadata.merchant_customer_id = user_id`. Требуется чтобы ЮKassa вернула `payment_method_id` в webhook `payment.succeeded`.
- Новый режим `mode: 'update-card'` — рекуррентный платёж на **1 ₽** с `save_payment_method: true` и autoRefund после успеха. Используется в `SubscriptionManagement` для обновления карты без реального списания.
- Экстрактован `export const handler` для тестируемости, добавлен env override `YOOKASSA_API_BASE` (default `https://api.yookassa.ru`).

**`payment-webhook` — обновлено (dev.6.5.1)**
- **`payment.succeeded`** для `plan=pro`: если payload содержит `payment_method.saved: true` → INSERT в `payment_methods` (с `merchant_customer_id`, `card_last4`, `card_type`), UPDATE `user_entitlements.payment_method_id` + `next_renewal_at = valid_until - 24h`.
- **`payment.succeeded`** для `mode=update-card`: сохраняет новый payment method и делает **auto-refund через `POST /v3/refunds`**.
- **`refund.succeeded`** → downgrade `plan = 'free'`, `valid_until = null`, `cancel_at_period_end = true`, отключаем `payment_methods.is_active = false`, письмо `refund_completed`.
- IP-шитинг вынесен в отдельный helper с полным списком ЮKassa-подсетей + IPv6.
- Экстрактован handler + env override `YOOKASSA_API_BASE` в трёх местах (verify + refunds + refund→downgrade).

**`renew-subscription` — новая Edge Function**
- Вызывается pg_cron ежечасно (или `curl` вручную с `x-internal-secret`).
- Выборка кандидатов: `user_entitlements WHERE plan = 'pro' AND next_renewal_at <= now() AND cancel_at_period_end = false AND renewal_failures_count < 3`.
- Для каждого: `POST /v3/payments` с `payment_method_id`, `capture: true`, детерминированный `Idempotence-Key = sha256(user_id + valid_until + attempt_no)`.
- **Grace period 3×24h** — на неуспех increment `renewal_failures_count`, `last_renewal_attempt_at = now()`, письмо `renewal_failed`. На 3-й неуспех → downgrade до `free` + отключить `payment_method.is_active`.
- INSERT в `renewal_attempts_log` каждой попытки.
- Экстрактован handler + `YOOKASSA_API_BASE`.

**`cancel-subscription` — новая Edge Function**
- JWT auth, `POST` только.
- SET `user_entitlements.cancel_at_period_end = true`. Не трогает `valid_until` — пользователь пользуется подпиской до конца оплаченного периода.
- Идемпотентна: повторный вызов вернёт `200` с тем же state.
- 404 если нет активного `pro`.

**`reactivate-subscription` — новая Edge Function**
- JWT auth, `POST` только.
- SET `cancel_at_period_end = false`. Требования: `plan = 'pro'`, `valid_until > now()`, есть активный `payment_method_id`.
- Ошибки: 401 (no JWT), 400 (не pro / истёк / нет карты).

**`send-user-email` — новая Edge Function** (шлюз Resend)
- Внутренний endpoint (JWT НЕ проверяется, только `x-internal-secret: INTERNAL_SHARED_SECRET`).
- Принимает `{ to, template, locale, params }`, рендерит один из трёх шаблонов, отправляет через Resend API.
- Fire-and-forget вызов из `payment-webhook` и `renew-subscription` — их основной ответ не блокируется email-ом.
- Шаблоны (RU + EN):
  - `subscription_renewed` — успешный автоплатёж, сумма/период
  - `renewal_failed` — attempt N/3, дата следующей попытки, CTA «Обновить карту» → `/checkout?mode=update-card`
  - `refund_completed` — refund прошёл, downgrade до `free`

### Frontend

**`src/pages/Settings.tsx` — SubscriptionManagement UI**
- Секция «Подписка» показывает текущий plan, `valid_until`, статус автопродления, последние 4 цифры карты (если есть).
- Кнопка **«Отменить подписку»** → вызывает `cancel-subscription`, показывает warning-баннер «Подписка активна до DD.MM.YYYY, автопродление выключено».
- Кнопка **«Возобновить автопродление»** (если `cancel_at_period_end = true`) → `reactivate-subscription`.
- Кнопка **«Обновить карту»** → редирект на `/checkout?mode=update-card`.
- Полная i18n RU/EN.

**`src/pages/Checkout.tsx` — mode=update-card**
- Читает `?mode=update-card` из query — показывает специальный экран «Обновление карты (1 ₽)» без выбора тарифа.
- Кнопка сразу открывает ЮKassa на 1 ₽. После успешной оплаты webhook сохранит новый payment method и сделает autoRefund.

**`src/lib/entitlements.ts`**
- Добавлены поля `paymentMethodId`, `cancelAtPeriodEnd`, `nextRenewalAt`, `cardLast4`, `cardType` в тип `Entitlement`.
- SELECT из `user_entitlements` JOIN `payment_methods` по `payment_method_id`.

### Legal

**`yourtaskflow.app/legal/offer.html`** — v1.1 (уже задеплоено, commit `65bb58c` в landing-repo):
- Раздел «Автоматические платежи» — регламент рекуррентных списаний, обязанности сторон, право на отмену.
- Раздел «Отмена подписки» — процедура через Settings, срок обработки, отсутствие refund при отмене (до конца оплаченного периода).
- Раздел «Возврат средств» — cooling-off 7 дней, механика auto-refund при `mode=update-card`.

### Тесты (29/29 pass)

**`supabase/functions/_shared/test_mock_server.ts`** (137 строк) — reusable HTTP mock: `Deno.serve({port:0})`, fluent API `.on(method, prefix, handler)`, доступ к `.calls[]`, helpers `.findCall()`, `withEnv()`, `fakeUserJwt()`.

**Deno mock-тесты** (по одному файлу, все зелёные):

| Функция              | Тестов | Кейсы                                                     |
|----------------------|--------|-----------------------------------------------------------|
| `create-payment`     | 6      | 401 no JWT, 400 invalid tier, monthly happy, lifetime happy, update-card, 502 ЮKassa error |
| `payment-webhook`    | 7      | 400 empty/JSON, 403 wrong IP, monthly happy, lifetime happy, update-card refund, refund→downgrade, dubl idempotent |
| `renew-subscription` | 4      | no candidates, happy path, downgrade+email on 3rd failure, pm inactive |
| `cancel-subscription`| 6      | 405 method, 401 no JWT, 404 no active pro, free plan, idempotent, happy |
| `reactivate-subscription` | 6 | 401, plan != pro, expired, no pm_id, happy, idempotent |
| **Итого**            | **29** |                                                           |

**Запуск**: `export PATH="/home/user/.deno/bin:$PATH" && deno test --allow-net --allow-env --allow-read supabase/functions/<name>/test.ts` — по одному файлу (все `index.ts` содержат `Deno.serve(handler)` который биндит port 8000 при импорте — параллельный запуск даст `AddrInUse`).

### pgTAP (SQL регрессии)

Расширены существующие suite для покрытия новой схемы 0014:
- `supabase/tests/01_grants_test.sql`: +18 assertions на `payment_methods`, `renewal_attempts_log`, новые колонки `user_entitlements`
- `supabase/tests/02_rls_test.sql`: +6 assertions — user видит свои `payment_methods`, не видит чужие; `service_role` может INSERT/UPDATE
- `supabase/tests/03_functions_test.sql`: +4 assertions на `pick_default_payment_method()`, `cleanup_old_renewal_logs()`
- **Итого: 124 assertions** (было 92).

---

## Технические детали

### Синхронизация цен

Прайс дублируется в четырёх местах, обновлять синхронно:
1. `supabase/functions/create-payment/index.ts` — `TIERS`
2. `supabase/functions/payment-webhook/index.ts` — `TIER_TO_DAYS`
3. `supabase/functions/renew-subscription/index.ts` — расчёт `amount` для monthly/annual
4. `src/pages/Checkout.tsx` — визуальные ценники
5. `yourtaskflow.app/legal/offer.html` — юридические цены

### Recurring flow (idempotent, deterministic)

1. Пользователь оплачивает monthly/annual → ЮKassa возвращает `payment_method.saved: true` в webhook → сохраняем в `payment_methods` и связываем с entitlement, ставим `next_renewal_at = valid_until - 24h`.
2. pg_cron ежечасно вызывает `renew-subscription` через `net.http_post` с `x-internal-secret`.
3. Функция выбирает entitlements где `next_renewal_at <= now()`, вызывает `POST /v3/payments` с deterministic `Idempotence-Key` → ЮKassa не создаст дубль на ретрае.
4. Успех → `valid_until += period`, `next_renewal_at = valid_until - 24h`, `renewal_failures_count = 0`.
5. Fail → increment `renewal_failures_count`, письмо, следующий cron через час. На 3-й фейл → downgrade до `free`.

### Update-card flow (1 ₽ + auto-refund)

1. Пользователь жмёт «Обновить карту» в Settings → редирект `/checkout?mode=update-card`.
2. `create-payment` с `mode: 'update-card'` → ЮKassa payment на 1 ₽ с `save_payment_method: true`.
3. `payment-webhook` при `payment.succeeded` c `metadata.mode = 'update-card'`: сохраняет новый method → `POST /v3/refunds` на всю сумму. Юзер не видит списание в выписке (или видит и сразу refund).

### Env vars (нужно перед deploy Edge Functions)

Добавляется в Supabase Dashboard → Edge Functions → Secrets (**item 14 — предстоит**):
- `INTERNAL_SHARED_SECRET` — ✅ уже добавлен
- `PUBLIC_APP_URL=https://yourtaskflow.app` — ⏳ нужно добавить (без trailing slash)
- `RESEND_API_KEY`, `RESEND_FROM` — ✅ уже настроены
- `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, `YOOKASSA_RETURN_URL_BASE` — ✅ уже настроены

### Recurring на стороне ЮKassa

**Автосписания в prod-магазине НЕ включены по умолчанию** — нужно письмо в поддержку ЮKassa с указанием shop_id, ссылкой на оферту (`https://yourtaskflow.app/legal/offer.html`) и запросом активации `save_payment_method` для тарифа НПД. Планируется отправить **после E2E-теста** (см. Testing Matrix ниже, шаг 5).

---

## Testing Matrix

| # | Сценарий | Ожидание | Статус |
|---|----------|----------|--------|
| 1 | Deno-тесты `deno test --allow-net --allow-env --allow-read` | 29/29 pass | ✅ pass в этом релизе |
| 2 | pgTAP `supabase test db` (после apply 0014) | 124 assertions pass | ✅ pass |
| 3 | Cancel via Settings → `cancel-subscription` | `cancel_at_period_end = true`, `valid_until` не меняется, warning-баннер | ⏳ E2E prod (item 16) |
| 4 | Reactivate → `reactivate-subscription` | `cancel_at_period_end = false`, баннер снят | ⏳ E2E prod |
| 5 | Lifetime поверх cancelled monthly | `plan = 'lifetime'`, `valid_until = null`, `cancel_at_period_end` сброшено | ⏳ E2E prod |
| 6 | Update-card mode → 1 ₽ + refund | Новый `payment_method` в БД, refund пришёл на карту | ⏳ ПОСЛЕ включения recurring |
| 7 | Первое автосписание (renew) | `valid_until += 30 days`, письмо `subscription_renewed` | ⏳ ПОСЛЕ включения recurring |
| 8 | 3× fail подряд (симуляция) | downgrade до `free`, письмо `renewal_failed` × 3 | ⏳ ПОСЛЕ включения recurring |
| 9 | Refund из ЛК ЮKassa | downgrade `plan=free`, письмо `refund_completed` | ⏳ E2E prod (item 16) |

---

## Deployment plan

**⚠️ Порядок (item 14 после мержа этого коммита):**

1. Пользователь добавляет `PUBLIC_APP_URL=https://yourtaskflow.app` в Supabase Secrets.
2. `supabase functions deploy send-user-email --no-verify-jwt` (internal endpoint).
3. `supabase functions deploy create-payment`.
4. `supabase functions deploy payment-webhook --no-verify-jwt`.
5. `supabase functions deploy cancel-subscription`.
6. `supabase functions deploy reactivate-subscription`.
7. `supabase functions deploy renew-subscription --no-verify-jwt` (internal endpoint, secured by `INTERNAL_SHARED_SECRET`).
8. **Migration 0014 уже применена** (`20260707140740`).
9. **Migration 0015 (pg_cron) — НЕ применять на free-плане** — no-op guard сработает, но лучше отложить до апгрейда.

**После deploy → item 16**: E2E тест на реальных пользователях (`test1` — pro до 2026-08-06, `test` — free): cancel → reactivate, попытка lifetime поверх pro. Recurring и refund flow — ПОСЛЕ ответа поддержки ЮKassa.

---

## Что НЕ вошло (запланировано на dev.6.6+)

- Admin-страница `/admin` для ручного управления entitlements (dev.6.6)
- Rewrite `SupportBlock` — разделение чаевых и подписки (dev.6.6)
- Prometheus / метрики попыток renewal (dev.7.0)
- Апгрейд Supabase до Pro (для pg_cron + leaked-password protection) — по мере готовности бюджета

---

## Хеш коммита

Будет проставлен после `git commit` — см. `git log --oneline -1`.
