/*
 * TaskFlow — personal task manager
 * SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
 * Copyright (c) 2026 Daniil Lebedev (danny-swan)
 *
 * v1.1.x — модалка выбора аватара (форма + ЯВНЫЙ цвет). F41, ADR 0032.
 *
 * Раньше выбор формы жил инлайн в блоке «Профиль», а цвет вообще не выбирался —
 * глиф красился акцентом темы и «уезжал» при смене темы. Теперь:
 *   • форма (1..8) и цвет (`#rrggbb`) выбираются в отдельном окне;
 *   • цвет задаётся системным пикером, hex-полем или быстрым свотчем;
 *   • превью показывает аватар на светлой и тёмной подложке, чтобы пользователь
 *     сам видел читаемость выбранного цвета в обеих темах;
 *   • «Готово» отдаёт значения наружу (сохранение — кнопкой блока «Профиль»),
 *     «Отмена»/Esc не меняют ничего.
 */
import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Avatar, AvatarPicker } from './Avatar';
import { AVATAR_COLOR_RE, normalizeAvatarColor } from '../lib/profile';

/** Быстрые свотчи: читаемы и в светлой, и в тёмной теме. */
export const AVATAR_COLOR_SWATCHES = [
  '#e05252', '#e0803c', '#d9b038', '#4fa35b', '#3fa8a0',
  '#3d8ad9', '#5f6fd6', '#9a5fd0', '#d05f9c', '#7c8794',
] as const;

/** Цвет по умолчанию при первом явном выборе (если раньше цвета не было). */
export const AVATAR_COLOR_DEFAULT = '#3d8ad9';

export interface AvatarEditorModalProps {
  open: boolean;
  variant: number;
  color: string | null;
  isRu: boolean;
  onCancel: () => void;
  onApply: (next: { variant: number; color: string | null }) => void;
}

export function AvatarEditorModal({
  open, variant, color, isRu, onCancel, onApply,
}: AvatarEditorModalProps) {
  const t = (ru: string, en: string) => (isRu ? ru : en);

  const [draftVariant, setDraftVariant] = useState(variant);
  const [draftColor, setDraftColor] = useState<string>(color ?? AVATAR_COLOR_DEFAULT);
  const [hexInput, setHexInput] = useState<string>(color ?? AVATAR_COLOR_DEFAULT);

  // Пересинхронизация при каждом открытии: модалка не должна помнить прошлый
  // черновик, если пользователь нажал «Отмена».
  useEffect(() => {
    if (!open) return;
    setDraftVariant(variant);
    setDraftColor(color ?? AVATAR_COLOR_DEFAULT);
    setHexInput(color ?? AVATAR_COLOR_DEFAULT);
  }, [open, variant, color]);

  const applyHex = (raw: string) => {
    setHexInput(raw);
    const v = raw.trim().toLowerCase();
    if (AVATAR_COLOR_RE.test(v)) setDraftColor(v);
  };

  const handleApply = () => {
    let next: string | null;
    try {
      next = normalizeAvatarColor(draftColor);
    } catch {
      next = null;
    }
    onApply({ variant: draftVariant, color: next });
  };

  return (
    <Modal open={open} onClose={onCancel} width={520} label={t('Выбор аватара', 'Choose avatar')}>
      <div className="px-5 py-4 border-b border-border-soft">
        <h3 className="font-display text-[15px] font-semibold">
          {t('Аватар', 'Avatar')}
        </h3>
        <p className="text-[12px] text-muted mt-1">
          {t(
            'Выберите форму и цвет. Цвет сохраняется явно и не меняется вместе с темой приложения.',
            'Pick a shape and a colour. The colour is stored explicitly and does not follow the app theme.',
          )}
        </p>
      </div>

      <div className="px-5 py-4 space-y-4 overflow-y-auto">
        {/* Превью в двух темах */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border-soft" style={{ background: '#ffffff' }}>
            <Avatar variant={draftVariant} color={draftColor} size={44} />
            <span className="text-[11px]" style={{ color: '#6b7280' }}>
              {t('светлая', 'light')}
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border-soft" style={{ background: '#16181d' }}>
            <Avatar variant={draftVariant} color={draftColor} size={44} />
            <span className="text-[11px]" style={{ color: '#9aa3ad' }}>
              {t('тёмная', 'dark')}
            </span>
          </div>
        </div>

        {/* Форма */}
        <div className="space-y-2">
          <div className="text-[12px] text-muted uppercase tracking-wide">
            {t('Форма', 'Shape')}
          </div>
          <AvatarPicker
            value={draftVariant}
            onChange={setDraftVariant}
            color={draftColor}
            label={t('Выбор формы аватара', 'Choose avatar shape')}
          />
        </div>

        {/* Цвет */}
        <div className="space-y-2">
          <div className="text-[12px] text-muted uppercase tracking-wide">
            {t('Цвет', 'Colour')}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={t('Пипетка цвета', 'Colour picker')}
              value={draftColor}
              onChange={e => { setDraftColor(e.target.value.toLowerCase()); setHexInput(e.target.value.toLowerCase()); }}
              className="h-9 w-12 rounded-md border border-border-soft bg-surface p-1 cursor-pointer"
            />
            <input
              type="text"
              aria-label={t('HEX-код цвета', 'Colour hex code')}
              value={hexInput}
              maxLength={7}
              spellCheck={false}
              onChange={e => applyHex(e.target.value)}
              placeholder="#3d8ad9"
              className="w-28 px-3 py-2 text-[13px] font-mono bg-surface border border-border-soft rounded-md outline-none focus:border-accent"
            />
            {!AVATAR_COLOR_RE.test(hexInput.trim()) && (
              <span className="text-[11px] text-[var(--status-important)]">
                {t('Формат: #rrggbb', 'Format: #rrggbb')}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {AVATAR_COLOR_SWATCHES.map(c => (
              <button
                key={c}
                type="button"
                aria-label={`color-${c}`}
                onClick={() => { setDraftColor(c); setHexInput(c); }}
                className={
                  'h-7 w-7 rounded-full border transition ' +
                  (draftColor === c ? 'border-accent ring-2 ring-accent/40' : 'border-border-soft')
                }
                style={{ background: c }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="px-5 py-3 border-t border-border-soft flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-[13px] border border-border-soft rounded-md hover:bg-surface-alt"
        >
          {t('Отмена', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={handleApply}
          className="px-4 py-2 text-[13px] rounded-md font-medium text-white bg-accent hover:bg-accent-hover"
        >
          {t('Готово', 'Done')}
        </button>
      </div>
    </Modal>
  );
}
