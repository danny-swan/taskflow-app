# 0009. Пространства — accept_invite реактивирует soft-deleted membership (upsert)

- Статус: accepted
- Дата: 2026-07-22
- Связано: находка F15 (эпик «Пространства»), ветка `feat/workspaces`, [ADR 0005](0005-shared-workspaces.md), [ADR 0008](0008-workspace-members-full-pull-leave-refresh.md); миграция `0040_accept_invite_upsert_membership.sql`

## Контекст

После применения ADR 0008 (F14, leave корректно soft-delete'ит строку членства и
обновляет сайдбар) пользователь смог выйти из shared-пространства «P0 invite test»,
после чего owner отправил повторный invite, а приложение при попытке принять
показало «Не удалось выполнить действие. Попробуйте позже.». В консоли — HTTP
409 Conflict от PostgREST на `POST /rpc/accept_invite`, в логах Postgres —
`duplicate key value violates unique constraint
"sync_workspace_members_workspace_id_user_id_key"` (sqlstate 23505).

**Корень.** Тело `public.accept_invite` (0032, переопределено в 0038) делает
голый `INSERT INTO sync_workspace_members (…) VALUES (…)`. Уникальный индекс
`sync_workspace_members_workspace_id_user_id_key` покрывает пару `(workspace_id,
user_id)` **без** предиката `WHERE deleted_at IS NULL` — он бьёт независимо от
soft-delete. После leave (ADR 0008) в таблице остаётся строка
`(ws=X, user=U, deleted_at=<timestamp>)`, повторный INSERT при accept ловит
конфликт → 23505 → HTTP 409 у клиента.

**Прод-подтверждение (2026-07-22, ROLLBACK).** У пользователя `fc592c97…` в
`ws_019f85c8…` строка `wsm_13afdb1b…` c `deleted_at = 2026-07-22 11:53:28`,
`version = 2`, `role = editor` (последствие leave). Owner test1 создал
`inv_6b84eb6b…` (pending, `role = editor`, `expires_at = 2026-07-29`). Прямой
вызов `public.accept_invite('inv_6b84eb6b…')` под JWT `fc592c97…` вернул
`23505 duplicate key … sync_workspace_members_workspace_id_user_id_key`.

**Когда баг существовал.** С самого 0032 (Wave B, PR-b-03) — код INSERT ни разу
не обрабатывал существующую soft-deleted строку. **Симптом не проявлялся до
F14/ADR 0008**, потому что клиентский leave не работал (`removeWorkspaceMember`
не рефрешил сайдбар): пользователь физически не мог выйти → повторных приёмов не
было. F14 не создал этот дефект — он его открыл, вернув leave в работоспособное
состояние.

**Прод-логи (24 ч, до фикса).** `get_logs postgres` показал ~14 сообщений
`duplicate key … sync_workspace_members_workspace_id_user_id_key` в час: часть —
у fc592c97, часть — у других пользователей, которые успели пройти сценарий
leave → повторный invite → accept.

## Решение

Заменить голый INSERT в `accept_invite` на **upsert по `(workspace_id, user_id)`**:

```sql
insert into public.sync_workspace_members
  (id, workspace_id, user_id, role, invited_by, joined_at, deleted_at, version, updated_at)
values
  ('wsm_' || replace(gen_random_uuid()::text, '-', ''),
   v_invite.workspace_id, v_uid, v_invite.role, v_invite.inviter_user_id,
   now(), null, 1, now())
on conflict (workspace_id, user_id) do update
   set role       = excluded.role,
       invited_by = excluded.invited_by,
       joined_at  = excluded.joined_at,
       deleted_at = null,
       updated_at = now(),
       version    = coalesce(public.sync_workspace_members.version, 0) + 1
returning * into v_member;
```

Что меняется при конфликте:

- `deleted_at → NULL` — реактивация;
- `role → EXCLUDED.role` — новая роль из нового инвайта (может отличаться от
  старой);
- `invited_by → EXCLUDED.invited_by` — новый пригласитель;
- `joined_at → now()` — новая точка вступления (для UI/аналитики);
- `updated_at → now()`;
- `version → COALESCE(version, 0) + 1` — LWW: клиент через
  `applyCloudRowMembers` увидит обновление и заменит локальную soft-deleted
  строку на живую.

**`id` НЕ переписываем.** Уникальный `id` (uuid membership-строки) сохраняется у
существующей строки. Это важно, потому что клиентский pull-matcher
(`applyCloudRowMembers` в `src/lib/sync/pull.ts`) сопоставляет облако и локаль
именно по `id`. Если бы `id` менялся при UPDATE, клиент увидел бы «две разные
строки» (старую soft-deleted и новую с новым uuid) и должен был бы вручную их
мержить. Такой конфликт архитектура не предусматривает — LWW-мерджер работает
на уровне одной строки.

