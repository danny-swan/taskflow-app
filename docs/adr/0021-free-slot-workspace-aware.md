# ADR 0021: Слот free-аккаунта (F21) становится workspace-aware — сохраняет `workspaces`/`workspace_members` и исходный `workspace_id` задач (F28)

- **Статус:** accepted
- **Дата:** 03.08.2026
- **Ветка:** `feat/workspaces`
- **Связано:** [ADR 0014](0014-free-tier-local-account-store.md) (слот per-account, `buildBackup`/`applyBackup`, `localAccountStore.ts`) — этот ADR его расширяет, не заменяет; [ADR 0007](0007-workspace-crash-clientid-dedup.md) (`dedupePersonalWorkspaces`, `src/lib/sync/workspace.ts`); roadmap §7.13 (F13), §7.22 (F21), §7.28 (F28)
- **Нумерация:** ADR `0015`–`0020` зарезервированы под патчи F22–F27, которые чинили не тот слой (см. «Почему F22–F27 не подошли» ниже) и были откачены вместе с кодом до F21 (`8a94bdb`) — файлы этих ADR не публикуются, т.к. решения, которые они фиксировали, отменены.

## Контекст

[ADR 0014](0014-free-tier-local-account-store.md) дал free-аккаунтам (без облачной синхронизации) локальный аналог облака: слот-слепок БД на каждый `user_id` в `localStorage['taskflow.localstore.v1.<userId>']`, читаемый/записываемый через `db.buildBackup()`/`db.applyBackup()`.

Баг (воспроизведён пользователем): free-аккаунт создаёт **второе личное пространство вручную** (кнопка «Новое личное пространство», `createWorkspace('personal')` в `useStore.ts` ~760) в дополнение к дефолтному `ws_<uid>`. Переключается на другой аккаунт и возвращается обратно. Результат: второе пространство пропадает из сайдбара, а задачи, ранее находившиеся в разных пространствах, оказываются перемешаны в одном.

## Корень (доказан по коду)

Два факта из `src/lib/db.ts`, оба существовали до этого фикса:

1. **`buildBackup(include)` не читает `workspaces`/`workspace_members`.** Функция кладёт в дамп только `statuses`/`tags`/`tasks`/`task_templates`. `localAccountStore.saveLocalAccountData()` вызывала `buildBackup({tasks, tags, statuses})` — слот **никогда не содержал** ни строки пространств, ни строки членства.
2. **`applyBackup(payload, 'replace')` штампует ВСЕ восстановленные строки одним `importWsId`** (текущий `current_workspace_id`/`personal_workspace_id` на момент восстановления). Это было корректно для легаси-бэкапов (снимки/импорт до эпика «Пространства», где `workspace_id` вообще не существовало) — но для слота с несколькими пространствами это схлопывает все задачи пользователя в одно текущее пространство.

Следствие цепочкой:

- После `clearUserData()` (смена аккаунта, `AccountSwitchGate` free-ветка) все локальные `workspaces`/`workspace_members` стираются.
- `loadLocalAccountData(newUser)` → `applyBackup(slotPayload, 'replace')` восстанавливает **только** `tasks`/`tags`/`statuses`/`task_templates`, привязывая их все к текущему `importWsId` (детерминированный `ws_<uid>`). Строка **второго** пространства (`ws_<random>`, `kind='personal'`) и его owner-membership **никогда не восстанавливаются** — их не было в дампе.
- `reconcilePersonalWorkspace(userId)` (вызывается перед `loadLocalAccountData` по контракту ADR 0014) вызывает `dedupePersonalWorkspaces(userId, target)` ([ADR 0007](0007-workspace-crash-clientid-dedup.md)) — та гасит (soft-delete) любую `kind='personal'` строку `workspaces`, у которой в **текущем** локальном зеркале нет живого членства текущего пользователя. Второе пространство новой строки `workspaces` тоже не имеет — здесь его просто ещё нет, так как оно не входило в цепочку `reconcile → dedupe`, вызываемую до restore. `dedupePersonalWorkspaces` в этом сценарии — не источник бага, а корректный механизм самолечения; он не может отличить «второе личное пространство, которое ещё не восстановлено» от «осиротевший мусор от прошлого аккаунта», потому что для этого ему нужна сама строка `workspaces`, а её в слоте не было.
- Итог: второе пространство пропадает из сайдбара (its `workspaces` row просто не существует), а его задачи — уже восстановленные `applyBackup` — лежат под `importWsId`, то есть смешаны с задачами первого личного пространства.

**`dedupePersonalWorkspaces` не является причиной бага** — он корректно работает с тем состоянием, которое ему подаёт неполный слот. Правка в нём не нужна и не делалась.

## Почему F22–F27 не подошли

Шесть последовательных патчей (F22–F27, коммиты между `8a94bdb` и текущим HEAD откатанной ветки) чинили симптомы в `reconcile`/`dedupe`/`restoreV2`-слое: подстройка порядка вызовов, доп. проверки в `dedupePersonalWorkspaces`, транзакционность restore, изоляция кэша entitlement и т.п. Ни один не трогал то, что реально неполно — сам контракт слота (`buildBackup`/`applyBackup`). Пока слот не несёт `workspaces`/`workspace_members`, любая правка вокруг него лечит следствие, а не причину, и хрупко ломается при следующем сценарии (другой набор пространств, другой порядок операций). Все шесть патчей отменены, код возвращён к состоянию F21 (`8a94bdb`) на `feat/workspaces`; F28 чинит корень напрямую в `buildBackup`/`applyBackup`.

## Решение

Сделать слот free-аккаунта **workspace-aware**: пространства и членства сохраняются и восстанавливаются вместе с задачами, каждая строка сохраняет свой исходный `workspace_id`.

