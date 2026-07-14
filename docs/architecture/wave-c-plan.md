# Wave C — план и хроника

Wave C надстраивается над полностью смёрженной Wave B (shared workspaces: роли,
инвайты, RLS). Базовая ветка волны — `feat/workspaces`. Каждый PR добавляет свой
раздел в этот файл.

## Обзор Wave C

Третий этап многопространственной модели — полировка совместной работы поверх
уже открытых shared-пространств Wave B. Волна разбита на 6 последовательных
под-PR (каждый ответвляется от предыдущего после мержа в `feat/workspaces`):

| PR | Тема | Merge-commit |
|----|------|--------------|
| #88 | c-01 Presence («кто онлайн») | `37f8010` |
| #89 | c-02 Invite pin (индикатор непринятых приглашений) | `22a6be1` |
| #90 | c-03 Historical audit log (журнал изменений задачи) | `8f7d836` |
| #91 | c-04 Workspace history tab (общий лог пространства) | `d1e0013` |
| #92 | c-05 Viewer polish (read-only UX) | `3b5f36e` |
| #93 | c-06 pgTAP техдолг (возврат теста 10 в CI) | `33463a7` |

**Что вошло:** живой presence-индикатор в shared-пространствах; внутриприложенческий
пин непринятых приглашений; неподделываемый серверный журнал изменений задач
(миграция 0034, единственная DDL волны) с UI в модалке задачи и отдельной вкладкой
«История» в настройках пространства; сплошная read-only-полировка UX для роли
viewer; закрытие давнего техдолга с pgTAP-тестом `10_workspace_management_test.sql`.

**Что сознательно НЕ вошло** (перенесено на будущие волны): per-task курсоры и
per-field merge для совместного редактирования (LWW остаётся моделью MVP);
email/push-уведомления о приглашениях (осознанный отказ пользователя); экспорт
лога (CSV/JSON) и diff-детализация payload «было → стало»; кросс-workspace поиск
и кастомные роли (см. `roadmap.md` §7.7).

**Единственная миграция волны — `0034` (audit log, PR-c-03).** Остальные пять PR
не трогали БД/RLS (0 DDL): presence эфемерен (client-to-client через Realtime),
invite-pin и viewer-polish — чистый клиент, history-tab переиспользует данные
0034, pgTAP-фикс правит только тест и CI.

---

## 1. PR-c-01: Presence («кто сейчас онлайн» в shared-пространстве)

### Что делаем

Живой индикатор присутствия для **общих** пространств: ряд аватарок тех, кто
прямо сейчас открыл то же shared-пространство. Наведение показывает `nickname`
(или публичный `TF-XXXXXX`, если ник не задан). Индикатор живёт в шапке
`Dashboard.tsx`.

### Почему Realtime Presence API, а не postgres_changes

Существующий `src/lib/sync/realtime.ts` слушает `postgres_changes` на sync-
таблицах и триггерит debounced pull — это про **данные**. Presence — про
**эфемерное состояние** «кто в канале сейчас», которого нет и не должно быть в
БД:

- **0 backend/DDL.** Presence — client-to-client через Realtime-сервер Supabase
  (`channel.track()` + события `presence` sync/join/leave). Новых таблиц,
  миграций и RLS не требуется.
- **Эфемерность.** Присутствие не переживает закрытие вкладки и не должно
  попадать в SQLite/outbox/sync-цикл. Поэтому состояние держим в отдельном
  эфемерном сторе `usePresenceStore` (Zustand, вне оффлайн-first `useStore`).
- **Тот же транспорт.** Канал создаётся тем же `supabase.channel(...)`, но с
  `config.presence.key = userId` — сервер группирует метаданные по пользователю
  (несколько вкладок одного юзера → один ключ).

### Архитектура

- `src/store/usePresenceStore.ts` — эфемерный стор: карта `userId → PresenceMember`
  (`{ userId, nickname, avatarVariant, publicUserId }`), плюс `workspaceId`
  активного канала. Действия `syncFrom` (полный снимок из события `sync`),
  `join`, `leave`, `clear`. Список НЕ включает самого пользователя (фильтрация
  в `presence.ts` до записи в стор).
