# ADR 0026: `applyBackup` идемпотентен к уже существующим `workspaces`/`workspace_members` в replace-режиме (F33)

- **Статус:** accepted
- **Дата:** 03.08.2026
- **Ветка:** `feat/workspaces`
- **Связано:** [ADR 0021](0021-free-slot-workspace-aware.md) (F28, слот сохраняет workspaces/members), [ADR 0022](0022-restore-legacy-ws-normalize.md) (F29), [ADR 0023](0023-free-restore-from-file-snapshot.md) (F30, аварийный откат на файловый снимок при ошибке слота), [ADR 0024](0024-hydrate-current-workspace-on-account-switch.md) (F31) — F30/F31/F32 не затронуты этой правкой; `src/lib/db.ts` (`applyBackup()`, блок восстановления `workspaces`/`workspace_members`); roadmap §7.28 (F33)

## Контекст

Симптом (репорт пользователя): после F32 «Мои задачи» видны (ОК). НО: пользователь создаёт второе пространство «new2» → перезапуск приложения / переключение free-аккаунта → «new2» ПРОПАДАЕТ, приложение откатывается на «Мои задачи», как будто второго пространства не было.

Диагноз доказан на реальных данных пользователя (`data-4.db`) и логе (`taskflow-3.log`), НЕ гипотеза.

Из лога (последовательность switch free-аккаунтов `ca1290fe` ↔ `e46d9d68`):

```
[localAccountStore] saved slot for e46d9d68 (tasks=5)
[localAccountStore] applyBackup failed for ca1290fe: (code: 2067) UNIQUE constraint failed: workspaces.uuid
[snapshots] restored snap_... from file    <-- аварийный откат F30 на старый снимок
```

и второй вариант того же:

```
[localAccountStore] applyBackup failed for ca1290fe: UNIQUE constraint failed: workspace_members.workspace_id, workspace_members.user_id
[snapshots] restored snap_... from file
```

Механизм (подтверждён воспроизведением на копии `data-4.db`):

1. Слот восстанавливается через `db.applyBackup(payload, 'replace')` (`src/lib/localAccountStore.ts`, `restoreLocalAccountData`, ~строка 146).
2. В `applyBackup` replace-режим делает `DELETE FROM workspaces` / `DELETE FROM workspace_members`, ЗАТЕМ `INSERT INTO workspaces (uuid,...)` для каждой строки payload (`src/lib/db.ts`, ~строки 1757, 1773, 1791 на HEAD `9c6cdc2`).
3. Personal-пространство `ca1290fe` к моменту `applyBackup` УЖЕ существует в БД — его пересоздаёт `reconcilePersonalWorkspace` (`src/lib/sync/workspace.ts`), который по контракту вызывается ДО `restoreLocalAccountData`. Плюс `DELETE` и `INSERT` идут отдельными командами (`sync()` = `d.execute` по одной, `applyBackup` НЕ в единой транзакции), поэтому к моменту `INSERT` строка `ca1290fe` снова на месте.
4. `INSERT INTO workspaces (uuid=...ca1290fe...)` → `UNIQUE constraint failed: workspaces.uuid`. `applyBackup` бросает исключение.
5. `localAccountStore` ловит исключение → срабатывает аварийный откат на файловый снимок (F30) → снимок = состояние ДО создания «new2» → «new2» пропадает, активным становится «Мои задачи».

Реальные данные подтверждают:

- `data-4.db` (текущее живое состояние): 2 пространства живы — «Мои задачи» (`ws_ca1290fe`) + «new2» (`ws_019fc6e4`), у каждого по 2 задачи, `deleted_at` пусто.
- `data.db-5.backup` (снимок, на который откатывается): «Мои задачи» + СТАРОЕ «new test3» (`ws_019fc54`, из прошлой сессии) — «new2» там нет. Это ровно тот старый снимок.
- Воспроизведено на копии `data-4.db`: `INSERT INTO workspaces` с существующим uuid → UNIQUE (ровно ошибка лога). `INSERT INTO workspace_members` с существующим `(workspace_id,user_id)` → тоже UNIQUE (второй вариант лога).

Схема (проверено):

- `workspaces`: `UNIQUE INDEX` на `uuid` (`idx_workspaces_uuid WHERE uuid IS NOT NULL`). Числовой `id` — `AUTOINCREMENT PK`. `tasks`/`statuses`/`tags`/`templates` ссылаются на пространство по uuid-строке `ws_...` (`tasks.workspace_id = 'ws_ca1290fe...'`), НЕ по числовому id → менять числовой id безопасно для связей.
- `workspace_members`: ДВА уникальных индекса — `idx_workspace_members_uuid` (`uuid`) И `idx_workspace_members_ws_user` (`workspace_id, user_id`). Конфликт из лога — по составному `(workspace_id, user_id)`.

