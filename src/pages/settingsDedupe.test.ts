// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
//
// F49 (ADR 0035) — устранение дублей ws-настроек, и F52 — несуществующие
// цветовые токены на экране оплаты. Оба теста читают исходники: это
// структурные инварианты проекта, которые дешевле и надёжнее проверять
// статически, чем рендером целых страниц.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SETTINGS_SECTIONS, parseSettingsSection } from '../lib/settingsSections';

const root = resolve(__dirname, '..', '..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf-8');

describe('F49 — справочники живут только в настройках пространства', () => {
  it('в общих настройках больше нет секций «Статусы» и «Теги»', () => {
    expect(SETTINGS_SECTIONS).not.toContain('statuses');
    expect(SETTINGS_SECTIONS).not.toContain('tags');
    expect(parseSettingsSection('#statuses')).toBeNull();
    expect(parseSettingsSection('#tags')).toBeNull();
    // Остальные секции не задеты.
    expect(SETTINGS_SECTIONS).toContain('general');
    expect(SETTINGS_SECTIONS).toContain('templates');
    expect(parseSettingsSection('#general')).toBe('general');
  });

  it('Settings.tsx не объявляет и не рендерит секции справочников', () => {
    const src = read('src/pages/Settings.tsx');
    expect(src).not.toMatch(/export function (StatusesSection|TagsSection)/);
    expect(src).not.toMatch(/<(StatusesSection|TagsSection)\s*\/>/);
  });

  it('WorkspaceSettings импортирует справочники из общего модуля, а не из страницы Settings', () => {
    const src = read('src/pages/WorkspaceSettings.tsx');
    expect(src).toContain("from '../components/WorkspaceReferenceSections'");
    expect(src).not.toMatch(/from '\.\/Settings'/);
  });

  it('модуль справочников экспортирует обе секции', () => {
    const src = read('src/components/WorkspaceReferenceSections.tsx');
    expect(src).toContain('export function TagsSection');
    expect(src).toContain('export function StatusesSection');
    // Ролевой гейт (Bug #5) переехал вместе с кодом и не потерян.
    expect(src).toContain('useCanManageWorkspace');
  });
});

describe('F52 — экран оплаты использует только существующие токены темы', () => {
  const themeTokens = [
    'bg', 'surface', 'surface-alt', 'border', 'border-soft',
    'text', 'muted', 'faint', 'accent', 'accent-hover', 'accent-soft',
  ];

  it('в tailwind.config.ts по-прежнему нет цветов primary/success', () => {
    const cfg = read('tailwind.config.ts');
    expect(cfg).not.toMatch(/^\s*'?primary'?:/m);
    expect(cfg).not.toMatch(/^\s*'?success'?:/m);
    for (const t of themeTokens) expect(cfg).toContain(t);
  });

  it('Checkout.tsx не содержит классов с несуществующими цветами', () => {
    const src = read('src/pages/Checkout.tsx');
    const code = src.slice(src.indexOf('*/') + 2); // без шапки-комментария, где баг описан словами
    const bad = code.match(/\b(?:bg|text|border|ring|from|to|via)-(?:primary|success)\b[^\s'"`]*/g) ?? [];
    expect(bad).toEqual([]);
  });

  it('Checkout.tsx не вешает opacity-модификатор на var-цвета (Tailwind 3.4 его молча теряет)', () => {
    const src = read('src/pages/Checkout.tsx');
    const code = src.slice(src.indexOf('*/') + 2);
    const bad = code.match(/\b(?:bg|text|border|ring)-accent(?:-hover|-soft)?\/[0-9[]/g) ?? [];
    expect(bad).toEqual([]);
  });

  it('у выделенного тарифа есть валидный фон вместе с text-white', () => {
    const src = read('src/pages/Checkout.tsx');
    expect(src).toContain('bg-accent text-white hover:bg-accent-hover');
  });
});