- `src/lib/presence.ts`:
  - `subscribeWorkspacePresence(workspaceId, profile)` — поднимает канал
    `presence-ws-<id>`, на `SUBSCRIBED` трекает публичный meta, слушает
    sync/join/leave, возвращает unsubscribe. `sync` пересобирает список целиком
    из `presenceState()` (авторитетный снимок), `join`/`leave` — точечные
    диффы. Unsubscribe делает `channel.untrack()` + `supabase.removeChannel()` +
    `store.clear()`, иначе «призрачные» юзеры висят до heartbeat-таймаута
    сервера.
  - `useWorkspacePresence()` — хук жизненного цикла: канал поднимается **только**
    когда текущее пространство `kind === 'shared'` и известны `boundUserId` +
    профиль; переподключается при смене `currentWorkspaceId` (симметрично
    `resubscribeRealtime`); снимает подписку при уходе с shared/размонтаже. На
    personal канал не поднимается вообще.
- `src/components/PresenceIndicator.tsx` — чисто презентационный: читает
  `usePresenceStore`, рендерит до 5 аватарок (переиспуется общий `Avatar` по
  `avatar_variant`), при переполнении — бейдж «+N». Возвращает `null` на
  personal и при пустом списке. Встроен в шапку `Dashboard.tsx`.

### Приватность: почему никогда не email

В presence-meta уходит только публичный минимум профиля — `nickname`,
`avatar_variant`, `public_user_id`. **Email не трекается и нигде в presence-UI
не показывается.** Подпись аватарки — непустой `nickname`, иначе публичный
`TF-XXXXXX` (он уже человекочитаемый идентификатор, перевод не нужен). Это тот же
принцип, что в Wave B (`MembersTab` показывает чужих участников без email из-за
own-row RLS на профилях).

### Сознательно вне scope

- **Курсоры / «кто редактирует именно эту карточку».** Только уровень «кто в
  пространстве онлайн», без per-task гранулярности — это отдельная, более
  дорогая история (частые track-апдейты на каждое движение).
- **Presence на personal-пространстве.** Там гарантированно один человек —
  лишний Realtime-канал не нужен.
- **Backend/DDL.** См. выше — Presence этого не требует.

### Тесты

- `usePresenceStore.test.ts` — join/leave/sync/clear, дедуп по userId.
- `presence.test.ts` — создание канала, track на SUBSCRIBED (без email),
  обработка sync/join/leave с исключением себя, очистка на unsubscribe
  (Realtime channel замокан).
- `PresenceIndicator.test.tsx` — N аватарок, «+N» при переполнении, тултип
  nickname/fallback TF-ID, скрытие на personal и при пустом списке.

### i18n

- `ws_presence_aria` (ru+en) — aria-label ряда аватарок. Fallback-подписи не
  требуют перевода (`public_user_id` — уже строка `TF-XXXXXX`).

---

## 2. PR-c-02: Invite pin (индикатор непринятых приглашений)

### Что делаем

Визуальный «unread pin» на непринятые приглашения текущего пользователя:

- `count === 1` → красная точка без числа (классический unread-dot);
- `count >= 2` → красный бейдж с числом, при `count > 99` показываем «99+»;
- `count === 0` → ничего (компонент возвращает `null`).

### Почему всё внутри приложения (без email/push)

Пользователь **явно отказался** от email- и push-уведомлений о новых
приглашениях — только внутриприложенческий индикатор. Это осознанный выбор
минимального disruption: приглашения и так видны в сайдбаре, пину достаточно
подсветить их наличие, не выводя пользователя из приложения и не требуя новых
внешних каналов доставки. **0 backend/DDL** — данные берутся из уже
существующего стора.

### Где размещён пин

