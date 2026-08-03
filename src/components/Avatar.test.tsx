/**
 * Тесты встроенных SVG-аватаров (v1.0.x).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Avatar, AvatarPicker, AVATAR_VARIANTS, avatarTint } from './Avatar';

describe('Avatar', () => {
  it('рендерит svg-глиф', () => {
    const { container } = render(<Avatar variant={1} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('клампит вне-диапазонные варианты без падения', () => {
    expect(() => render(<Avatar variant={99} />)).not.toThrow();
    expect(() => render(<Avatar variant={0} />)).not.toThrow();
  });

  // F41 (ADR 0032): без явного цвета остаётся темовый акцент (обратная совместимость).
  it('без цвета красится акцентом темы (класс text-accent)', () => {
    const { container } = render(<Avatar variant={1} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('text-accent');
    expect(root.style.color).toBe('');
  });

  it('с явным цветом ставит inline-цвет и НЕ зависит от темы', () => {
    const { container } = render(<Avatar variant={1} color="#ff8800" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).not.toContain('text-accent');
    expect(root.style.color).toBe('rgb(255, 136, 0)');
    expect(root.style.backgroundColor).toBe('rgba(255, 136, 0, 0.14)');
  });

  it('невалидный цвет игнорируется — падаем назад на тему', () => {
    const { container } = render(<Avatar variant={1} color="red" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('text-accent');
  });
});

describe('avatarTint', () => {
  it('переводит hex в rgba с низкой альфой', () => {
    expect(avatarTint('#3d8ad9')).toBe('rgba(61, 138, 217, 0.14)');
  });

  it('возвращает null для пустого/невалидного значения', () => {
    expect(avatarTint(null)).toBeNull();
    expect(avatarTint('')).toBeNull();
    expect(avatarTint('#12345')).toBeNull();
    expect(avatarTint('rgb(1,2,3)')).toBeNull();
  });
});

describe('AvatarPicker', () => {
  it('показывает все 8 вариантов', () => {
    render(<AvatarPicker value={1} onChange={() => {}} />);
    expect(screen.getAllByRole('radio')).toHaveLength(AVATAR_VARIANTS.length);
  });

  it('помечает выбранный вариант через aria-checked', () => {
    render(<AvatarPicker value={3} onChange={() => {}} />);
    const selected = screen.getByLabelText('avatar-3');
    expect(selected).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('avatar-2')).toHaveAttribute('aria-checked', 'false');
  });

  it('вызывает onChange с выбранным индексом', () => {
    const onChange = vi.fn();
    render(<AvatarPicker value={1} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('avatar-6'));
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it('прокидывает выбранный цвет во все варианты (превью)', () => {
    const { container } = render(<AvatarPicker value={1} onChange={() => {}} color="#4fa35b" />);
    const tinted = Array.from(container.querySelectorAll<HTMLElement>('span[style]'))
      .filter(el => el.style.color === 'rgb(79, 163, 91)');
    expect(tinted).toHaveLength(AVATAR_VARIANTS.length);
  });
});
