/**
 * uuid.ts — генерация UUIDv7 на клиенте (v0.9.35-dev.1).
 *
 * UUIDv7 = 48 бит Unix timestamp (миллисекунды) + 74 бит случайности + версия/вариант.
 * Ключевое свойство: лексикографическая сортировка соответствует временной —
 * важно для B-tree индексов на сервере (Postgres) и для дебага в логах.
 *
 * Спецификация: RFC 9562, §5.7.
 *
 * Используем crypto.getRandomValues (доступно и в Tauri WebView, и в sql.js/web).
 *
 * Формат: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
 *   где 7 — версия, y ∈ {8,9,a,b} — вариант RFC 4122.
 */

function toHex(n: number, width: number): string {
  return n.toString(16).padStart(width, '0');
}

/**
 * Сгенерировать UUIDv7.
 * Возвращает 36-символьную строку в нижнем регистре, например:
 *   018f4c62-8b23-7c9a-9b7d-3a2f8e1d4c5b
 *
 * Если crypto.getRandomValues недоступен (крайне редко) — fallback на Math.random
 * с предупреждением. Для локального клиента это приемлемо; для криптографии — нет.
 */
export function uuidv7(): string {
  const now = Date.now(); // ms since epoch — 48 бит хватает до ~10889 года

  // 10 случайных байт для остальных 74 бит (первые 4 бита — версия, 2 бита — вариант).
  const rand = new Uint8Array(10);
  try {
    // Стандартный путь для Tauri WebView и всех современных браузеров.
    (globalThis.crypto as Crypto).getRandomValues(rand);
  } catch {
    // Fallback: только для сред без crypto. Не криптостойко, но для локального
    // client_id/uuid это некритично — коллизии маловероятны.
    // eslint-disable-next-line no-console
    console.warn('[uuid] crypto.getRandomValues unavailable — falling back to Math.random');
    for (let i = 0; i < rand.length; i++) rand[i] = Math.floor(Math.random() * 256);
  }

  // Ставим версию (0111 = 7) в старшие 4 бита 7-го байта.
  rand[0] = (rand[0] & 0x0f) | 0x70;
  // Ставим вариант (10xx = RFC 4122) в старшие 2 бита 9-го байта.
  rand[2] = (rand[2] & 0x3f) | 0x80;

  // Собираем строку.
  // ms в hex — 12 символов (48 бит).
  const tsHex = toHex(Math.floor(now / 0x1_0000_0000), 4) + toHex(now >>> 0, 8);

  const b = Array.from(rand, (x) => toHex(x, 2)).join('');

  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-${b.slice(0, 4)}-${b.slice(4, 8)}-${b.slice(8, 20)}`;
}

/**
 * Проверка формата UUIDv7 (для тестов и дебага).
 * Не строгая — не проверяет вариант, только версию 7 и общий формат.
 */
export function isUuidV7(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
