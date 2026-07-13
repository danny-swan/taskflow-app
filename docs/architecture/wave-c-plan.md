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
