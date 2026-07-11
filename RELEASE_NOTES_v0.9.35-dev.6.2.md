## v0.9.35-dev.6.2 — CI fix: Supabase env → GitHub Secrets

Хотфикс к `v0.9.35-dev.6.1`. Функциональных изменений нет — только починка CI-пайплайна.

### Проблема

В dev.6.1 из `src/lib/supabase.ts` был убран hardcoded fallback URL/anon key. Клиент теперь падает при старте, если `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` не заданы. Это правильное поведение для рантайма, но CI-workflow не прокидывал эти переменные:

- `Run Vitest` — vitest.config.ts подставляет dummy через `define`, но всё равно надёжнее иметь env
- `Run Playwright tests` — Vite dev-server стартовал без env → все 13 E2E-тестов падали (sidebar не рисовался)
- `Build Tauri app` (Windows stable/prerelease + macOS) — тот же корень: bundle собирался без env, Supabase-клиент не инициализировался

Итог: CI билд `v0.9.35-dev.6.1` завершился с ошибкой на E2E-гейте, tauri-bundle не собрался, релиз не опубликовался.

### Исправление

- В репозиторий добавлены GitHub Secrets `SUPABASE_URL` и `SUPABASE_ANON_KEY` (публичные по дизайну Supabase, RLS-защита).
- `.github/workflows/test.yml` — `Run Vitest` и `Run Playwright tests` получают `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` из secrets.
- `.github/workflows/build.yml` — те же env добавлены в:
  - `test` job (Vitest);
  - `e2e` job (Playwright);
  - `Build Tauri app (stable — NSIS + MSI)`;
  - `Build Tauri app (pre-release — NSIS + portable)`;
  - `Build Tauri app (Universal .dmg, unsigned)`.

### Дополнительный эффект

CI-installer теперь **полнофункциональный** — Supabase-клиент работает из коробки. Раньше (в dev.6.1) CI собирал installer с fallback throw, и монетизация была недоступна без локальной пересборки. Теперь `VITE_PAY_*` можно тоже добавить в GitHub Secrets отдельным шагом — это позволит собирать production installer со всеми способами поддержки прямо из CI.

### Совместимость

- Полная обратная совместимость с dev.6.1.
- Модель данных не изменилась.
- Никаких новых миграций.
