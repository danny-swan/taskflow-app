// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Тесты модалки выбора аватара (F41, ADR 0032).
//
// Ключевое требование: цвет задаётся ЯВНО (пикер / hex / свотч) и уезжает наружу
// только по «Готово»; «Отмена» не меняет ничего, а повторное открытие сбрасывает
// черновик к сохранённому значению.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AvatarEditorModal, AVATAR_COLOR_SWATCHES, AVATAR_COLOR_DEFAULT } from './AvatarEditorModal';

const onApply = vi.fn();
const onCancel = vi.fn();

beforeEach(() => {
  onApply.mockReset();
  onCancel.mockReset();
});

const view = (over: { variant?: number; color?: string | null } = {}) =>
  render(
    <AvatarEditorModal
      open
      variant={over.variant ?? 1}
      color={'color' in over ? (over.color as string | null) : null}
      isRu
      onCancel={onCancel}
      onApply={onApply}
    />,
  );

describe('AvatarEditorModal', () => {
  it('не рендерится, когда open=false', () => {
    render(
      <AvatarEditorModal open={false} variant={1} color={null} isRu onCancel={onCancel} onApply={onApply} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('гидрирует форму и цвет из пропсов', () => {
    view({ variant: 4, color: '#e05252' });
    expect(screen.getByLabelText('avatar-4')).toHaveAttribute('aria-checked', 'true');
    expect((screen.getByLabelText('HEX-код цвета') as HTMLInputElement).value).toBe('#e05252');
  });

  it('без сохранённого цвета подставляет цвет по умолчанию', () => {
    view({ color: null });
    expect((screen.getByLabelText('HEX-код цвета') as HTMLInputElement).value).toBe(AVATAR_COLOR_DEFAULT);
  });

  it('показывает все быстрые свотчи', () => {
    view();
    for (const c of AVATAR_COLOR_SWATCHES) {
      expect(screen.getByLabelText(`color-${c}`)).toBeTruthy();
    }
  });

  it('свотч + «Готово» отдают выбранные форму и цвет', () => {
    view({ variant: 2, color: null });
    fireEvent.click(screen.getByLabelText('avatar-6'));
    fireEvent.click(screen.getByLabelText('color-#4fa35b'));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onApply).toHaveBeenCalledWith({ variant: 6, color: '#4fa35b' });
  });

  it('системный пикер меняет цвет и синхронизирует hex-поле', () => {
    view();
    fireEvent.change(screen.getByLabelText('Пипетка цвета'), { target: { value: '#AABBCC' } });
    expect((screen.getByLabelText('HEX-код цвета') as HTMLInputElement).value).toBe('#aabbcc');
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onApply).toHaveBeenCalledWith({ variant: 1, color: '#aabbcc' });
  });

  it('валидный hex принимается (регистр приводится к нижнему)', () => {
    view();
    fireEvent.change(screen.getByLabelText('HEX-код цвета'), { target: { value: '#FF8800' } });
    expect(screen.queryByText('Формат: #rrggbb')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onApply).toHaveBeenCalledWith({ variant: 1, color: '#ff8800' });
  });

  it('невалидный hex показывает подсказку и не портит выбранный цвет', () => {
    view({ color: '#e05252' });
    fireEvent.change(screen.getByLabelText('HEX-код цвета'), { target: { value: 'красный' } });
    expect(screen.getByText('Формат: #rrggbb')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onApply).toHaveBeenCalledWith({ variant: 1, color: '#e05252' });
  });

  it('«Отмена» ничего не применяет', () => {
    view();
    fireEvent.click(screen.getByLabelText('avatar-8'));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('превью показывает аватар на светлой и тёмной подложке', () => {
    view({ color: '#4fa35b' });
    expect(screen.getByText('светлая')).toBeTruthy();
    expect(screen.getByText('тёмная')).toBeTruthy();
    // Модалка живёт в портале — ищем внутри самого dialog, не в render-контейнере.
    const dialog = screen.getByRole('dialog');
    const tinted = Array.from(dialog.querySelectorAll<HTMLElement>('span[style]'))
      .filter(el => el.style.color === 'rgb(79, 163, 91)');
    // 2 превью + 8 вариантов формы — цвет один и тот же во всех.
    expect(tinted.length).toBeGreaterThanOrEqual(10);
  });
});
