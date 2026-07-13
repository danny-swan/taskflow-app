# 0005. Shared workspaces — роли, инвайты по TF-ID и `workspace_id` text → uuid + FK + ON DELETE CASCADE

- Статус: accepted
- Дата: 2026-07-13
- Связано: направление workspaces, Wave B. План — [`docs/architecture/wave-b-plan.md`](../architecture/wave-b-plan.md);
  living-анализ — [`docs/architecture/tf_workspaces_architecture.md`](../architecture/tf_workspaces_architecture.md);
  фундамент Wave A — [`docs/architecture/workspaces-plan.md`](../architecture/workspaces-plan.md).
  Соседние решения: ADR [0001](0001-payment-method-id-vs-external-id.md)–[0004](0004-rate-limiting-table-based.md).
  Реализация FK+CASCADE — в PR `feat/ws-b-01-integrity` (migration Wave B, «PR-b-01»).

## Контекст

Wave A ввела модель пространств (personal-only): таблицы `sync_workspaces` /
`sync_workspace_members` / `sync_workspace_settings`, колонку `workspace_id text`
в 6 sync-таблицах, функцию `has_workspace_role` и RLS через неё, а также тарифные
лимиты (`get_workspace_limit` / `enforce_workspace_limit`). Wave B открывает
**общие пространства**.

Из PR-6 Wave A унаследованы **две инженерные проблемы**, которые до открытия
shared были некритичны, а в shared становятся источником реальных багов:

1. **`workspace_id` хранится как `text` без FK** на `sync_workspaces(id)`.
   Ссылочная целостность держится только на неявной логике RLS/клиента —
   orphan-строки (child без существующего workspace) физически возможны.
2. **Нет `ON DELETE CASCADE`.** Удаление workspace не удаляет его детей на уровне
   БД; чистка возможна только приложным orphan-cleanup, что и является источником
   скрытых расхождений между клиентами.

Продуктовые ограничения (унаследованы, не пересматриваются): free-user не
участвует в shared; роли — три (`owner/editor/viewer`); приглашения — по
публичному `public_user_id` формата `TF-XXXXXX` (заложен миграцией 0026), не по
email.

## Решение

Принятые решения Wave B:

1. **Роли: `owner / editor / viewer`** (без `admin`; owner = admin в MVP).
2. **Free не участвует в shared** (ни owner, ни invitee) — уже реализовано в
   `get_workspace_limit` (free + shared → 0), регресс-подтверждается в PR-b-06.
3. **Приглашения через `public_user_id` (`TF-XXXXXX`)**, не по email.
4. **Shared workspace принадлежит одному owner-Pro и занимает ЕГО слот** в лимите
   7 — уже реализовано через «суммарно по всем kind» в `get_workspace_limit`
   (форвард-совместимо, см. `workspaces-plan.md` §3.8-факт).
5. **`workspace_id`: `text` → `uuid` + FK + `ON DELETE CASCADE`** для 6 sync-таблиц
   + `sync_workspace_members` + `sync_workspace_settings` (миграция в PR-b-01).

### Обоснование пункта 5 (FK + CASCADE)

**Плюсы:**

- Явные database-level инварианты вместо неявных через RLS.
- Orphan-строки становятся физически невозможными.
- Hard delete workspace становится атомарной операцией — cleanup job тривиален
  (одна строка `DELETE FROM sync_workspaces WHERE deleted_at < now() - interval '30 days'`).
- Меньше приложной сложности: не нужен orphan-cleanup job, не нужен явный порядок
  удаления детей в клиенте.
- PG эффективнее оптимизирует запросы при наличии объявленного FK.

**Минусы:**

- Offline-first клиент обязан строго соблюдать PUSH_ORDER
  (`workspace → members → settings → tasks/statuses/tags/…`). Уже соблюдается с
  Wave A PR-2, но регресс-тесты становятся жёстче.
- При пуше child'а раньше parent'а (race в outbox) прилетит FK violation — нужен
  корректный retry в sync-цикле. Частично покрыто существующим outbox retry, но
  нужен явный тест.
- Миграция `ALTER COLUMN ... TYPE uuid` на большой таблице может потребовать
  downtime или concurrent-подхода. На объёмах TaskFlow (Supabase Postgres 15)
  ожидается быстро, но стоит проверить.
- Ошибка «workspace ещё не пришёл, а task уже пришёл» станет заметнее — нужно
  UX-сообщение «синхронизация в процессе» вместо тихого пропуска.

### Влияние на RLS

Нейтральное. RLS-политики через `has_workspace_role` не зависят от типа
`workspace_id`. `WITH CHECK` для UPDATE (положительный инвариант, обнаруженный в
PR-6) продолжает работать.

### Влияние на sync

Нужно тщательное тестирование PUSH_ORDER и outbox-retry на FK violation.
Ожидается +1–2 теста в pgTAP PR-b-01.

## Последствия

- Обновить outbox retry, если он ещё не обрабатывает FK-ошибку корректно (child
  раньше parent → ретрай, не permanent-error).
- Провести orphan/format-scan существующих данных **во время миграции**, до
  `ALTER COLUMN ... TYPE uuid` (все значения должны быть валидными UUID; orphan'ов
  быть не должно).
- Обновить pgTAP-тесты PR-6: часть инвариантов становится избыточной. Например,
  тест группы C «INSERT с несуществующим `workspace_id` проходит незамеченным»
  можно упростить — теперь такой INSERT падает по FK, а не проходит тихо.
- Снятие check-constraint `block_shared_workspaces` открывает `kind='shared'` на
  уровне схемы; продуктовое открытие shared идёт отдельными PR (b-03…b-05).

## Альтернативы, которые отвергнуты

- **Orphan-cleanup job без FK.** Сохраняет offline-first проще, но оставляет
  integrity в приложении — постоянный источник багов и скрытых расхождений между
  клиентами. **Отвергнуто.**
- **Оставить как есть, добавить FK только для новых таблиц.** Половинчатое
  решение: будущий разработчик наступит на грабли `text` vs `uuid` и
  рассогласованного набора ограничений. **Отвергнуто.**
