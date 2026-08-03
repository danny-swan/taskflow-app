# ADR 0012: Гидрация `workspaces` и `workspace_members` в webDb-зеркало при старте (Tauri) — истинный корень «shared-ws пропадают после рестарта» (F18)

- **Статус:** accepted
- **Дата:** 31.07.2026
- **Ветка:** `feat/workspaces`
- **Связано:** F14 (ADR 0008), F15 (ADR 0009), F16 (ADR 0010), F17 (ADR 0011) — все чинили СИМПТОМ этого же бага; roadmap §7.18

## Контекст

Симптом «shared-пространства пропадают из сайдбара после перезапуска приложения» преследовал проект через четыре итерации (F14–F17). Консоль стабильно показывала:

```
error returned from database: (code: 2067) UNIQUE constraint failed:
  workspace_members.workspace_id, workspace_members.user_id
Uncaught TypeError: Cannot create property '_id' on number '<N>'
```

Каждая итерация давала правдоподобную, но НЕ корневую причину:

- **F14** — неполный pull членства (двухфазный скоуп). Помогло другим симптомам, не этому.
- **F15** — `accept_invite` upsert (реактивация soft-deleted). Не помогло.
- **F16** — 2067 объявлен «порчей SQLite», добавлен авто-reset базы. **Неверный диагноз** (база не была битой).
- **F17** — uuid-mismatch reconcile: fallback-матчинг `applyCloudRowMembers` по `(workspace_id, user_id)` + переклейка uuid. Логика верна, но **на реальном Tauri не срабатывала** — по причине, вскрытой ниже.

## Корень (доказан кодом `src/lib/db.ts`)

В Tauri-режиме TaskFlow держит **две** базы:

1. **Нативная** `data.db` (`@tauri-apps/plugin-sql`) — постоянное хранилище.
2. **Зеркало** в памяти (`webDb`, sql.js) — из него идут ВСЕ синхронные чтения (`db.get`/`db.all`).

`db.run()` (db.ts) пишет **синхронно в зеркало** и **fire-and-forget в нативную** БД
(`getTauriDb().then(d => d.execute(sql, params))`). Чтения — только из зеркала.

При старте `initDb()` создаёт **пустое** зеркало и заливает в него данные из нативной
`data.db` (hydrate). Но hydrate-цикл покрывал лишь часть таблиц:
`statuses, tags, tasks, settings, task_templates, overdue_events, task_hold_periods`.
**`workspaces` и `workspace_members` в hydrate НЕ входили вообще** (подтверждено `grep`:
ни одного `SELECT * FROM workspace_members` для заливки в зеркало).

Следствие цепочки при перезапуске:

1. Зеркало стартует **пустым** по членству (в нативной `data.db` строки есть — записаны
   fire-and-forget в прошлой сессии).
2. Pull вызывает `applyCloudRowMembers`: `db.get(... WHERE uuid=?)` и fallback
   `db.get(... WHERE workspace_id=? AND user_id=?)` читают **пустое зеркало** → оба
   промахиваются (в т.ч. F17-matcher — ему нечего находить).
3. Applier уходит в `INSERT`. INSERT синхронно проходит в пустом зеркале, а
   fire-and-forget-копия уходит в нативную `data.db`, **где строка для этой
   `(ws, user)` уже есть** → **2067 UNIQUE в нативном SQLite** (отсюда формулировка
   «error returned from database», а не sql.js-ошибка).
4. `prunePhantomWorkspaces` смотрит в зеркало, не видит «живого» членства для shared-ws
   → удаляет ws → **пустой сайдбар**.

Именно поэтому баг воспроизводился **только на десктопе (Tauri)** и никогда в web-режиме
(там одна база sql.js в LocalStorage, зеркала-рассинхрона нет) — и почему все vitest-тесты
F17 были зелёными (в них один sql.js-движок), а на реальном устройстве фикс не работал.

Правило §11.3 арх-дока (введённое ещё в PR #104 после аналогичного бага с `workspace_id`)
прямо предупреждало: **любая ws-scoped таблица/колонка ОБЯЗАНА гидрироваться в `initDb()`**.
`workspaces`/`workspace_members` это правило нарушали.

## Решение

Добавить недостающую гидрацию в Tauri-ветку `initDb()` (`src/lib/db.ts`), в том же стиле,
что и для остальных таблиц:

- прочитать из нативной БД `SELECT * FROM workspaces` и `SELECT * FROM workspace_members`
  (в `try/catch` — таблицы появляются с миграции v11);
- залить их в зеркало через `INSERT OR REPLACE` по PK `id` (зеркало пусто — безопасно),
  перенося все колонки, включая `uuid`, `workspace_id`, `user_id`, `role`, `deleted_at`,
  `version`, `client_id`.

После этого при рестарте зеркало = нативная БД по членству. `applyCloudRowMembers` видит
существующую строку → идёт по `byUuid`/`byPair` (UPDATE/переклейка, F17), а НЕ `INSERT`
→ 2067 не возникает → `prunePhantomWorkspaces` видит живое членство → shared-ws остаются.

Схема БД не меняется → ERD/миграции не трогаем. Это чисто клиентский фикс инициализации.

## Почему не альтернативы

- **Делать `db.run` в Tauri по-настоящему async (await в нативную БД, читать из неё же).**
  Правильно в долгую, но это крупный рефакторинг всего синхронного стора (десятки
  вызовов), высокий риск регрессий. Отложено (см. TODO в `all()` — «make store fully
  async for Tauri»). F18 закрывает конкретный баг минимальным изменением.
- **Убрать `prunePhantomWorkspaces`.** Он нужен для чистки реально устаревших ws; удаление
  вернёт другие баги (фантомные ws после leave).
- **Оставить F16-reset как страховку.** Отвергнуто ещё в F17: сброс рабочей базы на штатном
  2067 разрушителен.

## Последствия

- Shared-ws переживают перезапуск на десктопе; 2067 на `(ws, user)` при старте исчезает.
- `TypeError: Cannot create property '_id' on number '<N>'` — вторичный шум (минифицированное
  имя, предположительно Sentry/PostgREST-обёртка над примитивом); кодом не адресуется, за
  ним наблюдаем отдельно (roadmap §7.18, follow-up).
- **Правило (усилено):** при добавлении ЛЮБОЙ новой синхронизируемой/ws-scoped таблицы —
  добавить её в hydrate-цикл `initDb()` (Tauri) И проверить `seed`/`tauriSeed`. В идеале —
  генерировать список гидрируемых таблиц из единого реестра, чтобы пропуск был невозможен
  (backlog).

## Верификация

- Новый `src/lib/db.workspaceHydrate.test.ts` гоняет РЕАЛЬНЫЙ Tauri-путь `db.ts` с
  персистентным sql.js-адаптером, переживающим «рестарт»: shared-ws + membership пишутся в
  нативную БД, после повторного `initDb()` проверяется, что зеркало содержит эти строки и
  fallback-lookup по `(ws, user)` находит серверный uuid. Тест **красный** без hydrate,
  **зелёный** с ним (red-check выполнен).
- Регресс: `db.firstWorkspaceSeed.test.ts`, `pull.twophase.test.ts`, `pull.test.ts`,
  `workspaces-sync.test.ts`, `db.corruption.test.ts` — 45/45 зелёные.
- `./node_modules/.bin/tsc --noEmit` — 0 ошибок.
