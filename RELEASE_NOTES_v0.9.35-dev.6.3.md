# TaskFlow v0.9.35-dev.6.3 — CI Hotfix (channel regex)

## Что исправлено

### Проблема dev.6.2
CI-workflow `build` в v0.9.35-dev.6.2 отработал по stable-каналу вместо pre-release и упал на MSI-таргете:

```
failed to bundle project `optional pre-release identifier in app version
must be numeric-only and cannot be greater than 65535 for msi target`
```

### Причина
Regex определения канала релиза (`build.yml`, шаг **Determine release channel**) не поддерживал двухсегментные pre-release суффиксы:

```bash
# Было:
if [[ "$TAG" =~ ^v.*-(dev|beta|rc|alpha)(\.[0-9]+)?$ ]]; then
```

`(\.[0-9]+)?` разрешает **не более одной** точки+числа после `-dev/-beta/-rc/-alpha`. Тег `v0.9.35-dev.6.2` содержит два таких сегмента (`.6.2`), поэтому не матчил pre-release-ветку → уходил на stable → триггерил MSI-сборку → WiX падал.

### Fix
```bash
# Стало:
if [[ "$TAG" =~ ^v.*-(dev|beta|rc|alpha)(\.[0-9]+)+$ ]]; then
```

`(\.[0-9]+)+` = **одна или больше** точек+чисел. Работает и для `-dev.6`, и для `-dev.6.2`, и для `-dev.6.2.1` в будущем.

Правка применена в двух местах `build.yml`:
- Job `build` (строка 121) — влияет на выбор bundle'ов (NSIS+portable vs NSIS+MSI+portable)
- Job `release` (строка 374) — влияет на `prerelease: true/false` и публикацию `latest.json`

## Проверено локально

- `npx tsc -b --noEmit` — clean
- Bash regex test:
  ```
  v0.9.35-dev.6.2 → prerelease ✓
  v0.9.35-dev.6   → prerelease ✓
  v0.9.35-dev.1   → prerelease ✓
  v0.9.35-beta.1  → prerelease ✓
  v0.9.35-rc.2.1  → prerelease ✓
  v1.0.0          → stable ✓
  ```

## Что в dev.6.2 уже работало

- ✅ Test job — все 156 vitest + 13 Playwright прошли (Supabase secrets корректно подхватываются)
- ✅ build-macos — .dmg собран
- ❌ build (Windows) — упал только на MSI из-за regex

## Roadmap
- **dev.6.3 сейчас** — CI regex hotfix
- dev.6.4 — real ЮKassa/CloudPayments checkout + чеки НПД
- dev.6.5 — recurring + refund
- dev.6.6 — admin page `/admin`
- dev.7 — Telegram bot
- v1.0.0 — merge to main
