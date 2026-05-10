import { useState } from 'react';
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';
import { ChevronDown } from 'lucide-react';

interface HelpSection {
  title: string;
  items: { q: string; a: React.ReactNode }[];
}

const sectionsRu: HelpSection[] = [
  {
    title: '🆕 Что нового в v0.8.1',
    items: [
      {
        q: 'Список изменений v0.8.1',
        a: (
          <ul className="space-y-1.5 list-disc pl-4">
            <li>Поповер «Свой период» теперь позиционируется корректно под кнопкой.</li>
            <li>Тулбар задач: кнопки «Свернуть всё» и «Новая задача» всегда видны, тэги прокручиваются горизонтально.</li>
            <li>Все native <code>confirm()</code> заменены собственной модалкой — нет больше «Сообщение с tauri.localhost».</li>
            <li>Двойные «+» на кнопках «Добавить тэг» / «Добавить статус» — исправлено.</li>
            <li>Статусы: вместо выпадашки «Вверх/Середина/Ниже/Архив» — чекбокс «Архивный». Архивные статусы скрыты на доске задач.</li>
            <li>Текст welcome-задачи обновлён: «иконка корзины 🗑 в правом верхнем углу».</li>
            <li>Удаление задачи: убран вопрос-заголовок, осталось две большие кнопки на блюре карточки.</li>
            <li>DnD не блокирует выделение текста при редактировании названия или комментария.</li>
            <li>Восстановление задачи из Статистики: иконка ↺ у завершённых/удалённых задач с выбором целевого статуса.</li>
            <li>Форматы дат: ось X «Активность» — «дд MMM», «Недавно завершённые» — «дд.ММ.гггг», custom range — «дд.ММ.гггг».</li>
            <li>Хранилище: кнопка «Выбрать…» теперь открывает системный диалог (Tauri plugin-dialog).</li>
            <li>Импорт: добавлена кнопка «Шаблон» — скачать XLSX-шаблон со структурой импорта.</li>
            <li>Топбар: чип «Всего» — синий, новый виртуальный чип «Просрочено» (AlertTriangle, красный).</li>
            <li>Сброс БД перенесён в Настройки → Хранилище → «Опасная зона» с двойным подтверждением.</li>
            <li>Цитаты обновлены на универсальные мотивирующие для всех четырёх тем.</li>
          </ul>
        ),
      },
    ],
  },
  {
    title: '📋 Основы',
    items: [
      {
        q: 'Как добавить задачу?',
        a: 'Откройте вкладку «Добавить» или нажмите клавишу N. Заполните название, выберите статус и тэг — внизу формы есть живой предпросмотр карточки.',
      },
      {
        q: 'Как работают тэги?',
        a: 'Тэги — это метки для категоризации задач. Их можно создавать в Настройки → Тэги, задавать цвет и название. На доске задач доступна фильтрация по тэгу через горизонтально прокручиваемую панель.',
      },
      {
        q: 'Как работают статусы?',
        a: (
          <>
            <p>Статусы определяют группировку задач на доске. Порядок задаётся стрелками в Настройки → Статусы.</p>
            <p className="mt-2">Чекбокс «Архивный» делает статус скрытым на доске задач (но видимым в Статистике и Дашборде). Это удобно для «Выполнено» и «Удалено».</p>
            <p className="mt-2">Системные статусы по умолчанию: Запланировано, В работе, Приостановлено, Выполнено (архивный), Удалено (технический).</p>
          </>
        ),
      },
      {
        q: 'Как изменить порядок задач?',
        a: 'Перетащите карточку мышью — внутри группы или в другую группу. Статус обновится автоматически. При редактировании названия или комментария drag-and-drop автоматически отключается.',
      },
      {
        q: 'Как удалить задачу?',
        a: 'Нажмите иконку корзины 🗑 в правом верхнем углу карточки. Появятся две кнопки: «Удалить» (красная) и «Оставить». Удалённые задачи помечаются как «Удалено» (мягкое удаление) и видны в Статистике — откуда их можно восстановить.',
      },
    ],
  },
  {
    title: '📊 Дашборд',
    items: [
      {
        q: 'Что показывает Дашборд?',
        a: 'KPI-карточки (всего/в работе/выполнено/просрочено), график активности, круговую диаграмму по статусам, столбчатую по тэгам, тепловую карту активности за 12 недель и список недавно завершённых задач.',
      },
      {
        q: 'Как выбрать период?',
        a: (
          <>
            <p>Кнопки «Неделя / Месяц / Квартал / Год / Свой период» в правом верхнем углу Дашборда.</p>
            <p className="mt-1.5">«Свой период» открывает поповер прямо под кнопкой — введите даты «От» и «До», нажмите «Применить». Поповер закрывается кликом вне него.</p>
            <p className="mt-1.5">Активный custom-диапазон показывается в формате «дд.ММ.гггг → дд.ММ.гггг».</p>
          </>
        ),
      },
      {
        q: 'Что такое чипы «Просрочено» и «Всего» в топбаре?',
        a: '«Всего» (синяя иконка) — общее число задач на доске. «Просрочено» (красный AlertTriangle) — виртуальный счётчик задач с прошедшим дедлайном, которые не выполнены и не удалены. Клик фильтрует доску задач.',
      },
    ],
  },
  {
    title: '📥 Импорт / Экспорт',
    items: [
      {
        q: 'Как импортировать задачи?',
        a: 'Настройки → Экспорт/импорт → «Выберите файл». Поддерживаются форматы JSON, CSV, XLSX. Можно добавить к существующим или заменить все (с подтверждением).',
      },
      {
        q: 'Как скачать шаблон для импорта?',
        a: 'Настройки → Экспорт/импорт → кнопка «Шаблон» рядом с полем загрузки. Скачивает XLSX-файл taskflow_import_template.xlsx со столбцами: title, description, status, tags, due_date, created_at и примерной строкой.',
      },
      {
        q: 'Как экспортировать данные?',
        a: 'Настройки → Экспорт/импорт → «Экспорт CSV» или «Экспорт JSON». CSV удобен для Excel, JSON — для резервной копии.',
      },
    ],
  },
  {
    title: '💾 Хранилище',
    items: [
      {
        q: 'Где хранятся данные?',
        a: 'В браузере — в IndexedDB/localStorage через sql.js (SQLite WASM). В десктопном приложении Tauri — в файле SQLite на диске.',
      },
      {
        q: 'Как изменить путь к файлу БД?',
        a: 'Настройки → Хранилище → «Выбрать…». Откроется системный диалог выбора папки. Файл taskflow.db будет создан в выбранной папке. Эта функция доступна только в десктопном приложении.',
      },
      {
        q: 'Что такое «Опасная зона»?',
        a: 'Настройки → Хранилище → секция «⚠ Опасная зона». Кнопка «Стереть все данные» запрашивает два последовательных подтверждения, после чего полностью очищает БД и создаёт welcome-задачу заново.',
      },
    ],
  },
  {
    title: '🎨 Темы и цитаты',
    items: [
      {
        q: 'Как переключить тему?',
        a: 'Внизу левого сайдбара — кнопка с иконкой солнца/луны — открывает список из 4 тем: Светлая, Тёмная, Акацуки, Деревня листа.',
      },
      {
        q: 'Что такое цитаты в топбаре?',
        a: 'При каждом запуске (или смене темы/языка) случайно выбирается мотивирующая цитата про продуктивность и фокус. Цитаты уникальны для каждой темы.',
      },
    ],
  },
  {
    title: '⌨ Горячие клавиши',
    items: [
      {
        q: 'Список горячих клавиш',
        a: (
          <ul className="space-y-1 list-disc pl-4">
            <li><code>N</code> — новая задача</li>
            <li><code>/</code> — фокус на поле поиска</li>
            <li><code>1–6</code> — переключение вкладок (Задачи, Добавить, Дашборд, Статистика, Настройки, Помощь)</li>
            <li><code>ESC</code> — закрыть модальное окно или отменить редактирование</li>
            <li><code>Enter</code> (в полях карточки) — сохранить изменение</li>
          </ul>
        ),
      },
    ],
  },
  {
    title: 'ℹ О приложении',
    items: [
      {
        q: 'Версия и GitHub',
        a: (
          <>
            <p><strong>TaskFlow v0.8.1</strong> — менеджер задач с поддержкой Tauri (desktop) и браузерного режима.</p>
            <p className="mt-1.5">
              Исходный код и релизы:{' '}
              <a
                href="https://github.com/danny-swan/taskflow-app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                github.com/danny-swan/taskflow-app
              </a>
            </p>
          </>
        ),
      },
    ],
  },
];

