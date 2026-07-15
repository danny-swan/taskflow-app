// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright (c) 2026 Daniil Lebedev (danny-swan)
/**
 * push.ts — отправка локальных изменений в Supabase.
 *
 * Алгоритм:
 * 1. Читаем батч из sync_outbox (upto 50 старейших записей).
 * 2. Группируем по entity_table и op — так проще делать один запрос на
 *    группу upsert'ов и один на группу delete'ов.
 * 3. Для каждой группы формируем payload (маппер id→uuid через mappers.ts).
 * 4. Отправляем в Supabase через .upsert() (для op='upsert') или
 *    .update({deleted_at: now()}) (для op='delete' — soft delete).
 * 5. Успех → удаляем строки из outbox.
 *    Ошибка → attempt_count++, last_error, last_attempt_at.
 *    Если attempt_count >= MAX_ATTEMPTS — запись остаётся в outbox с ошибкой,
 *    но пропускается на следующих попытках (не блокирует другие записи).
 *
 * Retry: exponential backoff, макс 5 попыток. Между попытками одной строки —
 * пауза 1→2→4→8→16 секунд. Это управляется НЕ через setTimeout, а через
 * фильтр в SELECT: берём только те строки, у которых прошло достаточно
 * времени с last_attempt_at (соответственно attempt_count).
 */
import * as db from '../db';
import { supabase } from '../supabase';
import { logger } from '../logger';
import { getSpec, PUSH_ORDER, type TableSpec } from './mappers';

export const MAX_ATTEMPTS = 5;
export const BATCH_SIZE = 50;

/** Backoff-задержки в секундах для попыток 1..5. */
const BACKOFF_SECONDS = [0, 1, 2, 4, 8, 16];

/**
 * Проверяет, готова ли строка outbox к следующей попытке (прошло достаточно
 * времени с last_attempt_at). Первая попытка (attempt_count=0) — сразу.
 */
function isReadyForRetry(attemptCount: number, lastAttemptAt: string | null): boolean {
  if (attemptCount === 0) return true;
  if (!lastAttemptAt) return true;
  if (attemptCount >= MAX_ATTEMPTS) return false;
  const backoffSec = BACKOFF_SECONDS[Math.min(attemptCount, BACKOFF_SECONDS.length - 1)];
  const lastAttemptMs = new Date(lastAttemptAt).getTime();
  return Date.now() - lastAttemptMs >= backoffSec * 1000;
}

/**
 * Определяет, является ли ошибка от Supabase "permanent" — то есть
 * её бессмысленно ретраить. Смотрим на:
 *   - PostgREST/Postgres codes: 42501 (permission denied), 42P01 (undefined table),
 *     42703 (undefined column), 22P02 (invalid text),
 *     PGRST301 (JWT expired), PGRST116 (schema mismatch);
 *   - HTTP-маркеры в тексте: "401", "403", "404", "422";
 *   - RLS: "row-level security", "violates row-level security";
 *   - schema: "column ... does not exist", "does not exist";
 *   - malformed: "invalid input syntax".
 *
 * NB: 409 (conflict) и 429 (rate limit) — ТРАНЗИЕНТНЫЕ, ретраим.
 * 5xx / сеть — тоже транзиентные.
 *
 * NB: 23503 (foreign_key_violation) — ТРАНЗИЕНТНАЯ (не permanent). После
 * миграции 0030 workspace_id имеет FK на sync_workspaces(id): если child
 * (task/status/…) пушится раньше своего workspace (race в outbox), сервер
 * отклоняет его с 23503. PUSH_ORDER гарантирует parent-first, поэтому это
 * лечится ретраем — на следующей итерации workspace уже на сервере. См.
 * isForeignKeyViolation ниже и ADR 0005 «Последствия».
 */
export function isPermanentError(errorMsg: string): boolean {
  const m = errorMsg.toLowerCase();
  // Postgres SQLSTATE codes (23503 намеренно НЕ здесь — см. jsdoc / retry ниже).
  // 23502 (not-null) и 23514 (check) — permanent: строка не пройдёт валидацию
  // сервера ни на одной попытке (ретрай лишь жёг бы бюджет и держал гейт).
  if (/\b42501\b|\b42p01\b|\b42703\b|\b22p02\b|\b23502\b|\b23514\b/.test(m)) return true;
  // PostgREST codes
  if (/\bpgrst\d{3}\b/.test(m)) return true;
  // RLS
  if (m.includes('row-level security') || m.includes('row level security')) return true;
  // Schema / column
  if (m.includes('does not exist')) return true;
  if (m.includes('invalid input syntax')) return true;
  // Auth
  if (m.includes('jwt') && (m.includes('expired') || m.includes('invalid'))) return true;
  // Прямые HTTP-статусы (когда Supabase-js выкидывает голый fetch-error)
  if (/\b(401|403|404|422)\b/.test(m)) return true;
  // Mapper-ошибки (например task не имеет uuid) — permanent до overdue-цикла,
  // но мы хотим их ретраить (task может появиться). Не маркируем.
  return false;
}

