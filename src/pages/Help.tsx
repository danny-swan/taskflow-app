import { useState } from 'react';
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';
import { ChevronDown } from 'lucide-react';
import { CHANGELOG } from '../data/changelog';

interface HelpSection {
  title: string;
  items: { q: string; a: React.ReactNode }[];
}

// ─── RU ──────────────────────────────────────────────────────────────────────
const sectionsRu: HelpSection[] = [
  {
    title: '📋 Основы',
    items: [
      {
        q: 'Как добавить задачу?',
        a: 'На вкладке «Задачи» нажмите кнопку «+ Новая задача» в правом верхнем углу — откроется модальное окно. Заполните название, выберите статус и тэг (можно создать новый через «+»), при необходимости задайте даты начала и дедлайн. Внизу формы — живой предпросмотр карточки.',
      },
      {
        q: 'Как работают тэги?',
        a: 'Тэги — это метки для категоризации задач. Создавайте их в Настройки → Тэги (имя + цвет) или прямо из модалки задачи кнопкой «+». На доске задач есть горизонтально прокручиваемая панель фильтрации по тэгу.',
      },
      {
        q: 'Как работают статусы?',
        a: (
          <>
            <p>Статусы определяют группировку задач на доске. Порядок задаётся стрелками в Настройки → Статусы.</p>
            <p className="mt-2">
              <strong>Скрытый</strong> — статус не показывается на доске, но виден в Статистике и Дашборде. По умолчанию — у «Удалено».
            </p>
            <p className="mt-2">
              <strong>Свёрнут по умолчанию</strong> — секция статуса видна на доске, но свёрнута. Кликните по заголовку, чтобы раскрыть. По умолчанию — у «Выполнено».
            </p>
            <p className="mt-2">Стандартные статусы: Запланировано, Взять в работу, В работе, Приостановлено, Выполнено (свёрнут), Удалено (скрытый).</p>
          </>
        ),
      },
      {
        q: 'Как перетащить задачу в другой статус?',
        a: 'Перетащите карточку за иконку ⋮⋮ (drag handle) с правой стороны. Поддерживаются перестановка внутри статуса и перенос между статусами. Клик по самой карточке открывает модалку редактирования — эти жесты не конфликтуют (исправлено в v0.8.6).',
      },
      {
        q: 'Как удалить задачу?',
        a: 'В модалке задачи — кнопка «Удалить» внизу слева, затем подтверждение. Задача мягко удаляется (статус «Удалено») и видна в Статистике, откуда её можно восстановить.',
      },
      {
        q: 'Что такое эмодзи-пикер в полях задачи? (v0.8.8)',
        a: (
          <>
            <p>Рядом с заголовком полей <strong>Название</strong> и <strong>Комментарий</strong> есть кнопка 😊. Клик — открывается панель: сначала «Недавние» (до 12), потом кнопка «Больше…» раскрывает полный picker с поиском и 8 категориями (Смайлы, Жесты, Объекты, Символы, Природа, Еда, Действия, Транспорт).</p>
            <p className="mt-2">Эмодзи вставляется в позицию каретки, фокус сохраняется. Недавние сохраняются между запусками.</p>
          </>
        ),
      },
    ],
  },
  {
    title: '📊 Дашборд',
    items: [
      {
        q: 'Что показывает Дашборд?',
        a: (
          <>
            <p>Дашборд разделён на две зоны:</p>
            <p className="mt-2"><strong>Текущий срез</strong> (не зависит от периода): топбар с метриками (Всего / В работе / Приостановлено / Выполнено / Просрочено / Самый частый тэг), круговая диаграмма «По статусу» и столбчатая «По тэгам».</p>
            <p className="mt-2"><strong>За период</strong> (период выбирается в правом верхнем углу): график «Активность» во всю ширину с тремя линиями — новые (синяя), выполненные (зелёная), просроченные (красная) — и тепловая карта «12 недель».</p>
            <p className="mt-2">Внизу — список «Недавно завершённые».</p>
          </>
        ),
      },
      {
        q: 'Как выбрать период?',
        a: (
          <>
            <p>Кнопки «Неделя / Месяц / Квартал / Год / Свой период» в правом верхнем углу Дашборда. Период влияет только на график «Активность» (и связанные счётчики за период, если они присутствуют).</p>
            <p className="mt-1.5">«Свой период» открывает поповер — даты «От» и «До», затем «Применить».</p>
            <p className="mt-1.5">Метрики в шапке и графики «По статусу» / «По тэгам» показывают текущее состояние всех задач и не зависят от периода.</p>
          </>
        ),
      },
      {
        q: 'Что за чипы в топбаре вкладки «Задачи»?',
        a: 'Всего (синий), В работе (зелёный), Внимание (оранжевый — дедлайн в ближайшие 3 дня), Просрочено (красный). Клик по чипу фильтрует доску по соответствующим задачам.',
      },
      {
        q: 'Как читать подсветку дедлайна?',
        a: 'Синий «сегодня», оранжевый жирный — 1–3 дня до дедлайна, серый — 4+ дней, красный жирный — просрочено. Жёлтый промежуточный цвет убран в v0.8.7 для большей контрастности.',
      },
    ],
  },
  {
    title: '📥 Экспорт / Импорт',
    items: [
      {
        q: 'В каких форматах можно экспортировать?',
        a: (
          <>
            <p><strong>JSON</strong> — полная резервная копия (задачи + тэги + статусы), идеальный формат для переноса между ПК.</p>
            <p className="mt-1.5"><strong>XLSX</strong> — удобный для просмотра в Excel/Google Sheets.</p>
            <p className="mt-1.5">CSV-экспорт убран в v0.8.8: он некорректно восстанавливал статусы при обратном импорте.</p>
          </>
        ),
      },
      {
        q: 'Как импортировать?',
        a: 'Настройки → Экспорт/Импорт → «Выберите файл». Поддерживаются JSON и XLSX. После выбора показывается предпросмотр и выбор стратегии: «Слить» (добавить к существующим) или «Заменить всё». При импорте задачи без указанного статуса попадают в «Взять в работу» (v0.8.8).',
      },
      {
        q: 'Как скачать шаблон для импорта?',
        a: 'Настройки → Экспорт/Импорт → кнопка «Шаблон». Скачивает XLSX-файл со столбцами: title, comment, status, tag, start_date, deadline. Статусы и тэги по умолчанию подбираются автоматически.',
      },
    ],
  },
  {
    title: '💾 Хранилище',
    items: [
      {
        q: 'Где хранятся данные?',
        a: (
          <>
            <p>В десктопной версии — два файла в папке профиля пользователя: <code>data.db</code> (SQLite со всеми данными) и <code>taskflow_config.json</code> (только переопределение пути, если задано).</p>
            <p className="mt-1.5">На Windows это <code>%APPDATA%\TaskFlow</code> — можно открыть через <code>Win+R</code> → <code>%APPDATA%\TaskFlow</code>, либо нажать кнопку <strong>«Открыть папку»</strong> в Настройки → Хранилище (v0.8.9).</p>
            <p className="mt-1.5">В браузерной версии — IndexedDB через sql.js (SQLite WASM).</p>
          </>
        ),
      },
      {
        q: 'Можно ли держать БД в OneDrive / Dropbox / Яндекс.Диске?',
        a: 'Не рекомендуется. SQLite блокирует файл во время работы приложения, и облачная синхронизация может повредить базу. Для переноса данных между устройствами используйте Экспорт/Импорт в JSON или XLSX.',
      },
      {
        q: 'Как изменить путь к файлу БД?',
        a: 'Настройки → Хранилище → «Выбрать…». Откроется системный диалог выбора папки — новый <code>taskflow.db</code> будет создан внутри. «Сбросить к умолчанию» возвращает <code>%APPDATA%\\TaskFlow\\data.db</code>. Функция доступна только в десктопной версии.',
      },
      {
        q: 'Что такое «Опасная зона»?',
        a: 'Настройки → Хранилище → «⚠ Опасная зона». Кнопка «Стереть все данные» требует двух подтверждений, затем полностью очищает БД, пересоздаёт стандартные статусы и welcome-задачу — без перезагрузки страницы. Исправлено в v0.8.7: раньше в десктопе очищался только кэш в памяти.',
      },
    ],
  },
  {
    title: '🎨 Темы и язык',
    items: [
      {
        q: 'Как переключить тему?',
        a: 'Внизу левого сайдбара — кнопка с иконкой солнца/луны. Доступны 4 темы: Светлая, Тёмная, Акацуки, Деревня листа.',
      },
      {
        q: 'Как сменить язык?',
        a: 'Настройки → Общие → Язык: русский / English. Цитаты и подсказки переключаются вместе с языком.',
      },
      {
        q: 'Что за цитаты в топбаре?',
        a: 'При каждом запуске (и при смене темы/языка) случайно выбирается мотивирующая цитата. Набор зависит от темы (для Акацуки и Деревни листа — тематические).',
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
            <li><code>1</code> — Задачи</li>
            <li><code>2</code> — Дашборд</li>
            <li><code>3</code> — Статистика</li>
            <li><code>4</code> — Настройки</li>
            <li><code>5</code> — Помощь</li>
            <li><code>/</code> — фокус на поле поиска (на вкладке Задачи)</li>
            <li><code>Esc</code> — закрыть модальное окно / отменить редактирование / закрыть эмодзи-пикер</li>
            <li><code>Enter</code> в полях карточки — сохранить inline-правку</li>
          </ul>
        ),
      },
    ],
  },
];

