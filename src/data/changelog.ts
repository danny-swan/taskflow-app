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
