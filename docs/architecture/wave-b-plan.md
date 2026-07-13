# TaskFlow — направление «Пространства» (Workspaces): техплан Wave B (shared)

> **Рабочая ветка направления:** `feat/workspaces` (создана от `main` @ `667426e`).
> Wave B ответвляется от актуального HEAD `feat/workspaces` (после squash-мержа Wave A). Все под-этапы Wave B вливаются обратно в `feat/workspaces`; в `main` направление уходит единым merge-PR после стабилизации эпика.
> **Этот документ — план, не код.** Компаньоны: `workspaces-plan.md` (Wave A, факт), `tf_workspaces_architecture.md` (living-анализ), ADR `0005-shared-workspaces.md` (ключевое решение FK+CASCADE).

---

## 1. Цели Wave B

Продуктовые:
- Открыть **shared workspaces**: приглашения по `public_user_id` формата `TF-XXXXXX`, роли `owner / editor / viewer`, UX-раздел «Личные / Общие» в переключателе пространств.
- Индикатор роли рядом с названием общего пространства в UI (edit/view badge).

Инженерные:
- Закрыть два инварианта из PR-6 Wave A через **настоящие FK + ON DELETE CASCADE** (см. §3 и ADR 0005): `workspace_id text` без FK и отсутствие каскадного удаления детей.
- Обновить/регрессионно проверить лимиты: shared занимает слот у owner-Pro (уже реализовано в `get_workspace_limit` из PR-5 через «суммарно») — изменений логики не требуется, только регресс-подтверждение.
- Снять check-constraint `block_shared_workspaces` (иначе `kind='shared'` нельзя создать на уровне схемы).

Процессные:
- Продолжаем работу в `feat/workspaces`. В `main` не мержим до полной готовности эпика (после Wave B, либо после Wave C, если такая будет).

---

## 2. Предпосылки из Wave A (что унаследовано)

- Схема `sync_workspaces / sync_workspace_members / sync_workspace_settings` (миграция `0027`).
- Колонка `workspace_id text` в 6 sync-таблицах: `sync_tasks`, `sync_statuses`, `sync_tags`, `sync_task_templates`, `sync_overdue_events`, `sync_task_hold_periods`.
- Функция `has_workspace_role(ws, uid, min_role)` (SECURITY DEFINER, `search_path = public, pg_catalog`) + RLS-политики через неё.
- Check-constraint `block_shared_workspaces` — Wave B **снимает** его (открывает `kind='shared'` на уровне схемы).
- Тарифные лимиты (PR-5): триггер `enforce_workspace_limit` + функция `get_workspace_limit(uid, kind)`. Логика «paid = 7 суммарно» уже работает для shared без изменений (форвард-совместима, см. `workspaces-plan.md` §3.8-факт).
- Regression pgTAP (PR-6, файл `12`): 45 тестов инвариантов, которые Wave B не должен ломать.

---

## 3. Инженерная развилка: `workspace_id text` → `uuid` + FK + CASCADE

**Решение принято: добавляем настоящие FK + ON DELETE CASCADE.** Обоснование, плюсы/минусы и отвергнутые альтернативы — в [ADR 0005](../adr/0005-shared-workspaces.md). Влияние:

- **Миграция типа:** `ALTER TABLE ... ALTER COLUMN workspace_id TYPE uuid USING workspace_id::uuid;` — потребует убедиться, что все существующие значения являются валидными UUID. Backfill Wave A (PR-1) генерирует id через `gen_random_uuid()`-семантику (детерминированный `ws_<uid>`-формат, см. `workspaces-plan.md` §2.3), но перед `ALTER TYPE` нужен явный orphan/format-scan.
- **FK:** `ALTER TABLE sync_* ADD CONSTRAINT sync_*_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES sync_workspaces(id) ON DELETE CASCADE;` — для каждой из 6 sync-таблиц.
- **Members/settings:** такая же миграция для `sync_workspace_members.workspace_id` и `sync_workspace_settings.workspace_id`.
- **Влияние на sync / PUSH_ORDER:** клиент уже пушит workspaces раньше детей (Wave A PR-2, `workspaces-plan.md` §3.2 — `workspaces → workspace_members → workspace_settings → statuses → tags → tasks → ...`). FK не ломает это, но требует pgTAP-тестов на последовательность вставки.
- **Влияние на offline-first:** клиент продолжает генерить UUID в SQLite; при пуше сервер валидирует их через FK. Если child пушится раньше своего workspace — сервер отклонит его явной FK-ошибкой; workspace должен пушнуться первым, ошибка child'а безобидна и лечится ретраем в outbox-цикле.
- **Влияние на удаление:** hard DELETE workspace автоматически удаляет всех детей через CASCADE. Продукт по-прежнему использует soft delete (`deleted_at IS NOT NULL`) для UX; hard delete применяется только при окончательной очистке (workspace старше N дней после soft delete — cleanup job). Cleanup job теперь тривиален: одна строка `DELETE FROM sync_workspaces WHERE deleted_at < now() - interval '30 days'`.

---

## 4. Разбивка Wave B на PR

Строгая последовательность подветок; каждая ответвляется от предыдущей после мержа в `feat/workspaces`.

1. **`feat/ws-b-01-integrity`** — миграция FK+CASCADE для 6 sync-таблиц + `sync_workspace_members` + `sync_workspace_settings`. Регресс-тесты на удаление и integrity. Снимаем check-constraint `block_shared_workspaces` (открываем `kind='shared'` на уровне схемы; продуктово ещё закрыт до PR-3).
2. **`feat/ws-b-02-rls-roles`** — расширенные RLS-политики: `editor` может UPDATE/INSERT в задачи/статусы/теги; `viewer` — только SELECT; `owner` — всё, включая настройки/участников. Функция `has_workspace_role` уже это поддерживает — расширяем только политики.
3. **`feat/ws-b-03-invites`** — приглашения по `public_user_id TF-XXXXXX`: RPC `invite_to_workspace(ws_id, target_public_id, role)`, RPC `accept_invite(invite_id)`, таблица `sync_workspace_invites` со статусами `pending / accepted / rejected / expired`. Free-юзер получает 403, в клиенте — апселл. UI не в этом PR, только API.
4. **`feat/ws-b-04-ui-invites`** — UI: вкладка «Участники» в настройках workspace получает возможность приглашать по TF-ID, показывает список текущих участников с ролями, кнопки повышения/понижения роли (только owner), кнопку «покинуть workspace» для editor/viewer.
5. **`feat/ws-b-05-navigation`** — UX-раздел «Личные / Общие» в переключателе workspace (архитектура A уже описана в `tf_workspaces_architecture.md` §7). Индикатор роли рядом с названием общего workspace (edit/view badge).
6. **`feat/ws-b-06-hardening`** — regression pgTAP: все три роли × 6 sync-таблиц × SELECT/INSERT/UPDATE/DELETE (~72 теста); проверка лимитов с shared у paid owner'а; проверка, что free не может ни принять инвайт, ни быть приглашённым.

После всех шести — единый merge-PR `feat/workspaces → main` вместе с Wave A (если к этому моменту не будет Wave C).

---

## 5. Инварианты, которые Wave B не должен нарушить

- Все 310 pgTAP-тестов CI-списка после Wave A продолжают проходить (плюс новые тесты Wave B).
- Vitest 349+ остаётся зелёным.
- Free-user всё ещё не участвует в shared (ни как owner, ни как invitee) — pre-existing decision из PR-5.
- Лимит 7 для paid — суммарно, включая shared, где юзер owner (уже реализовано, регресс-подтвердить).

---

## 6. Открытые вопросы (для будущих обсуждений внутри Wave B)

- Presence-индикатор в UI для shared (кто сейчас смотрит workspace) — вне scope Wave B, отложено.
- Notifications на инвайты — пока UI-only, без email/push (вне scope Wave B).
- Historical audit log (кто что менял) — вне scope MVP.
