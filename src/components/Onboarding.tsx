/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.8.12 → v0.9.17 — 10 итераций попыток сделать «умный» онбординг
 *   с spotlight-подсветкой и tooltip'ом рядом с целевым элементом.
 *   Каждый раз что-то отваливалось: floating-ui был асинхронный и мигал,
 *   ручной расчёт координат тултип уводил за viewport, key={step} давал
 *   вспышки в центре, v0.9.16 добавил редкий крэш в белый экран.
 *
 * v0.9.18 — Полный редизайн. Спот-лайт выкинут. Новый подход:
 *   1. Один модал по центру экрана — всегда. Никакого позиционирования
 *      относительно target-элементов, никакого расчёта координат.
 *   2. Тёмный dim overlay 40% opacity под модалом.
 *   3. На каждом шаге в фоне переключается соответствующая вкладка через
 *      navigate(), чтобы пользователь видел реальный UI под модалкой.
 *   4. Прогресс сверху карточки — тонкая полоска, показывает какой шаг
 *      из скольки, без визуального шума 11 точек.
 *   5. Клик по dim overlay — не закрывает (только по «×», «Пропустить»
 *      или «Готово»), чтобы случайный клик мимо кнопки не прервал тур.
 *
 * Результат: 150 строк вместо 560, ноль DOM-логики, ноль возможности
 * упасть в белый экран. Внешне — визуально более цельно, чем полу-рабочий
 * spotlight в v0.9.17.
 *
 * Public API (не менять сигнатуры — используется в Help.tsx и App.tsx):
 *   - <Onboarding />          — маунтится один раз в App.tsx (в ErrorBoundary)
 *   - isOnboardingSeen()      — проверка флага в settings
 *   - markOnboardingSeen()    — проставить флаг
 *   - resetOnboarding()       — сбросить флаг (Help → «Пройти тур заново»)
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, ChevronRight, ChevronLeft, Sparkles,
  ListChecks, CalendarDays, LayoutDashboard, BarChart3,
  Settings as SettingsIcon, HelpCircle, Plus, Tag, Layers,
  LucideIcon,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import * as db from '../lib/db';

const SETTING_KEY = 'onboarding_seen';

export function isOnboardingSeen(): boolean {
  try {
    const row = db.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [SETTING_KEY]);
    return row?.value === '1';
  } catch {
    return true;
  }
}

export function markOnboardingSeen() {
  try {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [SETTING_KEY, '1']);
  } catch { /* silent */ }
}

export function resetOnboarding() {
  try {
    db.run('DELETE FROM settings WHERE key=?', [SETTING_KEY]);
  } catch { /* silent */ }
}

type Step = {
  /** Куда переключить вкладку в фоне при показе этого шага. null — не менять. */
  route: string | null;
  /** Иконка шага (lucide-react). */
  icon: LucideIcon;
  title: { ru: string; en: string };
  body: { ru: string; en: string };
};