const sectionsEn: HelpSection[] = [
  {
    title: '🆕 What\'s New in v0.8.1',
    items: [
      {
        q: 'Changelog v0.8.1',
        a: (
          <ul className="space-y-1.5 list-disc pl-4">
            <li>Custom range popover now appears directly below the button — no more scrolling down the page.</li>
            <li>Tasks toolbar: Collapse All and New Task buttons stay fixed on the right; tags scroll horizontally.</li>
            <li>All native <code>confirm()</code> dialogs replaced with a custom modal — no more "Message from tauri.localhost".</li>
            <li>Duplicate "+" icons on "Add tag" / "Add status" buttons fixed.</li>
            <li>Statuses: replaced Top/Middle/Bottom/Archive dropdown with a single "Archived" checkbox. Archived statuses are hidden from the task board.</li>
            <li>Welcome task text updated: "trash can icon 🗑 in the top-right corner".</li>
            <li>Task delete confirmation: removed the question heading — two large buttons remain on the blur overlay.</li>
            <li>DnD no longer blocks text selection when editing a title or comment.</li>
            <li>Restore task from Statistics: ↺ icon appears on completed/deleted tasks to restore them with a target status selection.</li>
            <li>Date formats: Activity X-axis shows "dd MMM", recent completed shows "dd.MM.yyyy", custom range shows "dd.MM.yyyy".</li>
            <li>Storage: "Choose…" button now opens a system folder picker (Tauri plugin-dialog).</li>
            <li>Import: "Template" button downloads an XLSX template with import structure.</li>
            <li>Topbar: Total chip icon is now blue; new virtual Overdue chip (red AlertTriangle).</li>
            <li>DB reset moved to Settings → Storage → "Danger Zone" with double confirmation.</li>
            <li>Quotes updated to universal motivational productivity quotes for all four themes.</li>
          </ul>
        ),
      },
    ],
  },
  {
    title: '📋 Basics',
    items: [
      {
        q: 'How do I add a task?',
        a: 'Open the "Add" tab or press N. Fill in the title, choose a status and tag — the live preview below shows how the card will look.',
      },
      {
        q: 'How do tags work?',
        a: 'Tags are labels for categorising tasks. Create them in Settings → Tags with a name and color. The task board supports filtering by tag via a horizontally scrollable bar.',
      },
      {
        q: 'How do statuses work?',
        a: (
          <>
            <p>Statuses group tasks on the board. Order is set via arrows in Settings → Statuses.</p>
            <p className="mt-2">The "Archived" checkbox hides a status from the task board (but it remains visible in Statistics and Dashboard). Useful for "Done" and "Deleted".</p>
            <p className="mt-2">Default system statuses: Planned, In Progress, On Hold, Done (archived), Deleted (technical).</p>
          </>
        ),
      },
      {
        q: 'How do I reorder tasks?',
        a: 'Drag a card with your mouse — within its group or to another group. The status updates automatically. Drag-and-drop is automatically disabled while editing a title or comment.',
      },
      {
        q: 'How do I delete a task?',
        a: 'Click the trash icon 🗑 in the top-right corner of the card. Two buttons appear: Delete (red) and Keep. Deleted tasks are soft-deleted (status → "Deleted") and remain visible in Statistics where they can be restored.',
      },
    ],
  },
  {
    title: '📊 Dashboard',
    items: [
      {
        q: 'What does the Dashboard show?',
        a: 'KPI cards (total/in-progress/completed/overdue), an activity line chart, a status pie chart, a tag bar chart, a 12-week activity heatmap, and a list of recently completed tasks.',
      },
      {
        q: 'How do I select a period?',
        a: (
          <>
            <p>Buttons "Week / Month / Quarter / Year / Custom" in the top-right of the Dashboard.</p>
            <p className="mt-1.5">"Custom" opens a popover directly below the button — enter From/To dates and click Apply. Click outside to close.</p>
            <p className="mt-1.5">The active custom range is shown as "dd.MM.yyyy → dd.MM.yyyy".</p>
          </>
        ),
      },
      {
        q: 'What are the Overdue and Total chips in the topbar?',
        a: 'Total (blue icon) shows all tasks on the board. Overdue (red AlertTriangle) is a virtual counter of tasks with a past due date that are not completed or deleted. Clicking filters the task board.',
      },
    ],
  },
  {
    title: '📥 Import / Export',
    items: [
      {
        q: 'How do I import tasks?',
        a: 'Settings → Export/Import → "Choose file". JSON, CSV, and XLSX formats are supported. You can add to existing tasks or replace all (with confirmation).',
      },
      {
        q: 'How do I download an import template?',
        a: 'Settings → Export/Import → "Template" button next to the file upload. Downloads taskflow_import_template.xlsx with columns: title, description, status, tags, due_date, created_at and a sample row.',
      },
      {
        q: 'How do I export data?',
        a: 'Settings → Export/Import → "Export CSV" or "Export JSON". CSV is convenient for Excel, JSON for backups.',
      },
    ],
  },
  {
    title: '💾 Storage',
    items: [
      {
        q: 'Where is my data stored?',
        a: 'In the browser — IndexedDB/localStorage via sql.js (SQLite WASM). In the Tauri desktop app — a SQLite file on disk.',
      },
      {
        q: 'How do I change the database path?',
        a: 'Settings → Storage → "Choose…". A system folder picker opens. The file taskflow.db will be created in the chosen folder. This feature is only available in the desktop app.',
      },
      {
        q: 'What is the Danger Zone?',
        a: 'Settings → Storage → "⚠ Danger Zone" section. The "Erase all data" button requires two consecutive confirmations, then completely clears the database and recreates the welcome task.',
      },
    ],
  },
  {
    title: '🎨 Themes & Quotes',
    items: [
      {
        q: 'How do I switch theme?',
        a: 'Bottom of the left sidebar — sun/moon icon opens a list of 4 themes: Light, Dark, Akatsuki, Hidden Leaf.',
      },
      {
        q: 'What are the topbar quotes?',
        a: 'On each launch (or theme/language change) a random motivational productivity quote is picked. Quotes are unique to each theme.',
      },
    ],
  },
  {
    title: '⌨ Keyboard Shortcuts',
    items: [
      {
        q: 'Shortcut list',
        a: (
          <ul className="space-y-1 list-disc pl-4">
            <li><code>N</code> — new task</li>
            <li><code>/</code> — focus search field</li>
            <li><code>1–6</code> — switch tabs (Tasks, Add, Dashboard, Stats, Settings, Help)</li>
            <li><code>ESC</code> — close modal or cancel edit</li>
            <li><code>Enter</code> (in card fields) — save change</li>
          </ul>
        ),
      },
    ],
  },
  {
    title: 'ℹ About',
    items: [
      {
        q: 'Version & GitHub',
        a: (
          <>
            <p><strong>TaskFlow v0.8.1</strong> — task manager with Tauri (desktop) and browser support.</p>
            <p className="mt-1.5">
              Source code and releases:{' '}
              <a
                href="https://github.com/danny-swan/taskflow-app"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                github.com/danny-swan/taskflow-app
              </a>
            </p>
          </>
        ),
      },
    ],
  },
];