## Решение

Точечная правка одной функции (`applyBackup`), без новых слоёв, по требованию пользователя «проще и надёжнее».

В `src/lib/db.ts`, внутри `applyBackup`, блок восстановления пространств/членов:

1. **workspaces** (строка ~1778): `INSERT INTO workspaces (...)` → `INSERT OR REPLACE INTO workspaces (...)`.
   - Связи по uuid, не по числовому id → замена id безопасна. Проверено на `data-4.db`: после `OR REPLACE` оба пространства целы, задачи не осиротели.
   - Дедуп-строка `if (mode === 'merge' && existingWs.has(uuid)) continue;` оставлена как есть — merge-поведение не меняется, `OR REPLACE` влияет только на replace-путь, где и возникает конфликт.

2. **workspace_members** (строка ~1800): `INSERT INTO workspace_members (...)` → `INSERT OR IGNORE INTO workspace_members (...)`.
   - `OR IGNORE` сохраняет существующую строку члена (её uuid/идентичность), просто пропускает дубль по любому из уникальных индексов (`uuid` ИЛИ `(workspace_id, user_id)`). Проще и безопаснее `REPLACE` — не меняет sync-идентичность owner-строки. Проверено на `data-4.db`: без ошибки, дубля нет, count верный.
   - Дедуп-строка merge оставлена.

Применены ОБА изменения (workspaces и members) — в логе встречаются оба варианта падения. `INSERT OR REPLACE` для statuses/tags/tasks/templates оставлен как есть (не трогается). F30/F31/F32, `localAccountStore.ts`, схема, миграции, `reconcile*` не тронуты.

### Почему это надёжно

- Минимальная правка: 2 SQL-глагола (`INSERT` → `INSERT OR REPLACE` / `INSERT OR IGNORE`). Ничего не оборачиваем, слои не добавляем.
- Делает `applyBackup` идемпотентным к уже существующему personal-пространству → `applyBackup` больше не бросает исключение на этом пути → аварийный откат на снимок (F30) больше не срабатывает по этой причине → «new2» сохраняется.
- Веб-путь (`webDb.run`) использует ту же SQL-строку через `sync()` — фикс работает в обоих режимах (Tauri/web).

## Тесты

Добавлены в `src/lib/db.applyBackup.test.ts` (группа «F33 (ADR 0026): applyBackup replace идемпотентен к уже существующему workspace/member»):

1. **workspaces**: payload несёт существующий workspace X дважды (дубль uuid — детерминированный эквивалент межпроцессной гонки с `reconcilePersonalWorkspace` внутри одного INSERT-цикла, без мока внутреннего `sync()`) плюс новый workspace Y. `applyBackup(payload, 'replace')` не бросает; оба X и Y существуют после (`deleted_at IS NULL`); задачи payload видны и привязаны к своим `workspace_id`.
2. **workspace_members**: payload несёт два члена на один `(workspace_id, user_id)` под разными uuid (A и B). `applyBackup(payload, 'replace')` не бросает; после — ровно ОДНА строка члена на `(ws X, user U)`; первая вставленная строка (uuid A) не сломана.
3. Регресс: полный прогон `vitest run src/lib/ src/store/ src/components/` — 608 passed, 3 failed (см. ниже — падения не связаны с F33).

Полный вывод команд — см. `/home/user/workspace/f33_report.md`.

## Отдельное замечание (вне скопа этого ADR)

На момент реализации F33 в рабочем дереве присутствуют тест-файл `src/lib/db.repairTaskStatusWorkspaceMismatch.test.ts` и `docs/adr/0025-restore-status-remap-workspace-aware.md` (описывают F32 — workspace-aware перепривязку `status_id`/`tag_id` в `applyBackup` + идемпотентный ремонт битых данных), но сама функция `repairTaskStatusWorkspaceMismatch()` и правка в `applyBackup()` из F32 **отсутствуют** в `src/lib/db.ts` на HEAD `9c6cdc2` (F31). Из-за этого 3 теста F32 падают (`repairTaskStatusWorkspaceMismatch is not a function`), и `tsc --noEmit` тоже красный по той же причине. Это состояние существовало ДО начала работы над F33 (подтверждено запуском тестов до внесения каких-либо правок F33) — F33 этого не касается и не чинит, так как это отдельная функциональность вне скопа брифа F33. Требует отдельного решения главным агентом.
