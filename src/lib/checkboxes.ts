/**
 * checkboxes.ts — markdown-style checkbox utilities for task comments.
 *
 * Recognised syntax (case-insensitive, at line start, leading whitespace allowed):
 *
 *   - [ ] something  → unchecked
 *   - [x] something  → checked
 *   * [ ] something  → unchecked (alt bullet)
 *   * [x] something  → checked   (alt bullet)
 *
 * Implementation notes:
 * - We deliberately keep this as plain text inside the existing `tasks.comment`
 *   column — no schema change, no migration. Export/import keeps these as text,
 *   so JSON / CSV / XLSX backups stay compatible across versions.
 * - Toggling a checkbox simply rewrites the line and persists the whole comment
 *   via updateTask({ comment: newText }).
 * - Progress (X done of Y total) is computed on demand from the comment string;
 *   not stored anywhere. Empty comments and comments without checkboxes return
 *   `null` from getCheckboxStats(), so cards without checklist look exactly
 *   as before.
 */

/** Regex matches a checkbox line. Captures: indent, bullet, marker (space or x/X). */
const LINE_RE = /^([ \t]*)([-*])\s+\[( |x|X)\]\s?(.*)$/;

export interface CheckboxStats {
  total: number;
  done: number;
}

/**
 * Count checkboxes inside a comment. Returns null if the text has none —
 * callers should hide the progress indicator in that case.
 */
export function getCheckboxStats(text: string | null | undefined): CheckboxStats | null {
  if (!text) return null;
  let total = 0;
  let done = 0;
  for (const line of text.split('\n')) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    total += 1;
    if (m[3].toLowerCase() === 'x') done += 1;
  }
  return total > 0 ? { total, done } : null;
}

/**
 * Toggle the N-th checkbox (0-based) inside a comment. Returns the new text.
 * If `index` is out of range the original text is returned unchanged.
 * Idempotent on lines that aren't checkboxes.
 */
export function toggleCheckbox(text: string, index: number): string {
  const lines = text.split('\n');
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = LINE_RE.exec(lines[i]);
    if (!m) continue;
    if (seen === index) {
      const [, indent, bullet, marker, rest] = m;
      const flipped = marker.toLowerCase() === 'x' ? ' ' : 'x';
      lines[i] = `${indent}${bullet} [${flipped}] ${rest}`;
      return lines.join('\n');
    }
    seen += 1;
  }
  return text;
}

/**
 * Token returned by parseComment(). Either a checkbox or a plain text block
 * (which may span multiple consecutive non-checkbox lines).
 */
export type CommentToken =
  | { kind: 'text'; text: string }
  | { kind: 'checkbox'; index: number; checked: boolean; label: string };

/**
 * Parse a comment into renderable tokens. Plain-text lines are grouped into
 * `text` tokens, checkbox lines become individual `checkbox` tokens with a
 * sequential `index` (matches the index expected by toggleCheckbox).
 */
export function parseComment(text: string): CommentToken[] {
  if (!text) return [];
  const tokens: CommentToken[] = [];
  let textBuf: string[] = [];
  let cbIndex = 0;
  const flush = () => {
    if (textBuf.length) {
      tokens.push({ kind: 'text', text: textBuf.join('\n') });
      textBuf = [];
    }
  };
  for (const line of text.split('\n')) {
    const m = LINE_RE.exec(line);
    if (m) {
      flush();
      tokens.push({
        kind: 'checkbox',
        index: cbIndex++,
        checked: m[3].toLowerCase() === 'x',
        label: m[4],
      });
    } else {
      textBuf.push(line);
    }
  }
  flush();
  return tokens;
}

/**
 * v0.8.14: вставка markdown-чекбокса (или пункта списка) в позицию каретки.
 *
 * Работает с textarea-координатами selectionStart/selectionEnd. Логика:
 *
 * 1. Если выделен фрагмент из нескольких строк — превращаем каждую строку
 *    в чекбокс (пустые строки пропускаем).
 * 2. Иначе — вставляем одну пустую строку. Если курсор не в начале своей
 *    строки — добавляем \n перед префиксом (чтобы чекбокс начинался
 *    с новой строки).
 *
 * Возвращает обновлённый текст и позицию, куда поставить каретку (конец
 * вставки — удобно сразу печатать текст пункта).
 */
export interface InsertResult {
  next: string;
  caretAt: number;
}

export function insertCheckboxLines(
  text: string,
  selStart: number,
  selEnd: number,
  kind: 'unchecked' | 'checked' | 'bullet'
): InsertResult {
  const prefix = kind === 'unchecked' ? '- [ ] '
               : kind === 'checked'   ? '- [x] '
               : '- ';

  // Если есть выделение с >0 длиной — превращаем каждую строку.
  if (selEnd > selStart) {
    const before = text.slice(0, selStart);
    const middle = text.slice(selStart, selEnd);
    const after = text.slice(selEnd);
    const transformed = middle
      .split('\n')
      .map(line => (line.trim().length === 0 ? line : prefix + line))
      .join('\n');
    const next = before + transformed + after;
    return { next, caretAt: before.length + transformed.length };
  }

  // Без выделения — вставляем префикс в начало текущей строки,
  // а не «разрываем» её новыми \n. Это гарантирует, что текст
  // после курсора (в той же строке) не уедет на новую строку
  // (v0.9.1: исправление поведения — раньше «Канбан 03/07» превращался в
  //  «- [ ] \nКанбан 03/07», теперь будет «- [ ] Канбан 03/07»).

  // Ищем начало текущей строки (позиция после последнего \n до selStart).
  const lineStart = text.lastIndexOf('\n', selStart - 1) + 1;
  const lineEndIdx = text.indexOf('\n', selStart);
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
  const currentLine = text.slice(lineStart, lineEnd);

  // Если в строке уже есть префикс чекбокса/списка — не дублируем, просто
  // оставляем текст как есть, но переключаем вид на требуемый
  // (checked ↔ unchecked ↔ bullet).
  const existing = /^([ \t]*)(?:([-*])\s+\[( |x|X)\]\s?|([-*])\s+)/.exec(currentLine);
  if (existing) {
    const indent = existing[1] ?? '';
    // Пересобираем строку — убираем старый префикс, кладём новый.
    const rest = currentLine.slice(existing[0].length);
    const rebuilt = indent + prefix + rest;
    const next = text.slice(0, lineStart) + rebuilt + text.slice(lineEnd);
    const caretAt = lineStart + indent.length + prefix.length + (selStart - lineStart - existing[0].length > 0 ? (selStart - lineStart - existing[0].length) : 0);
    return { next, caretAt: Math.min(caretAt, next.length) };
  }

  // Сохраняем ведущие пробелы/табуляцию строки.
  const indentMatch = /^[ \t]*/.exec(currentLine);
  const indent = indentMatch ? indentMatch[0] : '';
  const lineBodyStart = lineStart + indent.length;

  const next =
    text.slice(0, lineBodyStart) +
    prefix +
    text.slice(lineBodyStart);

  // Каретка — сразу после префикса (в начале текста строки).
  const caretAt = lineBodyStart + prefix.length;
  return { next, caretAt };
}
