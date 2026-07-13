# Wave C — план и хроника

Wave C надстраивается над полностью смёрженной Wave B (shared workspaces: роли,
инвайты, RLS). Базовая ветка волны — `feat/workspaces`. Каждый PR добавляет свой
раздел в этот файл.

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
