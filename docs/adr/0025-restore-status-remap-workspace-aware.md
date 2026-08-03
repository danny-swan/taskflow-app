# ADR 0025: `applyBackup` перепривязка `status_id`/`tag_id` становится workspace-aware + идемпотентный ремонт уже битых данных (F32)

- **Статус:** accepted
- **Дата:** 03.08.2026
- **Ветка:** `feat/workspaces`
- **Связано:** [ADR 0021](0021-free-slot-workspace-aware.md) (F28, статусы/задачи восстанавливаются workspace-aware через `resolveWsId`), [ADR 0022](0022-restore-legacy-ws-normalize.md) (F29), [ADR 0023](0023-free-restore-from-file-snapshot.md) (F30), [ADR 0024](0024-hydrate-current-workspace-on-account-switch.md) (F31) — F28–F31 чинят слот/снимок/гидрацию текущего пространства и этой правкой НЕ затронуты; `src/lib/db.ts` (`applyBackup()`, новая `repairTaskStatusWorkspaceMismatch()`); roadmap §7.27 (F32)

## Контекст

Симптом (5-я+ попытка починить, тот же класс жалобы что F28–F31): free-пользователь переключает аккаунт → доска/список задач пуст, хотя счётчик в сайдбаре и статистика показывают верное число. Данные при этом целы в БД.

Диагноз доказан на реальной `data.db` пользователя (03.08.2026):

- Активное `current_workspace_id = ws_ca1290fe...` («Мои задачи»), в нём 2 задачи: «Добро пожаловать» (`status_id=4`), «Задача 1» (`status_id=8`).
- Статусы `id=4` («Сегодня») и `id=8` («Взять в работу») принадлежат ДРУГОМУ пространству `ws_019fc541...` (new test3), не активному.
- Статусы активного ws `ca1290fe` имеют id `1,3,5,7,9,11,13`. Задачи ссылаются на 4 и 8 → доска (рендерит колонки по статусам ТЕКУЩЕГО ws) не находит колонку → задачи невидимы. Счётчик считает по `workspace_id` задачи (не статуса) → показывает верное число. Ровно симптом пользователя.
- SQL-проверка подтвердила: 2 задачи имеют `task.workspace_id <> status.workspace_id` (MISMATCH). Задачи самого new test3 — OK.
- Проверено вручную: перепривязка `status_id` к одноимённому статусу ТОГО ЖЕ ws делает задачи видимыми («Добро пожаловать»→«Сегодня» id3, «Задача 1»→«Взять в работу» id7 — оба в правильном ws).

Корень в коде (`src/lib/db.ts`, `applyBackup()`, блок `if (has.tasks)`, HEAD `9c6cdc2`):

- Статусы восстанавливаются workspace-aware — `INSERT INTO statuses (... workspace_id) VALUES (... resolveWsId(s.workspace_id))` — это уже верно (F28).
- НО перепривязка `task.status_id` использовала `Map<string, number> statusByName`, ключ — ТОЛЬКО `name.toLowerCase()`, без workspace:
  ```ts
  const statusByName = new Map<string, number>();
  for (const r of all('SELECT id, name FROM statuses')) statusByName.set(String(r.name).toLowerCase(), r.id);
  ...
  const newId = statusByName.get(origName.toLowerCase()); // игнорирует workspace!
  ```
- Оба пространства несут одноимённые seed-статусы («Сегодня», «Взять в работу» и т.д.). При построении мапы запись для последнего обработанного ws перетирает предыдущую — остаётся id ПОСЛЕДНЕГО ws. Задача из «Мои задачи» со статусом «Сегодня» получает id статуса «Сегодня» из new test3 → MISMATCH. Та же уязвимость была у `tagByName` для тегов (без видимого эффекта «пустой доски», но потенциально тот же баг).

## Решение

Точечная правка одной функции (`applyBackup`), без новых слоёв, плюс отдельный идемпотентный ремонт уже испорченных на диске данных.

### 1. Workspace-aware ключ перепривязки (`src/lib/db.ts`, блок `if (has.tasks)`)

