/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v0.9.6 — Кастомный локализованный DatePicker.
 * Заменяет нативный <input type="date">, потому что WebView2 берёт локаль
 * пикера из системы, а не из <html lang>. Теперь месяц/дни/кнопки всегда
 * на языке интерфейса приложения (RU/EN).
 *
 * Формат value/onChange: 'YYYY-MM-DD' | null — совместимо со схемой БД.
 * Отображаемый формат в кнопке: DD.MM.YYYY (RU) / MM/DD/YYYY (EN).
 */
import { useMemo, useState } from 'react';
import {
  useFloating, useClick, useDismiss, useInteractions,
  offset, flip, shift, autoUpdate, FloatingPortal,
} from '@floating-ui/react';
import { Calendar as CalIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { tr, Lang, Dict } from '../lib/i18n';

const MS_DAY = 86400_000;

const MONTH_KEYS: (keyof Dict)[] = [
  'month_january', 'month_february', 'month_march', 'month_april',
  'month_may', 'month_june', 'month_july', 'month_august',
  'month_september', 'month_october', 'month_november', 'month_december',
];

const DOW_KEYS: (keyof Dict)[] = [
  'dow_mon', 'dow_tue', 'dow_wed', 'dow_thu', 'dow_fri', 'dow_sat', 'dow_sun',
];

function pad(n: number): string { return String(n).padStart(2, '0'); }

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYmd(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mo, d);
  if (isNaN(dt.getTime())) return null;
  return dt;
}

/** DD.MM.YYYY (RU) / MM/DD/YYYY (EN) для отображения в поле. */
function formatDisplay(lang: Lang, s: string | null): string {
  const dt = parseYmd(s);
  if (!dt) return '';
  const d = pad(dt.getDate());
  const m = pad(dt.getMonth() + 1);
  const y = dt.getFullYear();
  return lang === 'ru' ? `${d}.${m}.${y}` : `${m}/${d}/${y}`;
}

/** Сетка месяца — 6 недель × 7 дней, Пн-старт. */
function monthGrid(year: number, monthIdx: number): Date[] {
  const first = new Date(year, monthIdx, 1);
  const dow = first.getDay(); // 0=Вс, 1=Пн, ...
  const offsetDays = (dow + 6) % 7; // Пн=0
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - offsetDays);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(start.getTime() + i * MS_DAY));
  }
  return cells;
}

export function DatePicker({
  value, onChange, placeholder, disabled, className,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const lang = useStore(s => s.language);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<Date>(() => {
    const parsed = parseYmd(value);
    if (parsed) return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (o) => {
      // При открытии — переносим курсор к value или к сегодняшней дате.
      if (o) {
        const parsed = parseYmd(value);
        const anchor = parsed ?? new Date();
        setCursor(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
      }
      setOpen(o);
    },
    placement: 'bottom-start',
    middleware: [
      offset(4),
      flip({ fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] }),
      shift({ padding: 8 }),
    ],
    whileElementsMounted: autoUpdate,
  });
  const click = useClick(context, { enabled: !disabled });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

  const year = cursor.getFullYear();
  const monthIdx = cursor.getMonth();
  const cells = useMemo(() => monthGrid(year, monthIdx), [year, monthIdx]);
  const today = ymd(new Date());
  const selected = value;

  const monthName = tr(lang, MONTH_KEYS[monthIdx]);
  const monthTitle = monthName.charAt(0).toUpperCase() + monthName.slice(1) + ' ' + year;

  const display = formatDisplay(lang, value);

  return (
    <>
      <button
        ref={refs.setReference as any}
        type="button"
        disabled={disabled}
        {...getReferenceProps({ onClick: (e) => e.stopPropagation() })}
        className={
          (className ??
            'w-full bg-surface-alt border border-border-soft rounded px-2.5 py-1.5 text-[13px]') +
          ' inline-flex items-center gap-2 text-left hover:border-accent/60 transition-colors ' +
          (disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer')
        }
      >
        <CalIcon size={14} className="text-muted shrink-0" />
        <span className={'flex-1 tabular ' + (display ? 'text-text' : 'text-faint')}>
          {display || placeholder || (lang === 'ru' ? 'Дата не выбрана' : 'No date')}
        </span>
        {value && !disabled && (
          <span
            role="button"
            aria-label={tr(lang, 'cal_dp_clear')}
            title={tr(lang, 'cal_dp_clear')}
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="text-muted hover:text-text p-0.5 rounded hover:bg-surface"
          >
            <X size={12} />
          </span>
        )}
      </button>
      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating as any}
            style={{ ...floatingStyles, zIndex: 9999 }}
            {...getFloatingProps()}
            className="bg-surface border border-border rounded-lg shadow-xl p-3 scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header: месяц + год + стрелки */}
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={() => setCursor(new Date(year, monthIdx - 1, 1))}
                className="p-1 rounded hover:bg-surface-alt text-muted"
                aria-label={tr(lang, 'cal_prev_month')}
              >
                <ChevronLeft size={14} />
              </button>
              <div className="flex-1 text-center font-medium text-[13px] tabular">
                {monthTitle}
              </div>
              <button
                type="button"
                onClick={() => setCursor(new Date(year, monthIdx + 1, 1))}
                className="p-1 rounded hover:bg-surface-alt text-muted"
                aria-label={tr(lang, 'cal_next_month')}
              >
                <ChevronRight size={14} />
              </button>
            </div>

            {/* Дни недели */}
            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {DOW_KEYS.map((k, i) => (
                <div
                  key={k}
                  className={
                    'text-center text-[10px] font-mono uppercase py-1 ' +
                    (i >= 5 ? 'text-muted/60' : 'text-muted')
                  }
                >
                  {tr(lang, k)}
                </div>
              ))}
            </div>

            {/* Сетка дней */}
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((d, i) => {
                const dateStr = ymd(d);
                const inMonth = d.getMonth() === monthIdx;
                const isToday = dateStr === today;
                const isSelected = dateStr === selected;
                const dow = d.getDay();
                const isWeekend = dow === 0 || dow === 6;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(dateStr);
                      setOpen(false);
                    }}
                    className={
                      'text-[12px] tabular w-8 h-8 rounded transition-colors ' +
                      (isSelected
                        ? 'text-white font-semibold'
                        : isToday
                          ? 'font-bold'
                          : inMonth
                            ? isWeekend ? 'text-muted' : 'text-text'
                            : 'text-faint/60')
                    }
                    style={{
                      background: isSelected ? 'var(--accent)' : 'transparent',
                      border: isToday && !isSelected ? '1px solid var(--accent)' : '1px solid transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-alt)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    }}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>

            {/* Нижний ряд: Очистить / Сегодня */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-soft">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(null);
                  setOpen(false);
                }}
                className="text-[12px] text-muted hover:text-text px-2 py-1 rounded hover:bg-surface-alt"
              >
                {tr(lang, 'cal_dp_clear')}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const t = new Date();
                  onChange(ymd(t));
                  setCursor(new Date(t.getFullYear(), t.getMonth(), 1));
                  setOpen(false);
                }}
                className="text-[12px] text-accent hover:opacity-80 font-medium px-2 py-1 rounded hover:bg-surface-alt"
              >
                {tr(lang, 'cal_today')}
              </button>
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
