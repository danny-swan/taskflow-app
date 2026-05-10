import { useState } from 'react';
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';
import { ChevronDown } from 'lucide-react';
import { CHANGELOG } from '../data/changelog';

interface HelpSection {
  title: string;
  items: { q: string; a: React.ReactNode }[];
}

const sectionsRu: HelpSection[] = [
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
            <p className="mt-2">
              <strong>Скрытый</strong> — статус не показывается на доске задач (но виден в Статистике и Дашборде). Используйте для «Удалено».
            </p>
            <p className="mt-2">
              <strong>Свёрнут</strong> — секция статуса показывается на доске, но свёрнута по умолчанию. Нажмите на заголовок секции, чтобы развернуть. Используйте для «Выполнено».
            </p>
            <p className="mt-2">Системные статусы по умолчанию: Запланировано, В работе, Приостановлено, Выполнено (свёрнут), Удалено (скрытый).</p>
          </>
        ),
      },
      {
        q: 'Как изменить порядок задач?',
        a: 'Перетащите карточку мышью — за саму карточку или за иконку ⋮⋮ (drag handle) в правой части. Статус обновится автоматически. При редактировании названия или комментария drag-and-drop автоматически отключается.',
      },
      {
        q: 'Как удалить задачу?',
        a: 'Нажмите иконку корзины 🗑 в правом верхнем углу карточки. Появятся две кнопки по центру: «Удалить» (красная) и «Оставить». Удалённые задачи помечаются как «Удалено» (мягкое удаление) и видны в Статистике — откуда их можно восстановить.',
      },
    ],
  },
  {
    title: '📊 Дашборд',
    items: [
      {
        q: 'Что показывает Дашборд?',
        a: 'KPI-карточки (всего/в работе/выполнено/просрочено), график активности, круговую диаграмму по статусам, столбчатую по тегам (только теги с задачами), тепловую карту активности за 12 недель и список недавно завершённых задач.',
      },
      {
        q: 'Как выбрать период?',
        a: (
          <>
            <p>Кнопки «Неделя / Месяц / Квартал / Год / Свой период» в правом верхнем углу Дашборда.</p>
            <p className="mt-1.5">«Свой период» открывает поповер — введите даты «От» и «До», нажмите «Применить».</p>
            <p className="mt-1.5">Tooltip графика «Активность» показывает дату в формате дд.мм.гггг.</p>
          </>
        ),
      },
      {
        q: 'Что такое чипы «Просрочено» и «Всего» в топбаре?',
        a: '«Всего» (синяя иконка) — общее число задач. «Просрочено» (красный AlertTriangle) — задачи с прошедшим дедлайном. Клик фильтрует доску. Текст отображается в tooltip при наведении.',
      },
    ],
  },
  {
    title: '📥 Импорт / Экспорт',
    items: [
      {
        q: 'Как импортировать задачи?',
        a: 'Настройки → Экспорт/импорт → «Выберите файл». Поддерживаются форматы JSON, CSV, XLSX. Предпросмотр показывает все строки в прокручиваемой таблице.',
      },
      {
        q: 'Как скачать шаблон для импорта?',
        a: 'Настройки → Экспорт/импорт → кнопка «Шаблон». Скачивает XLSX со столбцами: title, description, status, tags, due_date, created_at. Статус и теги подхватываются автоматически при импорте.',
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
        a: 'Настройки → Хранилище → «Выбрать…». Откроется системный диалог выбора папки. Функция доступна только в десктопном приложении; в браузере отображается пояснение.',
      },
      {
        q: 'Что такое «Опасная зона»?',
        a: 'Настройки → Хранилище → «⚠ Опасная зона». Кнопка «Стереть все данные» требует двух подтверждений, после чего полностью очищает БД, пересоздаёт дефолтные статусы и welcome-задачу без перезагрузки страницы.',
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
        a: 'При каждом запуске (или смене темы/языка) случайно выбирается мотивирующая цитата про продуктивность и фокус.',
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
];

const sectionsEn: HelpSection[] = [
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
            <p className="mt-2">
              <strong>Hidden</strong> — status is not shown on the task board (but visible in Statistics and Dashboard). Use for "Deleted".
            </p>
            <p className="mt-2">
              <strong>Collapsed</strong> — the status section is shown on the board but collapsed by default. Click the section header to expand. Use for "Done".
            </p>
            <p className="mt-2">Default statuses: Planned, In Progress, On Hold, Done (collapsed), Deleted (hidden).</p>
          </>
        ),
      },
      {
        q: 'How do I reorder tasks?',
        a: 'Drag a card by the card body or by the ⋮⋮ (GripVertical) drag handle icon on the right. The status updates automatically. Drag-and-drop is disabled while editing a title or comment.',
      },
      {
        q: 'How do I delete a task?',
        a: 'Click the trash icon 🗑 in the top-right corner of the card. Two centered buttons appear: Delete (red) and Keep. Deleted tasks are soft-deleted and remain visible in Statistics where they can be restored.',
      },
    ],
  },
  {
    title: '📊 Dashboard',
    items: [
      {
        q: 'What does the Dashboard show?',
        a: 'KPI cards (total/in-progress/completed/overdue), an activity line chart, status pie chart, tag bar chart (only tags with tasks), 12-week heatmap, and recently completed tasks.',
      },
      {
        q: 'How do I select a period?',
        a: (
          <>
            <p>Buttons "Week / Month / Quarter / Year / Custom" in the top-right of the Dashboard.</p>
            <p className="mt-1.5">"Custom" opens a popover — enter From/To dates and click Apply.</p>
            <p className="mt-1.5">Activity chart tooltip shows dates as dd.mm.yyyy.</p>
          </>
        ),
      },
      {
        q: 'What are the Overdue and Total chips in the topbar?',
        a: 'Total (blue icon) shows all tasks. Overdue (red AlertTriangle) counts past-due tasks. Clicking filters the board. Label text appears in the tooltip on hover.',
      },
    ],
  },
  {
    title: '📥 Import / Export',
    items: [
      {
        q: 'How do I import tasks?',
        a: 'Settings → Export/Import → "Choose file". JSON, CSV, and XLSX formats are supported. Preview shows all rows in a scrollable table.',
      },
      {
        q: 'How do I download an import template?',
        a: 'Settings → Export/Import → "Template" button. Downloads XLSX with columns: title, description, status, tags, due_date, created_at. Status and tags are matched automatically on import.',
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
        a: 'Settings → Storage → "Choose…". A system folder picker opens. Only available in the desktop app; browser shows an explanation.',
      },
      {
        q: 'What is the Danger Zone?',
        a: 'Settings → Storage → "⚠ Danger Zone". "Erase all data" requires two confirmations, then clears the DB, recreates default statuses and a welcome task — without a page reload.',
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
        a: 'On each launch (or theme/language change) a random motivational productivity quote is picked.',
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
];

/** Task 13b: "What's New" section generated from CHANGELOG[0] */
function WhatsNewSection({ lang }: { lang: 'ru' | 'en' }) {
  const latest = CHANGELOG[0];
  const items = latest.items[lang];
  return (
    <div>
      <div className="text-[12px] text-muted uppercase tracking-wider mb-2 font-medium">
        {lang === 'ru' ? `🆕 Что нового в v${latest.version}` : `🆕 What's New in v${latest.version}`}
      </div>
      <div className="bg-surface border border-border-soft rounded-lg p-4">
        <div className="text-[11px] text-muted mb-3">{latest.date}</div>
        <ul className="space-y-1.5 list-disc pl-4 text-[13px] text-muted leading-relaxed">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Task 13c: About section */
function AboutSection({ lang }: { lang: 'ru' | 'en' }) {
  const latest = CHANGELOG[0];
  return (
    <div>
      <div className="text-[12px] text-muted uppercase tracking-wider mb-2 font-medium">
        ℹ {lang === 'ru' ? 'О приложении' : 'About'}
      </div>
      <div className="bg-surface border border-border-soft rounded-lg p-4 text-[13px] text-muted leading-relaxed">
        <p><strong>TaskFlow v{latest.version}</strong> — {lang === 'ru' ? 'менеджер задач с поддержкой Tauri (desktop) и браузерного режима.' : 'task manager with Tauri (desktop) and browser mode support.'}</p>
        <p className="mt-1.5">
          {lang === 'ru' ? 'Исходный код и релизы:' : 'Source code and releases:'}{' '}
          <a
            href="https://github.com/danny-swan/taskflow-app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            github.com/danny-swan/taskflow-app
          </a>
        </p>
      </div>
    </div>
  );
}

export function HelpPage() {
  const lang = useStore(s => s.language);
  const sections = lang === 'ru' ? sectionsRu : sectionsEn;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const latest = CHANGELOG[0];

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className="max-w-2xl">
        <h2 className="font-display text-[18px] font-semibold mb-1">{tr(lang, 'help_title')}</h2>
        <div className="text-[12px] text-muted mb-5">TaskFlow v{latest.version}</div>
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

          {/* Task 13c: What's New placed above About section, at the bottom of the page */}
          <WhatsNewSection lang={lang} />

          {/* About section — always last */}
          <AboutSection lang={lang} />
        </div>
      </div>
    </div>
  );
}
