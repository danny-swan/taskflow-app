import type { Task, Status } from '../store/useStore';

/**
 * v0.9.35-dev.6.10.5: «Текущий срез» на Дашборде должен отражать РОВНО тот
 * набор задач, что виден на вкладке «Задачи» прямо сейчас — то есть живое
 * состояние, а не всю историю. Определение «текущей» задачи повторяет фильтр
 * TasksPage: задача НЕ архивная и её статус НЕ скрытый и НЕ технический
 * (в т.ч. «Удалено»). Мягко удалённые (deleted_at) сюда уже не попадают —
 * их отфильтровывает refresh() на уровне SELECT.
 *
 * Исторические графики «За период» (Активность, тепловая карта, недавно
 * выполненные) намеренно продолжают считать по всем задачам и этот хелпер
 * не используют.
 */
export function currentSnapshotTasks(tasks: Task[], statuses: Status[]): Task[] {
  const hiddenStatusIds = new Set(
    statuses.filter(s => s.hidden || s.is_technical === 1).map(s => s.id),
  );
  return tasks.filter(t => !t.archived && !hiddenStatusIds.has(t.status_id));
}

/** Ключ дня YYYY-MM-DD по ЛОКАЛЬНЫМ полям календаря (без UTC-сдвига toISOString). */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Число недель (колонок) в тепловой карте «Активность · 12w». */
export const HEATMAP_WEEKS = 12;

/**
 * F50: сетка дней тепловой карты — 12 колонок по 7 дней, СТРОГО Пн…Вс.
 *
 * Почему это отдельная чистая функция: раньше сетка строилась инлайн в
 * `Dashboard.tsx` и стартовала с «83 дня назад» — произвольного дня недели, тогда как
 * подписи строк в UI жёстко заданы как Пн…Вс. Совпадение случалось только по
 * вторникам, в остальные дни строка показывала чужой день недели. Выносим в
 * чистую функцию, чтобы инвариант «строка j = labels[j]» проверялся тестом на
 * любой дате, а не рендером целого дашборда.
 *
 * Последняя колонка — всегда текущая неделя, поэтому в неё попадают и дни после
 * `today`. Это осознанно: у них просто не будет событий (count = 0), зато неделя
 * не разрезается посередине и подписи остаются честными.
 *
 * @param today опорная дата (обычно `new Date()`; параметр ради тестируемости)
 * @returns 12 колонок по 7 ключей YYYY-MM-DD; `[w][0]` — всегда понедельник
 */
export function heatmapDayKeys(today: Date): string[][] {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // JS: воскресенье = 0. Переводим в ISO-нумерацию Пн=0 … Вс=6 и откатываемся
  // к понедельнику текущей недели, а затем на 11 недель назад.
  const isoDow = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - isoDow - (HEATMAP_WEEKS - 1) * 7);

  const weeks: string[][] = [];
  for (let w = 0; w < HEATMAP_WEEKS; w++) {
    const days: string[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      days.push(localDayKey(date));
    }
    weeks.push(days);
  }
  return weeks;
}
