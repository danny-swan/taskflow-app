## v0.9.35-dev.6.1 — Secrets cleanup, env-based config

Патч-релиз линии `v0.9.35-dev.6`: чувствительная конфигурация вынесена из исходников в переменные окружения. Никаких изменений функциональности — только гигиена репозитория и упрощение поддержки нескольких сборочных профилей.

### Что изменилось

**Конфиг через env**
- Список admin-email’ов (`ADMIN_EMAILS`) теперь берётся из `VITE_ADMIN_EMAILS`. Пусто → admin-режима нет.
- Альтернативные способы поддержки (crowdfunding-ссылка, крипто-адреса) — из `VITE_PAY_CLOUDTIPS_URL`, `VITE_PAY_TON`, `VITE_PAY_USDT_TRC20`, `VITE_PAY_USDT_ERC20`. Пустые значения — соответствующие пункты скрываются автоматически, весь блок скрыт если пусты все.
- Цены планов в UI — из `VITE_PAY_PRICE_MONTHLY`, `VITE_PAY_PRICE_ANNUAL`, `VITE_PAY_PRICE_LIFETIME`. Пусто → «цена скоро».
- Supabase URL/anon key — обязательные `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY` (fallback-hardcode убран, сборка падает с понятной ошибкой если не заданы).

**Supabase**
- Из комментариев edge-функций убраны project-ref’ы; deploy-команды используют `$SUPABASE_PROJECT_REF`.
- `activation-notify` больше не имеет hardcoded email fallback — если `ADMIN_EMAIL` не задан, функция возвращает 200 skipped вместо падения.
- В `activation-notify` вместо цен в тексте письма — plan labels (Месячная / Годовая / Lifetime).
- Seed grandfathered-аккаунта вынесен в отдельную миграцию `0009_admin_seed.sql`, читающую email из GUC `app.admin_email`. Миграция `0007_entitlements.sql` больше не содержит email в истории кода.

**Workflow**
- `.github/workflows/supabase-ping.yml` — `SUPABASE_URL` берётся из GitHub Secrets, hardcoded fallback anon-key убран.

**Env-файлы**
- `.env.example` полностью описывает новые VITE_* переменные (пустые примеры).
- `.env.local` в `.gitignore` — для локальных значений.
- `vitest.config.ts` подставляет фиктивные значения для unit-тестов.

### Технические детали

**Fail-safe:**
- Отсутствие `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` → throw при старте (лучше явный сбой сборки, чем немой сбой авторизации в рантайме).
- Отсутствие крипто/платежных env → UI скрывает соответствующие блоки, без ошибок.
- Отсутствие `VITE_ADMIN_EMAILS` → admin-массив пустой, никто не получает override.

**Сборка:**
- Локальный build с `.env.local` → полнофункциональный installer со всеми методами поддержки.
- CI build без `.env.local` и без CI secrets → чистый installer, монетизация отключена. Bundle не содержит секретов.

**Тесты:** 156/156 зелёные (unit + integration).

### Roadmap

- **dev.6.1** (текущая) — secrets cleanup + env-based config.
- dev.6.2 — реальный checkout + чеки НПД.
- dev.6.3 — recurring + refund.
- dev.6.4 — админ-страница `/admin`.
- dev.7 — Telegram bot.
- v1.0.0 — merge в `main`.

### Совместимость

Полная обратная совместимость с dev.6:
- Модель данных не изменилась.
- Миграция `0009_admin_seed.sql` — идемпотентная, безопасна для повторного применения; при пустом GUC — no-op.
- Существующие развёртывания продолжают работать без изменений.
