/**
 * Unit-тесты для src/lib/checkboxes.ts — markdown-чекбоксы в комментариях.
 */
import { describe, it, expect } from 'vitest';
import {
  getCheckboxStats,
  toggleCheckbox,
  parseComment,
  insertCheckboxLines,
} from './checkboxes';

describe('getCheckboxStats', () => {
  it('null для пустой строки', () => {
    expect(getCheckboxStats('')).toBeNull();
    expect(getCheckboxStats(null)).toBeNull();
    expect(getCheckboxStats(undefined)).toBeNull();
  });

  it('null если чекбоксов нет', () => {
    expect(getCheckboxStats('просто текст\nбез чекбоксов')).toBeNull();
  });

  it('считает total и done', () => {
    const text = [
      '- [ ] первый',
      '- [x] второй',
      '- [X] третий (upper X)',
      '* [ ] четвертый (звёздочка)',
      'просто текст',
    ].join('\n');
    expect(getCheckboxStats(text)).toEqual({ total: 4, done: 2 });
  });

  it('игнорирует чекбокс не в начале строки', () => {
    // Отступы допустимы, но не текст перед маркером.
    expect(getCheckboxStats('текст - [ ] test')).toBeNull();
    expect(getCheckboxStats('   - [ ] с отступом')).toEqual({ total: 1, done: 0 });
  });
});

describe('toggleCheckbox', () => {
  const text = [
    '- [ ] первый',
    '- [x] второй',
    '- [ ] третий',
  ].join('\n');

  it('переключает unchecked → checked', () => {
    const result = toggleCheckbox(text, 0);
    expect(result.split('\n')[0]).toBe('- [x] первый');
  });

  it('переключает checked → unchecked', () => {
    const result = toggleCheckbox(text, 1);
    expect(result.split('\n')[1]).toBe('- [ ] второй');
  });

  it('индекс вне диапазона → без изменений', () => {
    expect(toggleCheckbox(text, 99)).toBe(text);
  });

  it('idempotent на строках-не-чекбоксах между', () => {
    const mixed = '- [ ] a\nпросто текст\n- [x] b';
    const toggled = toggleCheckbox(mixed, 1);
    expect(toggled.split('\n')[2]).toBe('- [ ] b');
    expect(toggled.split('\n')[1]).toBe('просто текст');
  });
});

describe('parseComment', () => {
  it('пустой вход → пустой массив', () => {
    expect(parseComment('')).toEqual([]);
  });

  it('только текст → один text-токен', () => {
    const t = parseComment('строка 1\nстрока 2');
    expect(t).toEqual([{ kind: 'text', text: 'строка 1\nстрока 2' }]);
  });

  it('чекбоксы получают последовательный index', () => {
    const t = parseComment('- [ ] a\n- [x] b\n- [ ] c');
    expect(t).toHaveLength(3);
    expect(t.map(x => (x.kind === 'checkbox' ? x.index : -1))).toEqual([0, 1, 2]);
    expect(t.map(x => (x.kind === 'checkbox' ? x.checked : null))).toEqual([false, true, false]);
    expect(t.map(x => (x.kind === 'checkbox' ? x.label : null))).toEqual(['a', 'b', 'c']);
  });

  it('чередование текста и чекбоксов', () => {
    const t = parseComment('preamble\n- [ ] task\ntail');
    expect(t).toHaveLength(3);
    expect(t[0]).toEqual({ kind: 'text', text: 'preamble' });
    expect(t[1]).toMatchObject({ kind: 'checkbox', index: 0, label: 'task' });
    expect(t[2]).toEqual({ kind: 'text', text: 'tail' });
  });
});

describe('insertCheckboxLines', () => {
  it('вставка префикса в пустую строку', () => {
    const r = insertCheckboxLines('', 0, 0, 'unchecked');
    expect(r.next).toBe('- [ ] ');
    expect(r.caretAt).toBe(6);
  });

  it('превращает выделенный многострочный фрагмент в чекбоксы', () => {
    const text = 'a\nb\nc';
    const r = insertCheckboxLines(text, 0, text.length, 'checked');
    expect(r.next).toBe('- [x] a\n- [x] b\n- [x] c');
  });

  it('пустые строки в выделении не превращаются в чекбоксы', () => {
    const text = 'a\n\nc';
    const r = insertCheckboxLines(text, 0, text.length, 'unchecked');
    expect(r.next).toBe('- [ ] a\n\n- [ ] c');
  });

  it('переключение существующего чекбокса unchecked → checked', () => {
    const text = '- [ ] task';
    const r = insertCheckboxLines(text, 6, 6, 'checked');
    expect(r.next).toBe('- [x] task');
  });

  it('превращение bullet → checkbox', () => {
    const text = '- task';
    const r = insertCheckboxLines(text, 2, 2, 'unchecked');
    expect(r.next).toBe('- [ ] task');
  });
});