Сайдбар всегда развёрнут (фиксированные 220px, без collapsed-режима —
`Sidebar.tsx`), а `MyInvitesSection` (PR-b-04) рендерится ровно тогда, когда есть
входящие pending-инвайты, и уже был единственной точкой их отображения. Поэтому
пин размещён в **одном** месте — в заголовке `MyInvitesSection`, наложенным
(`absolute`, top-right) поверх иконки `Mail`. Прежний плоский счётчик-span в
заголовке заменён этим пином (единый источник рендера бейджа, без дублирования
числа). В `WorkspaceSwitcher` пин намеренно не добавляется — переключение
пространств и входящие приглашения — разные концепции (то же решение, что в
PR-b-05).

### Источник данных

Переиспользуется существующий селектор `useInvitesStore(s => s.myPending)`
(PR-b-04) — реактивный список входящих pending текущего юзера. Пину передаётся
`myPending.length` пропсом; сам `InvitePinBadge` презентационный и стор не
читает (кроме `language` для aria-label).

### Архитектура

- `src/components/InvitePinBadge.tsx` — презентационный компонент. Пропсы
  `count: number` и опциональный `className`. Пороги 0/1/2+/99+, `absolute`
  top-right, красный (`var(--error,#c33)`) с `ring` под цвет сайдбара
  (`var(--surface)`) для контраста. `role="status"` + `aria-label` с реальным
  числом (не «99+»).
- Интеграция — минимальный diff в `MyInvitesSection.tsx`: иконка `Mail`
  обёрнута в `relative`-контейнер, поверх — `<InvitePinBadge count={myPending.length} />`.

### Сознательно вне scope

- Email/push-уведомления — отказ пользователя (см. выше).
- Backend/DDL/миграции — 0 изменений.
- Логика приглашений (accept/reject/expire) — не трогается, только индикатор.
- Звуки, тост-нотификации на новый инвайт — только визуальный пин.

### Тесты

- `InvitePinBadge.test.tsx` — пороги: 0 → null, 1 → точка без числа, 2 → «2»,
  100 → «99+», aria-label содержит настоящее число.
- `MyInvitesSection.test.tsx` — пин отрисован при pending ≥ 1 (с корректным
  aria-label) и отсутствует при пустом списке.

### i18n

- `ws_invite_pin_aria` (ru+en) — aria-label пина с плейсхолдером `{count}`
  («Неотвеченных приглашений: {count}» / «{count} pending invites»). Плейсхолдер
  подставляется через `.replace('{count}', …)` — тот же single-brace паттерн,
  что и у `ws_my_invites_expires_in`.

---

## 3. PR-c-03: Historical audit log (журнал изменений задачи)

### Что делаем

Историю значимых изменений задачи в **shared**-пространстве: сворачиваемая секция
«История изменений» внизу модалки задачи (`TaskModal`). По записи на событие —
аватар автора, локализованный текст действия, относительное время. По умолчанию
свёрнута, пагинация «Показать ещё» по 20 записей. Для personal-пространств секция
не рендерится вовсе.

### Почему серверный триггер, а не клиентский INSERT

Журнал должен быть **надёжным и неподделываемым**: клиент не может пропустить,
переписать или подделать запись. Поэтому лог пишет исключительно серверный
`SECURITY DEFINER`-триггер `log_task_activity()` на `sync_tasks` (миграция 0034),
а не клиентский код:

- **Триггерная фильтрация только по shared.** Функция логирует изменение лишь
  когда пространство задачи `kind='shared'` (personal — пропуск). Гейт на сервере,
  клиент не участвует.
- **Immutable append-only.** RLS даёт членам пространства только `SELECT` (через
  `has_workspace_role(..., 'viewer')`); `INSERT/UPDATE/DELETE` для роли
  `authenticated` запрещены deny-политиками. Пишет строки лишь сама триггер-функция
  (обходит insert-deny за счёт `SECURITY DEFINER`). Клиент журнал **только читает**.
- **FK только на workspace_id (CASCADE), не на task_id.** Задачу можно
  soft-delete/hard-delete, но её история должна пережить это (лог самодостаточен:
  хранит task uuid, автора и payload). Каскад по workspace_id чистит журнал при
  удалении пространства.

### Приоритет событий (одно изменение = одна запись)