### A. `src/lib/db.ts`

- `BackupPayload` получил два опциональных поля: `workspaces?: any[]`, `workspace_members?: any[]`. Их **присутствие** в payload (а не отдельный флаг) — единственный сигнал `applyBackup`, что бэкап workspace-aware. Отсутствие полей = легаси-формат, поведение не меняется.
- `buildBackup(include)` принял необязательный `include.workspaces` (по умолчанию `false` — снимки/экспорт в `snapshots.ts`/`Settings.tsx` вызывают `buildBackup` без него и не меняют поведение). При `true` дамп получает `SELECT * FROM workspaces WHERE deleted_at IS NULL` и `SELECT * FROM workspace_members WHERE deleted_at IS NULL`.
- `applyBackup(payload, mode)`:
  - в режиме `'replace'` — если `payload.workspaces`/`workspace_members` присутствуют, эти таблицы тоже очищаются и восстанавливаются (в том же порядке идентичности, что и `tasks`/`tags`/`statuses`: сохраняются `uuid`/`version+1`/`deleted_at`/`client_id`, строки ставятся в `sync_outbox` — тот же контракт dev.6.10.4);
  - пространства восстанавливаются **до** задач/статусов/тегов/шаблонов;
  - **критично:** для каждой восстановленной строки `workspace_id` берётся из самой строки (`resolveWsId(row.workspace_id)`), если бэкап workspace-aware — вместо повсеместной штамповки `importWsId`. `importWsId`-фолбэк остаётся ТОЛЬКО для (а) легаси-бэкапов без `workspaces` и (б) строк workspace-aware бэкапа без собственного `workspace_id` (устойчивость к неполным данным).
  - возвращаемые `counts` дополнены `workspaces`/`workspace_members`.

### B. `src/lib/localAccountStore.ts`

- `saveLocalAccountData` вызывает `db.buildBackup({tasks: true, tags: true, statuses: true, workspaces: true})` — слот теперь всегда несёт пространства/членства.
- `loadLocalAccountData` не изменена по логике — `db.applyBackup(payload, 'replace')` сама распознаёт workspace-aware payload по наличию `workspaces`. Инвариант ADR 0014 «пустой дамп не затирает живой слот» (`isNonEmpty`, считает только `tasks/tags/statuses/templates`) сохранён без изменений.

### C. `dedupePersonalWorkspaces` (`src/lib/sync/workspace.ts`)

Не изменена. После workspace-aware restore второе личное пространство приходит в БД вместе со своей `workspace_members`-строкой (`hasLocalMembership(userId, ws)` = true) → `dedupePersonalWorkspaces` его пропускает, как и было задумано в [ADR 0007](0007-workspace-crash-clientid-dedup.md).

## Альтернативы — рассмотрены и отклонены

- **Патчить `dedupePersonalWorkspaces`, чтобы не гасил пространства без задач восстановления.** Отклонено: dedupe не может отличить «легитимное второе пространство, ещё не восстановленное» от «настоящий осиротевший мусор от прошлого аккаунта» — единственный надёжный признак разницы — наличие живого членства, а оно и должно приходить из слота. Патч в dedupe стал бы костылём поверх неполного контракта слота, тем же классом ошибки, что и F22–F27.
- **Отдельный слот для workspaces/members.** Усложняет `localAccountStore` без выгоды: один JSON-дамп на аккаунт проще поддерживать и атомарнее восстанавливать (нет риска рассинхрона между двумя слотами).
- **Схлопывать все личные пространства в одно при restore (текущее поведение) и явно документировать как ограничение.** Отклонено пользователем — прямое требование «убирать сломанный слой, не строить костыль поверх»; потеря второго пространства и смешивание задач — это потеря данных с точки зрения UX, не приемлемое ограничение.

## Тесты

- `src/lib/db.workspaceAwareBackup.test.ts` (новый):
  1. workspace-aware roundtrip — `buildBackup({..., workspaces: true})` → `applyBackup('replace')` → `workspaces`/`workspace_members` восстановлены, задачи двух разных пространств сохраняют свой `workspace_id` (не схлопнуты).
  2. легаси-бэкап без `workspaces` — `applyBackup` ведёт себя как раньше (`importWsId`-штамповка), обратная совместимость подтверждена.
  3. два личных пространства переживают `save → load` слота (симуляция смены аккаунта), задачи каждого пространства остаются при своём `workspace_id`, не перемешаны.
  4. после restore + `reconcilePersonalWorkspace` второе личное пространство и его членство живы — `dedupePersonalWorkspaces` его не гасит.
- `src/lib/localAccountStore.test.ts` (обновлён): новый кейс проверяет, что `saveLocalAccountData` вызывает `buildBackup` с `workspaces: true`; существующие 9 тестов (roundtrip/изоляция/пустой-битый слот) не изменены и остаются зелёными на моках.
- Запуск: `./node_modules/.bin/vitest run src/lib/db.workspaceAwareBackup.test.ts src/lib/localAccountStore.test.ts --pool=forks --poolOptions.forks.maxForks=2` и `./node_modules/.bin/tsc --noEmit`.

## Последствия

- Слот занимает немного больше места в `localStorage` (пространства/членства обычно единицы строк — незначительно относительно задач).
- `applyBackup` теперь восстанавливает `workspaces`/`workspace_members` и для web-снимков/импорта, ЕСЛИ вызывающий явно передаст их в дампе (сейчас — только слот free-аккаунта; `snapshots.ts`/`Settings.tsx` не меняли вызов `buildBackup` и продолжают работать по-старому).
- Схема БД не менялась, миграций нет — правка полностью в клиентском TypeScript-коде `db.ts`/`localAccountStore.ts`.
