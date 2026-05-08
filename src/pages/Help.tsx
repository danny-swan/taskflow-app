import { useState } from 'react';
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';
import { ChevronDown } from 'lucide-react';

interface HelpItem {
  q: string;
  a: React.ReactNode;
}

const itemsRu: HelpItem[] = [
  {
    q: 'Как добавить задачу?',
    a: 'Откройте вкладку «Добавить» или нажмите клавишу N. Заполните название, выберите статус и тэг — внизу формы есть живой предпросмотр карточки.',
  },
  {
    q: 'Что означают статусы и как они работают?',
    a: (
      <>
        <p>Статусы определяют приоритет задачи и её положение в списке. Чем выше статус в настройках — тем выше задача в общем списке.</p>
        <p className="mt-2">В TaskFlow заданы базовые статусы:</p>
        <ul className="mt-1.5 space-y-1 list-disc pl-4">
          <li><strong>Важно</strong> — критические задачи, требующие внимания в первую очередь</li>
          <li><strong>Сегодня</strong> — задачи на текущий день</li>
          <li><strong>Взять в работу</strong> — нераспределённые задачи без чёткого срока</li>
          <li><strong>В процессе</strong> — задачи, над которыми вы работаете</li>
          <li><strong>Приостановлено</strong> — задачи на паузе (ждут условий, информации, ответа)</li>
          <li><strong>Выполнено</strong> — завершённые задачи</li>
        </ul>
        <p className="mt-2">Это начальный набор. В разделе <strong>Настройки → Статусы</strong> вы можете изменить названия, цвета, порядок (приоритетность), добавить свои или удалить существующие — подстройте систему под свой рабочий процесс.</p>
      </>
    ),
  },
  {
    q: 'Как переключить тему?',
    a: 'Внизу левого сайдбара кнопка с иконкой солнца/луны — открывает выпадающий список из 4 тем: Светлая, Тёмная, Акацуки, Деревня листа.',
  },
  {
    q: 'Как импортировать задачи из Excel?',
    a: 'Импорт из .xlsx в разработке. Пока вы можете экспортировать CSV из старого файла и импортировать вручную через ручную миграцию.',
  },
  {
    q: 'Как экспортировать данные?',
    a: 'Настройки → Экспорт/импорт. Доступны форматы CSV (для Excel) и JSON (для бэкапа). Та же кнопка экспорта есть на странице Статистика.',
  },
  {
    q: 'Какие горячие клавиши?',
    a: 'N — новая задача · / — фокус на поиске · 1–6 — переключение вкладок · ESC — закрыть модальное окно. Клик по заголовку или комментарию задачи — быстрое редактирование.',
  },
  {
    q: 'Как изменить порядок задач?',
    a: 'В списке «Задачи» перетащите карточку мышью. Можно перенести задачу как внутри своего статуса, так и в другую группу — статус автоматически обновится.',
  },
  {
    q: 'Где хранятся данные?',
    a: 'Локально в вашем браузере (SQLite в WebAssembly + localStorage). При обёртке в Tauri данные мигрируют в файл SQLite на диске.',
  },
];

const itemsEn: HelpItem[] = [
  { q: 'How do I add a task?', a: 'Open the "Add" tab or press N. Fill in title, choose status and tag — the live preview below the form shows how the card will look.' },
  {
    q: 'How do statuses work?',
    a: (
      <>
        <p>Statuses define task priority and position in the list. The higher a status sits in settings, the higher its tasks appear overall.</p>
        <p className="mt-2">TaskFlow ships with base statuses:</p>
        <ul className="mt-1.5 space-y-1 list-disc pl-4">
          <li><strong>Важно / Important</strong> — critical tasks first</li>
          <li><strong>Сегодня / Today</strong> — for the current day</li>
          <li><strong>Взять в работу / To do</strong> — unassigned tasks without a clear date</li>
          <li><strong>В процессе / In progress</strong> — what you are actively working on</li>
          <li><strong>Приостановлено / On hold</strong> — paused (waiting for info, conditions, answer)</li>
          <li><strong>Выполнено / Done</strong> — completed</li>
        </ul>
        <p className="mt-2">This is just the starting set. In <strong>Settings → Statuses</strong> you can rename, recolor, reorder (priority), add new ones, or remove existing ones — tailor the system to your workflow.</p>
      </>
    ),
  },
  { q: 'How do I switch theme?', a: 'Bottom of the left sidebar — sun/moon icon opens a dropdown with 4 themes: Light, Dark, Akatsuki, Hidden Leaf.' },
  { q: 'How do I import from Excel?', a: 'XLSX import is coming soon. For now export to CSV and migrate manually.' },
  { q: 'How do I export data?', a: 'Settings → Export / Import. CSV and JSON formats available. Same export buttons on the Stats page.' },
  { q: 'Keyboard shortcuts?', a: 'N — new task · / — focus search · 1–6 — switch tabs · ESC — close modal. Click a card title or comment to edit it inline.' },
  { q: 'How do I reorder tasks?', a: 'In Tasks list, drag a card with the mouse — within the same status group or to a different group; the status updates automatically.' },
  { q: 'Where is my data stored?', a: 'Locally in your browser (SQLite WASM + localStorage). When wrapped in Tauri, data lives in a SQLite file on disk.' },
];

export function HelpPage() {
  const lang = useStore(s => s.language);
  const items = lang === 'ru' ? itemsRu : itemsEn;
  const [openId, setOpenId] = useState<number | null>(null);
  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className="max-w-2xl">
        <h2 className="font-display text-[18px] font-semibold mb-4">{tr(lang, 'help_title')}</h2>
        <div className="space-y-3">
          {items.map((it, i) => {
            const open = openId === i;
            return (
              <div key={i} className="bg-surface border border-border-soft rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : i)}
                  aria-expanded={open}
                  className="w-full text-left list-none px-4 py-3 flex items-start gap-3 select-none hover:bg-surface-alt/40"
                >
                  <span className="text-accent font-mono text-[12px] mt-0.5 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-[13.5px] font-medium flex-1">{it.q}</span>
                  <ChevronDown
                    size={15}
                    className={'text-muted transition-transform shrink-0 mt-0.5 ' + (open ? 'rotate-180' : '')}
                  />
                </button>
                {open && (
                  <div className="px-4 pb-3.5 pl-12 text-[13px] text-muted leading-relaxed">
                    {typeof it.a === 'string' ? <p>{it.a}</p> : it.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