Триггер на `UPDATE`/`INSERT` определяет **один** тип события по цепочке
приоритетов (сверху вниз, первое совпадение выигрывает): `deleted` → `restored`
→ `status_changed` → `deadline_changed` → `tag_added`/`tag_removed` →
`title_changed` → `description_changed`; `INSERT` → `created`. Так «переставил
статус и заодно поправил заголовок» не плодит две строки — фиксируется наиболее
значимое действие.

### Клиентская интеграция (pull-only)

- **Realtime.** `sync_task_activity_log` добавлена в `WATCHED_TABLES`
  (`realtime.ts`) — новые записи прилетают debounced-пуллом, как остальные
  sync-таблицы.
- **Pull.** Отдельный `PULL_ORDER = [...PUSH_ORDER, ACTIVITY_LOG_SPEC]`
  (`mappers.ts`): лог тянется, но **никогда не пушится** (`toCloud` кидает —
  спека pull-only, в outbox не попадает; `getSpec` ищет только в `PUSH_ORDER`).
  Аппликатор `applyCloudRowActivityLog` (`pull.ts`) — INSERT-only, immutable:
  если строка с таким uuid уже есть, пропускает (лог не переписывается). Курсор
  пагинации пула — `created_at` (append-only, `updated_at` отсутствует).
- **Локальное зеркало.** Миграция SQLite v13 (`migrations.ts`) создаёт
  `task_activity_log` (int id + серверный uuid + task uuid как строка,
  workspace_id, user_id, kind, payload TEXT, created_at) + индексы
  `(task_id, created_at DESC)` и `(workspace_id, created_at DESC)`.

### Приватность авторства

Как в `MembersTab`/Presence: own-row RLS на `profiles` не даёт клиенту читать
чужие ники по uuid (нет RPC uuid→profile). Автор резолвится так: это я
(`boundUserId`) → «вы»; онлайн-участник (`usePresenceStore`) → ник или публичный
`TF-XXXXXX` + его аватар; иначе (офлайн/историческое действие) → короткий id
(первые 8 символов uuid). **Email не показывается никогда.**

### Архитектура

- `src/store/useTaskActivityStore.ts` — Zustand-стор поверх локального зеркала.
  Пагинация: страница `PAGE_SIZE=20`, сортировка `created_at DESC`; для «есть ли
  ещё» выбираем `limit+1` строку и обрезаем. Хук `useTaskActivity(taskUuid)`
  грузит первую страницу на смену задачи, отдаёт `{ records, hasMore, loadMore }`.
  `taskUuid=null` (задача без uuid — ещё не синхронизирована) → пустой результат,
  запросов нет. Ошибка `db.all` (нет таблицы) → пустой журнал без исключения.
- `src/components/TaskActivityLog.tsx` — сворачиваемая секция. Свёрнута по
  умолчанию; в свёрнутом виде хук получает `null` (данные не грузятся). Локальный
  `relativeTime` (только что / Nм / Nч / Nд / абсолютная дата старше недели), без
  внешних зависимостей. Рендерится вызывающим (`TaskModal`) **только** для
  shared-пространства.

### Сознательно вне scope

- **Клиентский INSERT в лог.** Пишет только серверный триггер — см. выше.
- **UPDATE/DELETE-политики (кроме deny).** Журнал immutable.
- **Diff-детализация payload в UI.** Показываем тип события и автора; развёрнутый
  «было → стало» — отдельная история (payload уже пишется в БД, UI можно
  расширить позже).
- **Лог personal-задач.** Гейт `kind='shared'` на триггере.

### Тесты

- `useTaskActivityStore.test.ts` — чтение/парсинг payload, фильтр по task_id,
  пагинация (PAGE_SIZE + loadMore + hasMore), DESC-сортировка, битый payload → `{}`,
  ошибка db → пустой журнал, `clear`.
- `TaskActivityLog.test.tsx` — свёрнут по умолчанию, разворот и пустое состояние,
  резолв автора (вы / presence-ник / короткий id), «Показать ещё» ↔ `loadMore`.
- `supabase/tests/17_task_activity_log_test.sql` — pgTAP: схема/FK/CHECK, RLS
  (select членам, deny insert/update/delete), триггер (логирует shared, пропускает
  personal, приоритет событий), realtime-публикация.

