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
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.round(ms / 86400000));
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
