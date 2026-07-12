/**
 * Рендер-тесты блока профиля в настройках (v1.0.x).
 *
 * Проверяет: показ публичного ID, ОТСУТСТВИЕ внутреннего id в разметке,
 * счётчик символов bio, выбор аватара, сохранение через save().
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Мок useProfile ─────────────────────────────────────────────────────────
const saveMock = vi.fn(async () => {});
const profileState = {
  profile: {
    public_user_id: 'TF-ABC234',
    nickname: 'СтарыйНик',
    avatar_variant: 2,
    bio: 'привет',
    email: 'a@b.test',
    created_at: '2026-01-01T00:00:00Z',
  } as any,
  loading: false,
  error: null as string | null,
  refetch: vi.fn(),
  save: saveMock,
};

vi.mock('../lib/profile', async (importActual) => {
  const actual = await importActual<typeof import('../lib/profile')>();
  return {
    ...actual,
    useProfile: () => profileState,
  };
});

// ─── Мок store (только pushToast нужен ProfileBlock) ────────────────────────
const pushToast = vi.fn();
vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector({ pushToast }),
}));

import { ProfileBlock } from './ProfileBlock';

const INTERNAL_ID = '11111111-1111-1111-1111-111111111111';

beforeEach(() => {
  saveMock.mockClear();
  pushToast.mockClear();
  profileState.loading = false;
  profileState.error = null;
});

describe('ProfileBlock', () => {
  it('показывает публичный ID и НЕ показывает внутренний id', () => {
    const { container } = render(<ProfileBlock userId={INTERNAL_ID} isRu />);
    expect(screen.getByText('TF-ABC234')).toBeTruthy();
    expect(container.innerHTML).not.toContain(INTERNAL_ID);
  });

  it('гидрирует поля из профиля (ник, bio, аватар)', () => {
    render(<ProfileBlock userId={INTERNAL_ID} isRu />);
    expect((screen.getByLabelText('Ник') as HTMLInputElement).value).toBe('СтарыйНик');
    expect((screen.getByLabelText('О себе') as HTMLTextAreaElement).value).toBe('привет');
    expect(screen.getByLabelText('avatar-2')).toHaveAttribute('aria-checked', 'true');
  });

  it('счётчик символов bio обновляется при вводе', () => {
    render(<ProfileBlock userId={INTERNAL_ID} isRu />);
    const bio = screen.getByLabelText('О себе') as HTMLTextAreaElement;
    fireEvent.change(bio, { target: { value: 'ровно десять' } });
    expect(screen.getByText(`${'ровно десять'.length}/160`)).toBeTruthy();
  });

  it('выбор аватара меняет выделение', () => {
    render(<ProfileBlock userId={INTERNAL_ID} isRu />);
    fireEvent.click(screen.getByLabelText('avatar-7'));
    expect(screen.getByLabelText('avatar-7')).toHaveAttribute('aria-checked', 'true');
  });

  it('сохранение вызывает save с косметическими полями и тост', async () => {
    render(<ProfileBlock userId={INTERNAL_ID} isRu />);
    fireEvent.click(screen.getByLabelText('avatar-5'));
    fireEvent.click(screen.getByText('Сохранить профиль'));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({ avatar_variant: 5, nickname: 'СтарыйНик', bio: 'привет' }),
    );
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith('Профиль сохранён'));
  });
});