### i18n

- `ws_activity_log_title` / `ws_activity_log_empty` / `ws_activity_log_load_more`
  (заголовок / пусто / «Показать ещё»), `ws_activity_you` («вы»), и по ключу на
  каждый тип события: `ws_activity_created`, `ws_activity_status_changed`,
  `ws_activity_deadline_changed`, `ws_activity_title_changed`,
  `ws_activity_description_changed`, `ws_activity_deleted`, `ws_activity_restored`,
  `ws_activity_tag_added`, `ws_activity_tag_removed` (ru+en). Тексты без
  плейсхолдеров — `tr()` без интерполяции.

---

## 4. PR-c-04: Workspace history tab (общий лог пространства)

### Что делаем

Новая вкладка «**История**» в `WorkspaceSettings` (после «Участники»): общий журнал
активности по **всему** пространству. Данные — то же локальное зеркало
`task_activity_log` (PR-c-03), но выборка workspace-scoped, а не по одной задаче.
**0 backend/DDL** — только клиент; журнал по-прежнему пишет лишь серверный триггер.

### Почему вкладка, а не модалка

Лог пространства — «фоновый» справочный экран, который открывают редко и
осознанно (расследовать «кто и когда поменял»), а не быстрый peek. Модалка поверх
доски провоцировала бы к нему как к оперативному инструменту, конфликтовала бы с
модалкой задачи (лог ссылается на задачу → открытие её модалки = модалка над
модалкой) и не давала бы места фильтрам. Вкладка в настройках ставит его рядом с
«Участники» — там же, где остальной ws-контекст, — и оставляет доску чистой.
Ссылка на живую задачу уводит на `/tasks?task=<id>`, где модалка открывается уже
в своём контексте.

### Доступ

Read-only для **всех** ролей (owner/editor/viewer): RLS на `sync_task_activity_log`
разрешает SELECT любому участнику. Вкладка видна только для `kind='shared'` (для
personal лог не пишется вовсе) — в списке табов её попросту нет, как и «Участники».

### Store: workspace-scope выборка

`useTaskActivityStore` расширен: `byWorkspace[wsId]` + `reloadWorkspace(wsId)`
читает **весь** лог пространства (`WHERE workspace_id=? ORDER BY created_at DESC`).
Хук `useWorkspaceActivity(wsId, { kinds?, userId?, taskIds? }, pageSize=WS_PAGE_SIZE=50)`
применяет фильтры на клиенте (SQLite быстрый — server-side пагинация не нужна) и
отдаёт `{ records, total, hasMore, loadMore, reload }`. Пагинация — локальный
счётчик видимых записей (+50 на «Показать ещё»); смена фильтров/пространства
сбрасывает его на первую страницу. Пустой `kinds` = «все типы»; `taskIds=[]` = ни
одной (текстовый фильтр без совпадений), `taskIds=null` = «все задачи».

### UI: `WorkspaceHistoryTab.tsx`

- **Фильтры** (компактная строка сверху): тип действия (поповер с чекбоксами,
  мультивыбор), участник (список членов ws; ник из presence, иначе публичный
  `TF-XXXXXX`, иначе короткий id — **никогда email**), задача (текст-поиск по
  заголовку → множество uuid, отдаётся в стор как `taskIds`).
- **Запись** рендерится общим `ActivityAuthorRow` (см. ниже) + слот `extra` со
  ссылкой на задачу: жива → кнопка «`«title»`» открывает её модалку через навигацию
  на `/tasks?task=<localId>` (там `useSearchParams` подхватывает и вычищает
  параметр); удалена/отсутствует локально → «`«title»` (удалена)» без ссылки,
  title из локальной строки задачи либо из `payload.title`.
- **Empty state** — «Нет записей истории», **loadMore** — «Показать ещё».

### Переиспользование render-логики