// ─── EN ──────────────────────────────────────────────────────────────────────
const sectionsEn: HelpSection[] = [
  {
    title: '📋 Basics',
    items: [
      {
        q: 'How do I add a task?',
        a: 'On the Tasks tab, click "+ New task" in the top right — a modal opens. Fill in the title, pick a status and tag (you can create a new one with "+"), optionally set start/deadline dates. The live card preview is at the bottom of the form.',
      },
      {
        q: 'How do tags work?',
        a: 'Tags are labels for categorising tasks. Create them in Settings → Tags (name + colour) or right from the task modal via the "+" button. The board has a horizontally scrollable filter strip.',
      },
      {
        q: 'How do statuses work?',
        a: (
          <>
            <p>Statuses group tasks on the board. Order is set with arrows in Settings → Statuses.</p>
            <p className="mt-2">
              <strong>Hidden</strong> — the status is not shown on the board but is visible in Statistics and Dashboard. Default for "Deleted".
            </p>
            <p className="mt-2">
              <strong>Collapsed by default</strong> — the section is visible on the board but collapsed. Click the header to expand. Default for "Done".
            </p>
            <p className="mt-2">Default statuses: Planned, Take into work, In progress, On hold, Done (collapsed), Deleted (hidden).</p>
          </>
        ),
      },
      {
        q: 'How do I drag a task between statuses?',
        a: 'Drag the card by the ⋮⋮ handle on the right. Both reordering inside one status and moving between statuses are supported. Clicking the card body opens the edit modal — these gestures no longer conflict (fixed in v0.8.6).',
      },
      {
        q: 'How do I delete a task?',
        a: 'In the task modal — the "Delete" button at the bottom left, then confirm. The task is soft-deleted (moved to "Deleted") and stays visible in Statistics where it can be restored.',
      },
      {
        q: 'What is the emoji picker in task fields? (v0.8.8)',
        a: (
          <>
            <p>Next to the labels of the <strong>Title</strong> and <strong>Comment</strong> fields there's a 😊 button. Click it to open a panel: first the recent emojis (up to 12), then a "More…" button expanding the full picker with search and 8 categories (Smileys, Gestures, Objects, Symbols, Nature, Food, Activities, Travel).</p>
            <p className="mt-2">The emoji is inserted at the caret position and focus is preserved. Recent emojis are remembered across launches.</p>
          </>
        ),
      },
    ],
  },
  {
    title: '📊 Dashboard',
    items: [
      {
        q: 'What does the Dashboard show?',
        a: (
          <>
            <p>The Dashboard has two zones:</p>
            <p className="mt-2"><strong>Current snapshot</strong> (does NOT depend on the period): top bar with metrics (Total / In progress / On hold / Done / Overdue / Most-used tag), pie chart "By status" and bar chart "By tag".</p>
            <p className="mt-2"><strong>For the selected period</strong> (picked in the top-right): full-width "Activity" chart with three lines — created (blue), completed (green), overdue (red) — plus the 12-week heatmap.</p>
            <p className="mt-2">At the bottom — the "Recently completed" list.</p>
          </>
        ),
      },
      {
        q: 'How do I pick a period?',
        a: (
          <>
            <p>Buttons "Week / Month / Quarter / Year / Custom" in the top right. The period only affects the Activity chart (and any period-scoped counters there).</p>
            <p className="mt-1.5">"Custom" opens a popover — pick From/To dates and click Apply.</p>
            <p className="mt-1.5">The top-bar metrics and "By status" / "By tag" charts always show the current state of all tasks regardless of period.</p>
          </>
        ),
      },
      {
        q: 'What are the chips in the Tasks topbar?',
        a: 'Total (blue), In progress (green), Attention (orange — deadline within 3 days), Overdue (red). Clicking a chip filters the board.',
      },
      {
        q: 'How is the deadline coloured?',
        a: 'Blue for "today", bold orange for 1–3 days left, muted grey for 4+ days, bold red for overdue. The intermediate yellow tier was removed in v0.8.7 for higher contrast.',
      },
    ],
  },
  {
    title: '📥 Export / Import',
    items: [
      {
        q: 'Which export formats are supported?',
        a: (
          <>
            <p><strong>JSON</strong> — full backup (tasks + tags + statuses), ideal for moving between machines.</p>
            <p className="mt-1.5"><strong>XLSX</strong> — easy to inspect in Excel/Google Sheets.</p>
            <p className="mt-1.5">CSV export was removed in v0.8.8 — it didn't round-trip statuses correctly.</p>
          </>
        ),
      },
      {
        q: 'How do I import?',
        a: 'Settings → Export/Import → "Choose file". JSON and XLSX are supported. After picking a file you see a preview and a strategy choice: "Merge" (add on top of existing) or "Replace all". Tasks without an explicit status land in "Take into work" (v0.8.8).',
      },
      {
        q: 'How do I download an import template?',
        a: 'Settings → Export/Import → "Template" button. Downloads an XLSX with columns: title, comment, status, tag, start_date, deadline. Default statuses and tags are matched automatically.',
      },
    ],
  },
  {
    title: '💾 Storage',
    items: [
      {
        q: 'Where is my data stored?',
        a: (
          <>
            <p>In the desktop app — two files in the user profile folder: <code>data.db</code> (SQLite with all data) and <code>taskflow_config.json</code> (only the DB path override, if any).</p>
            <p className="mt-1.5">On Windows that's <code>%APPDATA%\TaskFlow</code> — you can open it via <code>Win+R</code> → <code>%APPDATA%\TaskFlow</code>, or use the new <strong>"Open folder"</strong> button in Settings → Storage (v0.8.9).</p>
            <p className="mt-1.5">In the browser — IndexedDB via sql.js (SQLite WASM).</p>
          </>
        ),
      },
      {
        q: 'Can I keep the DB on OneDrive / Dropbox / Google Drive?',
        a: 'Not recommended. SQLite locks the file while the app runs, and cloud sync can corrupt the database. To move data between devices use Export/Import in JSON or XLSX.',
      },
      {
        q: 'How do I change the database path?',
        a: 'Settings → Storage → "Choose…". A system folder picker opens — a fresh <code>taskflow.db</code> is created inside. "Reset to default" goes back to <code>%APPDATA%\\TaskFlow\\data.db</code>. Desktop-only.',
      },
      {
        q: 'What is the Danger Zone?',
        a: 'Settings → Storage → "⚠ Danger Zone". "Erase all data" requires two confirmations, then fully wipes the DB, recreates default statuses and a welcome task — no page reload. Fixed in v0.8.7: previously only the in-memory cache was reset on desktop.',
      },
    ],
  },
  {
    title: '🎨 Themes & Language',
    items: [
      {
        q: 'How do I switch theme?',
        a: 'Bottom of the left sidebar — sun/moon icon. Four themes: Light, Dark, Akatsuki, Hidden Leaf.',
      },
      {
        q: 'How do I change language?',
        a: 'Settings → General → Language: Russian / English. Quotes and hints follow the language.',
      },
      {
        q: 'What are the topbar quotes?',
        a: 'On each launch (and on theme/language change) a random motivational quote is picked. The set depends on the theme (Akatsuki and Hidden Leaf have themed quotes).',
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
            <li><code>1</code> — Tasks</li>
            <li><code>2</code> — Dashboard</li>
            <li><code>3</code> — Statistics</li>
            <li><code>4</code> — Settings</li>
            <li><code>5</code> — Help</li>
            <li><code>/</code> — focus the search box (on the Tasks tab)</li>
            <li><code>Esc</code> — close modal / cancel edit / close emoji picker</li>
            <li><code>Enter</code> in card fields — save the inline edit</li>
          </ul>
        ),
      },
    ],
  },
];

/** "What's New" — generated from CHANGELOG[0]. */
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

/** About section. */
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

          <WhatsNewSection lang={lang} />
          <AboutSection lang={lang} />
        </div>
      </div>
    </div>
  );
}
