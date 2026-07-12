/**
 * Тесты встроенных SVG-аватаров (v1.0.x).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Avatar, AvatarPicker, AVATAR_VARIANTS } from './Avatar';

describe('Avatar', () => {
  it('рендерит svg-глиф', () => {
    const { container } = render(<Avatar variant={1} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('клампит вне-диапазонные варианты без падения', () => {
    expect(() => render(<Avatar variant={99} />)).not.toThrow();
    expect(() => render(<Avatar variant={0} />)).not.toThrow();
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
});