const STEPS: Step[] = [
  {
    route: '/tasks',
    icon: Sparkles,
    title: { ru: 'Добро пожаловать в TaskFlow', en: 'Welcome to TaskFlow' },
    body: {
      ru: 'Лёгкий менеджер задач. Работает офлайн, все данные хранятся локально в SQLite. Проведу короткий тур по возможностям — около минуты.',
      en: 'A lightweight task manager. Fully offline, everything is stored locally in SQLite. Let me walk you through the main features — takes about a minute.',
    },
  },
  {
    route: '/tasks',
    icon: ListChecks,
    title: { ru: 'Задачи — список и Kanban', en: 'Tasks — list and Kanban' },
    body: {
      ru: 'На вкладке «Задачи» — два вида: список с колонками и доска Kanban со статусами. Между ними — переключатель в шапке. В верхней панели быстрые метрики (всего, в работе, просрочено, ...) — клик по чипу фильтрует список.',
      en: 'The Tasks tab has two views: a list with columns and a Kanban board grouped by status. Toggle between them in the header. The top bar shows quick metric chips (total, in progress, overdue, …) — click a chip to filter the list.',
    },
  },
  {
    route: '/tasks',
    icon: Plus,
    title: { ru: 'Создание задач', en: 'Creating tasks' },
    body: {
      ru: 'Кнопка «+ Новая задача» или клавиша N. Стрелка справа от кнопки открывает меню шаблонов — часто повторяющиеся задачи можно сохранить как шаблон в Настройках.',
      en: 'The «+ New task» button or press N. The arrow next to it opens a menu of saved templates — recurring tasks can be saved as templates in Settings.',
    },
  },
  {
    route: '/tasks',
    icon: Tag,
    title: { ru: 'Тэги и фильтры', en: 'Tags and filters' },
    body: {
      ru: 'Панель тэгов под шапкой — клик по тэгу оставляет только задачи с ним, повторный клик снимает фильтр. Кнопка «Все» возвращает полный список. Свои тэги настраиваются в Настройках.',
      en: 'The tag row under the header — click a tag to keep only tasks with it, click again to clear. The «All» button shows every task. Custom tags are configured in Settings.',
    },
  },
  {
    route: '/calendar',
    icon: CalendarDays,
    title: { ru: 'Календарь', en: 'Calendar' },
    body: {
      ru: 'Режимы Неделя/Месяц. Drag-and-drop задач между датами меняет дедлайн. Панель «Без дедлайна» слева — перетащите туда задачу, чтобы очистить дату.',
      en: 'Week/Month modes. Drag-and-drop tasks between dates to change the deadline. Drag into the «No deadline» panel to clear the date entirely.',
    },
  },
  {
    route: '/dashboard',
    icon: LayoutDashboard,
    title: { ru: 'Дашборд', en: 'Dashboard' },
    body: {
      ru: 'Обзор с фильтром по датам и агрегированной статистикой за период — сколько создано, завершено, просрочено. Локализованный выбор дат.',
      en: 'An overview with a date-range filter and aggregated stats over the period — how many were created, completed, overdue. Localised date picker.',
    },
  },
  {
    route: '/stats',
    icon: BarChart3,
    title: { ru: 'Статистика', en: 'Stats' },
    body: {
      ru: 'Графики по темпу выполнения, распределению по статусам и тэгам. Вкладка отключаема в Настройках — если не нужна, её можно скрыть.',
      en: 'Charts of completion pace, distribution by status and tags. The tab can be hidden in Settings if you do not need it.',
    },
  },
  {
    route: '/settings',
    icon: SettingsIcon,
    title: { ru: 'Настройки', en: 'Settings' },
    body: {
      ru: 'Темы (Светлая, Тёмная, Akatsuki, Konoha), теги, статусы, шаблоны задач, экспорт/импорт данных, размер шрифта, вкладка по умолчанию.',
      en: 'Themes (Light, Dark, Akatsuki, Konoha), tags, statuses, task templates, data export/import, font size, default tab.',
    },
  },
  {
    route: '/help',
    icon: HelpCircle,
    title: { ru: 'Помощь и горячие клавиши', en: 'Help & hotkeys' },
    body: {
      ru: 'Полная справка, FAQ, список изменений и кнопка «Пройти тур заново». Клавиши: 1–6 — вкладки, N — новая задача, / — поиск.',
      en: 'Full reference, FAQ, changelog and a «Re-run the tour» button. Hotkeys: 1–6 tabs, N — new task, / — search.',
    },
  },
  {
    route: '/tasks',
    icon: Layers,
    title: { ru: 'Готово', en: 'All set' },
    body: {
      ru: 'Приятной работы. TaskFlow полностью офлайн — данные никуда не отправляются, всё хранится локально. Синхронизация с облаком (Supabase) — опциональная, включается на экране входа.',
      en: 'Enjoy. TaskFlow is fully offline — no data leaves your machine, everything is stored locally. Cloud sync (Supabase) is optional and enabled via the sign-in screen.',
    },
  },
];

