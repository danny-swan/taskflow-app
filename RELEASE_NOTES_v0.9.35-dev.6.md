## v0.9.35-dev.6 — Freemium + Trial + Subscription + Lifetime

Шестой прогон линии `v0.9.35-dev`: закладываем каркас монетизации. Разделяем локальный TaskFlow (free, offline-first) и облачные функции (sync, calendar, realtime) за подпиской. 14-дневный trial по одному клику, ручная активация, аудит платежей и Edge Function-заготовки под будущий checkout.

### Что нового

**Модель подписки**
- **4 плана**: `free`, `trial` (14 дней), `pro` (месячный/годовой), `lifetime`.
- **Freemium контур**: локальные задачи, статусы, теги, темы, экспорт/импорт, шаблоны — навсегда бесплатно и полностью offline.
- **Paywalled фичи**: cloud sync, страница календаря, Realtime обновления между устройствами.
- **Trial idempotency**: флаг `trial_used` не даёт запустить пробный период дважды; повторный клик получает 409.

**Пользовательский UX**
- **Sidebar-баннер** — 3 варианта в зависимости от плана: `trial-active` (accent, счётчик дней, не dismissable), `trial-expired` (error, кнопка «Оформить»), `free-CTA` (dismissable через localStorage). Скрыт для Pro/Lifetime.
- **PaywallGate** оборачивает `/calendar`: free/expired видят объяснение с кнопкой «Оформить подписку» → `/settings#subscription`.
- **PaywallModal** — унифицированная модалка для гейта отдельных действий (готова к использованию из любого места).
- **Settings → «Подписка»** — новая секция:
  - карточка «Текущий план» с бейджем и датой истечения;
  - кнопка «Начать 14-дневный trial» (только для free без использованного trial);
  - disabled-кнопка «Оплатить картой — скоро» с подсказкой про будущий релиз;
  - accordion с альтернативными способами оплаты и копированием реквизитов;
  - форма ручной активации: тариф, метод оплаты, TX/hash, комментарий;
  - список «Мои заявки» с realtime-статусом (pending/approved/rejected).
- **Deep-link `/settings#subscription`** — переход с баннера/гейта сразу открывает вкладку «Подписка» (через `hashchange`).

### Технические детали

**Data model — миграция 0007**
- `user_entitlements` — одна строка на пользователя, PK = `user_id`; поля `plan`, `valid_until`, `activated_at`, `source`, `trial_used`, `notes`.
- `activation_requests` — заявки на ручную активацию; поля `plan_requested`, `provider_hint`, `tx_ref`, `status`, `admin_notes`, `notified_at`.
- `payment_events` — audit-таблица вебхуков провайдеров; `provider + external_id` UNIQUE (идемпотентность).
- **RLS**: клиент читает только свою строку `user_entitlements`; INSERT в `activation_requests` — свои (`user_id = auth.uid()`); UPDATE и `payment_events.*` — только `service_role`.
- **Realtime**: `user_entitlements` и `activation_requests` в `supabase_realtime` publication (`payment_events` намеренно не в realtime).

**Миграция 0008**
- `alter table activation_requests add column notified_at timestamptz` — идемпотентный флаг для Edge Function `activation-notify`.

**Client-side (`src/lib/entitlements.ts`, ~510 строк)**
- Чистая функция `resolveEntitlement(row, userEmail, now?)` c 5 case: admin-override → lifetime; `null` row → free; lifetime; trial/pro с expiry-check; unknown → free.
- Хелперы: `isPro`, `isProOrTrial`, `isAdmin`, `daysLeftInTrial`, `daysLeftInSubscription`.
- Оффлайн-кэш в `settings`-таблице (`entitlement_cache_v1`) — UI мгновенно рендерится при холодном старте.
- `useEntitlement(userId, userEmail)` — React hook, cache-first, авто-refetch по Supabase `postgres_changes`.
- Actions: `startTrial()` (через Edge Function), `submitActivationRequest()` (прямой INSERT под RLS).

**Гейты**
- `syncNow()`: entitlement-check → `!isProOrTrial(ent)` возвращает `status: 'paywalled'` и не жжёт трафик.
- `subscribeRealtime()`: подписка не создаётся, если пользователь не Pro/Trial.
- E2E bypass через `?e2e=1` — в PaywallGate и `syncNow` (тот же флаг, что для auth-guard).

**Edge Functions**
- `start-trial` — валидирует JWT, проверяет `trial_used`/`plan`, upsert-ит `user_entitlements` с `plan='trial'`, `valid_until = now() + 14d`. Идемпотентно (409 при повторе).
- `activation-notify` — триггерится Database Webhook'ом на INSERT в `activation_requests`. HMAC-secret через заголовок `x-webhook-secret` (constant-time compare). Атомарно помечает `notified_at`, чтобы retry не спамил внешний email-сервис.
- `payment-webhook` — заготовка: HMAC-SHA256 подписи (общий секрет), идемпотентная запись в `payment_events` по `(provider, external_id)`, возвращает 501 «not_implemented» — активация подписки будет в следующем dev-релизе.

### Тесты и качество

- `tsc -b --noEmit` — ✅
- `vitest`: **156/156** (+26 новых в `dev6.test.ts`: 5 case resolveEntitlement × admin/lifetime/trial/pro/unknown, кэш, HMAC-SHA256 vector, `daysLeftInTrial`/`daysLeftInSubscription`, `isAdmin`)
- `vite build` — ✅

### Файлы

- `supabase/migrations/0007_entitlements.sql` (**new**) — 3 таблицы + RLS + realtime publication
- `supabase/migrations/0008_activation_notified_at.sql` (**new**) — `notified_at` для идемпотентности webhook'а
- `supabase/functions/start-trial/index.ts` (**new**)
- `supabase/functions/activation-notify/index.ts` (**new**)
- `supabase/functions/payment-webhook/index.ts` (**new**)
- `src/lib/entitlements.ts` (**new**) — типы, чистый резолвер, хелперы, кэш, hook, actions
- `src/lib/dev6.test.ts` (**new**) — 26 unit-тестов
- `src/components/PaywallModal.tsx` (**new**) — `PaywallModal`, `PaywallGate`, `PaywallBadge`
- `src/pages/Settings.tsx` — секция «Подписка» + hashchange navigation
- `src/components/Sidebar.tsx` — `SubscriptionBanner` (3 варианта)
- `src/lib/sync/index.ts` — `paywalled` state, entitlement-gate в `syncNow` и `initAutoSync`
- `src/App.tsx` — `<PaywallGate>` вокруг `/calendar`

### Что дальше

- Следующие dev-релизы: реальный checkout, recurring/refund flow, админ-страница для approve/reject заявок.
- Далее — интеграции и путь к v1.0.0.

### Установка

Скачайте `TaskFlow_0.9.35-dev.6_x64-setup.exe` (NSIS installer, currentUser — админ-права не требуются) или portable `.exe` из ассетов ниже.

**Pre-release** — не устанавливается автоматически поверх стабильных версий.
