# TaskFlow v1.0.0 — Release Notes

**Дата:** 11.07.2026
**Тип:** Первый стабильный релиз (первый не-pre-release). Итог линии `v0.9.35-dev.6`.
**Ветка:** main (merge из develop, 97 коммитов)

---

## TL;DR

TaskFlow выходит из pre-release. Это первый публичный стабильный релиз: **локальный offline-first таск-менеджер** (задачи, статусы, теги, шаблоны, темы, экспорт/импорт — навсегда бесплатно и без интернета) плюс **облачный контур за подпиской** (sync между устройствами, календарь, realtime) с полноценной монетизацией через ЮKassa.

За линию `dev.6` (волны аудита 1–4) закрыты все находки безопасности и стабильности: идемпотентное автопродление, изоляция базы по аккаунту, строгий CORS, серверный rate limiting, аудит платежей. Клиент переведён на современный **publishable key** Supabase.

**Итог:** 179/179 unit-тестов зелёные, `tsc` EXIT 0, E2E (Playwright) зелёные, сборка Windows (NSIS + MSI + portable) и macOS (dmg) с подписью для автообновления.

---

## Что нового относительно pre-release линии

### Монетизация (готова к бою)

- **4 плана:** `free`, `trial` (14 дней), `pro` (месячный/годовой), `lifetime`.
- **Freemium контур:** локальные задачи, статусы, теги, темы, экспорт/импорт, шаблоны — навсегда бесплатно и полностью offline.
- **Paywalled фичи:** cloud sync, страница календаря, realtime-обновления между устройствами.
- **Оплата картой через ЮKassa:** реальный checkout (`create-payment`), обработка вебхуков (`payment-webhook`), рекуррентные автосписания через сохранённый способ оплаты.
- **Автопродление:** ежечасный cron `taskflow-renew-subscriptions` находит подписки к продлению и списывает через `renew-subscription`; попытки логируются в `renewal_attempts_log`.
- **Управление подпиской в Settings:** отмена (`cancel-subscription`), реактивация (`reactivate-subscription`), смена тарифа (`change-plan`), отвязка карты (`detach-payment-method`).
- **Trial по одному клику** с защитой от повторного запуска (`trial_used`, 409 на повтор).
- **Админ-панель** (`admin-actions`): выдача/продление/отмена плана вручную для support-сценариев.

### Синхронизация и данные

- **Offline-first sync:** локальная SQLite-база (Tauri) ↔ Supabase Postgres, outbox-очередь, курсорный pull.
- **Изоляция базы по аккаунту** (dev.6.9): при смене аккаунта на устройстве срабатывает гейт «Загрузить облачные / Оставить локальные», привязка фиксируется через `bound_user_id`, снимки данных (`snapshot_registry`) защищают от потери.
- **Realtime** обновления `user_entitlements` и `activation_requests`.

---

## Волны аудита 1–4 (что было исправлено перед стабильным релизом)

### Wave 1 — критичные баги оплаты

- **F1 — идемпотентность автопродления:** устранён риск двойного списания при повторной доставке вебхука / гонке cron. Дедуп по `external_id` (UNIQUE), защита на уровне `payment_events`.
- **F4 — корректный расчёт `valid_until`** при продлении (наращивание от большей из дат «текущий конец / now», без «съедания» остатка).

### Wave 2 — стабильность и целостность

- **F5, N4, N5, N12, N15:** исправления обработки ошибок вебхука, валидации входных данных, консистентности статусов подписки и корректного отражения состояния в UI.

### Wave 3 — надёжность фоновых процессов

- **N6, N8, N9, N10:** укрепление cron-цепочки автопродления, обработка неактивных способов оплаты, аккуратные статусы в `renewal_attempts_log`.

### Wave 4 — безопасность периметра