export function Onboarding() {
  const lang = useStore(s => s.language);
  const ready = useStore(s => s.ready);
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const cur = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const progressPct = ((step + 1) / STEPS.length) * 100;

  // Автозапуск при первом ready.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      try {
        if (!isOnboardingSeen()) setOpen(true);
      } catch { /* silent */ }
    }, 600);
    return () => clearTimeout(t);
  }, [ready]);

  // При смене шага — переключаем вкладку в фоне, чтобы за модалкой был
  // виден релевантный UI. navigate() безопасен даже если route не изменился.
  useEffect(() => {
    if (!open || !cur.route) return;
    try {
      navigate(cur.route);
    } catch { /* silent */ }
  }, [open, step, cur.route, navigate]);

  if (!open) return null;

  const close = () => {
    try { markOnboardingSeen(); } catch { /* silent */ }
    setOpen(false);
    setStep(0);
  };
  const next = () => { if (isLast) close(); else setStep(s => s + 1); };
  const prev = () => setStep(s => Math.max(0, s - 1));

  const tr = (k: 'skip' | 'back' | 'next' | 'done' | 'close' | 'step_of') => {
    const dict = {
      ru: { skip: 'Пропустить', back: 'Назад', next: 'Дальше', done: 'Готово', close: 'Закрыть', step_of: 'Шаг' },
      en: { skip: 'Skip', back: 'Back', next: 'Next', done: 'Done', close: 'Close', step_of: 'Step' },
    };
    return dict[lang === 'ru' ? 'ru' : 'en'][k];
  };

  const Icon = cur.icon;

  return (
    <>
      {/* Dim overlay — 40% opacity, клик по нему не закрывает тур. */}
      <div
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 90,
          background: 'rgba(0, 0, 0, 0.4)',
        }}
      />

      {/* Центрированный модал. Использует уже проверенный класс .scale-in
          из globals.css — тот же, что применяется в Modal, DatePicker,
          StatusPill; никаких новых анимаций. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tf-onb-title"
        className="scale-in"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(460px, 92vw)',
          zIndex: 91,
        }}
      >
        <div className="bg-surface border border-border rounded-xl shadow-2xl overflow-hidden">
          {/* Прогресс-полоска сверху. */}
          <div
            aria-hidden
            style={{
              height: 3,
              background: 'var(--border-soft, rgba(0,0,0,0.08))',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                width: `${progressPct}%`,
                background: 'var(--accent)',
                transition: 'width 240ms ease',
              }}
            />
          </div>

          {/* Шапка. */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-soft">
            <div className="flex items-center gap-2 font-display font-semibold text-[13px]">
              <Icon size={15} className="text-accent" />
              <span id="tf-onb-title">{cur.title[lang === 'ru' ? 'ru' : 'en']}</span>
            </div>
            <button
              onClick={close}
              className="p-1 rounded hover:bg-surface-alt text-muted"
              aria-label={tr('close')}
            >
              <X size={14} />
            </button>
          </div>

          {/* Тело шага. */}
          <div className="px-4 py-4 text-[13px] leading-relaxed text-text min-h-[96px]">
            {cur.body[lang === 'ru' ? 'ru' : 'en']}
          </div>

          {/* Футер: счётчик шагов + управление. */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border-soft">
            <div className="text-[11px] font-mono text-muted tabular-nums">
              {tr('step_of')} {step + 1} / {STEPS.length}
            </div>
            <div className="flex items-center gap-2">
              {!isLast && (
                <button
                  onClick={close}
                  className="text-[12px] text-muted hover:text-text px-2 py-1 rounded hover:bg-surface-alt"
                >
                  {tr('skip')}
                </button>
              )}
              {step > 0 && (
                <button
                  onClick={prev}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
                >
                  <ChevronLeft size={13} />
                  {tr('back')}
                </button>
              )}
              <button
                onClick={next}
                className="flex items-center gap-1 px-3 py-1.5 text-[12px] rounded-md text-white font-medium hover:opacity-90"
                style={{ background: 'var(--accent)' }}
              >
                {isLast ? tr('done') : tr('next')}
                {!isLast && <ChevronRight size={13} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
