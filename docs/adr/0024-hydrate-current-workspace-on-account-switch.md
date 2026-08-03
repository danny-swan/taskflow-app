# ADR 0024: Гидрация `currentWorkspaceId` при смене аккаунта — переиспользование логики `init()` (F31)

- **Статус:** accepted
- **Дата:** 03.08.2026
- **Ветка:** `feat/workspaces`
- **Связано:** [ADR 0021](0021-free-slot-workspace-aware.md) (F28), [ADR 0022](0022-restore-legacy-ws-normalize.md) (F29), [ADR 0023](0023-free-restore-from-file-snapshot.md) (F30) — все три чинят слот/снимок free-аккаунта, этой правкой НЕ затронуты; `src/store/useStore.ts` (`init()`, `reloadAccountBinding()`, `loadWorkspaces()`, `setWorkspaces()` — уже существовали); roadmap §7.26 (F31)

## Контекст

Симптом, стабильно воспроизводимый у пользователя: free-аккаунт переключается → список задач пуст, хотя счётчик в сайдбаре и статистика (считают по-другому) показывают верное число. Pro не затронут — у него источник истины облако.

Диагноз подтверждён по реальным данным пользователя (`data.db` + `taskflow-4.log`, 03.08.2026) и по коду `src/store/useStore.ts` на HEAD `80626b5`:

- Лог показывает, что слот free-аккаунта (`localAccountStore`, [ADR 0014](0014-free-tier-local-account-store.md)) восстанавливается ПРАВИЛЬНО: `restored slot for <uid>: 4 tasks, 5 tags, 14 statuses`. Данные целы, `workspace_id` у задач верный, `settings.current_workspace_id` в БД корректен. Значит F28/F29/F30 (слот/снимок) здесь ни при чём — эта ветка не тронута этим фиксом.
- Все страницы читают задачи через ws-scoped хуки (`useCurrentWorkspace*` в `src/store/workspaceScope.ts`), которые фильтруют полный набор `tasks` по **in-memory** `currentWorkspaceId` (комментарий в `useStore.ts:130-133`).
- `init()` (холодный старт) читает `current_workspace_id` из settings, валидирует его против набора `workspaces`, иначе берёт `pickDefaultWorkspaceId(workspaces)`, и синхронно персистит обратно в settings при расхождении — пользователь подтверждал, что после перезапуска приложения данные видны, то есть этот путь работает.
- Путь смены аккаунта (`AccountSwitchGate.tsx` → `reloadAccountBinding()` + `refresh()`) НЕ повторяет эту гидрацию:
  - `refresh()` заливает `tasks`/`statuses`/`tags` целиком, но не трогает `currentWorkspaceId`.
  - `reloadAccountBinding()` перечитывает `boundUserId` и вызывает `loadWorkspaceMembers()` + `loadWorkspaces()`.
  - `loadWorkspaces()` подхватывает `current_workspace_id` из settings только если он валиден в новом наборе И отличается от текущего in-memory значения; иначе `setWorkspaces()` сам решает, оставлять ли текущий id — и если старый in-memory id (от ПРЕДЫДУЩЕГО аккаунта) случайно всё ещё присутствует в новом списке workspaces (например, совпадающий по строке id личного ws), сброса на дефолт не происходит, а нужной синхронизации с settings — тоже.
  - Итог: `currentWorkspaceId` в памяти остаётся залипшим от предыдущего аккаунта (или уезжает на дефолт, не совпадающий с восстановленным `current_workspace_id`). `refresh()` уже залил верные задачи в `tasks`, но ws-scoped фильтр по устаревшему `currentWorkspaceId` их не показывает — список пуст, а счётчик/статистика (которые считают иначе, не через этот фильтр) показывают верное число.

## Решение

Не вводить новый механизм — переиспользовать буквально ту же логику, что уже работает в `init()`.

1. Логика выбора «текущий workspace» из `init()` (было инлайном: прочитать `current_workspace_id` из settings → валидировать против `workspaces` → иначе `pickDefaultWorkspaceId` → персистить обратно при расхождении) вынесена в чистую функцию-helper:

   ```ts
   function hydrateCurrentWorkspaceId(workspaces: Workspace[]): string | null {
     const savedWsId = (readSetting('current_workspace_id') || '').trim() || null;
     const currentWorkspaceId =
       savedWsId && workspaces.some(w => w.id === savedWsId)
         ? savedWsId
         : pickDefaultWorkspaceId(workspaces);
     if (currentWorkspaceId && currentWorkspaceId !== savedWsId) {
       try {
         db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', ['current_workspace_id', currentWorkspaceId]);
       } catch (e) { console.warn('[hydrateCurrentWorkspaceId] persist current_workspace_id failed:', e); }
     }
     return currentWorkspaceId;
   }
   ```

   (`src/store/useStore.ts:414-445`)

2. `init()` вызывает этот helper вместо инлайн-кода (`src/store/useStore.ts:617-621`) — поведение `init()` не изменилось, это чистый рефактор без смены логики.

3. `reloadAccountBinding()` вызывает тот же helper **ПОСЛЕ** `loadWorkspaces()` (чтобы `get().workspaces` был уже новым набором входящего аккаунта) и синхронно выставляет `currentWorkspaceId` + `overdueMode`:

   ```ts
   reloadAccountBinding() {
     const boundUserId = (readSetting('bound_user_id') || '').trim() || null;
     set({ boundUserId });
     get().loadWorkspaceMembers();
     get().loadWorkspaces();
     const ws = get().workspaces;
     const cwid = hydrateCurrentWorkspaceId(ws);
     set({ currentWorkspaceId: cwid, overdueMode: readOverdueModeForWs(cwid) });
   }
   ```

   (`src/store/useStore.ts:781-794`)

