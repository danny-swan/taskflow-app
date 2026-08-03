// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Тесты карточки участника (F40, ADR 0031).
//
// Карточка показывает ПУБЛИЧНЫЙ минимум: аватар, ник (или TF-id), «о себе», TF-id.
// Внутренний uuid и email в разметку попадать не должны.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemberInfoModal } from './MemberInfoModal';
import type { MemberProfile } from '../lib/memberProfiles';

const INTERNAL = 'a0000021-0000-4000-8000-000000000002';

const prof = (over: Partial<MemberProfile> = {}): MemberProfile => ({
  user_id: INTERNAL,
  public_user_id: 'TF-EDIT01',
  nickname: 'nickname' in over ? (over.nickname ?? null) : 'Даниил',
  avatar_variant: over.avatar_variant ?? 6,
  avatar_color: 'avatar_color' in over ? (over.avatar_color ?? null) : '#ff8800',
  bio: 'bio' in over ? (over.bio ?? null) : 'сорсинг табака',
});

describe('MemberInfoModal', () => {
  it('не рендерится без профиля', () => {
    render(<MemberInfoModal open lang="ru" profile={null} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('показывает ник, «о себе» и TF-id', () => {
    render(<MemberInfoModal open lang="ru" profile={prof()} onClose={() => {}} />);
    // Ник виден дважды: в шапке карточки и в поле «Ник».
    expect(screen.getAllByText('Даниил')).toHaveLength(2);
    expect(screen.getByText('сорсинг табака')).toBeTruthy();
    expect(screen.getByText('TF-EDIT01')).toBeTruthy();
  });

  it('без ника в заголовке показывает TF-id и подпись «ник не задан»', () => {
    render(<MemberInfoModal open lang="ru" profile={prof({ nickname: null })} onClose={() => {}} />);
    expect(screen.getAllByText('TF-EDIT01').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Ник не задан')).toBeTruthy();
  });

  it('пустое «о себе» — плейсхолдер, а не пустота', () => {
    render(<MemberInfoModal open lang="ru" profile={prof({ bio: null })} onClose={() => {}} />);
    expect(screen.getByText('Ничего не указано')).toBeTruthy();
  });

  it('внутренний uuid участника в разметку не попадает', () => {
    const { container } = render(
      <MemberInfoModal open lang="ru" profile={prof()} onClose={() => {}} />,
    );
    expect(container.ownerDocument.body.innerHTML).not.toContain(INTERNAL);
  });

  it('аватар красится явным цветом участника', () => {
    render(<MemberInfoModal open lang="ru" profile={prof({ avatar_color: '#4fa35b' })} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    const tinted = Array.from(dialog.querySelectorAll<HTMLElement>('span[style]'))
      .filter(el => el.style.color === 'rgb(79, 163, 91)');
    expect(tinted.length).toBeGreaterThan(0);
  });

  it('роль показывается, если передана', () => {
    render(
      <MemberInfoModal open lang="ru" profile={prof()} roleLabel="Редактор" onClose={() => {}} />,
    );
    expect(screen.getByText('Редактор')).toBeTruthy();
  });

  it('кнопка закрытия вызывает onClose', () => {
    const onClose = vi.fn();
    render(<MemberInfoModal open lang="ru" profile={prof()} onClose={onClose} />);
    fireEvent.click(screen.getByText('Закрыть'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
