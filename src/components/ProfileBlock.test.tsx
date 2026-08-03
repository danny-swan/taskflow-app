/**
 * Рендер-тесты блока профиля в настройках (v1.1.x, редизайн — ADR 0032).
 *
 * Проверяет: показ публичного ID, ОТСУТСТВИЕ внутреннего id в разметке,
 * счётчик символов bio, порядок блоков (ник и аватар сверху, «Ваш ID» ниже
 * «О себе»), выбор формы И явного цвета аватара в МОДАЛКЕ, сохранение через
 * save() вместе с avatar_color.
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
    avatar_color: '#e05252',
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
    // Форма/цвет теперь видны только внутри модалки — открываем её.
    fireEvent.click(screen.getByRole('button', { name: 'Изменить аватар' }));
    expect(screen.getByLabelText('avatar-2')).toHaveAttribute('aria-checked', 'true');
    expect((screen.getByLabelText('HEX-код цвета') as HTMLInputElement).value).toBe('#e05252');
  });

  // Требование к редизайну: ник+аватар сверху, ниже «О себе», затем «Ваш ID».
  it('порядок блоков: ник → о себе → Ваш ID', () => {
    const { container } = render(<ProfileBlock userId={INTERNAL_ID} isRu />);
    const html = container.innerHTML;
    expect(html.indexOf('Ник')).toBeLessThan(html.indexOf('О себе'));
    expect(html.indexOf('О себе')).toBeLessThan(html.indexOf('Ваш ID'));
  });

  it('счётчик символов bio обновляется при вводе', () => {
    render(<ProfileBlock userId={INTERNAL_ID} isRu />);
    const bio = screen.getByLabelText('О себе') as HTMLTextAreaElement;
    fireEvent.change(bio, { target: { value: 'ровно десять' } });
    expect(screen.getByText(`${'ровно десять'.length}/160`)).toBeTruthy();
  });

  it('аватар выбирается в модалке: «Отмена» ничего не меняет', () => {
    render(<ProfileBlock userId={INTERNAL_ID} isRu />);
    fireEvent.click(screen.getByRole('button', { name: 'Изменить аватар' }));
    fireEvent.click(screen.getByLabelText('avatar-7'));
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    // Открываем снова — черновик сброшен к сохранённому значению.
    fireEvent.click(screen.getByRole('button', { name: 'Изменить аватар' }));
    expect(screen.getByLabelText('avatar-2')).toHaveAttribute('aria-checked', 'true');
  });

  it('сохранение вызывает save с косметическими полями (включая цвет) и тост', async () => {
    render(<ProfileBlock userId={INTERNAL_ID} isRu />);
    fireEvent.click(screen.getByRole('button', { name: 'Изменить аватар' }));
    fireEvent.click(screen.getByLabelText('avatar-5'));
    fireEvent.click(screen.getByLabelText('color-#4fa35b'));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(screen.getByText('Сохранить профиль'));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        avatar_variant: 5,
        avatar_color: '#4fa35b',
        nickname: 'СтарыйНик',
        bio: 'привет',
      }),
    );
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith('Профиль сохранён'));
  });
});
