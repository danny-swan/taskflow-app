/**
 * TaskFlow changelog — auto-generated "What's New" section in Help.
 * Add new entries at the top (index 0 = latest).
 */
export interface ChangelogEntry {
  version: string;
  date: string;
  items: {
    en: string[];
    ru: string[];
  };
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '0.9.28',
    date: '2026-07-05',
    items: {
      ru: [
        'Новая фича — автоочистка выполненных задач. Секция «Выполнено» на доске больше не разрастается бесконечно: в выбранный день недели (по умолчанию — воскресенье) при запуске приложения все выполненные задачи старше N дней (по умолчанию — 7) тихо переносятся в «Удалено». Задачи остаются в Статистике → Удалённые, откуда их можно восстановить.',
        'Настройки → Общие: новый блок «Автоочистка выполненных» с четырьмя контролами: (1) чекбокс вкл/выкл, (2) выбор дня недели, (3) возрастной фильтр в днях, (4) кнопка «Почистить сейчас» с confirm-диалогом для ручного запуска в любой момент.',
        'Автозапуск умеет в catch-up: если вы не открывали приложение в выбранный день недели (воскресенье — типичный выходной), автоочистка сработает при ближайшем следующем запуске. Алгоритм: трекаем last_run; если от него прошло ≥7 дней или в интервале (last_run, today] был целевой день — запускаем сейчас.',
        'Тост с Undo: при автоматическом срабатывании появляется уведомление «Автоочистка: N задач архивировано» с кнопкой «Отменить» (6 сек). Клик возвращает все архивированные задачи обратно в «Выполнено».',
        'Стратегия опт-ин/опт-аут: для новых баз (без задач на момент первого запуска) автоочистка включена по умолчанию; для старых выключена (чтобы миграция не вынесла задачи незамеченными). Зафиксированное значение сохраняется при первом видении ключа, чтобы поведение было стабильным между запусками.',
        'Архитектурно: «выполненная» задача = статус с behavior=archive И is_technical=0 (то есть «Выполнено», но не техническое «Удалено»). Кандидаты отбираются по finish_date (fallback — updated_at) старше пороговой даты. Soft-delete ставит archived=1 + status_id=deleted — тот же эффект, что клик по 🗑 на карточке.',
        'Помощь: в секции «📋 Основы» добавлен FAQ «Как работает автоочистка выполненных задач?» — с объяснением catch-up логики, opt-in/opt-out стратегии и как восстановить задачи через Статистику.',
      ],
      en: [
        'New feature — auto-cleanup of completed tasks. The «Done» section on the board no longer grows endlessly: on the selected day of week (default — Sunday) at app startup, all completed tasks older than N days (default — 7) are silently moved to «Deleted». Tasks remain in Statistics → Deleted where they can be restored.',
        'Settings → General: new «Auto-cleanup completed» block with four controls: (1) enable/disable checkbox, (2) day-of-week picker, (3) age filter in days, (4) «Clean up now» button with confirm dialog for manual runs anytime.',
        'Auto-run does catch-up: if you didn\'t open the app on the selected day (Sunday is a typical weekend), auto-cleanup runs on the next startup. Algorithm: we track last_run; if ≥7 days have passed since it, or the target day fell inside (last_run, today], we run now.',
        'Toast with Undo: on auto-run the app shows «Auto-cleanup: N tasks archived» with an «Undo» button (6 sec). Click restores all archived tasks back to «Done».',
        'Opt-in/opt-out strategy: for new databases (no tasks on first launch) auto-cleanup is enabled by default; for existing ones — disabled (so migration doesn\'t sweep tasks unnoticed). The fixed value is persisted on first sight of the key so behaviour stays stable across launches.',
        'Architecture: a «completed» task = a status with behavior=archive AND is_technical=0 (i.e. «Done», not the technical «Deleted»). Candidates are picked by finish_date (fallback — updated_at) older than the threshold. Soft-delete sets archived=1 + status_id=deleted — same effect as clicking 🗑 on the card.',
        'Help: added an FAQ «How does auto-cleanup of completed tasks work?» in «📋 Basics» — explaining catch-up logic, opt-in/opt-out strategy and how to restore tasks via Statistics.',
      ],
    },
  },
  {
    version: '0.9.27',
    date: '2026-07-05',
    items: {
      ru: [
        'Настройки: секция «Считать просрочку» переименована в «Логика дедлайнов» — название точнее отражает, что настройка влияет не только на счётчик просрочки, но и на всю логику вычисления дней до/после дедлайна.',
        'Настройки: пояснение «Праздники не учитываются» заменено на «В режиме «Рабочие дни» выходные (Сб-Вс) не учитываются» — термин «праздники» вводил в заблуждение (табеля праздников в приложении нет, отбрасываются только Сб-Вс).',
        'Настройки: рядом с ползунком «Размер текста» появились кнопки − и + — теперь менять шрифт на 1px можно одним кликом, без перетаскивания ползунка. Кнопки дисейблятся на границах диапазона (12–18px).',
        'Раздел Помощь: три FAQ переехали в раздел «📋 Основы», где им логичнее быть: «Что за чипы в топбаре вкладки Задачи?» и «Как читать подсветку дедлайна?» — из Дашборда; «Как работает Отменить в уведомлениях?» — из Диагностики. Ответы на эти вопросы нужны в начале знакомства с приложением, а не в продвинутых разделах.',
        'Раздел Помощь: убраны две внутренние детали, бесполезные конечному пользователю: упоминание файла src/lib/password.ts в FAQ парольной политики и указание пути к Sentry-тогглу в FAQ телеметрии (тоггл уже описан в предыдущем параграфе того же ответа).',
        'Лендинг: баннер с версией в герое теперь обновляется автоматически через GitHub Releases API — было захардкожено «v0.9.22 — стабильный релиз» и не синхронизировалось с реальной версией (в GitHub уже была v0.9.26, на лендинге всё ещё v0.9.22). Fallback-версия в HTML тоже бампнута до v0.9.26.',
      ],
      en: [
        'Settings: the "Overdue counting" section is renamed to "Deadline logic" — the label better reflects that the setting affects not only the overdue counter but the entire days-to/past-deadline calculation.',
        'Settings: "Holidays are not respected" hint is replaced with "In Business days mode the weekend (Sat-Sun) is not counted" — the word "holidays" was misleading (there’s no holiday calendar in the app, only Sat/Sun are skipped).',
        'Settings: the "Text size" slider now has − and + buttons next to it — adjust the font by 1px with a single click without dragging the slider. The buttons disable at the range boundaries (12–18px).',
        'Help section: three FAQs moved to "📋 Basics" where they belong: "What are the chips in the Tasks topbar?" and "How is the deadline coloured?" — from Dashboard; "How does Undo in toasts work?" — from Diagnostics. Users need these answers early, not tucked into advanced sections.',
        'Help section: dropped two internal detail lines useless to end users: the mention of the src/lib/password.ts file in the password-policy FAQ and the redundant path to the Sentry toggle in the telemetry FAQ (the toggle is already described in the previous paragraph of the same answer).',
        'Landing page: the version banner in the hero is now updated automatically via the GitHub Releases API — previously hardcoded as "v0.9.22 — stable release" and out of sync with the real version (GitHub already had v0.9.26 while the landing still said v0.9.22). The fallback version in HTML is also bumped to v0.9.26.',
      ],
    },
  },
  {
    version: '0.9.26',
    date: '2026-07-04',
    items: {
      ru: [
        'Модалка «Смена пароля»: убрано поле «Текущий пароль» и вся reauth-логика. Причина: в v0.9.23 включён Cloudflare Turnstile Secret Key в Supabase Attack Protection, из-за чего любой signInWithPassword (в т.ч. в эфемерном клиенте v0.9.25) стал требовать captchaToken, которого в модалке нет — пользователь получал ошибку «captcha protection: request disallowed (no captcha_token found)». Теперь модалка спрашивает только новый пароль дважды, а updatePassword выполняется под активной сессией. Это стандарт индустрии: Google/GitHub требуют текущий пароль только для критичных операций (2FA, смена email), не для рутинной смены пароля.',
        'Раздел Помощь: горячие клавиши синхронизированы с реальными роутами приложения — было 1=Задачи, 2=Дашборд, 3=Статистика, 4=Настройки, 5=Помощь (без Календаря!), стало 1=Задачи, 2=Календарь, 3=Дашборд, 4=Статистика, 5=Настройки, 6=Помощь. Исправлено в RU и EN.',
        'Раздел Помощь: удалён устаревший FAQ «Как работает облачная синхронизация?» — фича не поставлена (задачи хранятся в локальной SQLite, cloud sync в роадмэпе), формулировка вводила в заблуждение. Секция «☁ Облако и аккаунт» переименована в «👤 Аккаунт и email» и получила новый FAQ «Где хранятся мои задачи?» с честным объяснением.',
        'Раздел Помощь: удалён FAQ «Rate limiting и защита от bruteforce» — детали про Supabase Attack Protection пользователю не полезны, только техническая нагрузка.',
        'Раздел Помощь: FAQ смены пароля обновлён под v0.9.26 (только новый пароль + подтверждение), объяснение почему не требуется текущий пароль.',
      ],
      en: [
        'Change-password modal: the "Current password" field and the entire reauth logic are gone. Root cause: v0.9.23 enabled Cloudflare Turnstile Secret Key in Supabase Attack Protection, so any signInWithPassword (including the ephemeral client from v0.9.25) now requires a captchaToken that the modal cannot supply — users saw "captcha protection: request disallowed (no captcha_token found)". The modal now only asks for the new password twice, and updatePassword runs under the active session. This matches industry standard: Google/GitHub only require the current password for critical ops (2FA, email change), not for routine password rotation.',
        'Help section: hotkeys resynced with actual app routes — was 1=Tasks, 2=Dashboard, 3=Stats, 4=Settings, 5=Help (Calendar missing!), now 1=Tasks, 2=Calendar, 3=Dashboard, 4=Stats, 5=Settings, 6=Help. Fixed in both RU and EN.',
        'Help section: dropped the outdated "How does cloud sync work?" FAQ — the feature is not shipped (tasks live in local SQLite, cloud sync is on the roadmap), the wording was misleading. "☁ Cloud & account" section renamed to "👤 Account & email" with a new "Where are my tasks stored?" FAQ that tells the truth.',
        'Help section: dropped the "Rate limiting and bruteforce protection" FAQ — the Supabase Attack Protection internals aren\'t useful to users, only technical noise.',
        'Help section: password-change FAQ updated for v0.9.26 (new password + confirmation only), with an explanation of why the current password is no longer required.',
      ],
    },
  },
  {
    version: '0.9.25',
    date: '2026-07-04',
    items: {
      ru: [
        'Модалка «Смена пароля»: исправлены 3 бага. (1) При вводе символа в поле «Новый пароль» фокус прыгал обратно на «Текущий пароль» — компонент PasswordField был определён внутри тела модалки, и React пересоздавал функцию на каждом setState, из-за чего input-ы размонтировались; PasswordField вынесен наружу. (2) Placeholder показывал «минимум 6 символов», хотя политика Supabase уже 8 + Aa1 — используем shared валидацию из src/lib/password.ts. (3) При верном текущем пароле выдавалась ошибка «Неверный пароль»: reauth через глобальный supabase-клиент выпускал новую сессию и переписывал токены; заменили на эфемерный клиент (persistSession: false), который проверяет пароль, не трогая текущую сессию.',
        'Раздел Помощь: полный аудит с v0.9.0. Добавлены разделы «Облако и аккаунт» (регистрация, verify email, забыл пароль, keep-alive), «Безопасность и приватность» (политика паролей, Sentry с opt-out, PolyForm лицензия, Privacy Policy) и «Обновления» (auto-updater, где взять последнюю версию). В «О приложении» добавлена ссылка на сайт yourtaskflow.app первой строкой; ссылка на GitHub переведена в раздел «Для разработчиков» мелким текстом.',
        'Инфраструктура: валидация пароля вынесена в общий src/lib/password.ts (DRY), используется одновременно AuthScreen и PasswordResetModal. Больше не будет ситуации, когда правила разошлись между регистрацией и сменой пароля.',
      ],
      en: [
        'Change-password modal: 3 bugs fixed. (1) Typing into «New password» kicked focus back to «Current password» — PasswordField was declared inside the modal body, so React recreated the function on every setState and remounted the inputs; PasswordField is now hoisted outside. (2) Placeholder still said «at least 6 characters», though Supabase policy is 8 + Aa1 — we now use shared validation from src/lib/password.ts. (3) Correct current password was rejected as wrong: reauth through the global supabase client issued a new session and overwrote tokens; replaced with an ephemeral client (persistSession: false) that verifies the password without touching the active session.',
        'Help section: full audit from v0.9.0. New sections «Cloud & account» (signup, verify email, forgot password, keep-alive), «Security & privacy» (password policy, Sentry with opt-out, PolyForm license, Privacy Policy) and «Updates» (auto-updater, where to grab the latest build). About block now shows yourtaskflow.app as the primary link; the GitHub link moved to a smaller «For developers» line.',
        'Infrastructure: password validation extracted into shared src/lib/password.ts (DRY), used by both AuthScreen and PasswordResetModal. No more scenarios where the rules drift apart between signup and change-password.',
      ],
    },
  },
  {
    version: '0.9.24',
    date: '2026-07-04',
    items: {
      ru: [
        'Hotfix регистрации: CSP-политика блокировала фреймы challenges.cloudflare.com, из-за чего Turnstile-виджет не грузился, кнопка «Создать аккаунт» оставалась disabled без объяснения. Разрешили challenges.cloudflare.com в frame-src, и добавили видимое сообщение об ошибке, если onError сработает.',
        'Политика паролей: клиентская валидация обновлена под настройки Supabase — минимум 8 символов, обязательные строчная буква, заглавная буква и цифра. Placeholder в поле «Пароль» на экране регистрации теперь показывает актуальные правила.',
      ],
      en: [
        'Signup hotfix: CSP blocked challenges.cloudflare.com frames, so the Turnstile widget silently failed to load and the «Create account» button stayed disabled with no explanation. We allowed challenges.cloudflare.com in frame-src and added a visible error message if onError fires.',
        'Password policy: client-side validation is now aligned with Supabase settings — minimum 8 characters, lowercase, uppercase and digit required. The password placeholder on the signup screen now reflects the updated rules.',
      ],
    },
  },
  {
    version: '0.9.23',
    date: '2026-07-04',
    items: {
      ru: [
        'Sentry: интеграция для сбора необработанных ошибок и вылетов. Ошибки помогают быстрее чинить баги, PII не собираются (email, содержимое задач). Можно отключить одной кнопкой в Настройки → Приватность.',
        'Cloudflare Turnstile: CAPTCHA-виджет на экране регистрации защищает от массового автоматического создания аккаунтов. Виджет — invisible/managed режим, реальные пользователи капчу не решают вручную.',
        'Supabase security: включены Rate Limiting (защита от bruteforce), Attack Protection (блок подозрительных IP) и Security Email Notifications (уведомления о новых входах).',
        'Privacy Policy: доступна на сайте yourtaskflow.app/privacy.html и внутри приложения — Настройки → Приватность → «Политика конфиденциальности».',
      ],
      en: [
        'Sentry: integration for capturing unhandled errors and crashes. Errors help us fix bugs faster; no PII collected (no email, no task contents). You can disable telemetry with one toggle in Settings → Privacy.',
        'Cloudflare Turnstile: CAPTCHA widget on the signup screen prevents mass automated account creation. Uses invisible/managed mode — real users don’t solve puzzles manually.',
        'Supabase security: Rate Limiting (bruteforce protection), Attack Protection (suspicious-IP blocking) and Security Email Notifications (new sign-in alerts) are enabled.',
        'Privacy Policy: available on yourtaskflow.app/privacy.html and inside the app — Settings → Privacy → «Privacy Policy».',
      ],
    },
  },
  {
    version: '0.9.22',
    date: '2026-07-04',
    items: {
      ru: [
        'Инфраструктура: E2E-тестов стало больше — было 4, стало 13. Новые сценарии покрывают редактирование заголовка задачи через большую модалку, удаление задачи с overlay-подтверждением, отмену удаления, экспорт данных в JSON (с проверкой содержимого backup), импорт JSON-бэкапа (replace-режим), переключение между списочным и канбан-режимом, бейджи «Просрочено» и «Сегодня» на карточках задач и появление задачи с дедлайном на странице «Календарь». В e2e-режиме онбординг теперь не рендерится вообще — раньше его spotlight-overlay перехватывал клики Playwright и делал тесты флаки.',
        'Supabase keep-alive: TaskFlow при каждом старте fire-and-forget-запросом (SELECT limit 1) прогревает подключение к базе. Плюс добавлен GitHub Actions workflow `supabase-ping.yml` — раз в 3 дня по расписанию делает лёгкий REST-запрос к базе. Free-tier Supabase приостанавливает проект после 7 дней без активности (первые запросы после пробуждения — 10-30 секунд), а после 90 дней проект удаляется. Теперь этого не случится.',
        'Общий счёт тестов: 73 unit-тестов (Vitest) + 13 E2E-тестов (Playwright). Каждый PR прогоняет всё за ~1 минуту, сборка инсталляторов на тег гейтится через `needs: [test, e2e]` — если тесты падают, релиз не собирается.',
        'Для кода видимых изменений нет — это девелопмент-релиз, но плитку обновлений в приложении Вы всё равно увидите: подтверждение того, что автообновление работает.',
      ],
      en: [
        'Infrastructure: the E2E test count grew from 4 to 13. New scenarios cover editing a task title via the large modal, deleting a task with the overlay confirmation, cancelling a deletion, JSON data export (with backup contents validation), JSON backup import (replace mode), toggling between list and kanban view, «Overdue» and «Today» badges on task cards, and a task with a deadline appearing on the Calendar page. In e2e mode the onboarding component is no longer rendered at all — previously its spotlight overlay intercepted Playwright clicks and made tests flaky.',
        'Supabase keep-alive: on every start TaskFlow fires a fire-and-forget request (SELECT limit 1) that warms up the connection to the database. Plus a new GitHub Actions workflow `supabase-ping.yml` runs a light REST request against the base every 3 days on schedule. Free-tier Supabase pauses a project after 7 days of inactivity (the first requests after wake-up take 10-30 seconds), and after 90 days the project is deleted outright. This should no longer happen.',
        'Test counts overall: 73 unit tests (Vitest) + 13 E2E tests (Playwright). Every PR runs everything in ~1 minute, the installers build on tag is gated by `needs: [test, e2e]` — if tests fail, no release is built.',
        'No user-visible code changes — this is a development release, but you will still see the updates tile in the app: confirmation that auto-update works.',
      ],
    },
  },
  {
    version: '0.9.21',
    date: '2026-07-04',
    items: {
      ru: [
        'Инфраструктура: добавлены E2E-тесты (Playwright + Chromium). Покрыты happy paths — смоук-тест старта приложения, создание задачи через модалку, навигация по сайдбару (Задачи → Календарь → Настройки → Задачи) и переключение темы через быстрое меню в сайдбаре. Тесты стартуют веб-версию через Vite dev-server и обходят auth-gate через dev-only флаг `?e2e=1` — в проде байпаса нет, tree-shaking его вырезает.',
        'CI: в workflow `test.yml` добавлен job `e2e` (Ubuntu, Playwright ~30 секунд). В workflow `build.yml` сборка на тег теперь гейтится через `needs: [test, e2e]` — если сломан UI-flow, тег не соберётся, инсталляторы не выйдут в релиз.',
        'Инфраструктура: Vitest понижен с 4.x до 3.x — версия 4 приволокла transitive vite@8, конфликтующий с нашим vite@5 (dev-сервер падал на sql.js). Prod-билд не был затронут, но dev-разработка была сломана.',
        'Инфраструктура: убран `optimizeDeps.exclude: ["sql.js"]` из `vite.config.ts` — без него Vite корректно оптимизирует CJS-модуль sql.js в ESM. Ошибка `does not provide an export named "default"` в dev-сервере больше не воспроизводится.',
        'Для кода видимых изменений нет — это чисто девелопмент-релиз: инфраструктура тестов теперь покрывает и unit (73 теста), и E2E (4 теста), любой сломанный UI-flow будет пойман до выпуска.',
      ],
      en: [
        'Infrastructure: E2E tests added (Playwright + Chromium). Happy paths covered — app start smoke test, task creation via modal, sidebar navigation (Tasks → Calendar → Settings → Tasks) and theme switching via the quick menu in the sidebar. Tests start the web version via Vite dev server and bypass the auth-gate through a dev-only `?e2e=1` flag — no bypass exists in prod builds, tree-shaking strips it.',
        'CI: an `e2e` job was added to `test.yml` (Ubuntu, Playwright ~30 seconds). The `build.yml` workflow now gates tag builds via `needs: [test, e2e]` — if any UI flow breaks, the tag will not build and installers will not ship.',
        'Infrastructure: Vitest downgraded from 4.x to 3.x — v4 pulled in transitive vite@8, conflicting with our vite@5 (the dev server broke on sql.js). Prod builds were unaffected, but dev work was blocked.',
        'Infrastructure: `optimizeDeps.exclude: ["sql.js"]` was removed from `vite.config.ts` — without it, Vite correctly pre-bundles the sql.js CJS module into ESM. The `does not provide an export named "default"` dev-server error is no longer reproducible.',
        'No visible changes in the app — this is a pure development release: the test infrastructure now covers both unit (73 tests) and E2E (4 tests), any broken UI flow will be caught before shipping.',
      ],
    },
  },
  {
    version: '0.9.20',
    date: '2026-07-04',
    items: {
      ru: [
        'Инфраструктура: в проект добавлены unit-тесты (Vitest). Первые 73 теста покрывают форматирование дат, markdown-чекбоксы в комментариях (parse/toggle/insert), детектор пересечений дедлайна, расчёт календарных / будних дней до дедлайна, выбор читаемого цвета текста для тегов и деривед-хелперы Zustand-стора (visibleStatuses / visibleTasks / getDeletedStatusId / тосты).',
        'CI: добавлен workflow `test.yml` на Ubuntu — запускается на каждый PR и push в main (прогон ~1 минута). Сборка инсталляторов на тег теперь гейтится через needs: test — если тесты или typecheck падают, тег не соберётся, релиз не создастся.',
        'Для кода видимых изменений нет — это чисто девелопмент-релиз: в следующих версиях обновления будут стабильнее, регрессы ловятся до выпуска.',
      ],
      en: [
        'Infrastructure: unit tests added (Vitest). The first 73 tests cover date formatting, markdown checkboxes in comments (parse / toggle / insert), the overdue-event detector, calendar / business days-to-deadline math, readable text colour for tags, and Zustand store derived helpers (visibleStatuses / visibleTasks / getDeletedStatusId / toasts).',
        'CI: new `test.yml` workflow on Ubuntu — runs on every PR and push to main (~1 minute). The installers build on tag is now gated by `needs: test` — if tests or typecheck fail, no tag is built and no release is published.',
        'No user-visible code changes — this is a pure infrastructure release. Future updates should be more stable, regressions caught before shipping.',
      ],
    },
  },
  {
    version: '0.9.19',
    date: '2026-07-04',
    items: {
      ru: [
        'В онбординг вернулась подсветка: элемент интерфейса, о котором идёт речь на текущем шаге (фильтры по тегам, переключатель Список/Kanban, кнопка «Новая задача», метрика‑чипы, пункты сайдбара), выделяется мягким «прожектором» — вокруг него затемняется фон, а сам элемент остаётся ярким. Между шагами подсветка плавно переезжает с одного элемента на другой (240 мс).',
        'Позиционирование карточки — безопасное: карточка всегда в одном из трёх фиксированных положений (сверху / по центру / снизу) и выбирается автоматически по тому, где сейчас находится подсветка. За экран ничего не уезжает, даже на маленьких окнах.',
      ],
      en: [
        'Spotlight is back in the onboarding: the UI element referenced by the current step (tag filters, List/Kanban toggle, «New task» button, metric chips, sidebar items) is highlighted with a soft spotlight — the surrounding area dims while the element itself stays bright. Between steps the spotlight smoothly slides from one element to another (240 ms).',
        'Tooltip positioning is now safe: the card is always in one of three fixed positions (top / center / bottom), picked automatically based on where the spotlight is. Nothing can drift off-screen anymore, even in small windows.',
      ],
    },
  },
  {
    version: '0.9.18',
    date: '2026-07-04',
    items: {
      ru: [
        'Онбординг полностью переписан. Вместо тултипа, который пытался прилепиться к кнопкам интерфейса (и иногда уезжал за экран) — теперь один аккуратный модал по центру экрана. На каждом шаге автоматически переключается соответствующая вкладка, чтобы видно было о чём речь. Сверху карточки — прогресс-полоска.',
        'Содержание тура расширено: 10 шагов вместо 11 (убрал дубль «Навигация»), добавлена вкладка Статистики, упомянута синхронизация через Supabase.',
      ],
      en: [
        'Onboarding rewritten from scratch. Instead of a tooltip trying to stick to UI buttons (and sometimes drifting off-screen), the tour now shows one clean modal centered on the screen. Each step automatically switches to the relevant tab in the background so you can see what is being described. Progress bar sits at the top of the card.',
        'Content expanded: 10 steps instead of 11 (removed duplicate «Navigation»), added a Stats step, mentioned optional Supabase cloud sync.',
      ],
    },
  },
  {
    version: '0.9.17',
    date: '2026-07-04',
    items: {
      ru: [
        'Хотфикс онбординга: у части пользователей v0.9.16 приложение падало в белый экран при клике «Пройти тур заново». Логика позиционирования возвращена к стабильной v0.9.15, при этом плавные переходы между шагами и отсутствие вспышек в центре сохранены.',
        'Дополнительно: онбординг обёрнут в защитный слой (React error boundary). Если в туре когда-нибудь снова возникнет ошибка, приложение больше не уходит в белый экран — тур автоматически помечается как пройденный, а Задачи/Календарь/Настройки продолжают работать.',
      ],
      en: [
        'Onboarding hotfix: some users on v0.9.16 saw a white screen after clicking «Restart the tour». Positioning logic is rolled back to the stable v0.9.15 version, while the smooth step transitions and no-center-flashes stay in place.',
        'Extra safety: the onboarding is now wrapped in a React error boundary. If the tour ever crashes again, the app no longer goes blank — the tour is marked as completed automatically and Tasks/Calendar/Settings keep working.',
      ],
    },
  },
  {
    version: '0.9.16',
    date: '2026-07-03',
    items: {
      ru: [
        'Онбординг: убрали микро-прыжки в центр при переключении шагов. Теперь tooltip плавно перемещается между шагами с CSS-анимацией 220ms, без вспышек в центре экрана.',
      ],
      en: [
        'Onboarding: removed micro-jumps to center on step transitions. The tooltip now smoothly slides between steps with a 220ms CSS animation, no more center-screen flashes.',
      ],
    },
  },
  {
    version: '0.9.15',
    date: '2026-07-03',
    items: {
      ru: [
        'Онбординг: тултипы больше не мигают. Полностью отказались от асинхронного floating-ui — позиция теперь считается одним синхронным шагом до paint.',
        'Смена пароля: теперь спрашивается текущий пароль. Если не помните его — выйдите и воспользуйтесь ссылкой «Забыли пароль?» на экране входа.',
        'Иконка «глаз» в полях пароля: клик включает превью введённого пароля. Работает на входе, регистрации и в модалке смены пароля.',
      ],
      en: [
        'Onboarding: tooltips no longer flash. floating-ui is out — the position is now computed in one synchronous step before paint.',
        'Change password: the current password is now required. If you forgot it, sign out and use "Forgot password?" on the sign-in screen.',
        'Eye icon in password fields: click to preview the typed password. Works on sign-in, sign-up and in the change-password modal.',
      ],
    },
  },
  {
    version: '0.9.14',
    date: '2026-07-03',
    items: {
      ru: [
        'Онбординг: наконец полностью починен — подсказки на втором и дальше шагах больше не мигают в верхнем левом углу перед появлением у нужного элемента.',
        'Забыли пароль: на экране входа появилась ссылка «Забыли пароль?» — придёт письмо со ссылкой, которая откроет TaskFlow и предложит задать новый пароль.',
        'Смена пароля и email: в Настройки → Аккаунт добавлены кнопки «Сменить пароль» и «Сменить email» (только для аккаунтов через пароль). Для смены email на новый адрес придёт письмо-подтверждение.',
        'Запомнить меня: чекбокс на экране входа — email префиллится при следующем запуске. Пароль не хранится из соображений безопасности.',
        'Подтверждение email: новые регистрации через email/пароль теперь требуют подтверждения по ссылке из письма. Существующие аккаунты остаются как есть.',
      ],
      en: [
        'Onboarding: fully fixed at last — tooltips on step 2 and beyond no longer flash in the top-left corner before appearing on the correct element.',
        'Forgot password: a "Forgot password?" link now appears on the sign-in screen. An email with a link opens TaskFlow and prompts you to set a new password.',
        'Change password and email: Settings → Account now has "Change password" and "Change email" buttons (email/password accounts only). Changing email requires confirmation via a link sent to the new address.',
        'Remember me: a checkbox on the sign-in screen — your email is prefilled on the next launch. The password itself is never stored, for security.',
        'Email verification: new email/password sign-ups now require confirmation via a link. Existing accounts stay as-is.',
      ],
    },
  },
  {
    version: '0.9.13',
    date: '2026-07-03',
    items: {
      ru: [
        'Удаление аккаунта: починена серверная часть — раньше при удалении из-под Google-аккаунта возвращалась ошибка «Invalid or expired token». Теперь функция валидирует токен через штатный клиент Supabase и корректно удаляет учётную запись как для email/пароля, так и для входа через Google.',
      ],
      en: [
        'Delete account: fixed the server side — previously deletion under a Google-signed session failed with "Invalid or expired token". The Edge Function now validates the JWT through the standard Supabase client and correctly removes accounts signed in with either email/password or Google.',
      ],
    },
  },
  {
    version: '0.9.12',
    date: '2026-07-03',
    items: {
      ru: [
        'Онбординг: добит крайний случай мигания подсказок в левом верхнем углу между шагами: подсказка теперь появляется только когда floating-ui реально вычислит её позицию (isPositioned=true), а не по самому факту нахождения target-элемента.',
      ],
      en: [
        'Onboarding: patched the last corner-case where the tooltip briefly flashed in the top-left between steps. The tooltip is now shown only once floating-ui has actually positioned it (isPositioned=true), not just when the target element was found.',
      ],
    },
  },
  {
    version: '0.9.11',
    date: '2026-07-03',
    items: {
      ru: [
        'Онбординг: полностью починено позиционирование промежуточных шагов — подсказки больше не мелькают в углу и появляются только после того, как найден целевой элемент.',
        'Вход через Google: теперь можно войти одним кликом через Google-аккаунт. Открывается системный браузер, после подтверждения вы возвращаетесь в приложение автоматически.',
        'Удаление аккаунта: теперь удаляется по-настоящему — вместе с учётной записью Supabase auth (раньше очищался только профиль). Сможете зарегистрироваться на тот же email заново.',
      ],
      en: [
        'Onboarding: intermediate-step tooltip positioning is fully fixed — hints no longer flash in the corner and only appear after the target element is located.',
        'Sign in with Google: one-click sign in via a Google account. Your system browser opens, and after you confirm you are returned to the app automatically.',
        'Delete account: your account is now really deleted — the Supabase auth record is removed together with your profile (previously only the profile was wiped). You can register again with the same email.',
      ],
    },
  },
  {
    version: '0.9.10',
    date: '2026-07-03',
    items: {
      ru: [
        'Исправлено «Failed to fetch» при регистрации и входе: расширена политика безопасности приложения (CSP), теперь запросы к серверу аутентификации проходят корректно.',
        'Политика конфиденциальности: временный контакт разработчика заменён на GitHub Issues (data-request). Добавлено человеческое объяснение того, что такое «хеш пароля» — сам пароль не хранится нигде и не может быть восстановлен, включая разработчиком.',
      ],
      en: [
        'Fixed «Failed to fetch» during sign up and sign in: the app’s Content Security Policy (CSP) has been broadened so that requests to the auth server now go through.',
        'Privacy Policy: the developer’s temporary contact has been replaced with GitHub Issues (data-request). Added a plain-language explanation of what a «password hash» is — the password itself is not stored anywhere and cannot be recovered, including by the developer.',
      ],
    },
  },
  {
    version: '0.9.9',
    date: '2026-07-03',
    items: {
      ru: [
        'Новое: регистрация и вход по email/паролю (и Google-вход — в следующем обновлении). После первого входа приложение работает офлайн до 7 дней, затем просит перелогин. Новая секция Настройки → Аккаунт с профилем, выходом и удалением аккаунта. Содержимое задач по-прежнему хранится только локально — на сервер оно не отправляется.',
        'Онбординг: исправлено позиционирование промежуточных шагов — больше не уезжают в левый верхний угол, появляются рядом с подсвеченным элементом.',
        'Анимации карточек стали заметнее: более плавные fade+scale при создании/удалении задачи и более выразительные layout-переходы при смене статуса.',
        'Релизы: файлы подписи .sig больше не видны в списке артефактов — подписи вшиты в latest.json авто-апдейтера. Пользователь видит только 5 файлов вместо 8.',
        'Добавлена Политика конфиденциальности — полное описание того, какие данные собираются (email, версия приложения, OS, базовая телеметрия без содержимого задач), где хранятся и как удалить аккаунт.',
      ],
      en: [
        'New: sign up and sign in with email/password (Google login coming next update). After first login, the app works offline for up to 7 days and then asks you to sign in again. New Settings → Account section with profile, sign out and account deletion. Task content is still stored only locally — nothing is sent to the server.',
        'Onboarding: intermediate step tooltips no longer drift to the top-left corner; they now appear next to the highlighted UI element.',
        'Card animations are more noticeable: smoother fade+scale on task create/delete and more expressive layout transitions on status change.',
        'Releases: .sig signature files no longer clutter the assets list — signatures are embedded in the auto-updater latest.json. Users now see just 5 files instead of 8.',
        'Added a Privacy Policy with a full description of what data is collected (email, app version, OS, basic telemetry without task content), where it is stored, and how to delete your account.',
      ],
    },
  },
  {
    version: '0.9.8',
    date: '2026-07-03',
    items: {
      ru: [
        'Onboarding — фиксы по фидбэку: приветственное и финальное окна теперь появляются в центре экрана и не перекрывают левое меню. Финальный шаг «Помощь» корректно подсвечивает пункт Помощь в боковом меню.',
        'Добавлены новые шаги тура: подсвечены фильтры по тэгам (верхняя панель вкладки Задачи) и метрические чипы в шапке приложения (всего задач / в работе / на паузе / выполнено / внимание).',
        'Анимации карточек: при смене статуса задачи (и в списке, и на канбане) карточки теперь плавно появляются/исчезают (fade + slide) и остальные карточки плавно пересчитывают позиции (framer-motion layout). На перетаскивание мышью не влияет — dnd по-прежнему отзывчив.',
        'Автообновление: новый раздел Настройки → Обновления. Переключатель «Проверять автоматически» (включён по умолчанию) + кнопка «Проверить сейчас». При обнаружении обновления можно скачать и установить в один клик — приложение само перезапустится. Обновления криптографически подписаны (ed25519) — поддельные апдейты не пройдут.',
      ],
      en: [
        'Onboarding fixes based on feedback: the welcome and final tour windows now appear centered on screen and no longer overlap the left menu. The final “Help” step correctly highlights the Help nav item in the sidebar.',
        'New tour steps added: tag filters (top panel of the Tasks tab) and header metric chips (total / in-progress / paused / done / attention) are now highlighted with explanations.',
        'Card animations: when a task changes status (both in list and kanban view), cards now smoothly appear/disappear (fade + slide) and remaining cards smoothly reflow their positions (framer-motion layout). Mouse drag-and-drop remains fully responsive.',
        'Auto-update: new Settings → Updates section. Toggle “Check automatically” (on by default) + “Check now” button. When an update is available, download and install with one click — the app restarts itself. Updates are cryptographically signed (ed25519), so forged patches won’t pass verification.',
      ],
    },
  },
  {
    version: '0.9.7',
    date: '2026-07-03',
    items: {
      ru: [
        'Обновлённый онбординг для новых пользователей: теперь тур сопровождается подсветкой конкретных элементов интерфейса (dim-фон с «прожектором» вокруг цели), а сам список шагов актуализирован под все возможности, появившиеся с первой версии тура — Kanban-режим, Календарь (Неделя/Месяц + DnD + обратный DnD в «Без дедлайна»), локализованный DatePicker, метрики, шаблоны задач. Тур можно перезапустить в «Помощи».',
        'Fix: локализованный DatePicker больше не «улетает» в левый верхний угол, когда открывается внутри модалки задачи. Popover теперь позиционируется устойчиво к CSS-трансформациям родителя (strategy=fixed) и всплывает точно под полем ввода.',
      ],
      en: [
        'Refreshed onboarding for new users: the tour now highlights specific UI elements (dim background + spotlight around the target), and the list of steps has been brought up to date with everything introduced since the first tour — Kanban view, Calendar (Week/Month + drag-and-drop + reverse DnD into “No deadline”), localised DatePicker, metric chips, task templates. The tour can be re-run from the Help tab.',
        'Fix: the localised DatePicker no longer jumps to the top-left corner when opened inside a task modal. The popover is now positioned reliably regardless of CSS transforms on parents (strategy=fixed) and appears exactly under the input field.',
      ],
    },
  },
  {
    version: '0.9.6',
    date: '2026-07-03',
    items: {
      ru: [
        'Локализация выбора даты: нативный выпадающий календарь (который брал язык из системы Windows) заменён на кастомный компонент. Теперь месяцы, дни недели и кнопки «Очистить» / «Сегодня» — на языке интерфейса приложения (все места: модалка задачи, быстрое добавление, фильтр дат на дашборде).',
        'Календарь: переставлены кнопки в header’е. «Сегодня» + стрелки ‹/› теперь слева рядом с заголовком, переключатель «Неделя / Месяц» — справа (органичнее визуально).',
        'При переключении Неделя → Месяц (и наоборот) теперь всегда открывается отрезок, содержащий текущую дату (а не сохранённый курсор).',
        'Обратный drag-and-drop: карточку из ячейки дня можно перетащить в панель «Без дедлайна» — дедлайн очистится. Панель подсвечивается акцентной рамкой во время перетаскивания.',
      ],
      en: [
        'Date-picker localisation: the native date dropdown (which used to inherit the Windows system language) has been replaced with a custom component. Months, weekdays and the “Clear” / “Today” buttons now follow the app interface language everywhere (task modal, quick add, dashboard date filter).',
        'Calendar: header buttons have been rearranged. “Today” and the ‹/› arrows are now on the left next to the title, while the Week / Month toggle moved to the right (visually more organic).',
        'Switching Week ↔ Month now always opens the segment that contains today’s date (instead of the previously saved cursor).',
        'Reverse drag-and-drop: a card can be dragged from a day cell into the “No deadline” panel — the deadline is cleared. The panel is highlighted with an accent border while dragging.',
      ],
    },
  },
  {
    version: '0.9.5',
    date: '2026-07-03',
    items: {
      ru: [
        'Календарь: новый режим «Неделя» (по умолчанию) + переключатель «Неделя/Месяц» (по принципу «Список/Канбан»).',
        'В режиме «Неделя» карточка задачи показывает полное название (с переносом строк), высота адаптивная. В режиме «Месяц» остаётся компактный вид (с усечением «…»).',
        'Панель «Без дедлайна»: теперь показывает полное название задачи с переносом строк, карточки шире. Если все не влезают — вертикальный скролл (высота панели прежняя).',
        'Панель «Без дедлайна» — единая для обоих режимов и по расположению, и по виду.',
        'Навигация: стрелки «‹» и «›» теперь оформлены как кнопки с рамкой (в стиле «Сегодня»). Кнопка «Сегодня» вынесена вправо и отделена от стрелок — меньше путаницы в группе кнопок.',
        'Названия месяцев в заголовке — теперь в именительном падеже («Июнь 2026», а не «Июня 2026»).',
      ],
      en: [
        'Calendar: new “Week” view (default) and a Week/Month toggle (in the style of List/Kanban).',
        'In Week view a task card shows the full title with line wrapping and adaptive height. Month view keeps the compact card with “…” truncation.',
        'The “No deadline” panel now shows full task titles with line wrapping and wider cards. If they overflow, the panel scrolls vertically (the panel height stays the same).',
        'The “No deadline” panel is shared between Week and Month views — same location and layout.',
        'Navigation: “‹” and “›” are now bordered buttons (matching “Today”). The “Today” button is moved to the right and separated from the arrows — less confusion in the button group.',
      ],
    },
  },
  {
    version: '0.9.4',
    date: '2026-07-03',
    items: {
      ru: [
        'Новая вкладка «Календарь» в левом сайдбаре (между «Задачи» и «Дашборд»). Показывает сетку месяца 7×6 с началом недели с понедельника; при входе открывается текущий месяц.',
        'Каждая ячейка дня — задачи с этим дедлайном в компактной карточке: цветная точка статуса, название и мини-чип тега. Клик по карточке открывает обычную модалку задачи.',
        'Панель «Без дедлайна» внизу страницы (докированная, сворачиваемая): показывает активные задачи без дедлайна. Перетащите карточку из панели в любой день — у задачи проставится дедлайн этого дня.',
        'Drag-and-drop переноса дедлайна: карточку в календаре можно перетащить в другой день — дедлайн обновится. При переходе через «сегодня» подключается уже знакомый детектор просрочки из 0.9.2.',
        'Визуальные подсказки: выходные (Сб/Вс) — с более тёмным фоном; сегодняшний день — рамка цвета акцента; прошедшие дни с активными задачами — красная рамка (напоминание о просрочке).',
        'Календарь показывает только рабочие статусы: архивные и технические (например, «Выполнено») в сетке не отображаются и не мешают планированию.',
        'Навигация: кнопки «‹» / «Сегодня» / «›» + горячая клавиша «2» открывает «Календарь» (клавиши смещены: 1 — Задачи, 2 — Календарь, 3 — Дашборд, 4 — Статистика, 5 — Настройки, 6 — Помощь).',
        'Настройки → «Вкладка по умолчанию»: в список добавлен «Календарь».',
      ],
      en: [
        'New “Calendar” tab in the left sidebar (between “Tasks” and “Dashboard”). Shows a 7×6 month grid with Monday as the first day of the week; the current month is opened on entry.',
        'Each day cell shows tasks with that deadline as a compact card: a coloured status dot, the title and a mini tag chip. Clicking a card opens the usual task modal.',
        'A docked, collapsible “No deadline” panel at the bottom of the page lists active tasks without a deadline. Drag a card from the panel onto any day to assign that day as the deadline.',
        'Drag-and-drop deadline rescheduling: any card on the calendar can be dragged onto another day to update its deadline. Crossing “today” triggers the overdue detector introduced in 0.9.2.',
        'Visual hints: weekends (Sat/Sun) use a darker background; today is highlighted with an accent-coloured border; past days that still hold active tasks get a red border as an overdue reminder.',
        'The calendar shows only working statuses: archived and technical statuses (e.g. “Done”) do not appear in the grid and do not clutter planning.',
        'Navigation: “‹” / “Today” / “›” buttons plus the “2” hotkey open Calendar (hotkeys shifted: 1 — Tasks, 2 — Calendar, 3 — Dashboard, 4 — Statistics, 5 — Settings, 6 — Help).',
        'Settings → “Default tab”: “Calendar” added to the list.',
      ],
    },
  },
  {
    version: '0.9.3',
    date: '2026-07-03',
    items: {
      ru: [
        'Хотфикс: в некоторых сценариях страница «Дашборд» открывалась пустой сразу после установки 0.9.2. Причина — при инициализации Tauri-приложения in-memory кеш БД не содержал таблицы overdue_events, и запрос истории просрочек ронял отрисовку страницы. Схема кеша обновлена, данные из нативной БД теперь подтягиваются полностью, а сам запрос защищён fallback-ом на пустой результат.',
        'Детектор пересечений дедлайна также обёрнут в защитный try/catch — сбой на одной задаче больше не влияет на инициализацию приложения.',
      ],
      en: [
        'Hotfix: in some scenarios the Dashboard page opened blank right after installing 0.9.2. The root cause: on Tauri app init, the in-memory DB cache did not contain the overdue_events table, so the deadline-history query crashed the page render. The cache schema is now updated, data from the native DB is fully hydrated, and the query itself is guarded with a fallback to an empty result.',
        'The deadline-crossing detector is now wrapped in a defensive try/catch — a failure on a single task no longer breaks app initialisation.',
      ],
    },
  },
  {
    version: '0.9.2',
    date: '2026-07-02',
    items: {
      ru: [
        'Настройки → Общие: новый переключатель «Считать просрочку»: Календарные дни (как было раньше) или Рабочие дни (Пн–Пт, без праздников). Влияет на «Просрочено N дн.», «Дней осталось N» на карточках и чип «Внимание» в шапке Задач.',
        'График «Активность»: серия «Просрочено» теперь показывает историю пересечений дедлайна, а не только текущее состояние. Каждый раз, когда задача впервые стала просроченной, фиксируется событие — если потом сдвинули дедлайн вперёд и она снова просрочилась, это новое событие. История накапливается с момента обновления до 0.9.2 (без бэкфилла старых задач).',
        'Канбан: при перетаскивании карточки между колонками теперь показывается плейсхолдер — пунктирная рамка цвета акцента в той позиции, куда встанет карточка. Раньше подсветка была только при движении внутри одной колонки.',
        'Миграция БД v4: добавлена служебная таблица overdue_events для истории пересечений дедлайна; в settings добавлен ключ overdue_mode.',
      ],
      en: [
        'Settings → General: new “Overdue counting” toggle — Calendar days (the previous behaviour) or Business days (Mon–Fri, holidays are not tracked). Affects “Overdue N d” and “N days left” on cards, plus the “Attention” chip in the Tasks header.',
        'Activity chart: the “Overdue” series now shows the history of deadline crossings instead of the current snapshot. Every time a task first became overdue an event is recorded — if you later moved the deadline forward and it slipped again, that’s a new event. History accumulates from the moment you upgrade to 0.9.2 (no backfill of older overdue tasks).',
        'Kanban: when dragging a card between columns, a placeholder is now shown — a dashed accent-coloured slot at the target position. Previously the placement highlight only worked inside a single column.',
        'DB migration v4: added a service table overdue_events for deadline-crossing history; added an overdue_mode key in settings.',
      ],
    },
  },
  {
    version: '0.9.1',
    date: '2026-07-02',
    items: {
      ru: [
        'Косметика графика «Активность»: линия «Новые» теперь всегда синяя (раньше окрашивалась в акцент темы и могла сливаться с другими).',
        'График «Активность»: задачи с дедлайном «сегодня» больше не попадают в серию «Просрочено».',
        'Вставка чекбокса в комментарий: префикс «- [ ]» теперь вставляется в начало текущей строки, а не переносит текст на новую. Повторное нажатие на уже отмеченной строке переключает [ ] ↔ [x] → без чекбокса.',
        'Шапка страницы «Задачи»: поменяли местами кнопки «Свернуть всё» и переключатель «Список / Канбан», чтобы переключатель всегда был рядом с «+ Новая», независимо от вида списка.',
        'Канбан-карточка пересобрана: тег теперь расположен между названием и комментарием, значок прогресса чек-листа — справа от тега. В футере добавилась кнопка «Открыть задачу» (иконка ⊕). Клик открывает модалку только с комментария или с кнопки — теперь тянуть карточку за любую зону безопасно.',
        'Канбан: во время перетаскивания под курсором теперь показывается полноценная превью-карточка вместо сжатой полоски с одним только названием.',
        'Возврат задачи из «Выполнено» (кнопка «↺» на карточке списка или канбана) теперь показывает диалог выбора статуса — как восстановление из Статистики.',
      ],
      en: [
        'Activity chart: the “New” line is now always blue (previously followed the theme accent and could blend with other lines).',
        'Activity chart: tasks with a deadline of “today” are no longer counted as overdue.',
        'Checkbox insertion in a comment: the “- [ ]” prefix is now inserted at the start of the current line instead of pushing the text onto a new line. Pressing the button again on a line that already has the prefix toggles [ ] ↔ [x] → no checkbox.',
        'Tasks page header: swapped “Collapse all” and the “List / Kanban” toggle so the toggle always sits next to “+ New”, regardless of the current view.',
        'Kanban card redesigned: the tag now sits between the title and the comment, the checklist-progress badge is placed right next to the tag. A new “Open task” button (⊕ icon) was added to the footer. Clicking the card opens the modal only from the comment area or that button — you can now drag the card by any other area safely.',
        'Kanban: during a drag, the item under the cursor now shows a full preview card instead of a squeezed strip with just the title.',
        'Reopening a task from “Done” (the “↺” button on a list or kanban card) now shows a status-picker dialog — mirroring the restore flow from the Statistics tab.',
      ],
    },
  },
  {
    version: '0.9.0',
    date: '2026-06-07',
    items: {
      ru: [
        'Новинка: канбан-вид страницы «Задачи». В шапке появился переключатель «Список / Канбан». Режим запоминается.',
        'Канбан: колонки по видимым статусам, горизонтальный скрол, каждая колонка скроллится по вертикали независимо. В хедере колонки — цветная точка, название и счётчик задач.',
        'Канбан-карточка: боковая полоска цвета статуса, название (до 2 строк), сжатый комментарий на 1–3 строки (или прогресс чек-листа), теги, и футер с дедлайном и иконками перетаскивания / «✓» / «🗑». Клик по карточке по-прежнему открывает модалку.',
        'Drag-and-drop в канбане: перетаскивание внутри колонки меняет порядок, между колонками — статус (с тостом «Отменить» при переносе в «Выполнено»).',
        'По умолчанию поменяли порядок статусов: теперь «В процессе» идёт перед «Взять в работу». Миграция выполняет перестановку только если вы вручную не меняли эти статусы.',
        'Справка: раздел «Как удалить или завершить задачу» переписан — теперь чётко объяснено, что удалённые задачи восстанавливаются в Статистике, а безвозвратное удаление происходит только внутри Статистики. Убраны дубли «Что нового в 0.8.13/0.8.14» из Help.',
      ],
      en: [
        'New: kanban view on the Tasks page. A “List / Kanban” toggle is now in the page header. The chosen mode is remembered.',
        'Kanban: columns by visible statuses, horizontal scroll, each column scrolls vertically independently. Column header shows the status colour dot, name and task count.',
        'Kanban card: a coloured side bar for the status, title (up to 2 lines), a compact comment of 1–3 lines (or checklist progress), tags, and a footer with the deadline and drag / “✓” / “🗑” icons. Clicking the card body still opens the task modal.',
        'Kanban drag-and-drop: dragging within a column reorders tasks, dragging between columns changes the status (with an “Undo” toast when dropped into “Done”).',
        'Default status order changed: “In progress” now comes before “Take into work”. The migration swaps them only if you haven’t reordered those statuses yourself.',
        'Help: “How do I complete or delete a task?” rewritten — it now clearly explains that deleted tasks are restorable from the Statistics tab, and only Statistics-delete is permanent. Duplicate “What’s New in 0.8.13/0.8.14” sections removed from Help.',
      ],
    },
  },
  {
    version: '0.8.17',
    date: '2026-06-06',
    items: {
      ru: [
        'Фикс: модалка «Название шаблона» открывалась «под» модалкой задачи и пользователь её не видел. Причина — transform-анимация родителя ломала position:fixed внутри. Теперь PromptDialog рендерится через React Portal в body.',
        'Фикс: задача из сидового шаблона попадала в «Важно» вместо «Взять в работу». Добавлен второй fallback: если сохранённый в шаблоне status_id не найден, сначала ищется статус с именем «Взять в работу», и только если его нет — берётся первый видимый статус.',
      ],
      en: [
        'Fix: the “Template name” input modal opened underneath the task modal and was invisible to the user. Root cause was the parent’s transform animation breaking position:fixed inside. PromptDialog is now rendered via a React Portal to body.',
        'Fix: tasks created from the seed template fell into “Important” instead of “Take into work”. Added a second fallback: if the template’s saved status_id is missing, first look up a status named “Взять в работу” before falling back to the first visible status.',
      ],
    },
  },
  {
    version: '0.8.16',
    date: '2026-06-06',
    items: {
      ru: [
        'Кнопки вставки чекбоксов (☐ Чекбокс / ☑ Готово / • Список) теперь есть и в модалке «+ Новая задача» — в 0.8.14/0.8.15 они по ошибке были добавлены только в модалку редактирования.',
      ],
      en: [
        'Checkbox insert buttons (☐ Checkbox / ☑ Done / • List) are now also available in the “+ New task” modal — in 0.8.14/0.8.15 they were mistakenly added only to the edit modal.',
      ],
    },
  },
  {
    version: '0.8.15',
    date: '2026-06-06',
    items: {
      ru: [
        'Критический фикс: в 0.8.14 при открытии карточки задачи (клик в поле или нажатие на drag-ручку без перетягивания) приложение уходило в белый экран. Причина — нарушение Rules of Hooks (хук usePrompt вызывался после раннего return). Исправлено.',
      ],
      en: [
        'Critical fix: in 0.8.14 opening a task card (clicking the field or pressing on the drag handle without dragging) caused a white screen. Root cause was a Rules of Hooks violation (usePrompt was called after an early return). Fixed.',
      ],
    },
  },
  {
    version: '0.8.14',
    date: '2026-06-06',
    items: {
      ru: [
        'Кнопки вставки чекбоксов в комментарии: над полем «Комментарий» появилась панель с кнопками «☐ Чекбокс», «☑ Готово», «• Список» — одним кликом вставляет нужную маркдаун-разметку. При выделении нескольких строк префикс добавляется к каждой.',
        'Шаблоны задач переехали в отдельную вкладку Настроек (над «Экспорт/Импорт») — раньше были внутри «Хранилища».',
        'Исправление шаблонов: сидовый «Чек-лист» теперь создаётся и при обновлении с предыдущих версий и устойчив к переименованию статусов. Кнопка «Сохранить как шаблон» и ручное создание теперь корректно сохраняют шаблоны в БД.',
        'Собственная модалка ввода вместо системного prompt: больше никаких диалогов «Сообщение с tauri.localhost» — имя шаблона спрашивается в стилизованной модалке приложения.',
      ],
      en: [
        'Checkbox insert buttons in the comment field: a small toolbar above the “Comment” field with “☐ Checkbox”, “☑ Done”, “• List” inserts the right markdown in one click. With a multi-line selection the prefix is added to every line.',
        'Task templates moved to a dedicated Settings tab (above “Export/Import”) — previously they were tucked inside “Storage”.',
        'Template fixes: the seed “Checklist” template is now created on upgrades from older versions too and is resilient to renamed statuses. “Save as template” and manual creation now reliably persist to the DB.',
        'Custom input modal instead of the system prompt: no more “Message from tauri.localhost” dialogs — the template name is asked in a styled in-app modal.',
      ],
    },
  },
  {
    version: '0.8.13',
    date: '2026-06-06',
    items: {
      ru: [
        'Маркдаун-чекбоксы в комментариях задач: строки вида - [ ] / - [x] превращаются в кликабельные чекбоксы при просмотре карточки. На карточке появляется индикатор прогресса (например 2/5), подсвечивающийся зелёным при 100%.',
        'Шаблоны задач: новый раздел в Настройки → Шаблоны. Рядом с «+ Новая задача» появилась стрелочка ▾ с меню шаблонов (создание задачи в один клик). В модалке задачи добавлена кнопка «Сохранить как шаблон». Шаблоны включены в экспорт/импорт бэкапа (старые файлы продолжают работать).',
        'Уведомления снизу: тосты переехали из правого верхнего угла в нижний центр и больше не перекрывают топбар. Новые тосты появляются сверху старых (как в mobile-паттерне).',
        'Новый README и лицензия: репозиторий на GitHub получил двуязычный README (RU+EN) с описанием фич, инструкциями по установке/обновлению/миграции на другой ПК, горячими клавишами. Добавлен файл LICENSE (MIT).',
      ],
      en: [
        'Markdown checkboxes in task comments: lines like - [ ] / - [x] render as clickable checkboxes when viewing a card. A small progress badge (e.g. 2/5) appears on the card and turns green at 100%.',
        'Task templates: a new Settings → Templates section. Next to “+ New task” there’s now a ▾ split-button arrow that opens a template menu (one-click task creation). The task modal got a “Save as template” button. Templates are included in backup export/import (older backup files continue to work).',
        'Toasts moved to the bottom: notifications relocated from the top-right corner to the bottom-center and no longer overlap the topbar. New toasts stack above older ones (mobile-style).',
        'New README and license: the GitHub repo got a bilingual README (RU+EN) covering features, install/upgrade/migration to another PC, and keyboard shortcuts. Added a LICENSE file (MIT).',
      ],
    },
  },
  {
    version: '0.8.12',
    date: '2026-06-06',
    items: {
      ru: [
        'Undo для деструктивных действий: при удалении или завершении задачи (кнопкой ✓ или drag-в-«Выполнено») в правом верхнем углу висит тост с кнопкой «Отменить» 6 секунд. Статус (и finish_date) восстанавливаются ровно в тот вид, в котором были до действия.',
        'Приветственный тур для новых пользователей: при первом запуске показывается онбординг из 5 шагов (создание задачи, drag-and-drop, завершение кнопкой ✓, undo, горячие клавиши). Перезапустить тур можно из Помощь → Диагностика.',
        'Логирование: рядом с БД ведётся технический лог (taskflow.log, одна строка = JSON-событие). Исключения браузера, ошибки инициализации БД и бэкапа попадают туда. Ротация при 1 MB. Добавлен блок «Диагностика» в Настройки → Хранилище с кнопками «Открыть лог» / «Очистить».',
        'Миграции схемы БД: введён явный номер версии схемы (PRAGMA user_version). Существующие БД автоматически получают v1; будущие обновления смогут безопасно добавлять колонки/таблицы без повреждения данных. Текущая версия видна в Настройки → Хранилище → Диагностика.',
        'Code splitting: вкладки Дашборд, Статистика, Настройки и Помощь теперь грузятся лениво. Тяжёлые библиотеки (recharts, xlsx, papaparse, dnd-kit) вынесены в отдельные чанки — main bundle уменьшился в несколько раз, первичный экран выводится быстрее.',
      ],
      en: [
        'Undo for destructive actions: deleting or completing a task (via the ✓ button or by dragging into "Done") now shows a 6-second toast in the top-right corner with an "Undo" button. Status (and finish_date) are restored exactly to their pre-action values.',
        'Welcome tour for new users: on first launch a 5-step onboarding modal is shown (creating a task, drag-and-drop, completing via ✓, undo, keyboard shortcuts). The tour can be restarted from Help → Diagnostics.',
        'Logging: a technical log file (taskflow.log, one JSON event per line) is written next to the DB. Browser exceptions, DB init errors and backup failures land there. Rotates at 1 MB. A new "Diagnostics" block in Settings → Storage offers "Open log" / "Clear" buttons.',
        'DB schema migrations: an explicit schema version (PRAGMA user_version) was introduced. Existing DBs are auto-stamped as v1; future updates can safely add columns/tables without corrupting data. The current version is visible in Settings → Storage → Diagnostics.',
        'Code splitting: Dashboard, Statistics, Settings and Help are now lazy-loaded. Heavy libraries (recharts, xlsx, papaparse, dnd-kit) are split into separate chunks — the main bundle is several times smaller and the first screen appears faster.',
      ],
    },
  },
  {
    version: '0.8.11',
    date: '2026-06-06',
    items: {
      ru: [
        'Дашборд: график «Активность» и тепловая карта «12 недель» теперь строятся по дате старта задачи (с откатом на дату создания, если старт не задан). Раньше задача всегда отображалась в день создания, даже если её плановый старт был запланирован на завтра/будущее.',
        'Задачи: меню эмодзи больше не закрывается сразу после выбора смайлика — можно вставить несколько подряд. Добавлена кнопка «Готово» и компактная кнопка закрытия в шапке пикера. Esc и клик вне пикера по-прежнему работают.',
        'Статусы: «Выполнено» теперь системный — его нельзя удалить в Настройки → Статусы (вместо корзины показывается значок «системный»). Это защищает кнопку-галочку на карточке задачи от поломки.',
        'Хранилище: автоматическая резервная копия БД при закрытии приложения — рядом с data.db создаётся data.db.backup. В Настройки → Хранилище появился блок «Резервная копия» с кнопками «Создать копию сейчас» и «Открыть папку».',
        'Левое меню: переключатель языка RU/EN стал визуально явным — два варианта рядом, активный подсвечен.',
        'Помощь: убраны упоминания «удалено» как статуса; добавлены новые разделы про «Выполнено», про резервную копию и пошаговая инструкция «Что делать, если всё сломалось». Блок про облачные папки переписан как «можно, но с оговорками» с конкретными правилами.',
      ],
      en: [
        'Dashboard: the Activity chart and 12-week heatmap are now built from the task start date (falling back to the creation date if no start is set). Previously tasks were always plotted on their creation day, even when their planned start was tomorrow/in the future.',
        'Tasks: the emoji picker no longer closes immediately after picking a smiley — you can insert several in a row. Added a "Done" button and a compact close button in the picker header. Esc and outside-click still work.',
        'Statuses: "Done" is now a system status and can\'t be deleted in Settings → Statuses (a "system" badge is shown instead of the trash icon). This prevents breaking the checkmark button on task cards.',
        'Storage: automatic database backup on app close — data.db.backup is written next to data.db. Settings → Storage now has a "Backup" block with "Back up now" and "Open folder" buttons.',
        'Sidebar: the RU/EN language switcher is now a visual toggle with the active language highlighted.',
        'Help: removed mentions of "Deleted" as a default status; added new sections about "Done", on-close backups and a step-by-step "What if everything is broken?" guide. The cloud-folder block was rewritten as "yes, but with caveats" with concrete rules.',
      ],
    },
  },
  {
    version: '0.8.10',
    date: '2026-06-06',
    items: {
      ru: [
        'Хранилище: при смене пути БД существующая база автоматически копируется в новое место (старый файл сохраняется), и приложение предлагает перезапуститься, чтобы подхватить новый файл. Раньше задачи продолжали записываться в старое место.',
        'Хранилище: «Открыть папку» теперь надёжно открывает правильную папку даже если сам файл базы ещё не создан (раньше открывалась «Документы»).',
        'Дашборд: переключатель периода перенесён в секцию «За период» и размещён над графиком Активность — визуально очевидно, что период влияет именно на этот график.',
        'Дашборд: исправлен пустой график Активность — фиксированная высота контейнера (320px) вместо flex-расчёта (из-за которого ResponsiveContainer от recharts схлопывался в 0 и график не отрисовывался).',
        'Дашборд: в KPI «Больше всего задач» убрано число — остаётся только имя тэга с цветовым индикатором.',
      ],
      en: [
        'Storage: when the database path is changed, the existing database is automatically copied to the new location (the old file is preserved), and the app prompts to restart so plugin-sql picks up the new file. Previously tasks kept being saved to the old location.',
        'Storage: “Open folder” now reliably opens the correct folder even if the DB file itself does not exist yet (previously it opened “Documents” as a fallback).',
        'Dashboard: the period switcher was moved into the “Over period” section and placed right above the Activity chart — visually clear that the period only affects this chart.',
        'Dashboard: fixed the empty Activity chart — the container now has a fixed height (320px) instead of a flex-based layout (which caused recharts’ ResponsiveContainer to collapse to 0).',
        'Dashboard: the “Top tag” KPI no longer shows the count — only the tag name with a color dot.',
      ],
    },
  },
  {
    version: '0.8.9',
    date: '2026-06-06',
    items: {
      ru: [
        'Дашборд переработан: топбар из 6 метрик (Всего, В работе, Приостановлено, Выполнено, Просрочено, «Больше всего задач: <тэг>»), под ним По статусу и По тэгам в строку — это «текущий срез». Ниже «За период»: график Активность во всю ширину с тремя сериями (новые — синяя, выполнено — зелёная, просрочено — красная), затем 12W и Недавно завершённые в строку.',
        'Хранилище в Настройках: кнопка «Открыть папку» открывает проводник на текущей папке БД. Добавлена подсказка с описанием data.db / taskflow_config.json / %APPDATA%\\TaskFlow и предупреждением о нерекомендуемом хранении в OneDrive/Dropbox/Google Drive.',
        'Вкладка Помощь переписана под актуальное состояние: убраны устаревшие упоминания CSV-экспорта, вкладки «Добавить» и шортката N; добавлены разделы про эмодзи-пикер, кнопку «Открыть папку», drag-and-drop, цвета дедлайнов, чип «Внимание», JSON/XLSX импорт-экспорт.',
      ],
      en: [
        'Dashboard restructured: a 6-metric topbar (Total, In progress, Paused, Done, Overdue, “Most tasks: <tag>”), followed by By status and By tags side-by-side — this is the “current snapshot”. Below, the “Over period” section: an Activity chart full-width with three series (created — blue, completed — green, overdue — red), then 12W and Recently completed in a row.',
        'Storage section in Settings: an “Open folder” button reveals the current database folder in the OS file manager. A new hint describes data.db / taskflow_config.json / %APPDATA%\\TaskFlow and warns against storing the DB in OneDrive/Dropbox/Google Drive.',
        'Help tab rewritten to match the current state: removed stale mentions of CSV export, the “Add” sidebar tab and the N shortcut; added sections on the emoji picker, “Open folder”, drag-and-drop, deadline colors, the “Attention” chip and JSON/XLSX import-export.',
      ],
    },
  },
  {
    version: '0.8.8',
    date: '2026-06-06',
    items: {
      ru: [
        'Эмодзи-пикер в полях Название и Комментарий (кнопка 😊 рядом с заголовком поля): панель недавних (до 12) + полный picker с поиском и категориями.',
        'Убран CSV-экспорт (некорректно восстанавливал статусы при обратном импорте); остались JSON и XLSX.',
        'При импорте задачи без указанного статуса попадают в «Взять в работу» (раньше в первый top/middle).',
      ],
      en: [
        'Emoji picker in Title and Comment fields (😊 button next to the field label): recent panel (up to 12) plus a full picker with search and categories.',
        'CSV export removed (it didn’t restore statuses correctly on re-import); JSON and XLSX remain.',
        'On import, tasks without a status now land in “Взять в работу” (previously the first top/middle status).',
      ],
    },
  },
  {
    version: '0.8.7',
    date: '2026-06-06',
    items: {
      ru: [
        'Экспорт в 3 форматах: CSV, JSON, XLSX. При экспорте открывается диалог с чекбоксами: задачи / тэги / статусы.',
        'Импорт полной резервной копии (задачи + тэги + статусы) из JSON/CSV/XLSX с выбором «Слить» / «Заменить всё».',
        '«Стереть все данные» теперь реально очищает базу и в десктопной версии (раньше очищался только кэш в памяти), и восстанавливает дефолтные статусы + приветственную задачу.',
        'Подсветка дедлайна: убран жёлтый цвет для 4–5 дней. Остались: синий «сегодня», оранжевый жирный 1–3 дня, серый 4+ дней, красный жирный для просроченных.',
      ],
      en: [
        'Export to 3 formats: CSV, JSON, XLSX. The export dialog now lets you choose which entities to include: tasks / tags / statuses.',
        'Import a full backup (tasks + tags + statuses) from JSON/CSV/XLSX with a Merge / Replace-all choice.',
        '“Erase all data” now actually wipes the database in the desktop build too (previously only the in-memory cache was reset) and restores default statuses + the welcome task.',
        'Deadline highlighting: removed the yellow tier for 4–5 days. Now: blue “today”, bold orange 1–3 days, muted gray 4+ days, bold red overdue.',
      ],
    },
  },
  {
    version: '0.8.6',
    date: '2026-06-05',
    items: {
      ru: [
        'Исправлен drag-n-drop карточек: ручка ·· теперь перетаскивает, клик по карточке открывает модалку (раньше эти жесты конфликтовали).',
        'DnD поддерживает как перестановку внутри одного статуса, так и перенос между статусами.',
        'Новый чип «Внимание» в топбаре — оранжевый, между «В работе» и «Просрочено»; показывает задачи с дедлайном в ближайшие 3 дня.',
        'Подсветка дедлайна: сегодня — синий, 1–3 дня — оранжевый жирный, 4–5 дней — жёлтый жирный, просрочено — красный.',
        '«Недавно завершённые» в Дашборде — фиксированная высота на 5 задач + внутренний скролл (вместо жёсткого лимита в 6).',
        'Вкладка «Добавить» убрана из сайдбара. Кнопка «+ Новая задача» на вкладке Задачи открывает модальное окно (старая ссылка /add редиректит на /tasks).',
      ],
      en: [
        'Fixed task card drag-n-drop: the ·· handle now actually drags, clicking the card still opens the modal (previously these gestures collided).',
        'DnD supports both reordering inside one status and moving cards between statuses.',
        'New topbar chip “Attention” — orange triangle, sits between “In progress” and “Overdue”; shows tasks with a deadline in the next 3 days.',
        'Deadline coloring: today — blue, 1–3 days — bold orange, 4–5 days — bold yellow, overdue — red.',
        'Dashboard “Recently completed” — fixed 5-row height with internal scroll (instead of hard cap at 6).',
        'Sidebar “Add” tab removed. The “+ New task” button on the Tasks page now opens a modal (old /add URL redirects to /tasks).',
      ],
    },
  },
  {
    version: '0.8.5',
    date: '2026-05-10',
    items: {
      ru: [
        'Исправлена регрессия v0.8.4: при первом запуске после чистой установки не создавались базовые статусы, теги и welcome-задача.',
        'Причина: миграция вставляла технический статус «Удалено» в пустую БД, из-за чего isEmpty() возвращал false и seed пропускался.',
        'Теперь «Удалено» создаётся в seed вместе с базовыми статусами (в топбаре не отображается, hidden=1).',
        'Миграция добавляет «Удалено» только в уже инициализированные БД (обратная совместимость со старыми базами).',
      ],
      en: [
        'Fixed v0.8.4 regression: on first launch after a clean install, default statuses, tags and the welcome task were not created.',
        'Root cause: migration inserted the technical "Deleted" status into the empty DB, so isEmpty() returned false and seed was skipped.',
        'Now "Deleted" is created as part of seed alongside the default statuses (hidden from the topbar via hidden=1).',
        'Migration only adds "Deleted" to already-initialised DBs (preserves backward compatibility with older databases).',
      ],
    },
  },
  {
    version: '0.8.4',
    date: '2026-05-10',
    items: {
      ru: [
        'Исправлена ошибка миграции старых БД: «table statuses has no column named hidden».',
        'Миграция теперь выполняется ДО seed/INSERT — старые базы данных корректно дополняются новыми колонками.',
        'ALTER TABLE сделаны идемпотентными: повторный запуск не падает, частичные миграции автоматически восстанавливаются.',
        'После обновления установщика ваши задачи и теги снова появятся без ручного сброса БД.',
      ],
      en: [
        'Fixed old-database migration error: "table statuses has no column named hidden".',
        'Migration now runs BEFORE seed/INSERT — old databases get the new columns added correctly.',
        'ALTER TABLE statements are now idempotent: repeated runs no longer fail, and partial migrations self-heal.',
        'After installing the update, your tasks and tags reappear without needing a manual DB reset.',
      ],
    },
  },
  {
    version: '0.8.3',
    date: '2026-05-10',
    items: {
      ru: [
        'Исправлено зависание на экране «Загрузка...» при запуске (регрессия v0.8.2).',
        'Разбивка multi-statement SQL-запросов на отдельные execute() для tauri-plugin-sql.',
        'Добавлен safety-net: при ошибке инициализации UI всё равно открывается с баннером и возможностью сбросить БД.',
        'DevTools включены в production-сборке (Ctrl+Shift+I) — для диагностики проблем.',
      ],
      en: [
        'Fixed app hanging on the "Loading…" screen at startup (regression from v0.8.2).',
        'Multi-statement SQL queries split into separate execute() calls for tauri-plugin-sql compatibility.',
        'Added safety-net: if init fails, UI still opens with an error banner so user can reset DB.',
        'DevTools enabled in production builds (Ctrl+Shift+I) for easier troubleshooting.',
      ],
    },
  },
  {
    version: '0.8.2',
    date: '2026-05-10',
    items: {
      ru: [
        'Топбар-чипы: теперь только иконка + число, текст — в tooltip при наведении.',
        'Иконка «Всего» всегда синяя (#3b82f6) — исправлен баг из v0.8.1 (accent был зелёным).',
        'Tooltip графика «Активность»: формат даты теперь дд.мм.гггг вместо ISO.',
        'Исправлен UTC-сдвиг дат в графике «Активность» при выборе custom-диапазона.',
        'График «По тегам»: показываются только теги с задачами; пустые скрыты.',
        'Восстановление задачи из Статистики: задача теперь корректно появляется на доске.',
        'Оверлей удаления на TaskCard: кнопки теперь по центру, среднего размера (не на всю ширину).',
        'Статусы: два независимых флага «Скрытый» и «Свёрнут» вместо одного «Архивный».',
        '«Выполнено» — по умолчанию visible + свёрнут (isправлена регрессия из v0.8.1).',
        'Импорт XLSX: корректно читает статус и теги из шаблона (столбцы status, tags, due_date).',
        'Предпросмотр импорта: теперь прокручиваемая таблица со всеми строками.',
        'Хранилище: кнопка «Выбрать» теперь показывает ошибку в тосте, не глотает её.',
        '«Стереть все данные» теперь реально стирает и пересоздаёт дефолтные статусы без перезагрузки.',
        'TaskCard: добавлена иконка GripVertical ⋮⋮ для перетаскивания, увеличен gap между кнопками.',
        'Помощь: добавлена секция «Что нового» с авто-генерацией из changelog.',
        'Хранилище: реально подключён tauri-plugin-dialog (Rust + capabilities) — кнопка «Выбрать» теперь работает.',
        'Статистика: задача, выполненная день в день, считается как 1 день; день начала и день окончания теперь оба входят в подсчёт.',
        'TaskCard: поля «Название» и «Комментарий» больше не подходят вплотную к иконкам справа.',
      ],
      en: [
        'Topbar chips: icon + count only; label moved to native tooltip on hover.',
        'Total chip icon is now always blue (#3b82f6) — bug fix from v0.8.1 (accent was green).',
        'Activity chart tooltip: date format is now dd.mm.yyyy instead of ISO.',
        'Fixed UTC date shift bug in Activity chart for custom date ranges.',
        'Tags chart: only tags with tasks are shown; empty tags are filtered out.',
        'Task restore from Statistics: task now correctly appears on the board after restore.',
        'Task delete overlay: buttons are now centered and medium-sized (not full-width).',
        'Statuses: two independent flags "Hidden" and "Collapsed" instead of one "Archived".',
        '"Done" status — visible by default, collapsed (regression from v0.8.1 fixed).',
        'XLSX import: correctly reads status and tags from template (columns: status, tags, due_date).',
        'Import preview: now a scrollable table showing all rows.',
        'Storage: "Choose" button now shows error in toast instead of silently swallowing it.',
        '"Erase all data" now actually erases and recreates default statuses without page reload.',
        'TaskCard: added GripVertical ⋮⋮ drag handle icon, increased gap between action buttons.',
        'Help page: added "What\'s New" section auto-generated from changelog data.',
        'Storage: tauri-plugin-dialog actually wired up (Rust + capabilities) — folder picker now works.',
        'Statistics: same-day completion now counts as 1 day; both start and finish days are included.',
        'TaskCard: title and comment fields no longer touch the right-side action icons.',
      ],
    },
  },
  {
    version: '0.8.1',
    date: '2026-05-10',
    items: {
      ru: [
        'Поповер «Свой период» теперь позиционируется корректно под кнопкой.',
        'Тулбар задач: кнопки «Свернуть всё» и «Новая задача» всегда видны, тэги прокручиваются горизонтально.',
        'Все native confirm() заменены собственной модалкой.',
        'Двойные «+» на кнопках «Добавить тэг» / «Добавить статус» — исправлено.',
        'Статусы: чекбокс «Архивный» вместо выпадашки.',
        'DnD не блокирует выделение текста при редактировании.',
        'Восстановление задачи из Статистики с выбором целевого статуса.',
        'Форматы дат унифицированы.',
        'Хранилище: диалог выбора папки (Tauri plugin-dialog).',
        'Импорт: кнопка «Шаблон» для скачивания XLSX.',
        'Топбар: чип «Всего» синий, новый чип «Просрочено».',
        'Сброс БД перенесён в Настройки → Хранилище.',
      ],
      en: [
        'Custom range popover now appears directly below the button.',
        'Tasks toolbar: Collapse All and New Task buttons stay fixed; tags scroll horizontally.',
        'All native confirm() dialogs replaced with custom modal.',
        'Duplicate "+" icons fixed.',
        'Statuses: "Archived" checkbox instead of dropdown.',
        'DnD no longer blocks text selection when editing.',
        'Restore task from Statistics with target status selection.',
        'Date formats unified.',
        'Storage: system folder picker (Tauri plugin-dialog).',
        'Import: "Template" button for XLSX download.',
        'Topbar: Total chip blue, new Overdue chip.',
        'DB reset moved to Settings → Storage.',
      ],
    },
  },
  {
    version: '0.8.0',
    date: '2026-05-09',
    items: {
      ru: [
        'Начальный публичный релиз TaskFlow.',
        'Доска задач с drag-and-drop.',
        'Дашборд с графиками активности, по статусам, по тегам, тепловой картой.',
        'Статистика — таблица с изменяемыми колонками.',
        'Импорт/экспорт JSON, CSV.',
        'Четыре темы: Светлая, Тёмная, Акацуки, Деревня листа.',
        'Поддержка Tauri (desktop) и браузерного режима.',
      ],
      en: [
        'Initial public release of TaskFlow.',
        'Task board with drag-and-drop.',
        'Dashboard with activity chart, by-status, by-tag, and heatmap.',
        'Statistics — resizable column table.',
        'Import/export JSON, CSV.',
        'Four themes: Light, Dark, Akatsuki, Hidden Leaf.',
        'Tauri (desktop) and browser mode support.',
      ],
    },
  },
];
