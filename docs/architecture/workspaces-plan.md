# TaskFlow — направление «Пространства» (Workspaces): финализация решений и техплан Wave A

> **Рабочая ветка направления:** `feat/workspaces` (создана от `main` @ `667426e`).
> Все волны (A → B → C) вливаются в `feat/workspaces`; в `main` направление уходит только после стабилизации.
> **Реализацию по Wave A начинаем только после явного «стартуем».** Этот документ — план, не код.

---

## 0. Зафиксированные решения (финал)

| # | Вопрос | Решение |
|---|--------|---------|
| 1 | Free-юзер как viewer в чужом shared? | **Нет.** Shared — только между платными. Free вообще не участвует в shared (ни owner, ни viewer). |
| 2 | Отдельная роль `admin`? | **Нет в MVP.** Роли: `owner / editor / viewer`. `admin` = `owner`. |
| 3 | Где участники пространства в UI? | **В настройках пространства** (вкладка «Участники»). |
| 4 | Проекты внутри пространства? | **Не в MVP / не в Wave A–B.** Иерархия Space→Project полезна в долгую (Wave C+), закладываем возможность добавить `project_id text NULL` на задачу позже без переделки модели пространств. |
| 5 | LWW-конфликты на shared | **Принято как осознанное MVP-ограничение** (last-write-wins по всей строке). Per-field merge и presence — Wave C, если появятся жалобы. |
| 6 | `overdue_mode` → per-workspace | **Да.** Режим дедлайнов становится свойством пространства и синкается. При миграции наследует текущее значение в personal-пространство — для юзера незаметно. |
| 7 | Удаление аккаунта owner'а shared | **Блокировка + явный выбор** (см. §0.1). Никакого молчаливого каскада на shared. |
| 8 | Тарифы | Лимит на **пространства**: Free — 2 личных, 0 общих. Pro — до 7 суммарно, любые могут быть shared. Общий ws занимает слот у owner'а, не у участников. |
| 9 | Модель хранения | Один локальный SQLite + одна облачная схема; `workspace_id` в каждой sync-строке; доступ через `workspace_members`; роль — атрибут membership. (Вариант A из арх-анализа.) |