- Добавлена вторая пара карт `statusByWsName`/`tagByWsName`, ключ `${workspace_id}|${name.toLowerCase()}`, построенная из ТЕКУЩЕГО состояния БД (после вставки statuses/tags этим же вызовом `applyBackup`):
  ```ts
  const statusByWsName = new Map<string, number>();
  for (const r of all('SELECT id, name, workspace_id FROM statuses'))
    statusByWsName.set(`${r.workspace_id ?? ''}|${String(r.name).toLowerCase()}`, r.id);
  ```
- Добавлена `origStatusWs`/`origTagWs` — id→workspace_id ИЗ ПЕРВОНАЧАЛЬНОГО payload (старый ws_id дампа). Этот исходный ws_id прогоняется через ТУ ЖЕ `resolveWsId(...)`, что использовалась при вставке statuses/tags выше в этой же функции — чтобы получить актуальный ws_id, под которым статус/тег реально лежит в текущей БД:
  ```ts
  const origStatusWs = new Map<number, string>();
  if (has.statuses) for (const s of payload.statuses!) origStatusWs.set(s.id, String(s.workspace_id ?? ''));
  ```
- Перепривязка задачи: сперва ws-aware ключ, затем fallback на старую по-имени карту (обратная совместимость с легаси-бэкапами/снимками без `workspace_id` у статусов):
  ```ts
  const origWs = origStatusWs.has(t.status_id) ? resolveWsId(origStatusWs.get(t.status_id)) : undefined;
  const newId = (origWs !== undefined ? statusByWsName.get(`${origWs}|${origName.toLowerCase()}`) : undefined)
             ?? statusByName.get(origName.toLowerCase());
  ```
- Аналогично для `tag_id` (`tagByWsName` + fallback на `tagByName`), с сохранением исходной обработки `null` (тег может отсутствовать).

`resolveWsId` переиспользована как есть — не создаётся параллельный маппинг ws.

### 2. Идемпотентный ремонт уже битых данных на диске

Новая функция `repairTaskStatusWorkspaceMismatch()` (`src/lib/db.ts`, экспортируется), одним `UPDATE`:

```sql
UPDATE tasks
SET status_id = (
  SELECT s2.id FROM statuses s2
  WHERE s2.workspace_id = tasks.workspace_id AND s2.deleted_at IS NULL
    AND lower(s2.name) = (SELECT lower(s1.name) FROM statuses s1 WHERE s1.id = tasks.status_id)
  ORDER BY s2.sort_order LIMIT 1
)
WHERE deleted_at IS NULL
  AND status_id IN (SELECT s.id FROM statuses s WHERE s.id = tasks.status_id AND s.workspace_id <> tasks.workspace_id)
  AND EXISTS (
    SELECT 1 FROM statuses s2
    WHERE s2.workspace_id = tasks.workspace_id AND s2.deleted_at IS NULL
      AND lower(s2.name) = (SELECT lower(s1.name) FROM statuses s1 WHERE s1.id = tasks.status_id)
  );
```

- Работает в обоих режимах — web (`webDb.run`) и Tauri (`getTauriDb().execute`) — тот же `execBoth`-паттерн, что и `ensureSeededIfEmpty()`.
- Идемпотентна: условие `status.workspace_id <> tasks.workspace_id` перестаёт выполняться сразу после починки, повторный вызов — no-op (0 changes).
- НИКОГДА не удаляет задачи. Если одноимённого статуса в целевом (собственном) workspace задачи нет — `EXISTS`-условие ложно, строка не трогается (данные целы, задача просто останется без видимой колонки до следующей ручной правки — лучше, чем потеря данных).
- Вызывается в `src/store/useStore.ts`, `init()`, сразу после `await db.initDb()` и **до** `get().refresh()` — чтобы первый рендер доски уже увидел исправленные привязки:
  ```ts
  await db.initDb();
  try {
    await db.repairTaskStatusWorkspaceMismatch();
  } catch (e) {
    console.error('[init] repairTaskStatusWorkspaceMismatch failed:', e);
  }
  get().refresh();
  ```

## Почему это просто и надёжно, а не костыль

- Один точечный диф в существующей функции `applyBackup` — карта заменена на пару карт (ws-aware + fallback), логика вставки/резолва ws не меняется, `resolveWsId` переиспользована.
- Fallback на старую по-имени карту сохраняет 100% обратную совместимость с легаси-бэкапами/снимками, у которых статусы/теги ещё не несут `workspace_id`.
- Ремонт битых данных — отдельная маленькая идемпотентная функция, один `UPDATE`, без новых таблиц/полей/слоёв. Не трогает схему, миграции, сам слот (`localAccountStore.ts`), `AccountSwitchGate.tsx`, F30 file-snapshot fallback, F31 `currentWorkspaceId`-гидрацию.

