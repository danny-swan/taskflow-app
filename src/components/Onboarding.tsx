/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.8.12 → v0.9.17 — 10 итераций попыток сделать «умный» онбординг
 *   с spotlight-подсветкой и tooltip'ом РЯДОМ с целевым элементом.
 *   Каждый раз что-то отваливалось: floating-ui был асинхронный и мигал,
 *   ручной расчёт координат уводил tooltip за viewport.
 *
 * v0.9.18 — Полный редизайн: центрированный модал без spotlight.
 *
 * v0.9.19 — Добавляем spotlight обратно, но безопасно:
 *   1. Tooltip НЕ пытается прилепиться к target. Он остаётся в фикс. позициях —
 *      либо верх экрана (top: 15%), либо низ (top: 65%), выбор автоматический:
 *      если target в верхней половине экрана — tooltip внизу, и наоборот.
 *      Если target не найден — tooltip по центру (fallback).
 *   2. SVG-маска рисует «дырку» вокруг target — тот же безопасный код из
 *      v0.9.17, только без tooltip-позиционирования рядом с target.
 *   3. Если target не найден за 20 попыток (1 сек) — spotlight просто не
 *      рисуется, тултип остаётся по центру, шаг идёт дальше.
 *   4. SVG-mask плавно транзитится через CSS при смене шага (attr rx/x/y/...)
 *      или, где это не работает, через быстрый JS-tween. Мы делаем через
 *      state → React перерендерит с новыми координатами, а сам transition
 *      применяется через animate внутри SVG.
 *
 * Public API (не менять):
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
  /** data-onboarding-значение целевого элемента, вокруг которого рисуется
   *  spotlight. null → без spotlight, tooltip строго по центру. */
  target: string | null;
  /** Куда переключить вкладку в фоне при показе этого шага. null — не менять. */
  route: string | null;
  icon: LucideIcon;
  title: { ru: string; en: string };
  body: { ru: string; en: string };
};

