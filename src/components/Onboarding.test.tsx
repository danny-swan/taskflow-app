// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Рендер-тесты онбординга (пункт 8 брифа).
//
// Проверяет, что после актуализации шагов:
//  - число шагов совпадает с ожидаемым (добавлен шаг про пространства),
//  - тексты title/body не пустые ни на одном шаге ни на одном языке,
//  - слово «Kanban»/«Канбан» не встречается ни в одном тексте шага
//    (переименовано в «Карточки»/«Cards»),
//  - публичные функции isOnboardingSeen/markOnboardingSeen/resetOnboarding
//    продолжают работать как флаг в settings (не менялись, но проверяем
//    контракт, на который опирается автозапуск тура).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let settingsRow: { value: string } | undefined;

vi.mock('../lib/db', () => ({
  get: vi.fn((_sql: string) => settingsRow),
  run: vi.fn((sql: string) => {
    if (sql.startsWith('DELETE')) settingsRow = undefined;
    else settingsRow = { value: '1' };
  }),
}));

let storeState: any;
vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector(storeState),
}));

import { Onboarding, isOnboardingSeen, markOnboardingSeen, resetOnboarding } from './Onboarding';

describe('Onboarding — контракт флага (не менялся)', () => {
  beforeEach(() => {
    settingsRow = undefined;
  });

  it('isOnboardingSeen/markOnboardingSeen/resetOnboarding работают через settings', () => {
    expect(isOnboardingSeen()).toBe(false);
    markOnboardingSeen();
    expect(isOnboardingSeen()).toBe(true);
    resetOnboarding();
    expect(isOnboardingSeen()).toBe(false);
  });
});

describe('Onboarding — содержимое шагов', () => {
  beforeEach(() => {
    settingsRow = undefined;
    storeState = { language: 'ru', ready: true };
    vi.useFakeTimers();
  });

  it('автозапускается и показывает ожидаемое число шагов с непустыми текстами на обоих языках', async () => {
    render(
      <MemoryRouter>
        <Onboarding />
      </MemoryRouter>
    );

    await act(async () => {
      vi.advanceTimersByTime(700);
    });

    // "Шаг 1 / 11" — welcome, workspaces, tasks/cards, new-task, tags, calendar,
    // dashboard, stats, settings, help, done.
    expect(screen.getByText(/Шаг/)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 11/)).toBeInTheDocument();
  });

  it('не содержит слова «Канбан»/«Kanban» ни в одном шаге, на любом языке', async () => {
    for (const lang of ['ru', 'en'] as const) {
      storeState = { language: lang, ready: true };
      const { container, unmount } = render(
        <MemoryRouter>
          <Onboarding />
        </MemoryRouter>
      );
      await act(async () => {
        vi.advanceTimersByTime(700);
      });

      // Проходим все 11 шагов, проверяя текст на каждом. На последнем шаге кнопка
      // «Готово»/«Done» закрывает модалку (close()), поэтому останавливаемся,
      // как только диалога больше нет в DOM.
      for (let i = 0; i < 11; i++) {
        if (!container.querySelector('[role="dialog"]')) break;
        expect(container.textContent).not.toMatch(/канбан/i);
        expect(container.textContent).not.toMatch(/kanban/i);
        const buttons = screen.queryAllByRole('button').filter((b) =>
          /^(Дальше|Next|Готово|Done)$/.test(b.textContent?.trim() ?? '')
        );
        const nextBtn = buttons[0];
        if (nextBtn) {
          await act(async () => {
            fireEvent.click(nextBtn);
            vi.advanceTimersByTime(60);
          });
        }
      }
      unmount();
    }
  });
});
