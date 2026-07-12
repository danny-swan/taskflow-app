/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v1.0.x — 8 встроенных минималистичных SVG-аватаров.
 *
 * Индекс 1..8 ↔ profiles.avatar_variant (см. миграцию 0026). Аватары
 * нейтральные (м/ж вариации), рисуются inline через currentColor + мягкая
 * подложка, поэтому одинаково читаются в тёмной и светлой теме.
 *
 *   <Avatar variant={n} size={40} /> — показ.
 *   <AvatarPicker value={n} onChange={fn} /> — выбор из восьми.
 */
import { AVATAR_MAX, AVATAR_MIN } from '../lib/profile';

export const AVATAR_VARIANTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

function clampVariant(v: number): number {
  if (!Number.isFinite(v)) return AVATAR_MIN;
  return Math.min(AVATAR_MAX, Math.max(AVATAR_MIN, Math.round(v)));
}

/**
 * Рисунок конкретного варианта (без рамки/фона — они в обёртке Avatar).
 * viewBox 0 0 40 40, штрихи через currentColor.
 */
function AvatarGlyph({ variant }: { variant: number }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (clampVariant(variant)) {
    case 1: // короткая стрижка
      return (
        <g {...s}>
          <circle cx="20" cy="16" r="6" />
          <path d="M14 12c1-3 11-3 12 0" />
          <path d="M9 32c1-6 6-9 11-9s10 3 11 9" />
        </g>
      );
    case 2: // длинные волосы
      return (
        <g {...s}>
          <circle cx="20" cy="16" r="6" />
          <path d="M12 16c0-6 4-8 8-8s8 2 8 8v8" />
          <path d="M12 16v8" />
          <path d="M10 33c1-6 5-9 10-9s9 3 10 9" />
        </g>
      );
    case 3: // пучок/узел
      return (
        <g {...s}>
          <circle cx="20" cy="17" r="6" />
          <circle cx="20" cy="8" r="2.4" />
          <path d="M10 33c1-6 5-9 10-9s9 3 10 9" />
        </g>
      );
    case 4: // кепка
      return (
        <g {...s}>
          <circle cx="20" cy="18" r="6" />
          <path d="M11 13c2-4 16-4 18 0" />
          <path d="M29 13h4" />
          <path d="M10 34c1-6 5-9 10-9s9 3 10 9" />
        </g>
      );
    case 5: // очки
      return (
        <g {...s}>
          <circle cx="20" cy="16" r="6" />
          <circle cx="16.5" cy="16" r="2.2" />
          <circle cx="23.5" cy="16" r="2.2" />
          <path d="M18.7 16h2.6" />
          <path d="M9 33c1-6 6-9 11-9s10 3 11 9" />
        </g>
      );
    case 6: // борода
      return (
        <g {...s}>
          <circle cx="20" cy="15" r="6" />
          <path d="M14.5 18c1.5 4 9.5 4 11 0" />
          <path d="M9 33c1-6 6-9 11-9s10 3 11 9" />
        </g>
      );
    case 7: // хвостики
      return (
        <g {...s}>
          <circle cx="20" cy="17" r="6" />
          <path d="M12 15c0-2 1-3 2-3" />
          <path d="M28 15c0-2-1-3-2-3" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="28" cy="12" r="1.6" />
          <path d="M10 33c1-6 5-9 10-9s9 3 10 9" />
        </g>
      );
    case 8: // звезда (нейтральный/аноним)
    default:
      return (
        <g {...s}>
          <path d="M20 9l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
          <path d="M11 33c1-5 5-7 9-7s8 2 9 7" />
        </g>
      );
  }
}

export interface AvatarProps {
  variant: number;
  size?: number;
  className?: string;
}

/** Кружок-аватар: мягкая подложка + глиф акцентным цветом. */
export function Avatar({ variant, size = 40, className = '' }: AvatarProps) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-surface-alt border border-border-soft text-accent ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 40 40"
        width={Math.round(size * 0.7)}
        height={Math.round(size * 0.7)}
        role="img"
      >
        <AvatarGlyph variant={variant} />
      </svg>
    </span>
  );
}

export interface AvatarPickerProps {
  value: number;
  onChange: (variant: number) => void;
  disabled?: boolean;
  /** Подпись для screen-reader'ов (двуязычность решает вызывающий). */
  label?: string;
}

/** Сетка из 8 аватаров с визуальным выделением выбранного. */
export function AvatarPicker({ value, onChange, disabled = false, label }: AvatarPickerProps) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {AVATAR_VARIANTS.map(v => {
        const selected = clampVariant(value) === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`avatar-${v}`}
            disabled={disabled}
            onClick={() => onChange(v)}
            className={
              'inline-flex items-center justify-center rounded-full p-0.5 transition ' +
              'disabled:opacity-50 ' +
              (selected
                ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface'
                : 'ring-1 ring-transparent hover:ring-border-soft')
            }
          >
            <Avatar variant={v} size={40} />
          </button>
        );
      })}
    </div>
  );
}