const STEPS: Step[] = [
  {
    target: null,
    route: '/tasks',
    icon: Sparkles,
    title: { ru: 'Добро пожаловать в TaskFlow', en: 'Welcome to TaskFlow' },
    body: {
      ru: 'Лёгкий менеджер задач. Работает офлайн, все данные хранятся локально в SQLite. Проведу короткий тур по возможностям — около минуты.',
      en: 'A lightweight task manager. Fully offline, everything is stored locally in SQLite. Let me walk you through the main features — takes about a minute.',
    },
  },
  {
    target: 'view-toggle',
    route: '/tasks',
    icon: ListChecks,
    title: { ru: 'Задачи — список и Kanban', en: 'Tasks — list and Kanban' },
    body: {
      ru: 'На вкладке «Задачи» — два вида: список с колонками и доска Kanban со статусами. Переключатель в шапке (подсвечен). В верхней панели быстрые метрики (всего, в работе, просрочено, ...) — клик по чипу фильтрует список.',
      en: 'The Tasks tab has two views: a list with columns and a Kanban board grouped by status. Toggle in the header (highlighted). The top bar shows quick metric chips (total, in progress, overdue, …) — click a chip to filter the list.',
    },
  },
  {
    target: 'new-task',
    route: '/tasks',
    icon: Plus,
    title: { ru: 'Создание задач', en: 'Creating tasks' },
    body: {
      ru: 'Кнопка «+ Новая задача» (подсвечена) или клавиша N. Стрелка справа от кнопки открывает меню шаблонов — часто повторяющиеся задачи можно сохранить как шаблон в Настройках.',
      en: 'The «+ New task» button (highlighted) or press N. The arrow next to it opens a menu of saved templates — recurring tasks can be saved as templates in Settings.',
    },
  },
  {
    target: 'tag-filters',
    route: '/tasks',
    icon: Tag,
    title: { ru: 'Тэги и фильтры', en: 'Tags and filters' },
    body: {
      ru: 'Панель тэгов под шапкой (подсвечена) — клик по тэгу оставляет только задачи с ним, повторный клик снимает фильтр. Кнопка «Все» возвращает полный список. Свои тэги настраиваются в Настройках.',
      en: 'The tag row under the header (highlighted) — click a tag to keep only tasks with it, click again to clear. The «All» button shows every task. Custom tags are configured in Settings.',
    },
  },
  {
    target: 'nav-calendar',
    route: '/calendar',
    icon: CalendarDays,
    title: { ru: 'Календарь', en: 'Calendar' },
    body: {
      ru: 'Режимы Неделя/Месяц. Drag-and-drop задач между датами меняет дедлайн. Панель «Без дедлайна» слева — перетащите туда задачу, чтобы очистить дату.',
      en: 'Week/Month modes. Drag-and-drop tasks between dates to change the deadline. Drag into the «No deadline» panel to clear the date entirely.',
    },
  },
  {
    target: 'nav-dashboard',
    route: '/dashboard',
    icon: LayoutDashboard,
    title: { ru: 'Дашборд', en: 'Dashboard' },
    body: {
      ru: 'Обзор с фильтром по датам и агрегированной статистикой за период — сколько создано, завершено, просрочено. Локализованный выбор дат.',
      en: 'An overview with a date-range filter and aggregated stats over the period — how many were created, completed, overdue. Localised date picker.',
    },
  },
  {
    target: 'nav-stats',
    route: '/stats',
    icon: BarChart3,
    title: { ru: 'Статистика', en: 'Stats' },
    body: {
      ru: 'Графики по темпу выполнения, распределению по статусам и тэгам. Вкладка отключаема в Настройках — если не нужна, её можно скрыть.',
      en: 'Charts of completion pace, distribution by status and tags. The tab can be hidden in Settings if you do not need it.',
    },
  },
  {
    target: 'nav-settings',
    route: '/settings',
    icon: SettingsIcon,
    title: { ru: 'Настройки', en: 'Settings' },
    body: {
      ru: 'Темы (Светлая, Тёмная, Akatsuki, Konoha), теги, статусы, шаблоны задач, экспорт/импорт данных, размер шрифта, вкладка по умолчанию.',
      en: 'Themes (Light, Dark, Akatsuki, Konoha), tags, statuses, task templates, data export/import, font size, default tab.',
    },
  },
  {
    target: 'nav-help',
    route: '/help',
    icon: HelpCircle,
    title: { ru: 'Помощь и горячие клавиши', en: 'Help & hotkeys' },
    body: {
      ru: 'Полная справка, FAQ, список изменений и кнопка «Пройти тур заново». Клавиши: 1–6 — вкладки, N — новая задача, / — поиск.',
      en: 'Full reference, FAQ, changelog and a «Re-run the tour» button. Hotkeys: 1–6 tabs, N — new task, / — search.',
    },
  },
  {
    target: null,
    route: '/tasks',
    icon: Layers,
    title: { ru: 'Готово', en: 'All set' },
    body: {
      ru: 'Приятной работы. TaskFlow полностью офлайн — данные никуда не отправляются, всё хранится локально. Синхронизация с облаком (Supabase) — опциональная, включается на экране входа.',
      en: 'Enjoy. TaskFlow is fully offline — no data leaves your machine, everything is stored locally. Cloud sync (Supabase) is optional and enabled via the sign-in screen.',
    },
  },
];

/** Толщина «воздушной подушки» вокруг подсвеченного элемента, px. */
const SPOTLIGHT_PADDING = 8;
/** Радиус закругления углов spotlight. */
const SPOTLIGHT_RADIUS = 10;
/** Максимум попыток найти target в DOM (50ms × 20 = 1 сек). */
const MAX_TARGET_ATTEMPTS = 20;

type SpotlightRect = { x: number; y: number; w: number; h: number };

