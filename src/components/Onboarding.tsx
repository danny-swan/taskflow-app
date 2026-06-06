import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import * as db from '../lib/db';
import { X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';

/**
 * v0.8.12 (п. 13) — Интерактивный онбординг для новых пользователей.
 *
 * Поведение:
 * 1. При первом запуске (когда `onboarding_seen` отсутствует в settings)
 *    через ~600 мс после ready=true показывается оверлей-модалка с 4 шагами.
 * 2. Любой клик «Понятно» или «Закрыть» проставляет `onboarding_seen=1` в settings
 *    и больше тур не появляется.
 * 3. Перезапустить тур можно из Help → «Запустить тур заново»:
 *    в settings удаляется `onboarding_seen`, и при следующем мaунте App тур вернётся
 *    (см. exported `resetOnboarding` ниже).
 *
 * Это намеренно лёгкий «welcome modal с шагами», а не сложный продакт-тур с
 * подсветкой UI-элементов — учитывая компактный размер приложения, такого
 * подхода достаточно, чтобы пользователь понял основные жесты.
 */

const SETTING_KEY = 'onboarding_seen';

export function isOnboardingSeen(): boolean {
  try {
    const row = db.get<{ value: string }>('SELECT value FROM settings WHERE key=?', [SETTING_KEY]);
    return row?.value === '1';
  } catch {
    // Если settings ещё не готовы — считаем «видел», чтобы не показывать на сломанной БД
    return true;
  }
}

export function markOnboardingSeen() {
  try {
    db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [SETTING_KEY, '1']);
  } catch {/* silent */}
}

export function resetOnboarding() {
  try {
    db.run('DELETE FROM settings WHERE key=?', [SETTING_KEY]);
  } catch {/* silent */}
}

type Step = {
  title: { ru: string; en: string };
  body: { ru: string; en: string };
};

const STEPS: Step[] = [
  {
    title: { ru: 'Добро пожаловать в TaskFlow', en: 'Welcome to TaskFlow' },
    body: {
      ru: 'Это лёгкий менеджер задач, который работает офлайн и хранит все данные локально. Покажу 4 главных жеста — займёт меньше минуты.',
      en: 'A lightweight task manager that works offline and stores everything locally. Let me show 4 main gestures — under a minute.',
    },
  },
  {
    title: { ru: 'Создавайте задачи', en: 'Create tasks' },
    body: {
      ru: 'Нажмите кнопку «+ Новая задача» в верхней панели или клавишу N. Можно указать тэг, статус, дедлайн и комментарий.',
      en: 'Click the "+ New task" button in the top bar or press N. You can set a tag, status, deadline and comment.',
    },
  },
  {
    title: { ru: 'Перетаскивайте между статусами', en: 'Drag between statuses' },
    body: {
      ru: 'Возьмите карточку за ручку ⋮⋮ справа и перетащите в другую колонку — статус и порядок сохранятся автоматически.',
      en: 'Grab the card by the ⋮⋮ handle on the right and drop it into another column — the status and order are saved automatically.',
    },
  },
  {
    title: { ru: 'Завершайте одним кликом', en: 'Complete in one click' },
    body: {
      ru: 'Нажмите ✓ справа на карточке — задача уйдёт в «Выполнено». Если передумали — в правом верхнем углу появится уведомление с кнопкой «Отменить».',
      en: 'Click the ✓ on the right of a card — the task moves to "Done". Changed your mind? A toast in the top-right corner offers Undo.',
    },
  },
  {
    title: { ru: 'Готово', en: 'All set' },
    body: {
      ru: 'Горячие клавиши: 1–5 — навигация по вкладкам, N — новая задача, / — поиск. Полная справка во вкладке Помощь.',
      en: 'Shortcuts: 1–5 for tab navigation, N for a new task, / for search. Full reference in the Help tab.',
    },
  },
];

export function Onboarding() {
  const lang = useStore(s => s.language);
  const ready = useStore(s => s.ready);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!ready) return;
    // Лёгкая задержка, чтобы пользователь увидел саму доску перед модалкой
    const t = setTimeout(() => {
      if (!isOnboardingSeen()) setOpen(true);
    }, 600);
    return () => clearTimeout(t);
  }, [ready]);

  if (!open) return null;

  const cur = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const close = () => {
    markOnboardingSeen();
    setOpen(false);
  };
  const next = () => {
    if (isLast) close();
    else setStep(s => s + 1);
  };
  const prev = () => setStep(s => Math.max(0, s - 1));

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="bg-surface border border-border rounded-xl shadow-2xl w-[min(440px,92vw)] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-soft">
          <div className="flex items-center gap-2 font-display font-semibold text-[14px]">
            <Sparkles size={14} className="text-[var(--accent,#6366f1)]" />
            {cur.title[lang === 'ru' ? 'ru' : 'en']}
          </div>
          <button
            onClick={close}
            className="p-1 rounded hover:bg-surface-alt text-muted"
            aria-label={lang === 'ru' ? 'Закрыть' : 'Close'}
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 text-[13px] leading-relaxed text-text min-h-[88px]">
          {cur.body[lang === 'ru' ? 'ru' : 'en']}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-border-soft">
          {/* Точки-индикатор */}
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={
                  'w-1.5 h-1.5 rounded-full transition-colors ' +
                  (i === step ? 'bg-[var(--accent,#6366f1)]' : 'bg-border')
                }
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={prev}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
              >
                <ChevronLeft size={13} />
                {lang === 'ru' ? 'Назад' : 'Back'}
              </button>
            )}
            <button
              onClick={next}
              className="flex items-center gap-1 px-3 py-1.5 text-[12px] rounded-md bg-[var(--accent,#6366f1)] text-white hover:opacity-90 font-medium"
            >
              {isLast
                ? (lang === 'ru' ? 'Понятно' : 'Got it')
                : (lang === 'ru' ? 'Дальше' : 'Next')}
              {!isLast && <ChevronRight size={13} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
