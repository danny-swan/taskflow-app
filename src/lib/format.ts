/**
 * Unified date formatting utilities for TaskFlow v0.8.1
 * Uses Intl for locale-aware formatting (no external dependency needed).
 */

const RU_MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const EN_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parse a YYYY-MM-DD string (or ISO datetime) to a local date without timezone shifts */
function parseLocalDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const s = d.slice(0, 10);
  const [y, m, day] = s.split('-').map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day);
}

/**
 * Format a date as "dd.MM.yyyy"
 * e.g. "09.05.2026"
 */
export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? parseLocalDate(d) : d;
  if (!date) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

/**
 * Format a date as "dd MMM" in the given language
 * e.g. "09 май" (ru) or "09 May" (en)
 */
export function formatDateShort(d: string | Date | null | undefined, lang: 'ru' | 'en' = 'ru'): string {
  if (!d) return '';
  const date = typeof d === 'string' ? parseLocalDate(d) : d;
  if (!date) return '';
  const dd = String(date.getDate()).padStart(2, '0');
  const months = lang === 'ru' ? RU_MONTHS_SHORT : EN_MONTHS_SHORT;
  const mmm = months[date.getMonth()];
  return `${dd} ${mmm}`;
}

/**
 * Convert a "MM-DD" string (from a date slice 5..10) to "dd MMM" format
 */
export function formatMonthDay(mmdd: string, lang: 'ru' | 'en' = 'ru'): string {
  if (!mmdd || mmdd.length < 5) return mmdd;
  const parts = mmdd.split('-');
  if (parts.length < 2) return mmdd;
  const m = parseInt(parts[0], 10) - 1;
  const d = parseInt(parts[1], 10);
  const months = lang === 'ru' ? RU_MONTHS_SHORT : EN_MONTHS_SHORT;
  return `${String(d).padStart(2, '0')} ${months[m] ?? ''}`;
}