export function Onboarding() {
  const lang = useStore(s => s.language);
  const ready = useStore(s => s.ready);
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  /** Прямоугольник target-элемента для spotlight. null → без spotlight. */
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);

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

  // При смене шага — переключаем вкладку в фоне.
  useEffect(() => {
    if (!open || !cur.route) return;
    try {
      navigate(cur.route);
    } catch { /* silent */ }
  }, [open, step, cur.route, navigate]);

  // Поиск target-элемента для spotlight. Ретраи с интервалом 50ms.
  // Если за 1 сек не нашли — spotlight не показываем, тултип по центру.
  useEffect(() => {
    if (!open) {
      setSpotlight(null);
      return;
    }
    if (!cur.target) {
      setSpotlight(null);
      return;
    }

    let attempts = 0;
    let cancelled = false;
    let timerId: number | null = null;

    const findAndMeasure = () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const el = document.querySelector<HTMLElement>(`[data-onboarding="${cur.target}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          setSpotlight({
            x: Math.max(0, r.left - SPOTLIGHT_PADDING),
            y: Math.max(0, r.top - SPOTLIGHT_PADDING),
            w: r.width + SPOTLIGHT_PADDING * 2,
            h: r.height + SPOTLIGHT_PADDING * 2,
          });
          return;
        }
      } catch { /* silent — target пропал из DOM, spotlight не рисуем */ }
      if (attempts < MAX_TARGET_ATTEMPTS) {
        timerId = window.setTimeout(findAndMeasure, 50);
      } else {
        setSpotlight(null);
      }
    };

    // Сбрасываем предыдущий spotlight, чтобы SVG-mask не показывал старую
    // «дырку» на новом шаге пока не найден новый target.
    setSpotlight(null);
    timerId = window.setTimeout(findAndMeasure, 50);
    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [open, step, cur.target]);

  // Периодически обновляем spotlight (окно ресайзится, target двигается).
  // Только когда есть активный target и spotlight уже найден.
  useEffect(() => {
    if (!open || !cur.target || !spotlight) return;
    const update = () => {
      try {
        const el = document.querySelector<HTMLElement>(`[data-onboarding="${cur.target}"]`);
        if (!el) return;
        const r = el.getBoundingClientRect();
        setSpotlight({
          x: Math.max(0, r.left - SPOTLIGHT_PADDING),
          y: Math.max(0, r.top - SPOTLIGHT_PADDING),
          w: r.width + SPOTLIGHT_PADDING * 2,
          h: r.height + SPOTLIGHT_PADDING * 2,
        });
      } catch { /* silent */ }
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cur.target, spotlight?.x, spotlight?.y]);

  if (!open) return null;

  const close = () => {
    try { markOnboardingSeen(); } catch { /* silent */ }
    setOpen(false);
    setStep(0);
    setSpotlight(null);
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

  // Определяем вертикальное положение tooltip'а:
  //  - если spotlight в верхней половине экрана → tooltip внизу (top: 65%)
  //  - если spotlight в нижней половине → tooltip вверху (top: 15%)
  //  - если spotlight нет → tooltip по центру (top: 50%)
  // Все три случая — фиксированные top-значения, без расчёта относительно
  // размера tooltip'а. Ничему уезжать некуда.
  let tooltipTop: string;
  let tooltipTransform: string;
  if (!spotlight) {
    tooltipTop = '50%';
    tooltipTransform = 'translate(-50%, -50%)';
  } else {
    const vh = window.innerHeight;
    const spotlightCenter = spotlight.y + spotlight.h / 2;
    if (spotlightCenter < vh / 2) {
      // Target в верхней половине → tooltip в нижней трети.
      tooltipTop = '68%';
      tooltipTransform = 'translate(-50%, 0)';
    } else {
      // Target в нижней половине → tooltip в верхней трети.
      tooltipTop = '15%';
      tooltipTransform = 'translate(-50%, 0)';
    }
  }

  return (
    <>
      {/*
        SVG-оверлей с вырезом (mask) вокруг target-элемента.
        Если spotlight === null — маска состоит только из fill=white (сплошной
        затемняющий rect), «дырки» нет.
      */}
      <svg
        aria-hidden
        width="100%"
        height="100%"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 90,
          pointerEvents: 'auto',
        }}
      >
        <defs>
          <mask id="tf-onboarding-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {spotlight && (
              <rect
                x={spotlight.x}
                y={spotlight.y}
                width={spotlight.w}
                height={spotlight.h}
                rx={SPOTLIGHT_RADIUS}
                ry={SPOTLIGHT_RADIUS}
                fill="black"
                style={{ transition: 'x 240ms ease, y 240ms ease, width 240ms ease, height 240ms ease' }}
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.55)"
          mask="url(#tf-onboarding-mask)"
        />
        {spotlight && (
          <rect
            x={spotlight.x}
            y={spotlight.y}
            width={spotlight.w}
            height={spotlight.h}
            rx={SPOTLIGHT_RADIUS}
            ry={SPOTLIGHT_RADIUS}
            fill="none"
            stroke="var(--accent, #6366f1)"
            strokeWidth="2"
            style={{
              filter: 'drop-shadow(0 0 8px var(--accent, #6366f1))',
              transition: 'x 240ms ease, y 240ms ease, width 240ms ease, height 240ms ease',
              pointerEvents: 'none',
            }}
          />
        )}
      </svg>

      {/* Модал в одной из двух фиксированных позиций (top: 15% / 50% / 68%).
          Плавно перемещается через CSS transition по top. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tf-onb-title"
        className="scale-in"
        style={{
          position: 'fixed',
          top: tooltipTop,
          left: '50%',
          transform: tooltipTransform,
          width: 'min(460px, 92vw)',
          zIndex: 91,
          transition: 'top 260ms ease',
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

          {/* Футер. */}
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
