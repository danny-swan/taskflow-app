# Release Notes — v0.9.35-dev.6.6

**Date:** 2026-07-07
**Branch:** develop
**Previous:** v0.9.35-dev.6.5.3 (`6da627d`)

---

## Overview

dev.6.6 добавляет две независимые функции:

1. **Admin-панель `/admin`** — ручное управление entitlements напрямую из приложения. Доступна только администраторам (`isAdmin` из `useEntitlement`). Без отдельного веб-интерфейса — открывается как внутренний роут Tauri.

2. **Upgrade Monthly → Annual** — пользователь с месячной Pro-подпиской может перейти на годовую прямо из Settings. Списывается 2 990 ₽ через сохранённую карту ЮKassa, к текущему периоду добавляется +365 дней. Даунгрейд (Annual → Monthly) не предусмотрен — пользователь уже оплатил год.

---

## Changes

### New: Edge Function `admin-actions` (v1, verify_jwt=true)

**Endpoint:** `POST /functions/v1/admin-actions`
**Auth:** JWT required + admin check (ADMIN_EMAILS env ИЛИ source='seed' в user_entitlements)

Поддерживаемые действия:

| action | Параметры | Описание |
|--------|-----------|----------|
| `set-plan` | `target_user_id`, `plan`, `valid_until?`, `notes?` | Устанавливает план (free/trial/pro/lifetime). Для pro/trial требует valid_until. |
| `extend` | `target_user_id`, `days` (1–3650), `notes?` | Добавляет N дней к valid_until от MAX(valid_until, now). |
| `cancel` | `target_user_id` | Ставит cancel_at_period_end=true, auto_renew=false (мягкая отмена). |

Все действия логируют adminEmail в поле `notes` таблицы `user_entitlements`.

**Ошибки:**
- `401` — нет JWT / invalid
- `403` — не администратор
- `400` — неверные параметры / business rule violation
- `404` — target_user_id не найден
- `500` — серверная ошибка

---

### New: Edge Function `change-plan` (v1, verify_jwt=true)

**Endpoint:** `POST /functions/v1/change-plan`
**Auth:** JWT required

Upgrade Monthly → Annual:
1. Проверяет что текущий план `pro` и `daysLeft ≤ 300` (monthly)
2. Проверяет наличие активной карты в `payment_methods`
3. Создаёт платёж в ЮKassa: `payment_method_id` + `amount=2990.00 RUB` + receipt
4. При успехе (`succeeded`) обновляет `valid_until = current + 365 дней`, логирует в `payment_events`
5. Если требуется 3DS — возвращает `confirmation_url`, UI открывает в системном браузере

**Ошибки:**
- `400 "no_payment_method"` — нет привязанной карты
- `400 "Already on annual plan"` — daysLeft > 300
- `400 "not Pro subscription"` — план не pro
- `402` — ЮKassa отклонила платёж

---

### New: `src/pages/AdminPage.tsx`

Страница `/admin` внутри Tauri-приложения. Guard: `entitlement.isAdmin`.

**Функции:**
- Список всех пользователей из `user_entitlements` (до 200) с планом, датой, статусом авто-продления
- Поиск по email / user_id
- Кнопки действий в каждой строке: **Set Plan** (`UserCog`), **Extend** (`Plus`), **Cancel** (`Ban`)
- Раскрывающаяся детализация: renewal_attempts_log (последние 20) + payment_events (последние 20) по пользователю
- Модальное окно подтверждения для каждого действия с полем «Заметка»
- Кнопка возврата в Settings

**Безопасность:**
- Frontend guard: если `!entitlement.isAdmin` → редирект на `/`
- Backend guard: `admin-actions` EF проверяет через ADMIN_EMAILS ИЛИ source='seed'
- RLS политики (migration 0017): admin видит все строки в user_entitlements, renewal_attempts_log, payment_events

**Email-ы пользователей:** получаются через RPC `get_users_emails(uuid[])` — SECURITY DEFINER функция, доступна только admin (source='seed').

---

### New: Migration `0017_admin_rpc.sql`

- **`public.get_users_emails(uuid[])`** — SECURITY DEFINER RPC для AdminPage. Проверяет caller source='seed'. Возвращает `{id, email}[]` из `auth.users`.
- **`public.is_admin_user()`** — helper STABLE function для RLS политик.
- **RLS policies** (SELECT):
  - `admin_select_all_entitlements` на `user_entitlements`
  - `admin_select_all_renewal_log` на `renewal_attempts_log`
  - `admin_select_all_payment_events` на `payment_events`

Idempotent: все CREATE OR REPLACE / DROP POLICY IF EXISTS / ADD COLUMN IF NOT EXISTS.

---

### Changed: `src/lib/entitlements.ts`

- Добавлена функция `changePlan()` — вызывает EF `change-plan`, возвращает `{ok, new_valid_until, payment_id, confirmation_url}`.

### Changed: `src/pages/Settings.tsx`