## Границы

- **Не тронуты:** `localAccountStore.ts`, `AccountSwitchGate.tsx`, F30 (файловый снимок), F31 (`hydrateCurrentWorkspaceId`/`reloadAccountBinding`), схема БД и миграции.
- **Templates (`task_templates`)** используют тот же паттерн перепривязки по имени (`if (has.templates)` блок ниже в `applyBackup`), но НЕ входят в область этого фикса — у шаблонов нет визуального симптома «пустой доски» и брифом не затребованы; оставлены как есть, чтобы не расширять диф сверх необходимого.
- **Pro/Trial:** ремонт вызывается в общем (не free-специфичном) `init()`, но т.к. условие MISMATCH возникает только там, где были одноимённые статусы разных workspace (типичный сценарий free-слота с несколькими личными пространствами), для Pro/Trial с обычными данными это no-op.

## Тесты

`src/lib/db.applyBackup.test.ts` (добавлены 2 теста в новый `describe('F32: applyBackup — workspace-aware перепривязка status_id/tag_id')`):

1. Два ws с одноимёнными статусами разных id → восстановленная задача каждого ws получает `status_id`, чей статус лежит в ЕЁ workspace (`task.workspace_id === status.workspace_id`); оба одноимённых статуса переживают restore с разными id (карта не схлопнула их).
2. Легаси-бэкап без `payload.workspaces` (старый формат до F28) → перепривязка по имени работает как раньше (fallback-путь).

`src/lib/db.repairTaskStatusWorkspaceMismatch.test.ts` (новый файл, 3 теста):

1. Засеян MISMATCH (задача ws A со статусом ws B, в ws A есть одноимённый статус) → после ремонта задача рекбинднута на статус ws A; задача без mismatch не изменилась; все задачи целы.
2. Идемпотентность: первый вызов чинит и возвращает число изменений ≥1, повторный вызов возвращает 0 и ничего не меняет.
3. Нет одноимённого статуса в целевом ws → задача НЕ трогается и НЕ удаляется.

Регресс: полный прогон `src/lib/`, `src/store/`, `src/components/` (73 файла / 611 тестов) зелёный, включая `db.workspaceAwareBackup.test.ts`, `useStore.test.ts`, `AccountSwitchGate.test.tsx`, `accountSwitchRestore.test.tsx`.

Запуск:
```
cd /home/user/workspace/taskflow-repo
./node_modules/.bin/vitest run src/lib/db.applyBackup.test.ts src/lib/db.repairTaskStatusWorkspaceMismatch.test.ts src/lib/db.workspaceAwareBackup.test.ts src/store/useStore.test.ts src/components/AccountSwitchGate.test.tsx src/components/accountSwitchRestore.test.tsx --pool=forks --poolOptions.forks.maxForks=2
./node_modules/.bin/tsc --noEmit
```

## Не делать

- Не трогать слот free-аккаунта (`localAccountStore.ts`), `AccountSwitchGate.tsx`, F30/F31.
- Не трогать схему БД / миграции.
- Не запускать `npm run build` (известное OOM-ограничение среды) — верификация ограничена `vitest` + `tsc --noEmit`.

## Последствия

- `applyBackup` больше не схлопывает одноимённые статусы/теги разных workspace в один id при перепривязке задач — восстановленные задачи корректно ссылаются на статус/тег СВОЕГО workspace.
- Уже испорченные на диске данные пользователя чинятся автоматически при следующем запуске приложения (идемпотентный ремонт в `init()`), без ручного вмешательства и без потери задач.
- Схема БД не менялась, миграций нет — правка полностью в клиентском TypeScript-коде (`src/lib/db.ts`, `src/store/useStore.ts`).
- **Статус верификации:** реализовано, автотесты (vitest, 611/611) зелёные, `tsc --noEmit` чист. Фикс **НЕ подтверждён вручную на реальных данных пользователя** — требуется ручная проверка перед тем, как считать баг устранённым.
