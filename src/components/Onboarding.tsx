/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.8.12–v0.9.14 — история попыток починить позиционирование tooltip через
 *   floating-ui. Каждый раз оставался промежуточный кадр в (0,0), потому что
 *   floating-ui асинхронный: между сменой step и первым computePosition
 *   всегда есть один рендер с не-подтверждённой позицией.
 *
 * v0.9.15 — floating-ui выкинут, позиция считается вручную через useLayoutEffect.
 *   Осталась проблема микро-прыжка в центр из-за key={step}.
 *
 * v0.9.16 — Фикс микро-прыжка в центр при переходе между шагами:
 *   Корневая причина — key={step} заставлял React полностью размонтировать
 *   tooltip и заново смонтировать. Новый элемент рендерился без координат
 *   (top/left не выставлены), CSS-анимация scale-in запускалась сразу,
 *   в этот кадр позиция была (0,0)/край экрана — получалась вспышка в центре/углу
 *   перед переходом к целевому target.
 *
 *   Решение:
 *   (1) Убрали key={step}. Tooltip теперь всегда один и тот же DOM-элемент,
 *       React обновляет только style/текст. Никакого remount — браузер
 *       не проходит через «кадр без координат».
 *   (2) CSS scale-in только на самом первом показе тура, не на каждом шаге.
 *       Смена шагов — плавная транзиция left/top через CSS transition.
 *   (3) Позиция измеряется в useLayoutEffect в том же commit-кадре, что
 *       и смена контента — браузер паинтит уже с правильными координатами.
 *
 * Public API (не менять сигнатуры — используется в Help.tsx и App.tsx):
 *   - <Onboarding />          — маунтится один раз в App.tsx
 *   - isOnboardingSeen()      — проверка флага в settings
 *   - markOnboardingSeen()    — проставить флаг
 *   - resetOnboarding()       — сбросить флаг (Help → «Пройти тур заново»)
 */
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
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

type Placement = 'bottom' | 'top' | 'right' | 'left';

type Step = {
  target: string | null;
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
    target: 'tag-filters',
    route: '/tasks',
    placement: 'bottom',
    title: { ru: 'Фильтры по тэгам', en: 'Tag filters' },
    body: {
      ru: 'Панель тэгов на вкладке «Задачи»: клик по тэгу оставляет только задачи с ним, повторный клик снимает фильтр. Кнопка «Все» показывает все задачи.',
      en: 'Tag filter row on the Tasks tab: click a tag to keep only tasks with it, click again to clear. The «All» button shows every task.',
    },
  },
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

const SPOTLIGHT_PADDING = 6;
const SPOTLIGHT_RADIUS = 8;
/** Отступ между target и tooltip. */
const GAP = 12;
/** Минимальный отступ от края экрана. */
const VIEWPORT_PADDING = 12;

/**
 * v0.9.15: чистый расчёт позиции. Возвращает {top,left} для tooltip.
 * Если tooltip не помещается с выбранной стороны — переворачивает на
 * противоположную. Всегда clamp'ит к границам viewport.
 */
function computeTooltipPosition(
  targetRect: DOMRect,
  tooltipW: number,
  tooltipH: number,
  placement: Placement,
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Пробуем исходный placement, при необходимости флипаем.
  const canFit = (p: Placement) => {
    if (p === 'bottom') return targetRect.bottom + GAP + tooltipH <= vh - VIEWPORT_PADDING;
    if (p === 'top') return targetRect.top - GAP - tooltipH >= VIEWPORT_PADDING;
    if (p === 'right') return targetRect.right + GAP + tooltipW <= vw - VIEWPORT_PADDING;
    if (p === 'left') return targetRect.left - GAP - tooltipW >= VIEWPORT_PADDING;
    return true;
  };
  const flip: Record<Placement, Placement> = { bottom: 'top', top: 'bottom', right: 'left', left: 'right' };
  const finalPlacement = canFit(placement) ? placement : (canFit(flip[placement]) ? flip[placement] : placement);

  let top = 0;
  let left = 0;
  if (finalPlacement === 'bottom') {
    top = targetRect.bottom + GAP;
    left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
  } else if (finalPlacement === 'top') {
    top = targetRect.top - GAP - tooltipH;
    left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
  } else if (finalPlacement === 'right') {
    top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
    left = targetRect.right + GAP;
  } else if (finalPlacement === 'left') {
    top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
    left = targetRect.left - GAP - tooltipW;
  }

  // Clamp к границам viewport.
  left = Math.max(VIEWPORT_PADDING, Math.min(left, vw - tooltipW - VIEWPORT_PADDING));
  top = Math.max(VIEWPORT_PADDING, Math.min(top, vh - tooltipH - VIEWPORT_PADDING));

  return { top, left };
}