- Import: добавлен `changePlan` из `../lib/entitlements`
- State: `upgradeBusy`, `upgradeConfirmOpen`
- Handler: `handleUpgradePlan()` — вызывает changePlan, открывает confirmation_url через Tauri shell или window.open, показывает toast
- **UI блок «Управление планом»** — показывается только если `effectivePlan='pro'` И `daysLeft ≤ 40` (monthly). Кнопка «Перейти» → `ConfirmDialog` → `handleUpgradePlan`.
- **Admin link** — ссылка «Администрирование» в конце SubscriptionSection, только для `entitlement.isAdmin`, ведёт на `/admin`.
- `ConfirmDialog` для upgrade: текст подтверждения с суммой 2 990 ₽.

### Changed: `src/App.tsx`

- Lazy import `AdminPage`
- Роут `<Route path="/admin" element={<AdminPage />} />`

---

## New Files

```
supabase/functions/admin-actions/index.ts   — EF admin-actions v1
supabase/functions/admin-actions/test.ts    — 11 Deno-тестов
supabase/functions/change-plan/index.ts     — EF change-plan v1
supabase/functions/change-plan/test.ts      — 7 Deno-тестов
supabase/migrations/0017_admin_rpc.sql      — RPC + RLS для admin
src/pages/AdminPage.tsx                     — Admin UI (717 строк)
```

---

## Testing Matrix

### Vitest (unit / integration)
```
Test Files  15 passed (15)
Tests       156 passed (156)
```
Все существующие тесты зелёные. Новый код не затрагивает Vitest-тесты (EF тестируются через Deno).

### Deno tests

**admin-actions (11 тестов):**

| # | Тест | Ожидаемый результат |
|---|------|---------------------|
| 1 | GET → 405 | ✅ |
| 2 | POST без JWT → 401 | ✅ |
| 3 | Non-admin user → 403 | ✅ |
| 4 | set-plan: missing target_user_id → 400 | ✅ |
| 5 | set-plan: invalid plan 'vip' → 400 | ✅ |
| 6 | set-plan: pro без valid_until → 400 | ✅ |
| 7 | set-plan: lifetime (no valid_until) → 200 | ✅ |
| 8 | extend: days=9999 → 400 | ✅ |
| 9 | extend: lifetime plan → 400 | ✅ |
| 10 | extend: +30 дней → 200, правильный new_valid_until | ✅ |
| 11 | cancel: → 200, PATCH cancel_at_period_end=true | ✅ |
| 12 | Unknown action → 400 | ✅ |

**change-plan (7 тестов):**

| # | Тест | Ожидаемый результат |
|---|------|---------------------|
| 1 | GET → 405 | ✅ |
| 2 | POST без JWT → 401 | ✅ |
| 3 | free plan → 400 "not Pro subscription" | ✅ |
| 4 | daysLeft > 300 (annual) → 400 "already annual" | ✅ |
| 5 | Нет карты → 400 code='no_payment_method' | ✅ |
| 6 | ЮKassa succeeded → 200, new_valid_until +365d, PATCH entitlement | ✅ |
| 7 | ЮKassa declines → 402, yookassa_code в ответе | ✅ |

### E2E (после деплоя)

```
1. Открыть Settings → Подписка
2. Для test1 (plan=pro, daysLeft≤40) → убедиться что показывается блок "Перейти на годовый"
3. Нажать "Перейти" → ConfirmDialog с суммой 2 990 ₽
4. (Тест только UI — реальный платёж не делаем до согласования ЮKassa)
5. Войти под admin-аккаунтом → открыть /admin → убедиться что список пользователей загружается
6. Нажать UserCog у test1 → выставить plan=pro, valid_until=2026-09-06 → Apply
7. Проверить в Supabase: user_entitlements для test1 обновлён
8. Нажать Plus у test1 → extend +30 дней → Apply
9. Проверить new valid_until = (предыдущий + 30 дней)
10. Войти под non-admin → попробовать /admin → редирект на /tasks
```

---

## Deployment Checklist

### Edge Functions
```bash
# Задеплоить обе EF:
supabase functions deploy admin-actions
supabase functions deploy change-plan
```

### Env Variables
- `ADMIN_EMAILS` — добавить в Supabase Secrets (comma-separated, те же что в VITE_ADMIN_EMAILS). Нужно для admin-actions EF.
- Все остальные env уже настроены в dev.6.5.x.

### Migration
```sql
-- Применить migration 0017 в Supabase SQL editor:
-- supabase/migrations/0017_admin_rpc.sql
-- Idempotent — безопасно повторно запустить.
```

### Frontend build
```bash
npm run build
npm run tauri build
```

---

## Notes

- **Upgrade в ожидании ЮKassa** — `change-plan` EF готова, но реальные платежи начнут работать только после согласования автоплатежей от ЮKassa. До тех пор тест только UI flow.
- **Даунгрейд Annual → Monthly не поддерживается** — пользователь уже оплатил год. Возврат средств за оставшееся время сложен; не реализовано.
- **AdminPage email-ы** — если RPC `get_users_emails` не существует (migration 0017 не применена), AdminPage покажет truncated user_id вместо email — без краша.
- **auth.leaked_password_protection** — принятый риск, только на Pro Supabase (v1.0.0).
- **24 unused индекса** на sync_* — не удаляем, ждём когда sync поработает.
