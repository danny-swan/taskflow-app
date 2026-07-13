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
