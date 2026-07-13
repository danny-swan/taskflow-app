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

### §3-факт — реализация в PR-b-01 (миграция `0030_workspace_id_fk_cascade.sql`)

**Что сделано:** FK + `ON DELETE CASCADE` навешаны на все **8** таблиц с `workspace_id` (6 sync + `sync_workspace_members` + `sync_workspace_settings`), имя `<table>_workspace_id_fkey`, `DEFERRABLE INITIALLY IMMEDIATE`. Перед навешиванием — data-audit (orphan-scan по 8 таблицам; при находке миграция падает с `foreign_key_violation` и отчётом «сколько/где», orphan'ы **не** удаляются автоматически). Снят guard `block_shared_workspaces` (в 0027 это **триггер + функция**, а не check-constraint — сняты оба), `kind='shared'` открыт на уровне схемы (продуктово закрыт до PR-b-03/04; для free упирается в тарифный лимит `shared`=0).

**РАСХОЖДЕНИЕ С ПЛАНОМ — `workspace_id` остаётся `text`, НЕ переводится в `uuid`.** Пункт про `ALTER COLUMN ... TYPE uuid USING workspace_id::uuid` (§3 выше) **невыполним** без ломающего клиентского изменения: `sync_workspaces.id` — это `text` PK формата `ws_<hex>` (0027; `ws_` + uid без дефисов для personal, `ws_` + uuidv7-hex для новых — см. `src/store/useStore.ts` `createWorkspace` и `src/lib/migrations.ts` v11), а `'ws_...'::uuid` → `ERROR invalid input syntax for uuid`. Клиент и сервер обязаны генерировать **идентичный** id для склейки personal-ws по PK при первом sync (0027; `workspaces-plan.md` §2.3) — смена формата на uuid сломала бы офлайн-first дедуп. FK+CASCADE полностью валидны на `text→text` PK, суть ADR 0005 п.5 (референсная целостность + каскад, orphan'ы физически невозможны, тривиальный cleanup) достигнута без смены типа. Реальный переход на uuid (снятие префикса `ws_` синхронно на клиенте+сервере) — отдельная скоординированная работа вне scope PR-b-01. Поэтому pgTAP 13 ассертит `text`, а не `uuid` (группа C).

**Влияние на sync (реализовано):** SQLSTATE `23503` (foreign_key_violation) в outbox-ретрае классифицирован как **транзиентная** ошибка (не permanent) — child, пушнутый раньше своего workspace, ретраится, а не помечается исчерпавшим попытки (`src/lib/sync/push.ts`: `isPermanentError` без 23503 + новый `isForeignKeyViolation`; тесты в `dev5.test.ts`). `PUSH_ORDER` (parent-first) уже гарантирует правильный порядок, `DEFERRABLE` — задел на возможную единую транзакцию push'а.

### §4.2-факт — реализация в PR-b-02 (миграция `0031_workspace_rls_roles.sql`)

**Что сделано:** ролевые RLS-политики на 8 workspace-таблицах приведены к единой предсказуемой схеме имён `<table>_<op>_ws_role` (было `<table>_ws_<op>` из 0027), каждой политике добавлен `COMMENT ON POLICY`. 0031 — единственный источник правды по ролевым RLS этих таблиц (идемпотентно дропает и старые 0027-имена, и новые). Модель доступа: 6 sync-таблиц — SELECT→viewer, INSERT/UPDATE/DELETE→editor; `sync_workspace_members` — SELECT→viewer, INSERT→owner|bootstrap, UPDATE/DELETE→owner + self-leave не-owner'а; `sync_workspace_settings` — SELECT→viewer, запись→owner.

**РАСХОЖДЕНИЕ С ПЛАНОМ — почти всё уже было в Wave A; чистое поведенческое изменение ровно одно.** Аудит показал, что фундамент 0027 уже выразил доступ к 8 таблицам через `has_workspace_role`, а 0028 уже добавил self-leave не-owner'а и триггер `assert_at_least_one_owner` (защита последнего owner'a). Поэтому 0031 — это в основном **кодификация** (переименование в единую схему + COMMENT), а не введение новых прав. Единственное реальное изменение поведения: **`sync_statuses` writes owner→editor** — в 0027 запись статусов была owner-only («критичная настройка»), план §4.2 явно ставит статусы в один ряд с задачами/тегами → editor теперь может INSERT/UPDATE/DELETE статусы. Защита последнего owner'a **не дублируется** в 0031 — остаётся на триггере `assert_at_least_one_owner` (0028), единый источник (design invariant). Self-leave политики 0028 пересозданы под теми же именами, чтобы весь ролевой контур `members` лежал в одном файле.

**Тесты:** pgTAP `14_workspace_rls_roles_test.sql` (plan 103) — трёхролевая матрица (owner/editor/viewer) внутри одного shared-ws + outsider + last-owner. `sync_overdue_events` исключён из UPDATE-подматрицы: у таблицы pre-existing триггер `trg_set_updated_at` (0005), обращающийся к `NEW.updated_at`, при отсутствии такой колонки (0002) — любой UPDATE падает независимо от RLS (append-only де-факто). Это pre-existing quirk, вне scope PR-b-02.

### §4.3-факт — реализация в PR-b-03 (миграция `0032_workspace_invites.sql`)

**Что сделано:** API приглашений в shared-пространства (backend-only, без UI).

- **Обратный лукап `lookup_user_by_public_id(text) → uuid`** (`STABLE SECURITY DEFINER`, `search_path = public, pg_catalog`). В 0026 `public_user_id` (формат `TF-XXXXXX`) живёт в `public.profiles` (UNIQUE), forward-сторону читает клиент (`src/lib/profile.ts`), а обратной функции не было. Заводим минимальную: по TF-ID отдаёт internal `auth.uid()` (`profiles.id == auth.users.id`) или NULL. `EXECUTE` отозван у `anon/authenticated/public` — функция вызывается только внутри `invite_to_workspace`, не как самостоятельный REST-RPC.
- **Таблица `sync_workspace_invites`** — серверная (НЕ sync-таблица клиента, не участвует в outbox/pull): `id` (`inv_<hex>`), `workspace_id` (FK `sync_workspaces` `ON DELETE CASCADE`), `inviter_user_id` (FK `auth.users` `ON DELETE CASCADE`), `target_public_user_id text`, `target_user_id` (FK `auth.users` `ON DELETE SET NULL`), `role ∈ (editor, viewer)`, `status ∈ (pending, accepted, rejected, expired, cancelled)`, `expires_at` (default `now()+7d`), `created_at/updated_at/accepted_at`. Частичный UNIQUE `(workspace_id, target_user_id) WHERE status='pending'` (идемпотентность), плюс индексы для listInvites приглашённого и owner'а. `set_updated_at`-триггер (0005).
- **RLS:** `enable`. `invites_select_ws_role` — приглашённый видит свои инвайты (`target_user_id = auth.uid()`) ИЛИ owner видит все инвайты своего ws (`has_workspace_role(..., 'owner')`). `invites_insert_deny` / `invites_update_deny` / `invites_delete_deny` — `USING/ WITH CHECK false`: любая мутация только через SECURITY DEFINER RPC. `authenticated` получает GRANT только `SELECT` (I/U/D не выдаём — прямой DML падает 42501 ещё на уровне привилегий).
- **4 клиентских RPC + 1 сервисный** (все `SECURITY DEFINER`, `SET search_path = public`, `EXECUTE` для `authenticated`): `invite_to_workspace(ws, target_public_id, role)` (owner-only; role editor/viewer; target существует/не self/не участник/**на платном тарифе**; идемпотентно возвращает существующий pending), `accept_invite(invite_id)` (target-only, pending, не истёк, **re-check тарифного лимита shared принимающего** → атомарно invite→accepted + INSERT членства), `reject_invite(invite_id)` (target→rejected), `cancel_invite(invite_id)` (owner→cancelled). Плюс `expire_invites()` (cron-friendly, `EXECUTE` только `service_role`).

**РАСХОЖДЕНИЯ С ПЛАНОМ:**
- Добавлена **не заявленная в плане** helper-функция `lookup_user_by_public_id` — обратный лукап отсутствовал в 0026, а приглашение по публичному TF-ID без него невозможно. Область видимости максимально сужена (revoke execute у всех, вызов только из `invite_to_workspace`).
- Статус `cancelled` добавлен к заявленным в §4 `pending/accepted/rejected/expired` (owner отзывает свой pending-инвайт) — естественное дополнение жизненного цикла.
- `accept_invite` считает **активные членства принимающего** (`sync_workspace_members`) против `get_workspace_limit(uid,'shared')` (0029): free = 0 → free физически не может принять инвайт (двойная защита: pre-check на invite + re-check на accept). Слот shared занимает каждый участник, не только owner.
- FK: `inviter_user_id` → `ON DELETE CASCADE` (инвайты пропавшего пригласителя не нужны), `target_user_id` → `ON DELETE SET NULL` (nullable, если приглашённый удалён). Это добавило **9-й** `workspace_id→sync_workspaces` FK с CASCADE; инвариант 0030 в `13_workspace_id_integrity_test.sql` про **8 клиентских** workspace-таблиц — счётчик B1/B2 явно исключает `sync_workspace_invites` (серверная таблица, FK не DEFERRABLE), чтобы ассерт «ровно 8» остался точным.

**Тесты:** pgTAP `15_workspace_invites_test.sql` (plan 48) — группы A (схема/грант/RLS-enabled), B (invite: happy + owner-only/role/self/member/free-target/идемпотентность), C (accept: happy + лимит/not-target/re-status/expired/cancelled/no-auth), D (reject), E (cancel: owner-only), F (RLS видимость + прямой DML deny), G (FK CASCADE по workspace и inviter). Добавлен в CI-список `db-tests.yml`. Общий CI-прогон: **492** pgTAP-теста (14 файлов) зелёные.

### §4.4-факт — реализация в PR-b-04 (`feat/ws-b-04-ui-invites`)

**Что сделано:** клиентский UI приглашений поверх RPC из 0032 (0 DDL, backend не тронут).

- **Сервисный слой `src/lib/invites.ts`** — тонкие обёртки над 4 RPC (`invite_to_workspace` / `accept_invite` / `reject_invite` / `cancel_invite`) + два SELECT-списка (`listMyPendingInvites` мои входящие, `listWorkspaceInvites` pending пространства для owner). PostgREST-ошибка (SQLSTATE `code` + текст) мапится в типизированный `InviteRpcError` c `InviteErrorCode`, чтобы UI показывал переведённое сообщение по коду, а не сырой текст из БД. TF-ID нормализуется (`trim().toUpperCase()`).
- **Стор `src/store/useInvitesStore.ts`** — ОТДЕЛЬНЫЙ zustand-стор (не часть оффлайн-first `useStore`): инвайты живут только на сервере (`sync_workspace_invites` вне SQLite-зеркала/outbox). После `accept` дёргается `syncNow()` (lazy import) + перечитываются `workspaces`/`workspaceMembers` из локальной БД, чтобы новое членство/пространство подтянулось.
- **`MembersTab.tsx`** (заменил Wave-A `WorkspaceMembers.tsx`, прямой add по TF-ID теперь закрыт RLS) — вкладка «Участники» в `WorkspaceSettings`. Ролевой гейт: owner видит «Пригласить» (`InviteMemberModal`), promote/demote/remove и секцию «Приглашения» (pending + «Отозвать»); editor/viewer — только список ролей + «Покинуть пространство».
- **`InviteMemberModal.tsx`** — ввод TF-ID (валидация `PUBLIC_ID_RE`) + селектор роли (editor/viewer, default editor). Все коды ошибок RPC отображаются переведённым текстом (`inviteErrorKey`).
- **`MyInvitesSection.tsx`** — секция «Мои приглашения» в сайдбаре (после `WorkspaceSwitcher`), гейт по `boundUserId` + бейдж-счётчик. Accept защищён лимит-гардом (`limit_exceeded` → тарифный тост, без переключения), при успехе — `switchWorkspace`. Имя пространства с бэкенда приглашённому недоступно (ещё не член ws) → нейтральный заголовок «Приглашение в общее пространство» (approach 5.b, без backend-правок).
- **i18n:** добавлены ключи `ws_members_*` / `ws_invites_*` / `ws_invite_*` / `ws_my_invites_*` в `ru` и `en`.

**РАСХОЖДЕНИЯ С ПЛАНОМ:**
- **Кнопки повышения/понижения роли реализованы как отдельные иконки-действия** (стрелка вверх «Сделать редактором» / вниз «Сделать наблюдателем»), а не как `select` (как в Wave-A `WorkspaceMembers`) — чище отражает ролевой гейт «только owner».
- **Экран «Мои приглашения» реализован как секция сайдбара, а не отдельный роут** — приглашения актуальны в любом контексте, сайдбар-бейдж заметнее и не требует нового пункта навигации.
- **E2E happy-path помечен `test.fixme`** (`e2e/workspace-invites.spec.ts`): локальный харнесс (`?e2e=1`, sql.js, БЕЗ бэкенда, один free-юзер) физически не может проиграть приглашение (инвайты только серверные, нужны 2 пользователя + реальный Supabase + shared-ws). Хак с прямой записью фикстуры сознательно не написан. Оставлен smoke-тест «нет входящих → секция скрыта». В этом окружении даже baseline-спеки (`workspace-management`) не поднимают app-shell — Playwright-прогон невозможен в песочнице; продукт покрыт unit/RTL.
- **Осиротевшие i18n-ключи Wave A** (`ws_members_add` / `ws_members_tfid_placeholder` / `ws_members_added` / `ws_members_not_found`) оставлены в словаре (безвредны, `findUserByPublicId` ещё используется профилем) — удаление вне scope.

**Тесты (клиент, `npm test`):** `src/lib/invites.test.ts` (22) — контракт RPC + маппинг всех кодов ошибок; `InviteMemberModal.test.tsx` (14), `MembersTab.test.tsx` (9), `MyInvitesSection.test.tsx` (6) — ролевые гейты, валидация, accept/reject/limit-гард, перевод ошибок.

### §4.5-факт — реализация в PR-b-05 (`feat/ws-b-05-navigation`)

**Что сделано:** UX-раздел «Личные / Общие» в переключателе пространств (архитектура A из `tf_workspaces_architecture.md` §7). Чистый клиентский UI, **0 DDL**, backend не тронут.

- **Вынос компонента:** приватный `WorkspaceSwitcher` извлечён из `Sidebar.tsx` в отдельный файл `src/components/WorkspaceSwitcher.tsx` (для тестируемости; `Sidebar` теперь его импортирует). Разметка/дизайн дропдауна сохранены 1:1.
- **Сплит секций:** список делится по `kind` на «Личные» (`kind==='personal'`) и «Общие» (`kind!=='personal'`). Обе секции рендерятся всегда (в отличие от Wave-A, где «Общие» показывались только при непустом списке) — чтобы было место под пустое состояние. Заголовки на новых ключах `ws_switcher_section_personal/shared`.
- **Role-badge:** у shared-пространств рядом с названием — маленький бейдж роли текущего пользователя: `editor` → «Редактор» (иконка карандаша), `viewer` → «Наблюдатель» (иконка глаза). Owner (shared) и все personal — **без бейджа** (подразумевается по умолчанию). Роль на каждое пространство считает новый хук `useWorkspaceRoles()` в `workspaceScope.ts` (карта `{wsId: role|null}`; логика на ws совпадает с `useCurrentWorkspaceRole`: personal/`ws_local` → owner, shared → строка членства из локального зеркала `workspace_members` по `boundUserId`).
- **Сортировка:** внутри каждой секции активное (текущее) пространство — первым, остальные — по алфавиту (`localeCompare`). Отдельного поля `last_used_at`/`last_opened_at` на `Workspace` НЕТ (есть только `sort_order`), поэтому сортировка алфавитная — как и допускал бриф.
- **Пустое состояние «Общие»:** при 0 shared-пространств под заголовком «Общие» показывается hint (`ws_switcher_shared_empty_hint`) с собственным TF-ID пользователя (`{tfid}` подставляется из `useProfile(auth.user.id).profile.public_user_id`; до загрузки профиля — плейсхолдер `TF-……`).
- **i18n:** добавлены `ws_switcher_section_personal/shared`, `ws_switcher_role_editor/viewer`, `ws_switcher_shared_empty_hint` в `ru` и `en`.

**РЕШЕНИЕ по индикатору pending-инвайтов (§5 брифа):** выбран **безопасный вариант 5.b — НЕ добавлять новый индикатор** рядом с заголовком «Общие». Единственное место отображения входящих приглашений остаётся `MyInvitesSection` (PR-b-04) в том же сайдбаре. Причина: собственный счётчик у «Общие» дублировал бы одно и то же состояние (`useInvitesStore().myPending`) в двух местах сайдбара — визуальный шум и риск рассинхрона. `MyInvitesSection` смонтирован сразу под `WorkspaceSwitcher`, так что связь «новое приглашение → раздел общих пространств» и так очевидна пространственно.

**РАСХОЖДЕНИЯ С ПЛАНОМ:** нет (scope выполнен как описано; read-only UI-polish для viewer и правки `MembersTab`/`InviteMemberModal` сознательно вне scope).

**Тесты (клиент, `npm test`):** `src/components/WorkspaceSwitcher.test.tsx` (6) — сплит по kind + `switchWorkspace` по клику, role-badge (editor/viewer есть, shared-owner/personal нет), пустое состояние «Общие» с TF-ID (+ плейсхолдер без профиля), сортировка (активный первым, остальные по алфавиту).

---

### §4.6-факт — реализация в PR-b-06 (`feat/ws-b-06-hardening`)

**Что сделано:** финальный regression-hardening. Чисто backend/тестовый PR (UI-компоненты не тронуты).

- **Фикс quirk'а `sync_overdue_events` (миграция `0033`):** любой `UPDATE` строки падал с `record "new" has no field "updated_at"`. Причина: `set_updated_at()` (0005) выполняет `NEW.updated_at = now()`, а триггер `trg_set_updated_at` был ОШИБОЧНО навешен 0005 (строки 45-48) на `sync_overdue_events` — append-only таблицу, у которой по дизайну (0002 §8) НЕТ ни `updated_at`, ни `version`.
  - **Выбран Вариант B (снять триггер), а не Вариант A (добавить колонку).** `sync_overdue_events` — принципиально append-only лог: клиентский sync-слой это фиксирует (`mappers.ts` `CloudOverdueEventPayload` без `updated_at/version`; `pull.ts` — курсор по `id`, не по `updated_at`; LWW идёт по монотонному uuidv7-`id`). Добавление `updated_at` рассинхронизировало бы облачную схему с клиентскими типами и семантикой курсора без пользы. Правильный фикс — убрать триггер, которого там быть не должно.
  - **Это была ЖИВАЯ прод-проблема, не только тестовый артефакт:** push-слой (`push.ts`) отправляет и upsert, и soft-delete через `.upsert(onConflict:'id')`; повторный push/soft-delete уже существующего в облаке overdue-события превращался в `UPDATE-on-conflict` и падал на этом же триггере. `0033` идемпотентна (`DROP TRIGGER IF EXISTS`), на прод не применяется до релиза эпика.
- **pgTAP `14` (RLS роли):** снято исключение `sync_overdue_events` из UPDATE-подматрицы. Добавлены 3 теста (viewer no-op / editor / owner UPDATE по `event_date`), `plan(103)→plan(106)`. Теперь матрица полная: 3 роли × 6 sync-таблиц × 4 операции без пропусков.
- **pgTAP `16` (новый, `16_workspace_regression_test.sql`, `plan(19)`):** пересечения инвариантов, не покрытые поштучно в 11-15:
  - **A (8):** hard-delete shared-ws каскадит ВЕСЬ граф разом (дети в двух sync-таблицах + members + invites + settings → 0), соседний ws другого владельца не тронут.
  - **B (4):** owner делает self-leave при наличии второго owner'а; созданный им pending-инвайт выживает (`inviter_user_id` FK → `auth.users`, не members), а ex-owner мгновенно теряет SELECT-видимость данных ws (RLS следует за членством).
  - **C (3):** `target_user_id ON DELETE SET NULL` не ломает инвайт (строка выживает, `target_user_id` обнулён, owner всё ещё может `cancel_invite`).
  - **D (2):** free-регрессия side-by-side — free нельзя ни пригласить (invite-path, зеркалит 15/B4), ни принять инвайт (accept-path, лимит shared=0).
  - **E (2):** shared-пространство занимает слот в общем пуле владельца (микс 3 personal + 4 shared = 7 → 8-е любого kind → `P0001`).
- **CI:** `16_workspace_regression_test.sql` добавлен в pg_prove-список `.github/workflows/db-tests.yml`.

**РАСХОЖДЕНИЯ С ПЛАНОМ:** нет. Дедупликация: editor/viewer invite-denial (план п.3) уже покрыты 15/B9-B10 — не дублировались; invite-path free-denial уже в 15/B4 — в `16`/D оставлен рядом с accept-path'ом только ради явной side-by-side пары, как просил бриф.

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

---

## 7. Wave B — ИТОГ

Wave B завершена. Все шесть под-PR реализованы в ветке `feat/workspaces`; `main` не тронут (единый merge-PR `feat/workspaces → main` — после решения релизить эпик).

| PR | Ветка | Суть | DDL |
|----|-------|------|-----|
| b-01 | `feat/ws-b-01-integrity` | FK+CASCADE на 8 таблиц; снят `block_shared_workspaces` | `0030` |
| b-02 | `feat/ws-b-02-rls-roles` | Ролевые RLS-политики (owner/editor/viewer) на 6 sync-таблиц + members/settings | `0031` |
| b-03 | `feat/ws-b-03-invites` | Таблица `sync_workspace_invites` + 4 RPC (invite/accept/reject/cancel) + `expire_invites` | `0032` |
| b-04 | `feat/ws-b-04-ui-invites` | UI вкладки «Участники» + `MyInvitesSection` (приглашение по TF-ID, роли, leave) | 0 |
| b-05 | `feat/ws-b-05-navigation` | UX-раздел «Личные / Общие» + role-badge в `WorkspaceSwitcher` | 0 |
| b-06 | `feat/ws-b-06-hardening` | Фикс quirk'а `sync_overdue_events` (`0033`); regression pgTAP `14`(+3)/`16`(нов.) | `0033` |
| doc | — | Обновление `wave-b-plan.md` / `roadmap.md` (закрытие Wave B) | 0 |

**Финальные тесты:**
- **pgTAP (CI-список, 15 файлов): 514 тестов, все зелёные.** Прибавка Wave B к базе: `12`(45) + `13`(31) + `14`(106) + `15`(48) + `16`(19). Файл `14` вырос 103→106 (снято исключение `sync_overdue_events` в UPDATE), `16` — новый.
- **Vitest** и **`tsc -b` + `vite build`** — зелёные (клиентский код Wave B не менялся в b-06).

**Ключевое из b-06:** обнаружен и починен ЖИВОЙ прод-баг (не только тестовый) — ошибочный `trg_set_updated_at` на append-only `sync_overdue_events` ронял любой `UPDATE`/повторный push/soft-delete. Снят миграцией `0033` (Вариант B), т.к. таблица append-only по дизайну и на клиенте, и в облаке.