Render одной записи (аватар + имя автора + локализованное действие + relative-время
с tooltip) вынесен из `TaskActivityLog.tsx` в общий `src/components/ActivityEntry.tsx`
(`ActivityAuthorRow`, `eventText`, `relativeTime`) и используется обоими экранами —
дублирования нет. Резолв автора и приватность — как в PR-c-03.

### Сознательно вне scope

- **Backend/DDL/миграции** — 0 изменений (данные из PR-c-03).
- **Экспорт лога** (CSV/JSON) — не сейчас.
- **Server-side пагинация** — клиентской достаточно.
- **Restore/действия из UI лога** — только просмотр.

### Тесты

- `useWorkspaceActivity.test.tsx` — `reloadWorkspace` (весь ws-лог, DESC, ошибка
  db → пусто), хук: `wsId=null` → пусто, пагинация `WS_PAGE_SIZE`+`loadMore`,
  фильтры kind/user/task, семантика пустых `kinds`/`taskIds`.
- `WorkspaceHistoryTab.test.tsx` — empty state, список + «Показать ещё», фильтр по
  kind/user передаётся в хук, fallback ника → TF-ID (не email), клик по живой
  задаче → навигация, удалённая задача → «(удалена)» без ссылки.
- `WorkspaceSettings.test.tsx` — вкладка «История» скрыта в personal, видна всем
  ролям в shared.

### i18n

- `ws_history_tab_title` («История»/History), `ws_history_filter_kind`,
  `ws_history_filter_user`, `ws_history_filter_task`, `ws_history_filter_all`,
  `ws_history_load_more`, `ws_history_empty`, `ws_history_task_deleted`
  («(удалена)»/(deleted)) — ru+en. Строки типов действий переиспользуются из
  PR-c-03 (`ws_activity_*`).

---

## 5. PR-c-05: Viewer polish (read-only UX для роли viewer)

### Что делаем

RLS (миграция 0031) уже запрещает viewer'у запись на сервере, но UI до сих пор
показывал ему активные кнопки/поля. Клик приводил к отказу
`insufficient_privilege` — некрасиво и непонятно. Этот PR — чисто UX-слой:
проходим по всем интерактивным элементам shared-пространства и для viewer'а
явно **задизейбливаем** (предпочтительно) либо **скрываем** запись, добавляя
единый tooltip «Только просмотр».

Бэкенд, RLS и миграции НЕ трогаем — сервер остаётся источником истины.

### Хелперы (над `useCurrentWorkspaceRole`)

- `useCanEdit(): boolean` — `role !== 'viewer'`. `null` (роль ещё не
  подхвачена / личное пространство) трактуем как `true`, чтобы не блокировать
  UI до загрузки членства — worst-case сервер всё равно отсечёт запись.
