# 0008. Пространства — полный pull членства в двух скоупах + refresh сайдбара при выходе

- Статус: accepted
- Дата: 2026-07-22
- Связано: находка F14 (эпик «Пространства»), ветка `feat/workspaces`, [ADR 0005](0005-shared-workspaces.md), [ADR 0007](0007-workspace-crash-clientid-dedup.md); только клиент, БЕЗ миграций

## Контекст

Три симптома одной подсистемы — двухфазного pull членства (`src/lib/sync/pull.ts`)
и обработчика выхода из пространства (`src/store/useStore.ts::removeWorkspaceMember`).
Диагностика: код-анализ + прод-пробы под ROLLBACK на `sejpmzrmtgcvevukggkx` (RLS
членства) + детерминированные vitest-репро.

- **Симптом 1 — участники shared не видны (owner/editor видит только себя).**
  `WORKSPACE_MEMBERS_SPEC.pullScope='user_id'` → Phase 1 pull делал `.eq('user_id', me)`,
  т.е. тянул ТОЛЬКО свою строку членства. Строки со-участников того же ws (owner
  или другой editor) до текущего пользователя не доходили → `MembersTab` рисовал
  из локальной `workspace_members` только «вас». Прод-проба под ROLLBACK
  подтвердила: RLS SELECT-политика `sync_workspace_members_select_ws_role`
  (`has_workspace_role(ws, uid, 'viewer') OR user_id=uid OR is_workspace_bootstrap(...)`)
  под JWT участника ws отдаёт ВСЕ строки членства этого ws (VISIBLE=2 для «P0 invite
  test»). → до-тяг членства по `workspace_id IN (мои ws)` безопасен, сервер их отдаёт.

- **Симптом 3 — рестарт в том же аккаунте → shared-ws исчезают и не возвращаются.**
  Phase 1 pull членства был ИНКРЕМЕНТАЛЬНЫМ по курсору
  `sync_last_pulled_<ws>_sync_workspace_members` (`.gt(cursor)`). После первого pull
  курсор = max(updated_at) членств. При рестарте серверные членства не менялись →
  Phase 1 отдавал 0 строк → локально погашенные ранее membership-строки НИКОГДА не
  восстанавливались. `prunePhantomWorkspaces` строит allow-list из локального
  членства `user_id=me`; если оно неполно — физическим `DELETE` вычищал shared-ws.
  Возврат — только смена аккаунта (сброс курсоров через `clearUserData`).

- **Симптом 2 — приглашённый не может выйти (кнопка leave без эффекта).**
  `removeWorkspaceMember` soft-delete'ил членство + `enqueueOutbox(delete)`, но
  вызывал ТОЛЬКО `loadWorkspaceMembers()`, НЕ `loadWorkspaces()`. Сайдбар
  (`readWorkspacesFromDb`, EXISTS-фильтр `workspace_members WHERE user_id=me AND
  deleted_at IS NULL`) не перечитывался → покинутое ws оставалось в меню, пока
  `createWorkspace` не дёргал `loadWorkspaces()`. Серверный leave работал (RLS
  `sync_workspace_members_self_leave_update/delete` разрешают не-owner удалить свою
  строку).

## Решение (два точечных клиентских фикса, один PR, без DDL)

1. **A (симптомы 1 и 3) — полный pull членства в двух скоупах (`pull.ts::pullAll`).**
   Членство пуллится ПОЛНО (от epoch, ИГНОРИРУЯ сохранённый в settings курсор и НЕ
   продвигая его вперёд) в двух проходах:
   - **Проход A (вход в набор):** членство по `user_id=me`, полно. Восстанавливает
     локально погашенные/удалённые prune'ом свои строки на КАЖДОМ старте → чинит
     симптом 3.
   - Пересчёт набора `workspaceIds = listMembershipWorkspaceIds(me)` из свежего
     членства (как и раньше).
   - **Проход B (со-участники):** членство по `workspace_id IN (мои ws)`, полно.
     Даёт строки owner/других editor'ов того же ws → чинит симптом 1. RLS отдаёт
     (подтверждено прод-пробой). Реализован клоном `WORKSPACE_MEMBERS_SPEC` с
     `pullScope='workspace_id'`.

   Реализация: `pullTable` получил опцию `{ fullFrom }` — при ней курсор берётся из
   переданного значения (первый батч — epoch) и НЕ пишется обратно в settings;
   `pullSpecPaged` ведёт пагинацию полного pull IN-MEMORY (от epoch → maxCursor
   предыдущего батча), чтобы при >`PULL_BATCH_SIZE` строк не перечитывать бесконечно
   первый батч. Data-таблицы (tasks/statuses/tags/…) НЕ трогаем — они остаются
   ИНКРЕМЕНТАЛЬНЫМИ по своему per-ws курсору (полный pull данных был бы дорог;
   членство мало — полный pull дёшев).

   Восстановление надёжно по LWW: shared-членство гасит ТОЛЬКО
   `prunePhantomWorkspaces` физическим `DELETE FROM workspace_members` — строка
   исчезает целиком, значит `applyCloudRowMembers` видит `local=null` → чистый
   INSERT (LWW по `updated_at` не мешает). `dedupePersonalWorkspaces` (ADR 0007)
   трогает только `kind='personal'`, shared не затрагивает.

2. **B (симптом 2) — refresh сайдбара + переключение current при leave
   (`useStore.ts::removeWorkspaceMember`).** После soft-delete + `enqueueOutbox`
   добавлены: `loadWorkspaces()` (покинутое ws уходит по EXISTS-фильтру) и, если
   текущий пользователь покинул СВОИМ членством ТЕКУЩЕЕ пространство — переключение
   `currentWorkspaceId` на дефолт (`pickDefaultWorkspaceId`), по паттерну
   `deleteWorkspace`. Строку членства (workspace_id + user_id) захватываем ДО
   гашения, чтобы отличить leave-себя-из-текущего от remove-другого-участника
   (owner remove чужого членства сайдбар текущего пользователя не меняет).

Схема БД не менялась → миграции/ERD не нужны.

## Последствия

Плюсы: участники shared видны всем ролям; выход из пространства мгновенно обновляет
сайдбар и переключает текущее ws; shared-пространства переживают рестарт без смены
аккаунта. Всё — только клиент, без риска для прод-схемы; двухфазная модель pull
сохранена.

Минусы/риски: (1) членство теперь пуллится ПОЛНО на каждом sync — при очень большом
числе членств это дороже, но членство на пользователя мало (десятки), и in-memory
пагинация ограничивает батчи; data-таблицы остались инкрементальными. (2) Курсор
членства в settings больше не ведёт «прогресс» — это осознанно (полнота важнее
инкрементальности для входа в набор ws).

Верификация: vitest `src/lib/sync/pull.twophase.test.ts` += симптом 1 (сервер
отдаёт owner+editor членства ws, editor=`me` → обе строки локально после прохода B)
и симптом 3 (локальная membership-строка отсутствует, per-ws курсор «в будущем»,
сервер отдаёт живую строку с `updated_at` в прошлом → полный pull восстанавливает,
prune не убивает ws); `src/store/workspaces.actions.test.ts` += leave текущего ws
(сайдбар без покинутого + `currentWorkspaceId` → personal). Существующий P0-тест
двухфазного pull зелёный. `tsc -b` + `vitest` + `vite build`. Прод-проба под
ROLLBACK подтвердила видимость со-участников по `workspace_id`; прод-схема не
изменена (фикс клиентский).
