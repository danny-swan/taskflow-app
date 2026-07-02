export function cls(...args: (string | false | null | undefined)[]) {
  return args.filter(Boolean).join(' ');
}

export function formatDate(s?: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function daysBetween(a?: string | null, b?: string | null): number | null {
  if (!a) return null;
  const start = new Date(a);
  const end = b ? new Date(b) : new Date();
  if (isNaN(start.getTime())) return null;
  // Считаем календарные дни: и день начала, и день окончания включаются.
  // Сравниваем по локальному дню, чтобы UTC-сдвиг не давал лишний день.
  const sd = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const ed = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  const diff = Math.round((ed - sd) / 86400000);
  return Math.max(1, diff + 1);
}

export function readableTextColor(hex: string): string {
  // returns black or white depending on luminance
  const c = hex.replace('#', '');
  if (c.length !== 6) return '#000';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#28251D' : '#FFFFFF';
}

/**
 * v0.9.2 (№1): кол-во дней между двумя ISO-датами (YYYY-MM-DD),
 * from включательно, to включательно. Может быть отрицательным если to < from.
 *
 * calendarDaysDiff('2026-07-01', '2026-07-03') === 2  календарных дней
 */
export function calendarDaysDiff(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/**
 * v0.9.2 (№1): кол-во «рабочих» дней между двумя ISO-датами (Пн-Пт, без праздников).
 * Может быть отрицательным если to < from.
 *
 * Считаем кол-во будних дней вовлечённых в полу-открытый интервал [from, to):
 * businessDaysDiff('2026-07-03', '2026-07-06') === 1  — птница 3-го (будний), выходные 4/5, понедельник 6-го не включён.
 * businessDaysDiff('2026-07-06', '2026-07-06') === 0  — тот же день.
 * businessDaysDiff('2026-07-06', '2026-07-13') === 5  — 5 будней (Пн-Пт) в интервале.
 *
 * Праздники НЕ учитываются (по договорённости — только Пн-Пт, без календаря праздников).
 */
export function businessDaysDiff(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  if (a.getTime() === b.getTime()) return 0;

  const sign = a.getTime() < b.getTime() ? 1 : -1;
  const start = sign > 0 ? new Date(a) : new Date(b);
  const end   = sign > 0 ? new Date(b) : new Date(a);

  let count = 0;
  const cur = new Date(start);
  while (cur.getTime() < end.getTime()) {
    const dow = cur.getDay(); // 0=Вс, 6=Сб
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count * sign;
}

/**
 * v0.9.2 (№1): универсальный расчёт оставшихся/прошедших дней между today и deadline.
 * Отрицательное число — просрочка. Зависит от режима:
 * - 'calendar' — календарные дни
 * - 'business' — только будни (Пн-Пт)
 */
export function daysUntilDeadline(deadline: string, today: string, mode: 'calendar' | 'business'): number {
  return mode === 'business'
    ? businessDaysDiff(today, deadline)
    : calendarDaysDiff(today, deadline);
}

export function downloadFile(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}
