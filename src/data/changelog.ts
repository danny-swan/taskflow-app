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
