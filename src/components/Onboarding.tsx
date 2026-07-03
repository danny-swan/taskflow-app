/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.8.12  — Первая версия онбординга: центральная модалка с 5 шагами (welcome +
 *            create + drag + complete + shortcuts). Без подсветки UI.
 * v0.9.7   — Полностью переработан: dim BG + spotlight target. Шаги теперь
 *            подсвечивают конкретные UI-элементы через SVG-mask (cutout вокруг
 *            data-onboarding=«key»). Tooltip позиционируется рядом с target
 *            через floating-ui (strategy=fixed, устойчиво к transform на
 *            родителях). Шаги обновлены под фичи, добавленные в v0.8.13—v0.9.6:
 *            Kanban-вид, Календарь (Неделя/Месяц + DnD + обратный DnD),
 *            локализованный DatePicker, шаблоны задач, метрики.
 * v0.9.8   — Правки:
 *            (1) welcome/финальный tooltip центрируется через position:fixed
 *                + translate(-50%,-50%), а не через floating-ui с виртуальным
 *                нулевым reference (иначе tooltip прилипал к левому верху и
 *                перекрывал sidebar).
 *            (2) Финальный шаг подсвечивает «Помощь» (nav-help), потому что
 *                текст ссылается именно на неё.
 *            (3) Новые шаги: фильтры по тэгам на «Задачах» и метрик-чипы в
 *                шапке (data-onboarding=tag-filters / metric-chips).
 * v0.9.9   — Исправление позиционирования промежуточных шагов.
 *            Раньше через virtualRef.getBoundingClientRect() отдавался rect
 *            с координатами target, но floating-ui не пересчитывал позицию
 *            при смене virtualRef (autoUpdate слушает resize/scroll, а не
 *            смену reference). В итоге tooltip прилипал к (0,0).
 *            Теперь reference — реальный DOM-элемент через refs.setReference(el),
 *            autoUpdate работает штатно. Для шагов без target (welcome/final)
 *            reference не устанавливается, tooltip центрируется собственным
 *            style (position:fixed + translate(-50%,-50%)).
 * v0.9.11  — Итоговый фикс левого-верхнего угла (0,0):
 *            (1) refs.setReference(el) в useLayoutEffect всё ещё отставал от
 *                рендера — floating-ui успевал вычислить позицию с
 *                reference=null и вернуть {top:0,left:0}. Перевели на
 *                elements: { reference: targetEl } — нативный контракт
 *                floating-ui v2, пересчёт синхронен с рендером React.
 *            (2) targetEl сбрасывается СИНХРОННО в useEffect смены шага
 *                до таймера, чтобы isCentered=true срабатывало в первом
 *                рендере нового шага и не оставалось старого reference.
 *            (3) Поиск target — с ретраями (до 1с), чтобы пережить
 *                поздний рендер страницы после navigate().
 *            (4) Пока target не найден — tooltip показывается
 *                visibility:hidden, чтобы не мерцал.
 *
 * Public API (не менять сигнатуры — используется в Help.tsx и App.tsx):
 *   - <Onboarding />          — маунтится один раз в App.tsx
 *   - isOnboardingSeen()      — проверка флага в settings
 *   - markOnboardingSeen()    — проставить флаг
 *   - resetOnboarding()       — сбросить флаг (Help → «Пройти тур заново»)
 */