export function HelpPage() {
  const lang = useStore(s => s.language);
  const sections = lang === 'ru' ? sectionsRu : sectionsEn;
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className="max-w-2xl">
        <h2 className="font-display text-[18px] font-semibold mb-1">{tr(lang, 'help_title')}</h2>
        <div className="text-[12px] text-muted mb-5">TaskFlow v0.8.1</div>
        <div className="space-y-6">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="text-[12px] text-muted uppercase tracking-wider mb-2 font-medium">{section.title}</div>
              <div className="space-y-2">
                {section.items.map((item, i) => {
                  const key = `${section.title}-${i}`;
                  const open = openKey === key;
                  return (
                    <div key={key} className="bg-surface border border-border-soft rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setOpenKey(open ? null : key)}
                        aria-expanded={open}
                        className="w-full text-left list-none px-4 py-3 flex items-start gap-3 select-none hover:bg-surface-alt/40"
                      >
                        <span className="text-[13.5px] font-medium flex-1">{item.q}</span>
                        <ChevronDown
                          size={15}
                          className={'text-muted transition-transform shrink-0 mt-0.5 ' + (open ? 'rotate-180' : '')}
                        />
                      </button>
                      {open && (
                        <div className="px-4 pb-3.5 text-[13px] text-muted leading-relaxed">
                          {typeof item.a === 'string' ? <p>{item.a}</p> : item.a}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
