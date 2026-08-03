<!-- SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0 -->
<!-- Copyright (c) 2026 Daniil Lebedev (danny-swan) -->

# ADR 0028. Сид-справочник штампуется ЯВНО переданным `workspace_id` (не читается из БД), а `reconcileLocalPlaceholder` переклеивает осиротевшие дочерние строки `ws_local`

**Статус:** accepted
**Дата:** 03.08.2026
**Ветка:** `fix/f36-welcome-empty-board`

## Контекст

После мержа волны workspaces в `main` (PR #106, ADR 0027) при **первом** входе в свежий free-аккаунт страница «Задачи» открывалась пустой, хотя welcome-задача создавалась. После перехода в другой аккаунт и обратно задача появлялась.

Корень доказан не по коду, а на **реальной базе пользователя** (`data.db` + `data-2.db-wal`, аккаунт `1f797943-c8b5-4a3d-8e6b-c6dc7ac18c49`, 03.08.2026 11:39:10–11:39:11):

| Что | Значение |
| --- | --- |
| `settings.current_workspace_id` = `personal_workspace_id` | `ws_1f797943c8b54a3d8e6bc6dc7ac18c49` |
| `workspaces` | одна строка `ws_1f797943c8b54a3d8e6bc6dc7ac18c49` «Мои задачи», `personal`, 11:39:10 |
| `tasks` | одна строка «Добро пожаловать в TaskFlow», `workspace_id = ws_1f797943…`, 11:39:11.069Z |
| `statuses` | **все 7 сид-статусов с `workspace_id = 'ws_local'`** (тот же миллисекундный интервал) |

Доска рендерит колонки по статусам **текущего** пространства. Статусов в `ws_<uid>` нет → колонок нет → задачам негде отобразиться, при этом счётчики и БД «в порядке».

Механизм гонки (код на `main`):

1. `AccountSwitchGate.tsx` (free-ветка) → `clearUserData()` (сносит указатели `current_workspace_id`/`personal_workspace_id`, маркер `welcome_seeded` и все ws/статусы/теги/задачи) → `setBoundUserId` → `reconcilePersonalWorkspace(userId)` → `ensureSeededIfEmpty()` → `ensureWelcomeTaskIfNeeded(userId)`.
2. `reconcilePersonalWorkspace` пишет указатели через синхронный `db.run()`. В Tauri `db.run()` применяет SQL к web-зеркалу (sql.js) синхронно, а к **нативной** SQLite — `getTauriDb().then(d => d.execute(...))`, то есть **fire-and-forget, без await**.
3. `ensureSeededIfEmpty()` в Tauri читала `personal_workspace_id` из **нативной** базы (`getTauriDb().select`) — куда запись ещё не долетела → `seedWsId` падал на placeholder `'ws_local'` → 7 статусов и 5 тегов штамповались `ws_local`.
4. `ensureWelcomeTaskIfNeeded()` вызывается ~0.2 с позже, указатель уже доехал → задача получала корректный `ws_<uid>`. Расхождение зафиксировано.
5. Существующие механизмы самолечения не срабатывали:
   - `repairTaskStatusWorkspaceMismatch()` (F32 / ADR 0025) ищет одноимённый статус в целевом ws — там пусто, чинить нечем;
   - `reconcileLocalPlaceholder()` проверял наличие `ws_local` только в `workspaces` и `workspace_members`; обе таблицы `ws_local` не содержали (personal-ws уже создан под `ws_<uid>`) → `hasLocalRefs = false` → осиротевшие дочерние строки не переклеивались **никогда**;
   - «само починилось» при переходе между аккаунтами только потому, что `applyBackup`/restore слота перештамповывает `workspace_id` всех строк (лог: `restored slot for e46d9d68…: 2 tasks, 5 tags, 14 statuses`).

Ключевой вывод: сев не должен зависеть от того, доехала ли асинхронная запись указателя. Вызывающий знает `userId`, а `ws_<uid>` детерминирован (`computeWorkspaceId`).

## Решение

1. **Явный ws-id вместо чтения состояния.** `ensureSeededIfEmpty(seedWsIdOverride?)` и `ensureWelcomeTaskIfNeeded(_userId?, seedWsIdOverride?)` принимают ws-id аргументом. Если он передан — БД для получения указателя **не читается вовсе**. Все три места bootstrap'а передают `computeWorkspaceId(userId)`:
   - `src/components/AccountSwitchGate.tsx` (free-ветка, `!restored`),
   - `src/lib/sync/index.ts` — free/expired-trial локальный bootstrap,
   - `src/lib/sync/index.ts` — досев статусов после pull (облако без статусов).
   Без аргумента поведение прежнее (чтение `settings`) — обратная совместимость сохранена.
2. **Статус для welcome-задачи ищется строго внутри целевого ws:** `WHERE workspace_id = '<seedWsId>' AND deleted_at IS NULL` (предпочтительно «Сегодня», иначе минимальный `sort_order`). Если статусов в целевом ws нет — welcome **не создаётся** (`warn`), вместо привязки к статусу чужого пространства.
3. **Второй уровень защиты (self-heal) — `reconcileLocalPlaceholder`** (`src/lib/sync/workspace.ts`): признак `hasLocalRefs` расширен проверкой дочерних таблиц (`tasks`, `statuses`, `tags`, `task_templates`, `overdue_events`, `task_hold_periods`) через новый helper `hasLocalChildRefs()`, а шаг переклейки идёт по тому же списку. Любая база, где `ws_local` остался только в дочерних строках (в том числе уже испорченная на диске), лечится на следующем запуске.

## Последствия

**Положительные:**
- Первый вход в free-аккаунт больше не зависит от гонки native/web-зеркала: статусы, теги и welcome-задача гарантированно в одном пространстве.
- Уже испорченные базы (как `data.db` пользователя) лечатся при следующем старте без ручных действий и без restore слота.
- Убран сломанный слой (чтение состояния во время его же записи), а не построен костыль поверх него.

**Отрицательные / принимаемые:**
- Пока остаётся сама асинхронность `db.run()` в Tauri (fire-and-forget). Это осознанно вне объёма фикса: правка контракта `run()` на await затрагивает весь слой БД. Компенсация — явные аргументы в критичных путях + self-heal в reconcile.
- `LOCAL_WS_CHILD_TABLES` требует поддержки при добавлении новых ws-scoped таблиц (одно место, рядом с комментарием).

**Не затронуто:** логика членства и приглашений (ADR 0008/0009/0011), pro/облачный путь (pull/push/realtime), слот free-аккаунта (ADR 0014/0021), файловые снимки (ADR 0023), схема БД и миграции (новых миграций нет).

## Верификация

- Новые unit-тесты `src/lib/db.f36SeedWsStamp.test.ts` (4 кейса: штамп явным ws-id при отсутствующем указателе; задача и её статус в одном ws; отказ от welcome при статусах только в чужом ws; обратная совместимость без аргумента).
- Новый кейс в `src/lib/sync/workspaces-sync.test.ts` §(e): переклейка сирот `ws_local`, когда строк `ws_local` в `workspaces`/`workspace_members` нет + идемпотентность повторного вызова.
- Моки `../lib/db` и `../lib/sync/workspace` в `AccountSwitchGate.test.tsx` / `accountSwitchRestore.test.tsx` приведены к новой сигнатуре (пробрасывают ws-id, экспортируют `computeWorkspaceId`), добавлен ассерт «сев вызван с `ws_<uid>`».
- Полный прогон `vitest run`: **79 файлов / 658 тестов — все зелёные**; `tsc --noEmit` чист. Сборка локально не запускалась (OOM-ограничение среды) — только в CI.
- Ручная проверка на устройстве (обязательна до закрытия находки): свежий free-аккаунт → «Задачи» показывают welcome-задачу сразу, без перехода между аккаунтами.

## Ссылки

- `docs/audit/roadmap.md` §7.31 (F36) — симптом, доказательство на данных, статус.
- ADR 0025 (F32, `repairTaskStatusWorkspaceMismatch`), ADR 0022 (F29, нормализация legacy `workspace_id`), ADR 0021 (F28, workspace-aware слот) — соседние механизмы, которые здесь не помогали.
- `src/lib/db.ts` (`ensureSeededIfEmpty`, `ensureWelcomeTaskIfNeeded`), `src/lib/sync/workspace.ts` (`reconcileLocalPlaceholder`, `LOCAL_WS_CHILD_TABLES`), `src/lib/sync/index.ts`, `src/components/AccountSwitchGate.tsx`.