- **N11 — строгий CORS allowlist:** edge-функции с чувствительными действиями (`admin-actions`, `change-plan`, `cancel/reactivate-subscription`, `detach-payment-method`) отвечают только разрешённым origin (`APP_ALLOWED_ORIGINS` + `PUBLIC_APP_URL`), с корректным `Vary: Origin`.
- **N13 — серверный rate limiting:** per-IP лимит на `payment-webhook`, `create-payment`, `start-trial` (60 запросов / 60 c). Атомарный счётчик в `public.rate_limits`, ответ `429` с заголовком `retry-after`, автоочистка через cron `rate-limits-cleanup` (каждые 5 минут). Реальный egress-IP берётся на стороне gateway — подделать бакет клиентским `x-forwarded-for` нельзя.
- **N14, N18:** сопутствующие исправления валидации и защиты edge-функций.
- **N17 — pg_net:** оставлен в схеме `public` осознанно — необходим для работы pg_cron-цепочки автопродления; перенос оборвал бы cron. Риска нет.

---

## Безопасность

- **Миграция на publishable key:** клиент переведён с legacy JWT anon-ключа на современный `sb_publishable_...` (через CI secret `SUPABASE_ANON_KEY`). Новый ключ отзывается независимо от service_role и не «засвечен» в истории репозитория. Все данные по-прежнему защищены Row Level Security.
- **RLS на всех таблицах:** клиент читает только свою строку `user_entitlements`; запись в `payment_events` и апдейты — только `service_role`.
- **Cloudflare Turnstile** капча на чувствительных формах, Supabase Auth Attack Protection, минимальная длина пароля 8.
- **service_role-ключ** никогда не попадает в клиентский бандл — только в бэкенд/CI secrets.

### Осознанные ограничения (не блокеры)

- **N16 — Leaked Password Protection:** не включён — функция требует платного тарифа Supabase Pro. Остальные меры защиты паролей активны.
- **SupportBlock** и **Telegram-бот** — вне scope v1.0.0, запланированы post-v1.0.0.
- **SberPay recurring** — ждём активации на стороне ЮKassa (внешняя зависимость).

---

## Testing Matrix

| # | Проверка | Результат |
|---|----------|-----------|
| 1 | Unit-тесты (Vitest) | ✅ 179/179 |
| 2 | Type-check (`tsc --noEmit`) | ✅ EXIT 0 |
| 3 | E2E (Playwright) — создание задачи, навигация, темы | ✅ |
| 4 | Rate limiting `payment-webhook` (60/60c, 429 + retry-after) — проверено в бою на проде | ✅ |
| 5 | CORS allowlist edge-функций (preflight по origin) | ✅ |
| 6 | Идемпотентность автопродления (F1) на проде | ✅ |
| 7 | Миграции 0001–0024 применены на проде | ✅ |
| 8 | Сборка Windows (NSIS + MSI + portable) | ✅ CI |
| 9 | Сборка macOS (dmg), подпись updater | ✅ CI |

---

## Установка

- **Windows:** установщик `.exe` (NSIS) или `.msi`, либо portable `taskflow.exe`.
- **macOS:** `.dmg`.
- Автообновление настроено через `latest.json` (Tauri updater, подпись проверяется).

---

## Инфраструктура

- **Supabase project:** миграции 0001–0024, edge-функции (create-payment v18, start-trial v10, payment-webhook v26, admin-actions v7, renew-subscription и др.), cron-задачи автопродления и очистки rate-limits.
- **CI/CD:** GitHub Actions — гейт typecheck + unit + E2E, сборка Tauri под Windows/macOS, публикация релиза (`softprops/action-gh-release`).

---

## Известные шаги после релиза

- Первый реальный E2E-цикл автопродления подтвердится на живой подписке при наступлении срока (ожидается ~06.08.2026).
- После подтверждения работы нового ключа — отключение legacy anon-ключа в Supabase Dashboard.
- Обновление `/privacy.html` на лендинге (`taskflow-landing`).

---

*TaskFlow — personal task manager. © 2026 Daniil Lebedev (danny-swan). PolyForm-Noncommercial-1.0.0.*