Путь смены аккаунта становится идентичен холодному старту: та же валидация, тот же fallback на дефолт, тот же персист при расхождении.

## Почему это просто и надёжно, а не костыль

- **Не вводится новый механизм.** Используется ровно та же логика, что уже работает в `init()` (подтверждено пользователем на практике — после перезапуска приложения данные видны).
- **Один helper, один дополнительный вызов.** Минимальный диффф — не добавляется ни промежуточный кеш, ни доп. слой синхронизации поверх `loadWorkspaces()`/`setWorkspaces()`.
- **`loadWorkspaces()`/`setWorkspaces()` не переписаны** — их собственная (менее надёжная) попытка подхватить `current_workspace_id` остаётся как есть; `reloadAccountBinding()` просто дозаписывает корректное значение поверх ПОСЛЕ них, тем же способом, что и `init()`.

## Границы

- **Pro/Trial не затронуты** — правка находится в общем (не free-специфичном) коде `useStore.ts`, но пользователи Pro/Trial синхронизируют данные из облака, и `currentWorkspaceId` для них так же корректно гидрируется этим путём; сама природа бага (залипание после смены аккаунта) наблюдалась только у free — с Pro сохраняется поведение, к которому пользователь не имел претензий.
- **Слот free-аккаунта и файловый снимок не тронуты.** `localAccountStore.ts`, `snapshots.ts` и restore-логика в `AccountSwitchGate.tsx` (F30, ADR 0023) — без изменений. Диагностика по логу подтвердила, что восстановление слота работает правильно; этот фикс решает отдельную проблему (гидрация in-memory-указателя на ws), а не восстановление данных.
- **`setWorkspaces()` не изменён.** Его собственный fallback-механизм (`pickDefaultWorkspaceId`, если текущий id исчез из набора) продолжает работать как раньше — для случаев вроде удаления текущего ws. `hydrateCurrentWorkspaceId` в `reloadAccountBinding()` просто гарантирует корректный результат независимо от порядка/условий срабатывания этого fallback'а.

## Альтернативы — рассмотрены и отклонены

- **Чинить условие в `loadWorkspaces()`/`setWorkspaces()`.** Отклонено: логика там завязана на несколько условий (валидность, отличие от in-memory, присутствие старого id в новом наборе) и уже используется в нескольких местах (`createWorkspace`, `deleteWorkspace`, `removeWorkspaceMember`, `switchWorkspace`) — трогать её рискует задеть другие сценарии. Переиспользование готовой рабочей логики `init()` через отдельный helper безопаснее и предсказуемее.
- **Добавить отдельный «сброс кеша» перед сменой аккаунта.** Отклонено как новый слой поверх существующего механизма — противоречит принципу «просто и надёжно, без костыля на костыль», явно запрошенному пользователем.

## Тесты

Новый тест в `src/store/useStore.test.ts` (группа `reloadAccountBinding гидрирует currentWorkspaceId (F31)`):

1. Сидируются 2 workspace входящего аккаунта (personal `ws_A` с 2 задачами, `ws_B` без задач), `settings.current_workspace_id = 'ws_A'`, `settings.bound_user_id = 'user-new'`.
2. In-memory `currentWorkspaceId` выставляется в `'ws_STALE_from_prev_account'` — эмуляция залипания от предыдущего аккаунта (несуществующий id в новом наборе).
3. Вызывается `reloadAccountBinding()`.
4. Assert: `currentWorkspaceId === 'ws_A'` (гидрировалось из settings, а не `ws_STALE` и не `pickDefaultWorkspaceId`, поскольку сохранённый id валиден).
5. Assert: ws-scoped выборка (`filterByWorkspace` из `workspaceScope.ts`) для текущего `currentWorkspaceId` возвращает обе задачи аккаунта — то есть фильтр теперь показывает данные (репродукция и фикс симптома).

Регресс: существующие тесты `useStore.test.ts` (включая старую группу `reloadAccountBinding (Fix 2)`), `useStore.integration.test.ts`, `AccountSwitchGate.test.tsx`, `accountSwitchRestore.test.tsx` остаются зелёными без изменения ожиданий.

Запуск: `./node_modules/.bin/vitest run src/store/useStore.test.ts src/store/useStore.integration.test.ts src/components/AccountSwitchGate.test.tsx src/components/accountSwitchRestore.test.tsx --pool=forks --poolOptions.forks.maxForks=2` и `./node_modules/.bin/tsc --noEmit`.

## Не делать

- Не трогать `AccountSwitchGate.tsx` restore-логику слота/снимка (F30, ADR 0023) — она работает правильно (подтверждено логом пользователя).
- Не трогать `localAccountStore.ts` / `snapshots.ts`.
- Не трогать Pro/Trial-ветку синхронизации.
- Не запускать `npm run build` (известное OOM-ограничение среды) — верификация ограничена `vitest` + `tsc --noEmit`.

## Последствия

- Смена аккаунта гидрирует `currentWorkspaceId` из settings тем же способом, что и холодный старт — устраняет расхождение между двумя путями инициализации состояния.
- Схема БД не менялась, миграций нет — правка полностью в клиентском TypeScript-коде (`src/store/useStore.ts`).
- **Статус верификации:** реализовано, автотесты (vitest) зелёные, `tsc --noEmit` чист. Фикс **НЕ подтверждён вручную на реальных данных пользователя** — требуется ручная проверка перед тем, как считать баг устранённым.