- `useIsViewer(): boolean` — строгое `role === 'viewer'` (для явных read-only
  веток, где `null` не должен считаться viewer'ом).

Оба живут в `src/store/workspaceScope.ts` рядом с `useWorkspaceRoles`.

### disabled vs hidden — правило

- **disabled + tooltip** по умолчанию: элемент виден, но неактивен и объясняет
  почему (`title={tr(lang, 'ws_viewer_readonly_tooltip')}`, `opacity`,
  `cursor-not-allowed`). Так viewer видит полноту интерфейса без ложных кликов.
- **hidden** там, где disabled-кнопка была бы бессмысленным шумом: точечные
  действия-иконки на карточках (удалить/готово/ручка dnd), кнопки футера
  модалки (Сохранить/Удалить/Сохранить как шаблон), «+ добавить». Danger zone и
  управление участниками уже owner-only — там ничего не меняли.

### Точки полировки

- **Tasks.tsx** — кнопка «Новая задача»: у viewer'а disabled + tooltip.
- **StatusGroup / KanbanColumn** — `useSortable({ disabled: !canEdit })`:
  перетаскивание задач отключено.
- **TaskCard / KanbanCard** — inline-редактирование заголовка/комментария,
  тоггл чекбоксов (`MarkdownComment.onToggle`), кнопки удалить/готово и
  drag-handle скрыты у viewer'а.
- **TaskModal** — селекты статуса/тега, поля названия/комментария, DatePicker'ы
  `disabled`; emoji-кнопки, панель чекбоксов, «+ тег» скрыты; кнопки
  Удалить/Сохранить как шаблон/Сохранить скрыты; «Отмена» → «Закрыть». Журнал
  изменений (`TaskActivityLog`) остаётся видимым — это просмотр.
- **Settings: Statuses/Tags/Templates** — все CRUD-контролы (добавить, поля
  имени/цвета, чекбоксы, стрелки порядка, удалить, редактировать шаблон)
  задизейблены/скрыты у viewer'а. Секции переиспользуются и в личном Settings,
  и в WorkspaceSettings — гейт `useCanEdit` внутри секции корректен в обоих
  контекстах.
- **WorkspaceSettings.Members / переименование / Danger zone** — уже owner-only
  (`{isOwner && …}`), правок не потребовалось.

### Сознательно вне scope

- **Backend / RLS / DDL / миграции** — 0 изменений.
- **Email** — нигде (как во всей Wave C).
- Переверстка/новые компоненты — нет, только точечные атрибуты.

### Тесты

- `workspaceScope.role.test.ts` — юнит на `useIsViewer` (viewer→true,
  editor/owner→false, `null`→false) рядом с существующими `useCanEdit`.
- `viewerPolish.test.tsx` — компонентные: TaskCard (viewer прячет
  удалить/готово/ручку; editor показывает), TaskModal (viewer без
  Сохранить/Удалить, поля disabled, есть read-only tooltip; editor —
  наоборот). Роль вычисляется реально из замоканного store по
  (currentWorkspaceId, boundUserId, workspaceMembers).

### i18n

- `ws_viewer_readonly_tooltip` — ru «Только просмотр. Обратитесь к владельцу
  или редактору.» / en «Read-only. Ask an owner or editor for changes.».

---

## 6. PR-c-06: техдолг — возврат `10_workspace_management_test.sql` в CI

### Что было

Тест `supabase/tests/10_workspace_management_test.sql` писался в Wave A (PR-4,
миграция 0028) и с тех пор устарел: он был **исключён из CI** (явно пропущен в
списке `pg_prove` в `.github/workflows/db-tests.yml` — шёл 09, затем сразу 11) и
падал. Диагностика на vanilla Postgres 15 выявила три независимых расхождения со
схемой после Wave A/B:

1. **Auto-профиль + guard неизменяемости.** Триггер `on_auth_user_created`
   (0001) при `INSERT` в `auth.users` сам заводит profile со СЛУЧАЙНЫМ
   `public_user_id`, а guard `profiles_guard_immutable` (0026) запрещает
   переписать его через `UPDATE`. Тест же наливал профили через
   `INSERT … ON CONFLICT DO UPDATE`, из-за чего заданные TF-ID
   (`TF-TGT10` и т.п.) молча откатывались к случайным → RPC
   `find_user_by_public_id` не находил цель (тесты 3–6).
2. **Сигнатура RPC.** `find_user_by_public_id` теперь `RETURNS TABLE(...)`, т.е.
   `setof record`; тест ждал `record` (тест 2).
3. **Снятый guard `block_shared_workspaces`.** Миграция 0030 (FK-каскады)
   удалила и триггер, и функцию `block_shared_workspaces` — `kind='shared'`
   разрешён в схеме напрямую. Тест же пытался `ALTER TABLE … DISABLE TRIGGER
   block_shared_workspaces` → hard-error, обрывавший транзакцию (planned 25 /
   ran 19).
4. **Утечка `request.jwt.claim.sub`.** Тест сбрасывал только `RESET ROLE`, не
   очищая JWT-claim, поэтому `auth.uid()` оставался не-NULL между секциями. Это
   ломало сценарий «без аутентификации» (тест 8) и системный FK-каскад
   `auth.users → personal-ws` (тест 23): guard `block_personal_workspace_delete`
   пропускает каскад только при `auth.uid() IS NULL`.

Ни одно из расхождений не является багом бэкенда — guard'ы, RLS и RPC ведут себя
корректно; устарел именно тест.

### Что починили (только тест + CI, без изменений бэкенда)

- Налив RPC-данных обёрнут в `DISABLE/ENABLE TRIGGER on_auth_user_created` и
  переведён на `ON CONFLICT DO NOTHING` — заданные TF-ID теперь сохраняются
  (паттерн из `15_workspace_invites_test.sql`).
- `function_returns(...)` ждёт `setof record`.
- Убраны `ALTER TABLE … DISABLE/ENABLE TRIGGER block_shared_workspaces` —
  shared-пространство создаётся напрямую.
- Все сбросы контекста приведены к конвенции
  `RESET ROLE; SET LOCAL request.jwt.claim.sub TO '';` (как в
  `14_workspace_rls_roles_test.sql`).
- `plan()` исправлен с 25 на фактические **23** ассерта.

### Какой сценарий тест теперь покрывает

RPC `find_user_by_public_id` (публичный минимум без email, нормализация ввода,
требование аутентификации); guard `assert_at_least_one_owner` (нельзя удалить/
понизить/soft-удалить последнего owner'а, но можно при наличии второго); RLS
`sync_workspace_members` (owner add/update/delete, editor не может, self-leave);
soft-delete пространств (личное нельзя, shared — только owner) и системный
FK-каскад `auth.users → personal-ws` в обход guard'а.

### CI

Файл добавлен в список `pg_prove` в `.github/workflows/db-tests.yml` в правильном
порядке (между 09 и 11). Job `pgTAP на vanilla Postgres 15` прогоняет его зелёным
вместе с остальными (17 файлов, 578 ассертов).

---

## Итоги Wave C

Волна закрыта 2026-07-14. Все 6 под-PR смёржены в `feat/workspaces`; `main` не
тронут (эпик по-прежнему ждёт единого merge-PR `feat/workspaces → main`, целевой
десктоп-релиз v1.1.0).

| PR | Тема | Merge-commit | DDL/миграция | Ключевые файлы |
|----|------|--------------|--------------|----------------|
| #88 | c-01 Presence | `37f8010` | нет | `src/lib/presence.ts`, `src/store/usePresenceStore.ts`, `PresenceIndicator.tsx` |
| #89 | c-02 Invite pin | `22a6be1` | нет | `src/components/InvitePinBadge.tsx`, `MyInvitesSection.tsx` |
| #90 | c-03 Audit log | `8f7d836` | **0034** | `useTaskActivityStore.ts`, `TaskActivityLog.tsx`, `realtime.ts`/`mappers.ts`/`pull.ts`, SQLite v13 |
| #91 | c-04 Workspace history tab | `d1e0013` | нет | `WorkspaceHistoryTab.tsx`, `ActivityEntry.tsx`, `useTaskActivityStore.ts` (ws-scope) |
| #92 | c-05 Viewer polish | `3b5f36e` | нет | `workspaceScope.ts` (`useCanEdit`/`useIsViewer`), точечные атрибуты по интерактивным компонентам |
| #93 | c-06 pgTAP 10 fix | `33463a7` | нет | `supabase/tests/10_workspace_management_test.sql`, `.github/workflows/db-tests.yml` |

**Итог по БД:** единственная миграция волны — `0034_task_activity_log.sql`
(PR-c-03). Остальные пять PR — 0 DDL.

**Итог по CI/тестам:** финальный pgTAP-набор — **17 файлов / 578 ассертов**
(добавлены `17_task_activity_log_test.sql` из c-03 и возвращённый
`10_workspace_management_test.sql` из c-06); плюс vitest и `tsc -b`/`build`
зелёные.

**Техдолг pgTAP 10** (тянулся с Wave A) закрыт в PR-c-06 — тест переработан под
текущую схему (`plan(25)→plan(23)`) и возвращён в CI. Подтверждено в
`roadmap.md` §7.5 и §7.7.

**Перенесено на будущие волны:** per-field merge / индикатор «редактируется
участником N» (LWW остаётся моделью MVP); экспорт лога (CSV/JSON); diff-детализация
payload «было → стало» в UI; кросс-workspace поиск и «все мои задачи»; кастомные
роли и pipeline статусов между пространствами.