export function Onboarding() {
  const lang = useStore(s => s.language);
  const ready = useStore(s => s.ready);
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [targetEl, setTargetEl] = useState<HTMLElement | null>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  // v0.9.15: позиция tooltip — null пока не подтверждена. Рендер использует
  // это как единственный источник видимости (visibility:hidden при null).
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);

  const tooltipRef = useRef<HTMLDivElement | null>(null);
  // v0.9.16: scale-in анимация только на первом показе тура,
  // не на каждой смене шага.
  const firstShow = useRef(true);

  const cur = STEPS[step];
  const isLast = step === STEPS.length - 1;
  // Центрированный tooltip — для welcome/final или если target не найден.
  const isCentered = cur.target === null || !targetEl;

  // Автозапуск при первом ready.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      if (!isOnboardingSeen()) setOpen(true);
    }, 600);
    return () => clearTimeout(t);
  }, [ready]);

  // v0.9.16: ПРИ СМЕНЕ ШАГА НЕ СБРАСЫВАЕМ tooltipPos.
  // Это ключевое отличие от v0.9.15: tooltip остаётся на старой позиции
  // пока не посчитана новая (CSS transition плавно переместит его).
  // Сбрасываем только targetEl/Rect — это триггерит поиск нового target.
  useLayoutEffect(() => {
    if (!open) return;
    setTargetEl(null);
    setTargetRect(null);
    // если это центрированный шаг (welcome/final) — сбрасываем tooltipPos,
    // чтобы он пересчитался как sentinel {-1,-1} (координаты от targetRect
    // бессмысленны). Для таргетных шагов — не трогаем, старая позиция
    // будет плавно заменена новой через CSS transition.
    if (STEPS[step].target === null) {
      setTooltipPos(null);
    }
  }, [open, step]);

  // navigate + поиск target с ретраями.
  useEffect(() => {
    if (!open) return;
    if (cur.route) navigate(cur.route);
    if (!cur.target) return; // центрированный шаг — позиция не нужна.

    let attempts = 0;
    const maxAttempts = 20;
    let timerId: number;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      attempts += 1;
      const el = document.querySelector<HTMLElement>(`[data-onboarding="${cur.target}"]`);
      if (el) {
        setTargetEl(el);
        setTargetRect(el.getBoundingClientRect());
        return;
      }
      if (attempts < maxAttempts) {
        timerId = window.setTimeout(tick, 50);
      }
      // если не нашли — isCentered станет true и tooltip покажется по центру.
    };
    timerId = window.setTimeout(tick, 50);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [open, step, cur.target, cur.route, navigate]);

  // v0.9.16: расчёт позиции tooltip.
  // useLayoutEffect выполняется СИНХРОННО перед paint. Tooltip всегда смонтирован
  // (без key={step} — тот же DOM-узел), поэтому его размер стабилен.
  useLayoutEffect(() => {
    if (!open) return;
    if (isCentered) {
      // Сантинел {-1,-1} — рендер включает CSS translate(-50%,-50%).
      setTooltipPos({ top: -1, left: -1 });
      return;
    }
    if (!targetRect || !tooltipRef.current) return;

    const el = tooltipRef.current;
    const pos = computeTooltipPosition(
      targetRect,
      el.offsetWidth,
      el.offsetHeight,
      cur.placement ?? 'bottom',
    );
    setTooltipPos(pos);
  }, [open, isCentered, targetRect, cur.placement, step]);

  // Обновление позиции при resize/scroll — spotlight и tooltip двигаются вместе.
  useLayoutEffect(() => {
    if (!open || !targetEl) return;
    const update = () => {
      const rect = targetEl.getBoundingClientRect();
      setTargetRect(rect);
      if (tooltipRef.current) {
        const pos = computeTooltipPosition(
          rect,
          tooltipRef.current.offsetWidth,
          tooltipRef.current.offsetHeight,
          cur.placement ?? 'bottom',
        );
        setTooltipPos(pos);
      }
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const iv = setInterval(update, 250);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      clearInterval(iv);
    };
  }, [open, targetEl, cur.placement]);

  if (!open) return null;

  const close = () => {
    markOnboardingSeen();
    setOpen(false);
  };
  const next = () => { if (isLast) close(); else setStep(s => s + 1); };
  const prev = () => setStep(s => Math.max(0, s - 1));
  const skip = () => close();

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

  // v0.9.16: sentinel {-1,-1} = центрированный tooltip.
  const isCenteredSentinel = tooltipPos !== null && tooltipPos.top === -1 && tooltipPos.left === -1;
  const showTooltip = tooltipPos !== null;

  // Отслеживаем первый показ для scale-in анимации. После первого
  // видимого кадра сбрасываем — дальше только CSS transition.
  const shouldAnimate = firstShow.current && showTooltip;
  useEffect(() => {
    if (showTooltip && firstShow.current) {
      // Оставляем firstShow=true на один кадр, потом снимаем.
      const raf = requestAnimationFrame(() => {
        firstShow.current = false;
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [showTooltip]);

  // Стиль позиционирования. Transform: центрированный — translate(-50%,-50%),
  // обычный — top/left. transition — плавное перемещение между шагами,
  // но только когда tooltip уже видим (чтобы первый показ не анимировался из
  // случайной точки).
  const positionStyle: React.CSSProperties = useMemo(() => {
    // Центрированный.
    if (isCenteredSentinel) {
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(440px, 92vw)',
      };
    }
    return {
      position: 'fixed',
      top: tooltipPos?.top ?? 0,
      left: tooltipPos?.left ?? 0,
      width: 'min(400px, 92vw)',
      // CSS transition — плавное перемещение tooltip между шагами.
      // При первом показе (firstShow=true) transition отключён,
      // чтобы не анимировать из (0,0).
      transition: firstShow.current ? undefined : 'top 220ms ease, left 220ms ease',
    };
  }, [isCenteredSentinel, tooltipPos?.top, tooltipPos?.left]);

  return (
    <>
      {/* SVG-оверлей с вырезом вокруг target. */}
      <svg
        aria-hidden
        width="100%"
        height="100%"
        style={{ position: 'fixed', inset: 0, zIndex: 90, pointerEvents: 'auto' }}
      >
        <defs>
          <mask id="tf-onboarding-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {highlight && (
              <rect
                x={highlight.x} y={highlight.y}
                width={highlight.w} height={highlight.h}
                rx={SPOTLIGHT_RADIUS} ry={SPOTLIGHT_RADIUS}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#tf-onboarding-mask)" />
        {highlight && (
          <rect
            x={highlight.x} y={highlight.y}
            width={highlight.w} height={highlight.h}
            rx={SPOTLIGHT_RADIUS} ry={SPOTLIGHT_RADIUS}
            fill="none"
            stroke="var(--accent, #6366f1)"
            strokeWidth="2"
            style={{ filter: 'drop-shadow(0 0 8px var(--accent, #6366f1))' }}
          />
        )}
      </svg>

      {/*
        v0.9.16: НЕТ key={step}. Tooltip всегда один и тот же DOM-узел,
        React при смене шага обновляет только style и текст. Никакого remount —
        браузер не проходит через кадр без координат. CSS transition
        плавно перемещает tooltip из старой позиции в новую (220ms ease).
        scale-in — только на первом показе тура (firstShow.current).
      */}
      <div
        ref={tooltipRef}
        style={{
          ...positionStyle,
          zIndex: 91,
          visibility: showTooltip ? 'visible' : 'hidden',
        }}
        className={shouldAnimate ? 'scale-in' : undefined}
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
    </>
  );
}
