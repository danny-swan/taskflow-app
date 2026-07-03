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