### 0.1 Удаление аккаунта owner'а shared-пространства (детально, актуально в Wave B)
Правило: **нельзя молча удалить общее пространство вместе с аккаунтом.**
1. При запросе удаления аккаунта сервер проверяет наличие общих пространств, где юзер — единственный owner и есть другие участники.
2. Если такие есть — удаление **блокируется**, юзеру предлагается по каждому:
   - **Передать ownership** выбранному участнику (из editor'ов), либо
   - **Осознанно удалить пространство** (подтверждение вводом названия).
3. Аккаунт удаляется только после разрешения всех shared.
4. Личные пространства — каскадное удаление без вопросов.
Реализация — в процедуре удаления аккаунта (не БД-каскадом) + UI-флоу. Относится к Wave B.

---

## 1. Стратегия ветвления (важно: НЕ в main)

```
main (667426e, прод v1.0.3)
  └── feat/workspaces            ← интеграционная ветка направления (создана)
        ├── feat/ws-a-01-schema        (серверная миграция 0027 + клиентская v11)
        ├── feat/ws-a-02-sync-mappers  (workspace_id в mappers/pull/push)
        ├── feat/ws-a-03-store-ui       (currentWorkspaceId + переключатель + фильтры)
        ├── feat/ws-a-04-settings       (per-workspace настройки + overdue_mode миграция)
        ├── feat/ws-a-05-limits         (тарифные лимиты + серверный триггер)
        └── feat/ws-a-06-tests          (pgTAP + vitest + регрессия)
```

- Каждый под-этап Wave A — **отдельный PR в `feat/workspaces`** (не в main), squash-merge по конвенции репо.
- `feat/workspaces` регулярно **ребейзится/мержится от main**, чтобы не отставать (как develop отстал на 19 коммитов — этого избегаем).
- В `main` уходит **одним merge-PR `feat/workspaces → main`** только после того, как Wave A полностью стабилен, все проверки зелёные, ручная регрессия пройдена.
- Прод-миграцию `0027` применяем на Supabase **только когда решим катить Wave A на прод** (не при каждом под-PR). До этого — тестируем на локальном pgTAP (vanilla Postgres 15, как в CI).
- Desktop-релиз (bump версии/тег) — **только после merge в main**, не из feature-ветки.

---

## 2. Модель данных Wave A (personal-only)

### 2.1 Новые облачные таблицы

```sql
-- Пространство
create table public.sync_workspaces (
  id            text primary key,            -- uuid с клиента (как все sync-сущности)
  user_id       uuid not null references auth.users(id) on delete cascade,  -- = owner в Wave A
  owner_id      uuid not null references auth.users(id) on delete cascade,  -- явный owner (в Wave A == user_id)
  name          text not null,
  kind          text not null default 'personal'
                  check (kind in ('personal','shared')),   -- в Wave A разрешён только 'personal' (триггер)
  sort_order    int  not null default 0,
  -- sync-метаданные (контракт как у остальных):
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  version       int not null default 1,
  client_id     text references public.sync_devices(id) on delete set null
);

-- Членство (в Wave A у каждого personal — ровно одна строка: сам owner)
create table public.sync_workspace_members (
  id            text primary key,            -- uuid
  workspace_id  text not null,               -- ссылка на sync_workspaces.id (без FK, как принято)
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null default 'owner'
                  check (role in ('owner','editor','viewer')),
  invited_by    uuid,
  joined_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  version       int not null default 1,
  client_id     text references public.sync_devices(id) on delete set null,
  unique (workspace_id, user_id)
);

-- Настройки пространства (то, что раньше было per-device в client settings)
create table public.sync_workspace_settings (
  workspace_id  text not null,
  key           text not null,               -- напр. 'overdue_mode'
  value         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  version       int not null default 1,
  client_id     text references public.sync_devices(id) on delete set null,
  primary key (workspace_id, key)
);
```

Примечание: `sync_workspace_settings` по ключ-значению переиспользует уже существующий (но не синкавшийся) паттерн `sync_settings`. Первый ключ — `overdue_mode`.

### 2.2 Колонка `workspace_id` в существующих sync-таблицах
`ADD COLUMN workspace_id text` в: `sync_tasks`, `sync_statuses`, `sync_tags`, `sync_task_templates`, `sync_overdue_events`, `sync_task_hold_periods`.
Порядок в миграции: `NULL → backfill → SET NOT NULL` (по образцу 0026 `public_user_id`).

### 2.3 Backfill существующих пользователей (миграция)
Для каждого `user_id`, у которого есть хоть одна строка в любой sync-таблице (или профиль):
1. Создать `sync_workspaces` (`kind='personal'`, `name='Мои задачи'`, `owner_id=user_id`, детерминированный `id`). **Зафиксированная схема id (реализовано в 0027 / v11):** `id = 'ws_' || replace(user_id::text, '-', '')` — префикс `ws_` + 32 hex-символа user_id без дефисов (напр. `ws_41111111111111111111111111111111`). Без `uuidv5` (в vanilla PG нет `uuid_generate_v5` без расширения); на клиенте тривиально воспроизводимо: `'ws_' + userId.toLowerCase().replace(/-/g,'')`. Идемпотентно по PK; сервер и клиент генерируют идентичный id → строки склеиваются при первом sync.
2. Создать `sync_workspace_members` (`role='owner'`).
3. `UPDATE sync_tasks SET workspace_id = <personal ws id> WHERE user_id = <user_id> AND workspace_id IS NULL` — то же для 5 остальных таблиц.
4. Перенести `overdue_mode` из клиента невозможно на сервере (он локальный) → `sync_workspace_settings(overdue_mode)` **не заполняем на сервере**; клиентская миграция v11 запишет туда локальное значение при первом запуске (см. §3.3).
5. `SET NOT NULL` на `workspace_id` во всех 6 таблицах — только после успешного backfill.

Идемпотентность: все шаги через `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` / `WHERE workspace_id IS NULL`.

### 2.4 Что становится workspace-aware
| Сущность | Уровень | Комментарий |
|----------|---------|-------------|
| Задачи | per-workspace | `workspace_id` на строке |
| Статусы | per-workspace | у каждого ws свой набор (сид при создании) |
| Теги | per-workspace | свой набор, стартует пустым |
| Шаблоны задач | per-workspace | |
| overdue_events / hold_periods | per-workspace | наследуют ws своей задачи |
| Режим дедлайнов (`overdue_mode`) | per-workspace | в `sync_workspace_settings` |
| Участники / роли | per-workspace | Wave A: только owner; Wave B: editor/viewer |
| Профиль (nickname/avatar/TF-ID) | **global (user)** | НЕ per-workspace, остаётся в `profiles` |
| Тариф (entitlement) | **global (user)** | лимит считается по кол-ву ws юзера |

---

## 3. Изменения по компонентам (Wave A)

### 3.1 RLS (сервер)
Ввести SECURITY DEFINER функцию:
```sql
create or replace function public.has_workspace_role(ws text, uid uuid, min_role text)
returns boolean language sql stable security definer
set search_path = public, pg_catalog as $$
  select exists (
    select 1 from public.sync_workspace_members m
    where m.workspace_id = ws and m.user_id = uid and m.deleted_at is null
      and case min_role
            when 'viewer' then true
            when 'editor' then m.role in ('owner','editor')
            when 'owner'  then m.role = 'owner'
          end
  );
$$;
revoke execute on function public.has_workspace_role(text,uuid,text) from anon, authenticated, public;
```
RLS каждой sync-таблицы переписываем:
- SELECT USING `has_workspace_role(workspace_id, (select auth.uid()), 'viewer')`
- INSERT WITH CHECK `has_workspace_role(workspace_id, (select auth.uid()), 'editor')`
- UPDATE USING/WITH CHECK `... 'editor'`
- DELETE USING `... 'editor'`
Для `sync_statuses`/`sync_workspace_settings` — INSERT/UPDATE/DELETE требуют `'owner'` (критичные настройки). Теги/задачи/шаблоны — `'editor'`.
В Wave A каждый юзер — owner своего personal, поэтому фактическое поведение = как раньше (`user_id=auth.uid()`), но код уже готов к shared.

**Безопасность:** старый own-row барьер НЕ ослабляем — просто выражаем его через membership. В Wave A membership личного пространства эквивалентна `user_id=auth.uid()`.

### 3.2 Sync-мапперы и pull (клиент)
- `Cloud*Payload` (6 шт.) + новые для workspaces/members/settings: добавить `workspace_id`.
- `*ToCloudPayload(row, userId, clientId)`: подтягивать `workspace_id` из локальной строки (локальная строка теперь его содержит).
- Pull applier'ы (`applyCloudRow*` в pull.ts): **явно** добавить `workspace_id` в INSERT/UPDATE-списки всех 6 таблиц (пункт риска — легко забыть).
- `PUSH_ORDER`: расширить — `workspaces → workspace_members → workspace_settings → statuses → tags → tasks → ...` (пространство и членство — «родители» для всего).
- Резолверы `resolveStatusUuid`/`resolveTagUuid`: искать статус/тег **в пределах того же `workspace_id`** (иначе задача из ws-1 подхватит статус ws-2).
- `SyncEntityTable` тип: добавить `workspaces|workspace_members|workspace_settings`.

### 3.3 Клиентская миграция v11 (SQLite)
- `TARGET_VERSION: 10 → 11`.
- Создать локальные `workspaces`, `workspace_members`, `workspace_settings`.
- `ALTER TABLE ... ADD COLUMN workspace_id TEXT` в 6 локальных таблицах.
- Backfill локально: создать personal-пространство (тот же детерминированный id, что сервер: `'ws_' + userId.toLowerCase().replace(/-/g,'')` при наличии `bound_user_id`), проставить `workspace_id` во все локальные строки. **Local-only база (не привязана к аккаунту):** id = `ws_local`; согласование `ws_local` ↔ серверный `ws_<uid>` при первой привязке+sync — задел PR-2.
- **Перенести `overdue_mode`** из локальной `settings` в `workspace_settings(personal, 'overdue_mode', <текущее значение>)`, поставить в outbox на push.
- Инкрементно, не трогая v1–v10.

### 3.4 Курсоры pull
Сейчас ключ `sync_last_pulled_<cloudTable>`. Расширить до **`sync_last_pulled_<workspace>_<cloudTable>`** (per-ws-per-table). В Wave A пространство одно → фактически один курсор на таблицу, но формат уже готов к нескольким. Миграция settings мягкая (старый ключ → новый с префиксом personal-ws).

### 3.5 Realtime
- Фильтр `user_id=eq.<uid>` → `workspace_id=in.(<все мои ws>)`.
- В Wave A множество = {personal}. Переподписка при создании/удалении пространства.
- Publication уже включает 6 таблиц + добавить `sync_workspaces`, `sync_workspace_members`, `sync_workspace_settings`.

### 3.6 Store + UI
- `useStore`: `currentWorkspaceId` (persist в settings `current_workspace_id`), `workspaces[]`, `switchWorkspace(id)`.
- **Все SELECT'ы задач/статусов/тегов** фильтруются по `currentWorkspaceId`. Ввести хук `useCurrentWorkspaceTasks()` вместо голого `useStore(tasks)`; аналогично статусы/теги.
- Dev-варнинг, если данные читаются без ws-фильтра (защита от пункта риска «забыли фильтр»).
- Переключатель пространств — **в шапке приложения**, дропдаун с группами «Личные» / «Общие» (в Wave A только «Личные»).
- Кнопка «+ Создать пространство» → диалог (имя + тип; в Wave A тип только personal). Сид статусов из `SEED_STATUSES`, теги пустые, `overdue_mode='calendar'`.
- Смена ws → обязательный `pullAll()` + refresh стора.

### 3.7 Настройки
- Раздел «Пространство» с вкладками: `Общее (имя, удалить) | Статусы | Теги | Дедлайны | Участники`.
- В Wave A вкладка «Участники» показывает только owner (себя), без приглашений (заглушка «Доступно в Pro» для будущего shared).
- Статусы/теги/дедлайны — те же экраны, что сейчас, но привязаны к `currentWorkspaceId`.

### 3.8 Тарифные лимиты (Wave A)
- Серверный триггер `BEFORE INSERT ON sync_workspaces`: считает кол-во активных ws юзера (`deleted_at IS NULL`), сверяет с лимитом:
  - Free (нет активного entitlement): максимум 2 (kind='personal').
  - Pro/trial: максимум 7 суммарно.
  - kind='shared' в Wave A запрещён вовсе (check + триггер).
- Клиентская проверка — только UX (disabled + тултип), не барьер.

### 3.8-факт Реализация (PR-5, `feat/ws-a-05-limits`)

> Фактически реализованное в PR-5. Соответствует плану §3.8; ниже — точные формулировки того, что закоммичено (не запушено на момент фиксации).

**Миграция:** `supabase/migrations/0029_workspace_limits.sql` — номер `0029`, а НЕ `0028`: `0028` уже был занят (`0028_workspaces_mvp_guards`). На прод не применяется до решения релизить Wave A (как 0027/0028).

**Лимиты (зеркалят клиентский `resolveEntitlement`):** платный активный entitlement (`plan IN ('pro','trial','lifetime')`, `valid_until > now()` или lifetime бессрочно) → 7 суммарно по всем kind; free + personal → 2; free + shared → 0. Истёкший pro трактуется как free.

**SQL — `get_workspace_limit(uid uuid, workspace_kind text) returns int`** (SECURITY DEFINER, `stable`, `search_path = public, pg_catalog`; EXECUTE отозван у anon/authenticated/public):
```sql
select case
  when exists (
    select 1 from public.user_entitlements e
    where e.user_id = uid
      and e.plan in ('pro', 'trial', 'lifetime')
      and (e.plan = 'lifetime' or (e.valid_until is not null and e.valid_until > now()))
  ) then 7                                   -- платный: 7 суммарно по всем kind
  when workspace_kind = 'shared' then 0      -- free: shared недоступен
  else 2                                     -- free: 2 personal
end;
```

**SQL — триггер `enforce_workspace_limit()`** (BEFORE INSERT ON `sync_workspaces`, SECURITY DEFINER, plpgsql, `search_path = public, pg_catalog`; EXECUTE отозван):
```sql
begin
  -- Гейт активен ТОЛЬКО когда пользователь создаёт СВОЁ пространство
  -- (auth.uid() = owner_id). Пропускает service_role/backfill/суперпользователя
  -- (auth.uid() IS NULL) и вставки от чужого имени. IS DISTINCT FROM обрабатывает NULL.
  if (select auth.uid()) is distinct from new.owner_id then
    return new;
  end if;

  select count(*) into v_count
  from public.sync_workspaces w
  where w.owner_id = new.owner_id
    and w.deleted_at is null
    and w.id <> new.id;

  v_limit := public.get_workspace_limit(new.owner_id, new.kind);

  if v_count >= v_limit then
    raise exception 'workspace_limit_exceeded'
      using errcode = 'P0001',
            detail  = format('owner=%s kind=%s active=%s limit=%s', new.owner_id, new.kind, v_count, v_limit),
            hint    = 'Тарифный лимит пространств достигнут. Free: 2, Pro: 7.';
  end if;
  return new;
end;
```
```sql
drop trigger if exists enforce_workspace_limit on public.sync_workspaces;
create trigger enforce_workspace_limit
  before insert on public.sync_workspaces
  for each row execute function public.enforce_workspace_limit();
```

**Ключевые решения:**
- **Гейт `auth.uid() = owner_id` (IS DISTINCT FROM), а не `auth.uid() IS NULL`.** Это ровно то, что гарантирует RLS INSERT-политика 0027 (`owner_id = auth.uid() = user_id`) → для реального клиента гейт всегда активен. Пропускает service_role/backfill 0027/pgTAP-сетапы/суперпользователя. Дополнительно устойчиво к утечке GUC `request.jwt.claim.sub` через `RESET ROLE` в pgTAP.
- **SECURITY DEFINER на триггере критичен:** при реальном push порядок PUSH_ORDER — «сначала все workspaces, потом все members», поэтому на момент INSERT'а N-го пространства owner-членства предыдущих ещё не вставлены → под RLS (`has_workspace_role`) они невидимы, и count был бы занижен. DEFINER-контекст даёт честный подсчёт.
- **Форвард-совместимость с shared (Wave B):** счётчик считает ВСЕ активные пространства владельца (любого kind), а `get_workspace_limit` уже различает personal/shared для free — при открытии shared лимитная логика не потребует изменений.
- **Регрессия PR-1 сохранена:** имя триггера `enforce_workspace_limit` (буква «e») сортируется ПОСЛЕ `block_shared_workspaces` («b»), поэтому `kind='shared'` по-прежнему отклоняется check-constraint'ом / `block_shared_workspaces` с SQLSTATE `23514`, а НЕ лимитом (`P0001`).

**Клиент:**
- `src/lib/workspaceLimits.ts` — чистый резолвер `evaluateWorkspaceLimit({isPaid, activeWorkspaceCount})` (константы `FREE_WORKSPACE_LIMIT=2`, `PAID_WORKSPACE_LIMIT=7`) + `isWorkspaceLimitError(err)` (распознаёт подстроку `workspace_limit_exceeded` в Error/строке/объекте с `message`).
- `src/components/CreateWorkspaceModal.tsx` — UX-гейт ПЕРЕД созданием: кнопка «Создать» в `disabled` при достигнутом лимите + апселл (амбер-блок) отдельными текстами для free и paid; `submit` дополнительно защищён `if (!canCreate) return`.
- `src/components/Sidebar.tsx` — fallback на серверную ошибку лимита. Создание пространства offline-first (локальный INSERT + outbox, без синхронного серверного вызова), поэтому серверный `workspace_limit_exceeded` при race между устройствами ловится не в модалке, а на sync-поверхности: sync-чип показывает тарифное сообщение вместо сырого текста ошибки.
- i18n (`src/lib/i18n.ts`, ru+en): `ws_limit_free_hint` («Обновите до Pro…»), `ws_limit_paid_hint` («максимум 7»), `ws_limit_sync_error` (нейтральный fallback для sync-чипа).

**Тесты:**
- pgTAP `supabase/tests/11_workspace_limits_test.sql` (`plan(14)`): `get_workspace_limit` (free personal=2 / free shared=0 / pro=7 / trial=7 / истёкший pro=2), `has_trigger`, free 1→2 успех / 2→3 отклонён (`P0001`), paid 6→7 успех / 7→8 отклонён, shared free/paid отклонён check-constraint'ом (`23514`). Предзаполнение — суперпользователем (гейт пропускает), проверяемая граница — под ролью `authenticated` с выставленным JWT. Добавлен в `.github/workflows/db-tests.yml`.
- vitest: `src/lib/workspaceLimits.test.ts` (10) + `src/components/CreateWorkspaceModal.test.tsx` (4) — free/paid под лимитом и на лимите → состояние кнопки + правильный апселл + `createWorkspace` не зовётся на лимите.

**Результаты прогонов (локально):** vitest 349/349, `tsc --noEmit` чисто, `npm run build` OK, pgTAP CI-список (01–09 + 11) 265/265. Прогон на PostgreSQL 18 в песочнице; CI — vanilla Postgres 15.

### 3.9-факт Реализация (PR-6, `feat/ws-a-06-hardening`)

> Финальный regression-hardening Wave A. Продуктовых изменений НЕТ — только новый pgTAP-файл + регистрация в CI + доки. Задача: жёстко зафиксировать инварианты фундамента (0027–0029) тестами, чтобы Wave B (открытие shared) стартовал с уверенной базы.

**Тесты:** `supabase/tests/12_workspaces_regression_test.sql` (`plan(45)`) — добавлен в `.github/workflows/db-tests.yml`. Три группы, дополняют 09/11 без дублирования:
- **A (18) — двусторонняя RLS-изоляция между пространствами ДВУХ юзеров:** `has_workspace_role` не-член vs owner; юзер A не видит чужое ws / членство / строки во всех 6 sync-таблицах; UPDATE/DELETE чужих строк отсекаются (USING), INSERT с чужим `workspace_id` в tasks/statuses/members падает `42501` (WITH CHECK); зеркальная проверка для B; ни одна атака ничего не изменила.
- **B (12) — фактическое поведение при удалении пространства:** soft-delete (`deleted_at`) помечает ws, дочерние строки остаются; hard `DELETE` проходит и ОСИРОТЛЯЕТ дочерние строки/members/settings (нет FK-каскада); удаление одного ws не задело второе ws того же юзера.
- **C (15) — integrity `workspace_id`/`owner_id`:** `workspace_id` проиндексирован во всех 6 таблицах (`has_index`); `sync_tasks.workspace_id` имеет 0 FK-констрейнтов (каталог); INSERT с несуществующим `workspace_id` под superuser проходит (следствие отсутствия FK); `owner_id`/`user_id` NOT NULL + FK на `auth.users` ON DELETE CASCADE (удаление аккаунта каскадит на personal-ws); backfill sanity; RLS WITH CHECK блокирует перенос своей задачи в чужой `workspace_id` (`42501`).

**Два зафиксированных архитектурных инварианта Wave A** (осознанный дизайн PR-1, теперь под тестами — не баги):
1. **`workspace_id` — plain `text` БЕЗ FK** на `sync_workspaces(id)` во всех 6 sync-таблицах и в members/settings. Целостность держится только на RLS (`has_workspace_role` в USING + WITH CHECK), не на FK. **Причина:** offline-first sync — id генерируются на клиенте (SQLite, текстовые UUID) и приезжают порознь через outbox, жёсткий FK ломал бы порядок вставки при push. **Для Wave B:** рассмотреть настоящий FK либо периодический orphan-cleanup.
2. **НЕТ `ON DELETE CASCADE` на `workspace_id`.** Продукт использует soft-delete (`deleted_at`); hard `DELETE` пространства осиротит дочерние строки. **Причина:** тот же offline-first дизайн + soft-delete как штатный путь. **Для Wave B:** при открытии shared каскадить явно — либо в приложении (обратный `PUSH_ORDER`), либо схемным `ON DELETE CASCADE`, если появится FK.

**Положительная находка:** RLS UPDATE-политика через WITH CHECK строже ожидания — не даёт «увести» свою строку в чужой `workspace_id` (тест C15, `42501`). Это лучше, чем требовал план.

**Пред-существующая находка (TODO, вне scope PR-6):** файл `10_workspace_management_test.sql` (PR-4) НЕ зарегистрирован в CI и «красный» и на PG18, и на PG15 (soft-delete shared-ws конфликтует с UPDATE-guard'ом `block_shared_workspaces`). Не чинил и не включал в CI (чужой красный тест). Рекомендация: отдельный тикет — soft-delete shared должен временно `DISABLE` guard (как это уже сделано для INSERT), после чего включить 10 в `db-tests.yml`.

**Почему без нового ADR:** PR-6 не разворачивает архитектурную развилку — он лишь фиксирует тестами уже принятые в PR-1 решения (0027). Инварианты «`text` без FK» и «нет каскада» — следствие ADR-контекста offline-first sync, а не новый выбор. Новый ADR оправдан, когда Wave B решит ввести FK/каскад (там появится альтернатива и trade-off).

**Результаты прогонов (локально):** pgTAP CI-список (01–09 + 11 + 12) **11 файлов / 310 тестов PASS** (файл 12 отдельно 45/45); vitest 349/349; `tsc --noEmit` чисто; `npm run build` OK. Прогон на PostgreSQL 18 в песочнице; CI — vanilla Postgres 15 (файл 12 использует только PG15-совместимые ассершены).

---

## 4. Риски Wave A и тестирование

| Риск | Уровень | Митигирование / тест |
|------|---------|----------------------|
| Пропущенный `workspace_id` в pull applier'е → NULL ws | **High** | vitest на каждую из 6 таблиц: после applyCloudRow строка имеет workspace_id. pgTAP: `workspace_id NOT NULL` держит. |
| RLS-регрессия (перестал видеть свои задачи) | **High** | pgTAP: один юзер, personal ws — видит всё своё, ровно как раньше. 30+ assert. |
| Backfill сломался на юзере без задач / с частичными данными | **Medium** | Идемпотентная миграция; pgTAP на 3 сценария: пустой юзер, юзер с задачами, повторное применение. |
| Забыли ws-фильтр в UI → смешение (в Wave A некритично, ws один) | **Medium** | Централизованный хук + dev-варнинг. Готовимся к Wave B, где это станет High. |
| Курсор-миграция потеряла позицию → лишний повторный pull | **Low-Medium** | Fallback: нет нового ключа → читаем старый → мигрируем. Идемпотентно. |
| Разъезд id personal-ws между клиентом и сервером → дубли | **Medium** | Детерминированная генерация id (uuidv5 от user_id) на обеих сторонах; при первом sync склейка по PK. pgTAP + интеграционный тест. |
| overdue_mode миграция затерла значение | **Low** | Переносим ровно текущее значение; тест на v10→v11. |
| Клиентская v11 на легаси-базе (v0.8.x штампованной как v1) | **Medium** | Прогнать v11 поверх свежесозданной и поверх «старой» тестовой базы. |

**Обязательный прогон перед каждым PR в feat/workspaces:** vitest, `tsc --noEmit`, `npm run build`, **весь pgTAP-набор локально** (vanilla Postgres 15, как CI). Прод-миграцию 0027 НЕ применять до решения катить Wave A.

---

## 5. Разбивка Wave A на PR (все — в `feat/workspaces`)

1. **`feat/ws-a-01-schema`** — миграция `0027_workspaces_foundation.sql` (таблицы + workspace_id + backfill + RLS + функция has_workspace_role + realtime) и клиентская v11. pgTAP `09_workspaces_test.sql`.
2. **`feat/ws-a-02-sync`** — мапперы/pull/push/outbox/realtime под workspace_id. vitest на applier'ы.
3. **`feat/ws-a-03-store-ui`** — currentWorkspaceId, переключатель в шапке, ws-scoped хуки, фильтры на всех страницах.
4. **`feat/ws-a-04-settings`** — per-workspace настройки, overdue_mode → workspace_settings, создание/удаление ws.
5. **`feat/ws-a-05-limits`** — тарифные лимиты (триггер + UX). ✅ Реализовано, закоммичено локально в ветке `feat/ws-a-05-limits` (на момент фиксации не запушено, PR не открыт). Детали — см. §3.8-факт.
6. **`feat/ws-a-06-hardening`** — регрессия, полный pgTAP-набор, ручной чек-лист, доки. ✅ Реализовано, закоммичено локально в ветке `feat/ws-a-06-hardening` (на момент фиксации не запушено, PR не открыт). Детали — см. §3.9-факт.

После стабилизации всех шести — единый merge-PR `feat/workspaces → main`, затем desktop-релиз (v1.1.0).

---

## 6. Что НЕ делаем в Wave A (чтобы не расползлось)
- Никакого shared (kind='shared' заблокирован).
- Никаких приглашений, ролей editor/viewer в UI (модель готова, UI — заглушка).
- Никаких проектов внутри пространства.
- Не трогаем хрупкую логику `'Приостановлено'` (это Wave B, отдельно).
- Не применяем 0027 на прод до решения релизить Wave A.

---

## 7. Следующий шаг
После твоего «стартуем» — начинаю с PR **`feat/ws-a-01-schema`**: серверная миграция `0027` + клиентская v11 + pgTAP `09_workspaces_test.sql`, всё в ветке `feat/workspaces`, с локальным прогоном pgTAP. Прод не трогаем.