import { useState, useEffect, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useFloating, offset, flip, shift, autoUpdate, FloatingPortal,
} from '@floating-ui/react';
import { X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';
import * as db from '../lib/db';

const SETTING_KEY = 'onboarding_seen';

export function isOnboardingSeen(): boolean {
  try {
    const row = db.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [SETTING_KEY]);
    return row?.value === '1';
  } catch {
    return true; // если БД не готова — считаем «видел», чтобы не мешать
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

type Placement = 'bottom' | 'top' | 'right' | 'left';

type Step = {
  /** data-onboarding атрибут target-элемента. null → без подсветки (центр экрана). */
  target: string | null;
  /** Куда перейти перед показом шага (react-router path). null → не менять. */
  route: string | null;
  placement?: Placement;
  title: { ru: string; en: string };
  body: { ru: string; en: string };
};

const STEPS: Step[] = [
  {
    target: null,
    route: '/tasks',
    title: { ru: 'Добро пожаловать в TaskFlow', en: 'Welcome to TaskFlow' },
    body: {
      ru: 'Лёгкий менеджер задач, работает офлайн, все данные хранятся локально. Проведу короткий тур по основным возможностям — займёт около минуты.',
      en: 'A lightweight task manager that works offline and stores everything locally. Let me walk you through the main features — takes about a minute.',
    },
  },
  {
    target: 'sidebar',
    route: '/tasks',
    placement: 'right',
    title: { ru: 'Навигация', en: 'Navigation' },
    body: {
      ru: 'Слева — переход между вкладками: Задачи, Календарь, Дашборд, Статистика, Настройки, Помощь. Быстрые клавиши 1–5.',
      en: 'Left sidebar — switch between Tasks, Calendar, Dashboard, Stats, Settings, Help. Hotkeys 1–5.',
    },
  },
  {
    target: 'new-task',
    route: '/tasks',
    placement: 'bottom',
    title: { ru: 'Создание задачи', en: 'Create a task' },
    body: {
      ru: 'Кнопка «+ Новая задача» или клавиша N. Стрелка справа открывает меню с сохранёнными шаблонами.',
      en: 'The «+ New task» button or press N. The arrow on the right opens a menu with saved templates.',
    },
  },
  {
    target: 'view-toggle',
    route: '/tasks',
    placement: 'bottom',
    title: { ru: 'Список или Канбан', en: 'List or Kanban' },
    body: {
      ru: 'Переключение вида на странице «Задачи»: список с колонками или доска Kanban со статусами.',
      en: 'Toggle the Tasks page view: a list with columns or a Kanban board grouped by status.',
    },
  },
  // v0.9.8: новый шаг — фильтры по тэгам
  {
    target: 'tag-filters',
    route: '/tasks',
    placement: 'bottom',
    title: { ru: 'Фильтры по тэгам', en: 'Tag filters' },
    body: {
      ru: 'Панель тэгов на вкладке «Задачи»: клик по тэгу оставляет только задачи с ним, повторный клик снимает фильтр. Кнопка «Все» показывает все задачи.',
      en: 'Tag filter row on the Tasks tab: click a tag to keep only tasks with it, click again to clear. The «All» button shows every task.',
    },
  },
  // v0.9.8: новый шаг — метрик-чипы в шапке
  {
    target: 'metric-chips',
    route: '/tasks',
    placement: 'bottom',
    title: { ru: 'Метрики в шапке', en: 'Metric chips' },
    body: {
      ru: 'В верхней шапке — быстрые метрики со значками: всего задач, в работе, на паузе, выполнено, просрочено, требуют внимания. Клик по чипу фильтрует список на вкладке «Задачи».',
      en: 'The top bar shows quick metric chips with icons: total, in progress, paused, done, overdue, needs attention. Clicking a chip filters the list on the Tasks tab.',
    },
  },
  {
    target: 'nav-calendar',
    route: '/tasks',
    placement: 'right',
    title: { ru: 'Календарь', en: 'Calendar' },
    body: {
      ru: 'Вкладка «Календарь» — режимы Неделя/Месяц, DnD задач по датам и обратный DnD в панель «Без дедлайна», чтобы очистить дедлайн.',
      en: 'The «Calendar» tab — Week/Month modes, drag tasks between dates, drag back to the «No deadline» panel to clear the deadline.',
    },
  },
  {
    target: 'nav-dashboard',
    route: '/tasks',
    placement: 'right',
    title: { ru: 'Дашборд', en: 'Dashboard' },
    body: {
      ru: 'Дашборд — обзор с фильтром дат (локализованный DatePicker) и статистикой по периоду.',
      en: 'Dashboard — overview with a date filter (localised DatePicker) and stats over a period.',
    },
  },
  {
    target: 'nav-settings',
    route: '/tasks',
    placement: 'right',
    title: { ru: 'Настройки', en: 'Settings' },
    body: {
      ru: 'В Настройках — темы, теги, статусы, шаблоны задач, экспорт/импорт данных, размер шрифта.',
      en: 'Settings — themes, tags, statuses, task templates, data export/import, font size.',
    },
  },
  // v0.9.8: финальный шаг теперь подсвечивает «Помощь» (nav-help), потому что
  //         текст ссылается именно на неё
  {
    target: 'nav-help',
    route: '/tasks',
    placement: 'right',
    title: { ru: 'Помощь и перезапуск тура', en: 'Help & re-run the tour' },
    body: {
      ru: 'Во вкладке «Помощь» — полная справка, список горячих клавиш и кнопка «Пройти тур заново». Клавиши: 1–5 — вкладки, N — новая задача, / — поиск.',
      en: 'The «Help» tab has the full reference, hotkey list and a «Re-run the tour» button. Hotkeys: 1–5 tabs, N new task, / search.',
    },
  },
  {
    target: null,
    route: null,
    title: { ru: 'Готово', en: 'All set' },
    body: {
      ru: 'Приятной работы. TaskFlow полностью офлайн — данные никуда не отправляются, всё хранится локально в SQLite.',
      en: 'Enjoy. TaskFlow is fully offline — no data leaves your machine, everything is stored locally in SQLite.',
    },
  },
];

/** Отступ подсветки вокруг target (px). */
const SPOTLIGHT_PADDING = 6;
/** Радиус скругления подсветки (px). */
const SPOTLIGHT_RADIUS = 8;

export function Onboarding() {
  const lang = useStore(s => s.language);
  const ready = useStore(s => s.ready);
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [targetEl, setTargetEl] = useState<HTMLElement | null>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  // v0.9.11: пока идёт поиск target — прячем tooltip, чтобы не мерцал.
  const [resolving, setResolving] = useState(false);

  const cur = STEPS[step];
  const isLast = step === STEPS.length - 1;

  // Автозапуск при первом ready
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      if (!isOnboardingSeen()) setOpen(true);
    }, 600);
    return () => clearTimeout(t);
  }, [ready]);

  // v0.9.11: сначала СИНХРОННО сбрасываем targetEl, чтобы первый рендер
  // нового шага не позиционировался относительно старого элемента.
  // Затем — navigate и поиск target с ретраями на случай позднего рендера.
  useEffect(() => {
    if (!open) return;

    // Сброс состояния target — синхронно
    setTargetEl(null);
    setTargetRect(null);
    setResolving(cur.target !== null);

    if (cur.route) {
      navigate(cur.route);
    }
    if (!cur.target) {
      setResolving(false);
      return;
    }

    // Поиск с ретраями: 20 попыток × 50ms = 1s.
    let attempts = 0;
    const maxAttempts = 20;
    let timerId: number;
    const tick = () => {
      attempts += 1;
      const el = document.querySelector<HTMLElement>(
        `[data-onboarding="${cur.target}"]`
      );
      if (el) {
        setTargetEl(el);
        setTargetRect(el.getBoundingClientRect());
        setResolving(false);
        return;
      }
      if (attempts < maxAttempts) {
        timerId = window.setTimeout(tick, 50);
      } else {
        // Не нашли — fallback в центр
        setResolving(false);
      }
    };
    timerId = window.setTimeout(tick, 50);
    return () => window.clearTimeout(timerId);
  }, [open, step, cur.target, cur.route, navigate]);

  // Обновляем rect на resize/scroll — spotlight должен двигаться вместе с UI
  useLayoutEffect(() => {
    if (!open || !targetEl) return;
    const update = () => setTargetRect(targetEl.getBoundingClientRect());
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    // Ре-опрос через интервал — на случай позднего рендера (модалки, анимации)
    const iv = setInterval(update, 250);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      clearInterval(iv);
    };
  }, [open, targetEl]);

  // v0.9.9: центрируем только когда target явно указан null (welcome/финальный).
  // Если target указан но не нашёлся — тоже центрируем (fallback вместо (0,0)).
  const isCentered = cur.target === null || !targetEl;

  const placementMap: Record<Placement, 'top' | 'right' | 'bottom' | 'left'> = {
    top: 'top', right: 'right', bottom: 'bottom', left: 'left',
  };

  // v0.9.11: reference передаётся через elements — нативный контракт
  // floating-ui v2, синхронный с рендером React (без refs.setReference в effect).
  const { refs, floatingStyles } = useFloating({
    strategy: 'fixed',
    placement: placementMap[cur.placement ?? 'bottom'],
    middleware: [offset(12), flip(), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
    elements: { reference: targetEl },
  });

  if (!open) return null;

  const close = () => {
    markOnboardingSeen();
    setOpen(false);
  };
  const next = () => { if (isLast) close(); else setStep(s => s + 1); };
  const prev = () => setStep(s => Math.max(0, s - 1));
  const skip = () => close();

  // Rect для подсветки — расширенный на padding
  const highlight = targetRect
    ? {
        x: Math.max(0, targetRect.left - SPOTLIGHT_PADDING),
        y: Math.max(0, targetRect.top - SPOTLIGHT_PADDING),
        w: targetRect.width + SPOTLIGHT_PADDING * 2,
        h: targetRect.height + SPOTLIGHT_PADDING * 2,
      }
    : null;

  const t = (k: 'skip' | 'back' | 'next' | 'done' | 'close') => {
    const dict = {
      ru: { skip: 'Пропустить', back: 'Назад', next: 'Дальше', done: 'Понятно', close: 'Закрыть' },
      en: { skip: 'Skip', back: 'Back', next: 'Next', done: 'Got it', close: 'Close' },
    };
    return dict[lang === 'ru' ? 'ru' : 'en'][k];
  };

  return (
    <FloatingPortal>
      {/*
        SVG-оверлей на весь экран. Через <mask> вырезаем прямоугольник вокруг target,
        оставляя его подсвеченным (без затемнения), а всё остальное — с dim.
        pointer-events: auto только на затемнённой области; сам вырез пропускает клики,
        но мы всё равно перехватываем клик по overlay, чтобы не мешать пользователю
        случайно закрыть тур.
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
            {/* Белое = видно затемнение, чёрное = вырез */}
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {highlight && (
              <rect
                x={highlight.x}
                y={highlight.y}
                width={highlight.w}
                height={highlight.h}
                rx={SPOTLIGHT_RADIUS}
                ry={SPOTLIGHT_RADIUS}
                fill="black"
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
        {/* Тонкая рамка вокруг spotlight — визуально подчёркивает target */}
        {highlight && (
          <rect
            x={highlight.x}
            y={highlight.y}
            width={highlight.w}
            height={highlight.h}
            rx={SPOTLIGHT_RADIUS}
            ry={SPOTLIGHT_RADIUS}
            fill="none"
            stroke="var(--accent, #6366f1)"
            strokeWidth="2"
            style={{ filter: 'drop-shadow(0 0 8px var(--accent, #6366f1))' }}
          />
        )}
      </svg>

      {/* Tooltip.
          v0.9.8: если нет target — центрируем через translate(-50%,-50%),
          floating-ui игнорируем (иначе tooltip прилипает к (0,0)). */}
      <div
        ref={refs.setFloating as any}
        style={{
          ...(isCentered
            ? {
                position: 'fixed' as const,
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 'min(440px, 92vw)',
              }
            : { ...floatingStyles, width: 'min(400px, 92vw)' }),
          zIndex: 91,
          visibility: resolving ? ('hidden' as const) : ('visible' as const),
        }}
        className="scale-in"
      >
        <div className="bg-surface border border-border rounded-xl shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-soft">
            <div className="flex items-center gap-2 font-display font-semibold text-[13px]">
              <Sparkles size={13} className="text-accent" />
              {cur.title[lang === 'ru' ? 'ru' : 'en']}
            </div>
            <button
              onClick={close}
              className="p-1 rounded hover:bg-surface-alt text-muted"
              aria-label={t('close')}
            >
              <X size={14} />
            </button>
          </div>

          <div className="px-4 py-3 text-[13px] leading-relaxed text-text min-h-[72px]">
            {cur.body[lang === 'ru' ? 'ru' : 'en']}
          </div>

          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border-soft">
            <div className="flex gap-1.5">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={
                    'w-1.5 h-1.5 rounded-full transition-colors ' +
                    (i === step ? 'bg-accent' : 'bg-border')
                  }
                  style={i === step ? { background: 'var(--accent)' } : undefined}
                />
              ))}
            </div>
            <div className="flex items-center gap-2">
              {!isLast && (
                <button
                  onClick={skip}
                  className="text-[12px] text-muted hover:text-text px-2 py-1 rounded hover:bg-surface-alt"
                >
                  {t('skip')}
                </button>
              )}
              {step > 0 && (
                <button
                  onClick={prev}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
                >
                  <ChevronLeft size={13} />
                  {t('back')}
                </button>
              )}
              <button
                onClick={next}
                className="flex items-center gap-1 px-3 py-1.5 text-[12px] rounded-md text-white font-medium hover:opacity-90"
                style={{ background: 'var(--accent)' }}
              >
                {isLast ? t('done') : t('next')}
                {!isLast && <ChevronRight size={13} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </FloatingPortal>
  );
}
