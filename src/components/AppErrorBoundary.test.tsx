// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Bug C — глобальный ErrorBoundary разрывает белый экран.
//
// Проверяет, что AppErrorBoundary ловит исключение дочернего дерева и рендерит
// экран восстановления с кнопкой «Перезагрузить» вместо проброса ошибки наверх
// (которое обнуляло бы всё дерево React → пустой белый экран).
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = { language: 'ru' as 'ru' | 'en' };

vi.mock('../store/useStore', () => ({
  useStore: { getState: () => state },
}));

import { AppErrorBoundary } from './AppErrorBoundary';

function Boom(): never {
  throw new Error('render exploded');
}

describe('AppErrorBoundary', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    state.language = 'ru';
    // React логирует пойманную ошибку в console.error — глушим, чтобы не шуметь.
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
  });

  it('рендерит дочерний контент, пока ошибки нет', () => {
    render(
      <AppErrorBoundary>
        <div>всё хорошо</div>
      </AppErrorBoundary>,
    );
    expect(screen.getByText('всё хорошо')).toBeInTheDocument();
  });

  it('при исключении в дочернем дереве показывает экран восстановления (ru)', () => {
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByText('Что-то пошло не так')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Перезагрузить' })).toBeInTheDocument();
  });

  it('экран восстановления локализован (en)', () => {
    state.language = 'en';
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