Все прочие проверки `accept_invite` сохранены: target-only, pending, не истёк,
тарифный гейт по плану (`get_workspace_limit(uid, 'shared') > 0` — 0038).
SECURITY DEFINER, search_path, GRANT/REVOKE — не меняются. Функция остаётся
идемпотентной по внешней семантике: два подряд accept одного и того же инвайта
второй раз упадут на проверке `status = 'pending'` (после первого вызова инвайт
уже `accepted`).

## Альтернативы — рассмотрены и отклонены

- **A) DELETE soft-deleted перед INSERT.** Простой `delete from
  sync_workspace_members where workspace_id=… and user_id=… and deleted_at is
  not null;` перед INSERT. Проблема: физическое удаление ломает LWW-репликацию у
  других клиентов того же аккаунта — они увидят исчезновение строки (не понятно,
  это leave или reset), и через `applyCloudRowMembers` не смогут различить его
  от прошлого leave. Кроме того, при рейсе (два DEVICE-а принимают инвайт в один
  и тот же момент) DELETE + INSERT нетранзакционен по индексу.
- **B) UNIQUE INDEX с предикатом `WHERE deleted_at IS NULL`.** Изменить
  уникальный ключ так, чтобы он покрывал только живые строки. Пришлось бы
  вычистить старые soft-deleted строки, чтобы получить возможность создать
  новый partial-индекс (или использовать `DROP CONSTRAINT` + новый `CREATE
  INDEX`). Риск для существующих запросов, которые ссылаются на имя constraint
  (напр., PostgREST error mapping) выше, чем польза. Функциональной разницы с
  upsert нет — при UPDATE-пути мы всё равно бы делали то же самое (реактивация с
  новыми полями).
- **C) Клиентский обход — проверять membership перед accept.** Слишком тонко:
  между `SELECT` и вызовом `accept_invite` состояние может измениться; и это не
  чинит серверную нестабильность — любой другой клиент (или скрипт) через RPC
  всё равно упадёт с 23505.

Выбор — вариант **upsert в теле accept_invite**, минимальная поверхность
изменений, серверная гарантия консистентности.

## Верификация

- **Миграция.** `0040_accept_invite_upsert_membership.sql` — `CREATE OR REPLACE
  FUNCTION` (идемпотентна; GRANT/REVOKE сохраняются, повторно применены для
  явности). Схема таблиц не меняется → ERD не трогаем.
- **pgTAP.** `supabase/tests/20_accept_invite_reactivation_test.sql` (план 6):
  - F15-1: первый accept инвайта — INSERT-путь; строка появилась (`role=editor`),
    `deleted_at IS NULL`.
  - F15-2 setup: с��рока становится soft-deleted (симуляция leave через прямой
    `UPDATE` — RPC-контракт `remove_workspace_member` покрыт тестом 14).
  - F15-2 accept: повторный accept `inv20b` (role=viewer) — UPDATE-путь; строка
    живая, роль обновилась на viewer, uuid membership-строки НЕ изменился (важно
    для клиентского pull-matcher).
- **Прод-проба (ROLLBACK).** Функция подменена в транзакции, вызвана под JWT
  `fc592c97…` для `inv_6b84eb6b…`. Результат: возвращена строка
  `wsm_13afdb1b…`, `deleted_at = null`, `role = editor`, `version = 2 → 3`.
  Изменения откачены; тестовое состояние прод-БД восстановлено.

## Последствия

- Пользователь может выйти из shared и вернуться туда же по повторному инвайту
  — без ошибки 409 и без ручного вмешательства DBA.
- LWW клиента подхватит обновление: клиент, который ещё видит строку как живую
  (не успел применить leave-outbox от того же аккаунта), обновит `role` и
  `version`. Клиент, который уже применил leave (строка soft-deleted локально),
  получит по pull `deleted_at=null` и восстановит её.
- `id` membership-строки stable → outbox других клиентов, которые мог��т
  относиться к этой строке (напр., активность), продолжают работать без
  ремаппинга.
- Другой сценарий, который тоже начнёт работать: owner отправляет invite
  бывшему участнику, которого он же ранее «удалил» (owner remove). До 0040
  повторный invite → accept тоже падал с 23505. После 0040 работает.

## Что осталось (не в этом PR)

- **Malformed local SQLite** у части пользователей (симптом «ws пропадают при
  рестарте», консоль F12: `database disk image is malformed`, code 11). Это
  клиентский локальный дефект, не серверный — расследование выделено в **F16**
  (см. roadmap §7.16, план: `PRAGMA integrity_check` при старте, транзакционные
  границы миграций v13→v14, восстановление из облака при обнаружении corruption).
  Не блокирует F15.
- **`sync_devices RLS violation` (~30/час)** — вероятно следствие malformed
  клиентской БД (битый `client_id`). Расследуется вместе с F16.