/**
 * FK-violation (23503) — child пушится раньше своего workspace. Не ошибка UX:
 * PUSH_ORDER пушит workspace первым, а разъезд лечится ретраем. Логируем как
 * «ждём родительский workspace», не как error. Postgres шлёт 23503 +
 * "violates foreign key constraint"; ловим оба варианта текста.
 */
export function isForeignKeyViolation(errorMsg: string): boolean {
  const m = errorMsg.toLowerCase();
  return /\b23503\b/.test(m) || m.includes('foreign key constraint');
}

interface OutboxRow {
  id: number;
  entity_table: string;
  entity_uuid: string;
  op: 'upsert' | 'delete';
  queued_at: string;
  attempt_count: number;
  last_attempt_at: string | null;
  last_error: string | null;
}

/**
 * Читает batch готовых к push'у записей, сгруппированный по (table, op),
 * соблюдая PUSH_ORDER (parent'ы первыми) и фильтруя невалидные (нет spec'а
 * или превышен лимит попыток).
 */
function readReadyBatch(): { spec: TableSpec; op: 'upsert' | 'delete'; rows: OutboxRow[] }[] {
  // Bug A: parent-строки (workspaces, затем workspace_members) выбираем ПЕРВЫМИ,
  // чтобы поток из 50+ задач не вытеснял только что созданный ws за окно батча
  // (head-of-line starvation) — иначе child'ы вечно ловят FK 23503, а ws не
  // доезжает и гейт инвайтов висит. Внутри группы порядок по id сохраняется.
  const all = db.all<OutboxRow>(
    `SELECT id, entity_table, entity_uuid, op, queued_at, attempt_count, last_attempt_at, last_error
       FROM sync_outbox
      ORDER BY CASE entity_table
                 WHEN 'workspaces' THEN 0
                 WHEN 'workspace_members' THEN 1
                 ELSE 2 END, id
      LIMIT ?`,
    [BATCH_SIZE],
  );
  const groups = new Map<string, { spec: TableSpec; op: 'upsert' | 'delete'; rows: OutboxRow[] }>();
  for (const r of all) {
    if (!isReadyForRetry(r.attempt_count, r.last_attempt_at)) continue;
    const spec = getSpec(r.entity_table);
    if (!spec) {
      // Неизвестная таблица (например, overdue_events на dev.4) — пропускаем.
      continue;
    }
    const key = `${r.entity_table}:${r.op}`;
    if (!groups.has(key)) groups.set(key, { spec, op: r.op, rows: [] });
    groups.get(key)!.rows.push(r);
  }
  // Сортируем группы по PUSH_ORDER (parent'ы первыми).
  const ordered: { spec: TableSpec; op: 'upsert' | 'delete'; rows: OutboxRow[] }[] = [];
  for (const spec of PUSH_ORDER) {
    for (const op of ['upsert', 'delete'] as const) {
      const g = groups.get(`${spec.outbox}:${op}`);
      if (g) ordered.push(g);
    }
  }
  return ordered;
}

