# TaskFlow v0.9.35-dev.6.7.1 – dev.6.8.0

**Дата:** 08.07.2026
**Тип:** Combined — Patch-фиксы Settings/Help/AdminPage (6.7.1, 6.7.2) + новая функциональность Trial с привязкой карты (6.8.0)
**Коммиты:** `ae3c463`, `699a3b9` (6.7.1) → `a56bc68` (6.7.2) → `785b365`, hotfix `3f63dc8` (6.8.0)

---

## dev.6.7.1 — коммиты `ae3c463`, `699a3b9`

### Исправления

**1. SupportBlock пропал из Help (CloudTips + крипто)**
- **Проблема:** В dev.6.1 адреса вынесли в `VITE_PAY_*` переменные, но не прокинули их в `build.yml` → в production `METHODS.length === 0` → вместо блока показывалась заглушка «Способы поддержки временно недоступны».
- **Исправление:** Адреса возвращены хардкодом (безопасно — без приватных ключей средства снять нельзя). Восстановлено из git history (коммит `47b6ae8`).
- **Адреса:**
  - CloudTips: `https://pay.cloudtips.ru/p/83f4d553`
  - USDT TRC-20: `TJv97nWcARwvNTR6N62SW3TM2goo6gTpUZ`
  - TON: `UQDphkFo74Ff8yG92mYZk7wpclgdpjs666Qn9m1HvJ51becx`
  - USDT ERC-20: `0x316Da7F3930Cc8c45Ff689181f8053e5d45C9300`

**Файл:** `src/components/SupportBlock.tsx`

**2. AdminPage — «Доступ запрещён» мигал мгновенно**
- **Проблема:** При открытии `/admin` на долю секунды показывался экран «Доступ запрещён».
- **Причина:** Нет guard на `entLoading` перед early return — проверка прав срабатывала раньше, чем приходил реальный ответ от `useEntitlement`.
- **Исправление:** Добавлен `if (entLoading) return <Spinner>` перед проверкой прав доступа.

**Файл:** `src/pages/AdminPage.tsx`

**3. Микропролаг Free на вкладке Подписка**
- **Проблема:** Badge плана рендерился с `plan='free'`, пока `entLoading=true`, из-за чего Pro/Lifetime-пользователи на короткое время видели «Free».
- **Исправление:**
  - Badge плана заменён на skeleton, пока `entLoading=true`
  - Блоки «Оформить подписку» / «Ручная активация» / «Мои заявки» скрыты, пока `entLoading=true`

**Файл:** `src/pages/Settings.tsx`

**4. i18n: «Чаевые разработчику» → «Поддержать разработчика»**
- Ключ `support_title` в `i18n.ts` исправлен.

**Файл:** `src/lib/i18n.ts`

**5. Тексты SupportBlock**
- `support_intro_1/2/3` восстановлены из v0.9.34 (оригинальный авторский текст).

**Файл:** `src/lib/i18n.ts`

### Затронутые файлы

```
src/components/SupportBlock.tsx
src/pages/AdminPage.tsx
src/pages/Settings.tsx
src/lib/i18n.ts
```

---

## dev.6.7.2 — коммит `a56bc68`

### Исправления

**1. Help.tsx: мелькало «TaskFlow Pro» на секунду**
- **Проблема:** `SubscriptionBlock` был встроен в `Help.tsx` и рендерился с `plan='free'` до загрузки entitlement, из-за чего у Pro-пользователей на секунду мелькал badge «TaskFlow Pro».
- **Исправление:** `SubscriptionBlock` полностью убран из `Help.tsx`. Вся логика подписок теперь только в `Settings`.

**Файл:** `src/pages/Help.tsx`

**2. Подписка мигала для Pro-пользователей**
- **Проблема:** Даже после фикса из 6.7.1 мелькание Free сохранялось у части пользователей.
- **Причина:** Root cause был не в `entLoading`, а в `auth.loading` — до полного разрешения auth пользователь показывался как free.
- **Исправление:** `subsLoading = auth.loading || entLoading`. Все free-блоки скрыты, пока `subsLoading=true`.

**Файл:** `src/pages/Settings.tsx`

**3. AdminPage: бесконечный спам «[object Object]»**
- **Причина A:** `t()` — инлайн-функция без `useCallback` → пересоздавалась на каждый рендер → `loadUsers` (useCallback с `t` в deps) пересоздавался → `useEffect` перезапускался → бесконечный цикл.
- **Причина B:** `String(PostgrestError)` даёт `[object Object]` — нет извлечения `.message`.
- **Исправление A:** `t` берётся из `useRef` (не меняется между рендерами) → `loadUsers` стабилен.
- **Исправление B:** Ошибки извлекаются через `.message`.

**Файл:** `src/pages/AdminPage.tsx`

### Затронутые файлы

```
src/pages/Help.tsx      — удалён SubscriptionBlock
src/pages/Settings.tsx  — subsLoading = auth.loading || entLoading
src/pages/AdminPage.tsx — useCallback+useRef для t(), .message для ошибок
```

---

## dev.6.8.0 — коммит `785b365`; hotfix коммит `3f63dc8`

### Новая функциональность: Trial с привязкой карты

**Мотивация:** Ранее Trial можно было активировать без карты — автоплатёж по окончании пробного периода был невозможен.

Новый флоу: привязка карты (1 ₽ → возврат) → trial 14 дней → auto-renew 299 ₽/мес (при одобрении ЮKassa).

**Флоу пользователя:**

