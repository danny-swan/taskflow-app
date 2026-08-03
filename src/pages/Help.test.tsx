// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// Рендер-тесты страницы «Помощь» (FAQ).
//
// Проверяет, что после актуализации FAQ (пункт 7 брифа):
//  - появился раздел про пространства (workspaces) и участников,
//  - слово «Канбан»/«Kanban» больше не встречается в текстах FAQ-аккордеонов
//    (переименовано в «Карточки»/«Cards»); текст changelog (WhatsNewSection)
//    не проверяется — бриф явно запрещает переписывать историю changelog,
//  - секции рендерятся и раскрываются на обоих языках (RU/EN).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

let storeState: any;

vi.mock('../store/useStore', () => ({
  useStore: (selector: (s: any) => unknown) => selector(storeState),
}));

// SupportBlock тянет qrcode.react и криптоадреса — не имеет отношения к FAQ,
// в тесте достаточно заглушки, чтобы не рендерить лишнее.
vi.mock('../components/SupportBlock', () => ({
  SupportBlock: () => null,
}));

import { HelpPage } from './Help';

function setup(lang: 'ru' | 'en') {
  storeState = { language: lang };
  return render(<HelpPage />);
}

/**
 * Аккордеон держит только один открытый вопрос (state `openKey`), поэтому
 * раскрываем по одному, собираем текст каждого раскрытого пункта и снова
 * закрываем. Возвращает объединённый текст ТОЛЬКО FAQ-аккордеонов —
 * без WhatsNewSection/AboutSection, где живёт история changelog (её бриф
 * прямо запрещает переписывать, и там могут оставаться старые «Канбан»).
 */
function collectAllFaqText(): string {
  const buttons = screen.getAllByRole('button', { expanded: false });
  let combined = '';
  buttons.forEach((btn) => {
    fireEvent.click(btn);
    combined += btn.parentElement?.textContent ?? '';
    fireEvent.click(btn); // сворачиваем обратно — открыт должен быть только один
  });
  return combined;
}

/** Раскрывает конкретный FAQ-пункт по тексту вопроса и оставляет его открытым. */
function expandOne(questionText: RegExp) {
  const btn = screen.getByText(questionText).closest('button');
  if (btn) fireEvent.click(btn);
}

describe('HelpPage — FAQ', () => {
  it('содержит раздел про пространства и участников (RU)', () => {
    setup('ru');
    expect(screen.getByText('🗂 Пространства и участники')).toBeInTheDocument();
    expandOne(/Как пригласить участника в общее пространство/i);
    expect(screen.getByText(/TF-XXXXXX/)).toBeInTheDocument();
  });

  it('содержит раздел про workspaces и members (EN)', () => {
    setup('en');
    expect(screen.getByText('🗂 Workspaces & members')).toBeInTheDocument();
    expandOne(/How do I invite a member/i);
    expect(screen.getByText(/TF-XXXXXX/)).toBeInTheDocument();
  });

  it('не содержит слова «Канбан»/«Kanban» в текстах FAQ-аккордеонов (RU)', () => {
    setup('ru');
    const text = collectAllFaqText();
    expect(text).not.toMatch(/канбан/i);
    expect(text).not.toMatch(/kanban/i);
  });

  it('не содержит слова «Канбан»/«Kanban» в текстах FAQ-аккордеонов (EN)', () => {
    setup('en');
    const text = collectAllFaqText();
    expect(text).not.toMatch(/канбан/i);
    expect(text).not.toMatch(/kanban/i);
  });

  it('описывает роли owner/editor/viewer и не упоминает несуществующую роль «admin»', () => {
    setup('ru');
    expandOne(/Какие бывают роли участников/i);
    const rolesText = screen.getByText(/Какие бывают роли участников/i).closest('div')?.parentElement?.textContent ?? '';
    expect(rolesText).toMatch(/Владелец \(owner\)/);
    expect(rolesText).not.toMatch(/\badmin\b/i);
  });
});
