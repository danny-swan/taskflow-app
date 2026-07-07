# TaskFlow v0.9.35-dev.6.5.0 — pgTAP регрессионные тесты для миграций

**Дата:** 2026-07-07
**Тип:** dev-preview (CI-инфраструктура, prod без изменений)
**Предыдущая:** v0.9.35-dev.6.4.4 (b194764) — GRANTs sync/profiles + REVOKE triggers

---

## Зачем это

В v0.9.35-dev.6.4.x был инцидент: миграции 0002 и 0007 включили RLS на всех sync-таблицах и на entitlements/payment/activation_requests, но не выдали `GRANT` для `authenticated`. PostgREST возвращал 401/403 ещё до RLS-политик. Пришлось патчить тремя миграциями подряд (0011, 0012, 0013).

Причина — не хватало автоматической проверки. Теперь она есть.

## Что нового

### Три pgTAP-теста в `supabase/tests/`

- **`01_grants_test.sql`** — 56 assertions. Для каждой из 12 protected-таблиц проверяет ожидаемые GRANT'ы для `authenticated` / `service_role` / `anon`. Sync-таблицы: full CRUD. Payment/entitlements: read-only. `anon`: ничего не должно быть.
- **`02_rls_test.sql`** — 24 assertions. RLS enabled на 12 таблицах, own row visible / other row invisible для двух тестовых юзеров, `anon` получает `42501 permission denied`, `auth.uid()` работает от JWT claims.
- **`03_functions_test.sql`** — 16 assertions. Trigger-функции (`set_updated_at`, `set_user_entitlements_updated_at`, `sync_bump_updated_at`, `sync_bump_version`) закрыты для `anon`/`authenticated`/`service_role` (REVOKE FROM PUBLIC забирает и у `service_role`). Триггеры продолжают работать от имени owner (`postgres`).

### Auth shim для CI

`supabase/tests/00_auth_shim.sql` создаёт минимальный мок Supabase auth-схемы для ванильного Postgres:
- Роли `anon` / `authenticated` / `service_role` (NOLOGIN, service_role BYPASSRLS)
- Схема `auth` + таблица `auth.users` (только `id uuid PK`)
- `auth.uid()` / `auth.role()` — читают JWT claims из `current_setting`
- Extensions: `pgcrypto` (для `gen_random_uuid()`), `pgtap`

Применяется **только в CI**. В prod уже всё есть.

### GitHub Actions: `db-tests.yml`

- Ubuntu runner + `postgres:15` service container
- `apt-get install postgresql-15-pgtap` в контейнер Postgres
- Применяет: shim → миграции 0001-0013 → прогоняет `pg_prove` по трём test-файлам
- Триггеры: PR/push в `develop` или `main` при изменениях в `supabase/**`, ручной `workflow_dispatch`

### Документация: `docs/migrations.md`

Правила для будущих миграций:
- **Правило GRANT ↔ RLS**: любая миграция с `ENABLE ROW LEVEL SECURITY` обязана эксплицитно выдать GRANT'ы (иначе 401)
- Минимальный шаблон миграции + список ролей, которым что выдавать/не выдавать
- Правило REVOKE для trigger-функций
- Верификация в prod через `SET LOCAL ROLE authenticated`
- Rollback-скелет

## Testing Matrix

| Компонент | Что проверяется | Как проверить |
|---|---|---|
| **CI workflow** | Запускается на PR/push в develop | GitHub Actions → tab "DB tests (pgTAP)" зелёный |
| **shim** | Роли + auth-схема поднимаются на ванильном Postgres | Первый шаг workflow "Установить pgTAP" + "Применить auth shim" не падает |
| **01_grants_test** | 56/56 pass | ✅ в CI: `Files=3, Tests=96, Result: PASS` |
| **02_rls_test** | 24/24 pass | ✅ в CI |
| **03_functions_test** | 16/16 pass | ✅ в CI |
| **Регрессия** | Новая миграция без GRANT падает в CI | Добавить `create table public.foo (...); alter table public.foo enable row level security;` без GRANT — 01_grants_test упадёт (или потребует расширения списка проверяемых таблиц) |

## Что НЕ вошло (следующие шаги dev.6.5)

- Recurring subscription (Pro monthly auto-renewal через ЮKassa)
- Refund UI + cancel flow

## Prod изменения

**Нет.** Все файлы этого релиза — тесты, workflow, docs. Ни одной новой миграции. Prod остаётся на состоянии v0.9.35-dev.6.4.4.

## Файлы

**Добавлены:**
- `supabase/tests/00_auth_shim.sql`
- `supabase/tests/01_grants_test.sql`
- `supabase/tests/02_rls_test.sql`
- `supabase/tests/03_functions_test.sql`
- `.github/workflows/db-tests.yml`
- `docs/migrations.md`
- `RELEASE_NOTES_v0.9.35-dev.6.5.0.md`

**Изменены (version bump):**
- `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`

## Фиксы после первого прогона CI

Первый прогон упал — локально проверить не удалось (нет docker). Зафиксировано четыре коммита:

1. **`6d7d793`** — добавил PGDG apt-репо (Ubuntu 24.04 не имеет `postgresql-client-15` в стандартных репах, только 16).
2. **`dc807d0`** — в shim добавлены `auth.users.last_sign_in_at`, `email`, `created_at` (0001 создаёт view `admin_users_summary` с join на эти колонки).
3. **`82d2036`** — в shim добавлена пустая `PUBLICATION supabase_realtime` (0002/0006/0007 делают ALTER PUBLICATION ADD TABLE).
4. **`c51f68c`** — поправлен `03_functions_test`: `service_role` тоже не имеет EXECUTE (REVOKE FROM PUBLIC забирает и у него). Проверено в prod — так и есть, триггеры работают от имени owner.

Финальный зелёный run: [28871210334](https://github.com/danny-swan/taskflow-app/actions/runs/28871210334).

## Известные ограничения
- **`sync_task_templates` схема** в тесте 02 не проверяется на own row (только на RLS enabled + GRANT'ы). Причина: не хотел раздувать fixtures. Добавим если понадобится.
- **`payment_events` / `usage_events` / `activation_requests`** — RLS enabled проверяем, own row visibility — нет. Записи туда пишет только `service_role` через Edge Functions, а RLS-политики симметричны sync-таблицам.