1. Settings → кнопка «Попробовать бесплатно 14 дней» → `/checkout?mode=trial`
2. Экран Trial в Checkout: описание условий («14 дней бесплатно, затем 299 ₽/мес, отмена в любое время»)
3. Кнопка «Привязать карту» → `create-payment {mode:'trial'}` → редирект в ЮKassa, списание 1 ₽
4. ЮKassa `payment.succeeded` → `payment-webhook`: refund 1 ₽ + upsert trial (`plan='trial'`, `valid_until=+14d`, `next_renewal_at=valid_until`, `payment_method_id`, `auto_renew=true`)
5. Редирект → `/settings?trial=started`
6. Через 14 дней: `renew-subscription` (pg_cron) → автоматическое списание 299 ₽ → `plan='pro'`

> **⚠️ БЛОКЕР:** Автоплатежи ЮKassa не одобрены → шаг 6 не работает. `pg_cron` (migration 0015) ждёт апгрейда до Supabase Pro.

### Изменения

**`src/pages/Settings.tsx`:**
- Trial CTA теперь вызывает `navigate('/checkout?mode=trial')` (раньше вызывал `start-trial` EF напрямую)
- Удалены: `handleStartTrial`, `trialBusy`, импорт `startTrial`

**`src/pages/Checkout.tsx`:**
- Новый экран `isTrialMode`: описание условий trial
- Добавлена иконка Sparkles
- `handleStartTrialWithCard` → `create-payment {mode:'trial'}`

**`supabase/functions/create-payment` → v13 (ACTIVE):**
- `PaymentMode` расширен значением `'trial'`
- При `mode=trial`: списание 1 ₽ + `save_payment_method=true` + description «привязка карты»
- `return_url` для trial → `/settings?trial=started`

**`supabase/functions/payment-webhook` → v16 (ACTIVE):**
- Добавлен блок `isTrialMode` в `handlePaymentSucceeded`:
  - Проверка `trial_used` через `AdminClient.selectOne()` (raw fetch — без supabase-js)
  - Refund 1 ₽ через `initiateRefund()`
  - Upsert trial: `plan='trial'`, `valid_until=+14d`, `next_renewal_at=valid_until`, `auto_renew=true`, `payment_method_id`
- `handleRefundSucceeded`: trial-refund больше не даунгрейдит план (учитываются только update-card и настоящие refund'ы)
- **Hotfix `3f63dc8`:** исправлен баг, при котором блок trial использовал синтаксис supabase-js `.from().select().eq().maybeSingle()` вместо `AdminClient` raw fetch — приводило к сбою проверки `trial_used`

**`supabase/functions/renew-subscription` → v4 (ACTIVE):**
- Запрос изменён на `plan: 'in.(pro,trial)'` вместо `'eq.pro'` → в выборку для renew попадают и trial-пользователи

### Затронутые файлы

```
src/pages/Settings.tsx                     — Trial CTA → /checkout?mode=trial
src/pages/Checkout.tsx                     — экран isTrialMode, handleStartTrialWithCard
supabase/functions/create-payment/index.ts — v13, mode='trial'
supabase/functions/payment-webhook/index.ts — v16, isTrialMode блок + hotfix AdminClient
supabase/functions/renew-subscription/index.ts — v4, plan in.(pro,trial)
```

---

## Testing Matrix

| Сценарий | Ожидаемый результат | Статус |
|----------|--------------------|----|
| Trial CTA в Settings → Checkout | Переход на `/checkout?mode=trial`, экран Trial | ✅ Ready |
| Checkout Trial → кнопка «Привязать карту» | Вызов `create-payment {mode:'trial'}`, редирект в ЮKassa | ✅ Ready |
| ЮKassa `payment.succeeded` (mode=trial) | webhook: refund 1 ₽ + `plan=trial` + `valid_until=+14d` | ✅ Ready (BLOCKED: автоплатежи) |
| `trial_used=true` — повторный trial | webhook: refund 1 ₽, activation skipped | ✅ Ready |
| `renew-subscription`: `plan=trial` кандидаты | Подбираются вместе с `plan=pro` | ✅ Ready (BLOCKED: pg_cron, автоплатежи) |
| SupportBlock в Help | CloudTips + крипто-адреса всегда видны | ✅ Fixed (6.7.1) |
| AdminPage для admin@ | Нет «Доступ запрещён» при загрузке | ✅ Fixed (6.7.1) |
| Вкладка Подписка | Нет мелькания Free для Pro-юзера | ✅ Fixed (6.7.2) |
| Help → нет мелькания Pro | `SubscriptionBlock` убран из Help | ✅ Fixed (6.7.2) |
| AdminPage — нет спама `[object Object]` | Стабильный `loadUsers`, корректные сообщения об ошибках | ✅ Fixed (6.7.2) |

---

## Deployed Edge Functions (после dev.6.8.0 + hotfix)

| Функция | Версия | verify_jwt |
|---------|--------|-----------|
| create-payment | v13 | true |
| payment-webhook | v16 | false |
| renew-subscription | v4 | true |

---

## Pending

- **migration 0018**: поле `trial_payment_method_id` в `user_entitlements` (реф на payment_method, сохранённый при trial) — не применена
- **БЛОКЕР: ЮKassa автоплатежи** — переход trial→pro заблокирован до одобрения
- **БЛОКЕР: Supabase Pro** — migration 0015 (pg_cron) ждёт апгрейда плана
- После одобрения ЮKassa: переключить `YOOKASSA_SKIP_IP_CHECK=false`, выставить prod `SHOP_ID`/`SECRET_KEY`, настроить webhook URL, провести E2E тест trial-флоу