/** Помечает успех — удаляет строки из outbox. */
function markSuccess(ids: number[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.run(`DELETE FROM sync_outbox WHERE id IN (${placeholders})`, ids);
}

/**
 * Помечает ошибку. Если ошибка permanent — сразу attempt_count=MAX_ATTEMPTS
 * (больше в батч не попадёт). Иначе — attempt_count++.
 */
function markFailure(ids: number[], errorMsg: string): void {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const placeholders = ids.map(() => '?').join(',');
  if (isPermanentError(errorMsg)) {
    db.run(
      `UPDATE sync_outbox
       SET attempt_count = ?,
           last_attempt_at = ?,
           last_error = ?
       WHERE id IN (${placeholders})`,
      [MAX_ATTEMPTS, now, `[permanent] ${errorMsg}`, ...ids],
    );
    return;
  }
  db.run(
    `UPDATE sync_outbox
     SET attempt_count = attempt_count + 1,
         last_attempt_at = ?,
         last_error = ?
     WHERE id IN (${placeholders})`,
    [now, errorMsg, ...ids],
  );
}

export interface PushResult {
  /** Сколько строк успешно отправлено. */
  pushed: number;
  /** Сколько строк упало (будут ретрайнуты). */
  failed: number;
  /** Сколько строк пропущено из-за исчерпанных попыток или невалидности. */
  skipped: number;
  /** Первая ошибка (для отображения в UI). */
  firstError: string | null;
}

/**
 * Основная функция: пушит одну итерацию батча. Возвращает статистику.
 * Не спит и не ретраит внутри — вызывающий (orchestrator) сам решает,
 * когда позвать снова.
 */
export async function pushBatch(userId: string, clientId: string): Promise<PushResult> {
  const groups = readReadyBatch();
  const result: PushResult = { pushed: 0, failed: 0, skipped: 0, firstError: null };
  if (groups.length === 0) return result;

  for (const g of groups) {
    // Собираем payload'ы. Для op='delete' достаточно послать deleted_at + uuid,
    // но проще: перечитать локальную строку (там deleted_at уже стоит) и
    // отправить полный payload через upsert. Это гарантирует, что удалённая
    // строка попадёт даже если её не было в облаке.
    const payloads: any[] = [];
    const validIds: number[] = [];
    for (const r of g.rows) {
      const localRow = g.spec.fetchLocal(r.entity_uuid);
      if (!localRow) {
        // Локальная строка исчезла (hard delete?) — не можем отправить, скипаем.
        result.skipped++;
        db.run('DELETE FROM sync_outbox WHERE id=?', [r.id]);
        continue;
      }
      try {
        payloads.push(g.spec.toCloud(localRow, userId, clientId));
        validIds.push(r.id);
      } catch (e) {
        // Маппер не смог построить payload (например, отсутствует parent uuid).
        // Регистрируем как ошибку.
        const msg = e instanceof Error ? e.message : String(e);
        markFailure([r.id], `mapper: ${msg}`);
        result.failed++;
        if (!result.firstError) result.firstError = msg;
      }
    }

    if (payloads.length === 0) continue;

    // Отправка. Для upsert и delete используем один и тот же upsert — потому
    // что при soft delete локальная строка уже имеет deleted_at, а payload
    // формируется из локальной строки. Идентично для op='upsert' и op='delete'.
    try {
      const { error } = await supabase
        .from(g.spec.cloud)
        .upsert(payloads, { onConflict: g.spec.onConflict ?? 'id' });
      if (error) throw new Error(error.message);
      markSuccess(validIds);
      result.pushed += validIds.length;
      logger.info(`[sync/push] ${g.spec.cloud} (${g.op}): ${validIds.length} rows OK`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      markFailure(validIds, msg);
      result.failed += validIds.length;
      if (!result.firstError) result.firstError = msg;
      if (isForeignKeyViolation(msg)) {
        // Транзиентно: workspace ещё не долетел. Ретрай (см. markFailure/backoff).
        logger.info(
          `[sync/push] ${g.spec.cloud} (${g.op}): waiting for parent workspace to sync (FK 23503), will retry`,
        );
      } else {
        logger.warn(`[sync/push] ${g.spec.cloud} (${g.op}) failed:`, msg);
      }
    }
  }

  return result;
}

/**
 * Полный push-цикл: гоняет pushBatch в цикле, пока в outbox есть готовые
 * строки И не встретилась общая ошибка. Ограничение по итерациям (10),
 * чтобы не зациклиться при странных состояниях.
 */
export async function pushAll(userId: string, clientId: string): Promise<PushResult> {
  const total: PushResult = { pushed: 0, failed: 0, skipped: 0, firstError: null };
  for (let i = 0; i < 10; i++) {
    const r = await pushBatch(userId, clientId);
    total.pushed += r.pushed;
    total.failed += r.failed;
    total.skipped += r.skipped;
    if (!total.firstError && r.firstError) total.firstError = r.firstError;
    // Если ничего не отправилось И ничего не упало — outbox пуст или всё
    // в backoff'е. Выходим.
    if (r.pushed === 0 && r.failed === 0 && r.skipped === 0) break;
    // Если что-то упало — выходим, чтобы не долбить сервер.
    if (r.failed > 0) break;
  }
  return total;
}

// Экспорт для тестов — чтобы можно было проверять внутреннюю логику.
export const _internals = {
  isReadyForRetry,
  isPermanentError,
  isForeignKeyViolation,
  readReadyBatch,
  markSuccess,
  markFailure,
  BACKOFF_SECONDS,
};
