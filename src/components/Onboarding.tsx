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
 *
 * Public API (не менять сигнатуры — используется в Help.tsx и App.tsx):
 *   - <Onboarding />          — маунтится один раз в App.tsx
 *   - isOnboardingSeen()      — проверка флага в settings
 *   - markOnboardingSeen()    — проставить флаг
 *   - resetOnboarding()       — сбросить флаг (Help → «Пройти тур заново»)
 */
import { useState, useEffect, useMemo, useLayoutEffect } from 'react';
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
    title: { ru: 'Дашборд и метрики', en: 'Dashboard & metrics' },
    body: {
      ru: 'Дашборд — обзор с фильтром дат (локализованный DatePicker) и статистикой. Метрики также видны в шапке любой страницы.',
      en: 'Dashboard — overview with a date filter (localised DatePicker) and stats. Metric chips are also visible in the top bar of any page.',
    },
  },
  {
    target: 'nav-settings',
    route: '/tasks',
    placement: 'right',
    title: { ru: 'Настройки и Помощь', en: 'Settings & Help' },
    body: {
      ru: 'В Настройках — темы, теги, статусы, шаблоны задач, экспорт/импорт. В Помощи можно перезапустить этот тур.',
      en: 'Settings — themes, tags, statuses, task templates, export/import. In Help you can re-run this tour anytime.',
    },
  },
  {
    target: null,
    route: null,
    title: { ru: 'Готово', en: 'All set' },
    body: {
      ru: 'Клавиши: 1–5 — вкладки, N — новая задача, / — поиск. Полная справка во вкладке «Помощь». Приятной работы.',
      en: 'Shortcuts: 1–5 tabs, N new task, / search. Full reference in the Help tab. Enjoy.',
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

  // При смене шага: навигация → поиск target → сохранение rect
  useEffect(() => {
    if (!open) return;
    if (cur.route) {
      // navigate синхронный; хешовые роуты обрабатываются сразу
      navigate(cur.route);
    }
    // Даём React отрисовать страницу перед поиском target
    const t = setTimeout(() => {
      if (!cur.target) {
        setTargetEl(null);
        setTargetRect(null);
        return;
      }
      const el = document.querySelector<HTMLElement>(`[data-onboarding="${cur.target}"]`);
      setTargetEl(el);
      setTargetRect(el ? el.getBoundingClientRect() : null);
    }, 60);
    return () => clearTimeout(t);
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

  // Floating-ui для tooltip'а. Reference — виртуальный: rect target'а или центр экрана.
  const virtualRef = useMemo(() => {
    return {
      getBoundingClientRect: () => {
        if (targetRect) return targetRect;
        // Центр окна
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        return {
          x: cx, y: cy, top: cy, left: cx, right: cx, bottom: cy,
          width: 0, height: 0, toJSON: () => ({}),
        } as DOMRect;
      },
    };
  }, [targetRect]);

  const placementMap: Record<Placement, 'top' | 'right' | 'bottom' | 'left'> = {
    top: 'top', right: 'right', bottom: 'bottom', left: 'left',
  };

  const { refs, floatingStyles, update } = useFloating({
    strategy: 'fixed',
    placement: placementMap[cur.placement ?? 'bottom'],
    middleware: [offset(12), flip(), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });

  // Подставляем virtual reference
  useEffect(() => {
    refs.setReference(virtualRef as any);
    update();
  }, [virtualRef, refs, update]);

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

      {/* Tooltip */}
      <div
        ref={refs.setFloating as any}
        style={{ ...floatingStyles, zIndex: 91, width: 'min(400px, 92vw)' }}
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
