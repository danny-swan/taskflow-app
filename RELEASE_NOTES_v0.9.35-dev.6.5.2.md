# TaskFlow v0.9.35-dev.6.5.2 — отвязка карты (self-service detach)

Пользователь может самостоятельно отвязать сохранённую карту от сервиса без обращения в поддержку. Это **обязательное требование ЮKassa** для включения автоплатежей: в интерфейсе должна быть кнопка самостоятельной отвязки карты. Реализовано как отдельный инкремент: Edge Function + UI + тесты.

---

## Почему это нужно

Поддержка ЮKassa при рассмотрении заявки на подключение автоплатежей (сохранение способа оплаты и рекуррентные списания) выдвинула условие:

> «В вашем сервисе должен быть реализован интерфейс, где покупатель может самостоятельно отвязать карту от вашего сервиса, без обращения в поддержку.»

Без этого функционала автоплатежи не согласуют. Поэтому detach выделен в самостоятельный релиз и делается до отправки/согласования заявки.

---

## Что нового

### Edge Function `detach-payment-method` — новая (verify_jwt=true)

Файл: `supabase/functions/detach-payment-method/index.ts`

- **Auth:** JWT required. `user_id` берётся из `auth.getUser()` (anon-клиент с `Authorization`-хедером юзера). Никаких body-параметров — юзер отвязывает только свою карту.
- **Метод:** только `POST` (405 на остальные), CORS preflight `OPTIONS` поддержан.
- **Логика:**
  1. Читаем активные `payment_methods` юзера (`is_active=true`) через service-key.
  2. Если активных карт нет → идемпотентный `200 { ok:true, already_detached:true, detached_count:0 }`. Для страховки от рассинхрона всё равно чистим entitlement.
  3. Иначе — admin PATCH `payment_methods?user_id=eq.<uid>&is_active=eq.true` → `{ is_active:false, updated_at }`.
  4. Admin PATCH `user_entitlements?user_id=eq.<uid>` → `{ payment_method_id:null, auto_renew:false, cancel_at_period_end:true, notes:'card detached by user at <iso>' }`.
  5. Ответ `200 { ok:true, detached_at, detached_count }`.
- **`valid_until` не трогаем** — доступ к Pro сохраняется до конца оплаченного периода, отключается только автопродление. cron `renew-subscription` не найдёт карту → списаний не будет.
- **ЮKassa API не вызываем:** у ЮKassa нет отдельного метода «забыть карту». Сохранённый `payment_method_id` просто перестаёт использоваться, потому что мы больше не отправляем по нему рекуррентные списания. Достаточно локальной деактивации.
- Использует **только реально существующие колонки** прод-схемы (`payment_methods.is_active`, `user_entitlements.payment_method_id/auto_renew/cancel_at_period_end/notes`).

**Deploy:** `detach-payment-method` v1, статус `ACTIVE`, `verify_jwt=true` (id `61c0ea71-36ee-4115-8a30-7ba693787a48`).

### Frontend

**`src/lib/entitlements.ts`**
- Новая функция `detachPaymentMethod()` — вызывает `supabase.functions.invoke('detach-payment-method')`, маппит ответ в `{ ok, detachedAt, detachedCount, alreadyDetached }` либо `{ ok:false, error }`. Паттерн идентичен `cancelSubscription()`.

**`src/pages/Settings.tsx` — секция «Способ оплаты»**
- Рядом с кнопкой «Обновить» добавлена кнопка **«Отвязать»** (иконка `Unlink`) для каждой активной карты.
- Клик открывает `ConfirmDialog` с предупреждением: карта будет удалена, автопродление отключится, доступ к Pro сохранится до конца периода, для повторного включения нужно привязать карту заново.
- После успеха — тост «Карта отвязана» и локальная очистка списка карт (`setPaymentMethods([])`); realtime догонит стейт.
- Полная i18n RU/EN на кнопке, диалоге, тостах, состоянии «Отвязываем…».

### Тесты (5/5 pass)

`supabase/functions/detach-payment-method/test.ts` — Deno mock-тесты на общем `_shared/test_mock_server.ts`:

| # | Кейс | Ожидание |
|---|------|----------|
| 1 | `GET` вместо POST | 405 |
| 2 | Нет `Authorization` | 401, error содержит `Authorization` |
| 3 | Happy path (есть активная карта) | 200, `detached_count=1`; PATCH `payment_methods` (`is_active:false`, фильтр `user_id`+`is_active=eq.true`); PATCH `user_entitlements` (`payment_method_id:null`, `auto_renew:false`, `cancel_at_period_end:true`, notes) |
| 4 | Идемпотентность (нет активной карты) | 200, `already_detached:true`, `detached_count:0`; НЕТ PATCH к `payment_methods`; entitlement всё же чистится |
| 5 | Ошибка деактивации карты (400 от БД) | 500, error содержит `deactivate` |

**Запуск:** `export PATH="/home/user/.deno/bin:$PATH" && deno test --allow-net --allow-env --allow-read supabase/functions/detach-payment-method/test.ts`

`tsc --noEmit` фронтенда — без ошибок.

---

## Testing Matrix

| # | Сценарий | Ожидание | Статус |
|---|----------|----------|--------|
| 1 | Deno-тесты `detach-payment-method` | 5/5 pass | ✅ pass в этом релизе |
| 2 | `tsc --noEmit` фронтенд | без ошибок | ✅ pass |
| 3 | Deploy функции | ACTIVE, verify_jwt=true | ✅ v1 задеплоена |
| 4 | UI: кнопка «Отвязать» видна для активной карты Pro-юзера | confirm-диалог, после — карта пропадает | ⏳ E2E prod (item 16) |
| 5 | Detach с активной картой | `payment_methods.is_active=false`, `payment_method_id=null`, `auto_renew=false`, `cancel_at_period_end=true`; доступ по `valid_until` сохранён | ⏳ E2E prod |
| 6 | Повторный detach (нет карты) | 200 `already_detached`, без побочных эффектов | ⏳ E2E prod |
| 7 | JWT-изоляция: юзер не может отвязать чужую карту | detach затрагивает только строки своего `user_id` | ⏳ E2E prod |

---

## ⚠️ Известная проблема — фикс в dev.6.5.3 (ДО включения автоплатежей ЮKassa)

Задеплоенные ранее `payment-webhook` v13 и `renew-subscription` v1 **обращаются к колонкам, которых нет в прод-схеме** — при первом реальном рекуррентном платеже они упадут (500). Detach этого не касается (использует только существующие колонки), но перед фактическим включением автосписаний нужен отдельный релиз с миграцией 0016 + правкой кода. Ключевые расхождения код↔схема:

- `payment_methods`: код шлёт `card_first6`, `card_type`, `method_type`, `saved_at` — этих колонок нет (в схеме `card_brand`, `card_last4`, `card_expiry_month/year`, `created_at`).
- `user_entitlements`: код шлёт `renewal_attempts_count`, `last_renewal_attempt_at`, `last_payment_id`, `last_payment_at` — их нет (есть `renewal_attempts`).
- `renewal_attempts_log`: код шлёт `payment_id`, не шлёт NOT NULL `attempt_number` — INSERT упадёт (реальные колонки: `yookassa_payment_id`, `attempt_number`, `payment_method_id` uuid).
- `payment_method_id`: код трактует как ЮKassa external_id (string), схема = UUID FK → `payment_methods.id`.

Также `fetchActivePaymentMethods()` во фронте SELECT-ит `card_exp_month/year` и `saved_at` (в схеме — `card_expiry_month/year`, `created_at`) — тоже в скоуп dev.6.5.3.

**Порядок работ:** detach (этот релиз) → dev.6.5.3 (синхронизация схема↔код, миграция 0016) → E2E → письмо/согласование ЮKassa → включение автоплатежей.

---

## Изменённые файлы

- `supabase/functions/detach-payment-method/index.ts` — новая (181 строка)
- `supabase/functions/detach-payment-method/test.ts` — новая (5 тестов)
- `src/lib/entitlements.ts` — `+detachPaymentMethod()`
- `src/pages/Settings.tsx` — кнопка «Отвязать» + confirm-диалог + handler + state + импорты
- `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` — версия → `0.9.35-dev.6.5.2`

---

## Хеш коммита

Будет проставлен после `git commit` — см. `git log --oneline -1`.
