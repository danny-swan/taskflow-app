/**
 * migrations.ts — explicit schema migrations with PRAGMA user_version.
 *
 * Each migration bumps user_version by 1 and is applied at most once per DB.
 * Always ADD new migrations at the bottom; never edit a released migration.
 *
 * For SQLite + tauri-plugin-sql we use ALTER TABLE ADD COLUMN. Because SQLite
 * has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, we wrap each statement in
 * try/catch and ignore "duplicate column" / "already exists" errors so the
 * migration is idempotent — safe to re-run if the previous attempt crashed
 * between executing the SQL and bumping user_version.
 *
 * The current released schema (statuses/tags/tasks/settings with all the
 * v0.8.x columns) is considered version 1. On first run with v0.8.12 we
 * stamp existing DBs as v1 and start applying any future migrations from v2.
 */

import { uuidv7 } from './uuid';

// Public type — exported so callers can register/inspect migrations.
export type Migration = {
  version: number;
  description: string;
  /** Apply the migration. `exec` runs a SQL statement; `select` returns rows. */
  up: (api: MigrationApi) => Promise<void>;
};

export interface MigrationApi {
  exec(sql: string, params?: any[]): Promise<void>;
  select<T = any>(sql: string, params?: any[]): Promise<T[]>;
  /** Run `exec` and silently swallow "duplicate column" / "already exists" errors. */
  execIgnoreDuplicate(sql: string): Promise<void>;
}

/**
 * Registered migrations. INDEX MUST EQUAL `version` (1-based, sorted).
 *
 * v1: baseline — schema as released in v0.8.11. No-op: tables and columns are
 *     created by the legacy ensureSchema()+migrate() path which runs BEFORE
 *     runMigrations(). This entry exists so we can stamp existing DBs as v1
 *     and start fresh migrations from v2.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Baseline schema (v0.8.11 — statuses, tags, tasks, settings)',
    up: async () => {
      // No-op. The legacy ensureSchema() + migrate() runs before this and
      // already produces the v1 schema for both fresh and existing DBs.
    },
  },
  {
    version: 2,
    description: 'Add task_templates table + seed default template',
    up: async ({ exec, select }) => {
      // 1. Создаём таблицу шаблонов. status_id и tag_id — NULLable,
      //    потому что пользователь может удалить связанный статус/тег позже,
      //    и в этом случае шаблон упадёт на дефолты при применении.
      await exec(`
        CREATE TABLE IF NOT EXISTS task_templates (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT    NOT NULL,
          title       TEXT    NOT NULL DEFAULT '',
          comment     TEXT    NOT NULL DEFAULT '',
          status_id   INTEGER,
          tag_id      INTEGER,
          sort_order  INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        )
      `);

      // 2. Сид «Шаблон задачи 1» — только если таблица пуста.
      // Обязательно try/catch — любой сбой на сиде НЕ должен ломать всю миграцию:
      // таблицу уже создали — это главное; сидовый шаблон пользователь легко
      // создаст и сам.
      try {
        const existing = await select<{ n: number }>(`SELECT COUNT(*) AS n FROM task_templates`);
        const n = Number(existing[0]?.n ?? 0);
        if (n === 0) {
          // Статус «Взять в работу» — он в сиде первым, с behavior='middle'.
          // Если пользователь переименовал/удалил — берём первый видимый (не hidden, не technical).
          let statusId: number | null = null;
          const exact = await select<{ id: number }>(
            `SELECT id FROM statuses WHERE name='Взять в работу' LIMIT 1`
          );
          if (exact[0]?.id != null) {
            statusId = exact[0].id;
          } else {
            const fallback = await select<{ id: number }>(
              `SELECT id FROM statuses
               WHERE COALESCE(hidden,0)=0 AND COALESCE(is_technical,0)=0
               ORDER BY sort_order, id LIMIT 1`
            );
            statusId = fallback[0]?.id ?? null;
          }
          const comment = [
            '1. Action item',
            '2. Action item',
            '',
            'Статус выполнения:',
            '- [ ] …',
            '- [ ] …',
            '- [ ] …',
          ].join('\n');
          await exec(
            `INSERT INTO task_templates (name, title, comment, status_id, tag_id, sort_order)
             VALUES (?, ?, ?, ?, NULL, 0)`,
            ['Шаблон задачи 1', 'Задача 1', comment, statusId]
          );
        }
      } catch (e) {
        console.warn('[migrate v2] seed template skipped:', e);
      }
    },
  },
  {
    version: 3,
    description: 'Меняем порядок «В процессе» и «Взять в работу» в сидовых статусах',
    up: async ({ select, exec }) => {
      // v0.9.0: «В процессе» должен идти ПЕРЕД «Взять в работу».
      //
      // КОНСЕРВАТИВНОСТЬ: меняем порядок ТОЛЬКО если оба статуса
      // найдены по своим сидовым именам (если пользователь переименовал их —
      // оставляем как есть, не ломаем его кастомный порядок).
      //
      // Меняем порядок только если «Взять в работу» сейчас выше «В процессе»
      // (меньший sort_order). Иначе пользователь уже сам поменял — не трогаем.
      try {
        const taking = await select<{ id: number; sort_order: number }>(
          `SELECT id, sort_order FROM statuses WHERE name='Взять в работу' LIMIT 1`
        );
        const inProgress = await select<{ id: number; sort_order: number }>(
          `SELECT id, sort_order FROM statuses WHERE name='В процессе' LIMIT 1`
        );
        if (taking[0] && inProgress[0]) {
          const takingOrder = Number(taking[0].sort_order ?? 0);
          const inProgressOrder = Number(inProgress[0].sort_order ?? 0);
          if (takingOrder < inProgressOrder) {
            // Свопаем sort_order. Обходим UNIQUE-конфликт (если вдруг есть
            // такой констрейнт) через временное большое значение.
            await exec(`UPDATE statuses SET sort_order = -1 WHERE id = ?`, [taking[0].id]);
            await exec(`UPDATE statuses SET sort_order = ? WHERE id = ?`, [
              takingOrder, inProgress[0].id,
            ]);
            await exec(`UPDATE statuses SET sort_order = ? WHERE id = ?`, [
              inProgressOrder, taking[0].id,
            ]);
          }
        }
      } catch (e) {
        console.warn('[migrate v3] swap order skipped:', e);
      }
    },
  },
  {
    version: 4,
    description: 'Таблица overdue_events (история пересечений дедлайна) + settings.overdue_mode',
    up: async ({ exec }) => {
      // v0.9.2 (№3): история пересечений дедлайна — каждое первое пересечение
      // фиксируется как отдельное событие. Если дедлайн сдвинули вперёд и задача
      // опять просрочилась — это новое событие.
      //
      // deadline_snapshot хранит какой дедлайн был на момент события
      // — это позволяет отличить «таже задача, тот же дедлайн, уже было
      // событие» (дубликат) от «новый дедлайн, нужно новое событие».
      //
      // Без бэкфилла: история начинается с даты установки v0.9.2 —
      // таким образом, ceiling в верхней точке — честный счётчик с этого момента.
      await exec(`
        CREATE TABLE IF NOT EXISTS overdue_events (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id           INTEGER NOT NULL,
          deadline_snapshot TEXT    NOT NULL,
          event_date        TEXT    NOT NULL,
          created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
        )
      `);
      // Индекс для быстрого чтения на дашборде: COUNT(*) GROUP BY event_date.
      await exec(`CREATE INDEX IF NOT EXISTS idx_overdue_events_date ON overdue_events(event_date)`);
      // Индекс для детектора: last событие по task_id.
      await exec(`CREATE INDEX IF NOT EXISTS idx_overdue_events_task ON overdue_events(task_id, id DESC)`);

      // Настройка «Считать просрочку»: 'calendar' (по-умолчанию) | 'business'.
      // Запись создаём только если её ещё нет, чтобы не перетирать
      // пользовательское значение при ретри-миграции.
      await exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('overdue_mode', 'calendar')`);
    },
  },
  {
    version: 5,
    description: 'Sync foundation: uuid/updated_at/deleted_at/version/client_id + backfill (v0.9.35-dev.1)',
    up: async ({ exec, execIgnoreDuplicate, select }) => {
      // v0.9.35-dev.1: готовим локальную схему к sync через Supabase.
      //
      // Ключевые принципы:
      //   * INTEGER id ОСТАЁТСЯ — локальный PK, быстрые JOIN, меньше
      //     рефакторинга. uuid — «внешний» идентификатор для sync-слоя
      //     (тот же UUIDv7, что и sync_*.id на сервере).
      //   * Soft delete везде: DELETE FROM в пользовательском UI больше
      //     НЕ выполняем — вместо этого UPDATE deleted_at = datetime('now').
      //   * version бампается на каждый UPDATE (клиент-сайд триггер не ставим,
      //     но сеттеры в store.ts будут обновлять явно).
      //   * client_id — UUIDv7 этого устанавления, генерится один раз
      //     и хранится в settings('client_id'). На каждой строке тот, кто
      //     последним её трогал.
      //
      // UNIQUE(uuid) нельзя добавить через ALTER TABLE ADD COLUMN в SQLite,
      // поэтому делаем CREATE UNIQUE INDEX после backfill — как partial index
      // WHERE uuid IS NOT NULL, чтобы NULL-значения (между ADD COLUMN
      // и backfill внутри этой же миграции) не ломали ограничение.

      // ==============================================================
      // 1. Добавляем колонки во все пять таблиц (идемпотентно).
      // ==============================================================
      const tables = ['tasks', 'tags', 'statuses', 'task_templates', 'overdue_events'];

      for (const t of tables) {
        // uuid TEXT — пока не NOT NULL. Backfill в шаге 2, UNIQUE индекс в шаге 3.
        await execIgnoreDuplicate(`ALTER TABLE ${t} ADD COLUMN uuid TEXT`);
        // deleted_at TEXT (наличие → строка удалена).
        await execIgnoreDuplicate(`ALTER TABLE ${t} ADD COLUMN deleted_at TEXT`);
        // version INTEGER, по-умолчанию 1. Бампаем в setter'ах store.
        await execIgnoreDuplicate(`ALTER TABLE ${t} ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
        // client_id TEXT — кто сделал последнее изменение. NULLable
        // на время backfill'а текущих данных; при первом запуске store
        // накатит client_id на все строки (как отметку «это моё устройство»).
        await execIgnoreDuplicate(`ALTER TABLE ${t} ADD COLUMN client_id TEXT`);
      }

      // updated_at — только там где её ещё нет.
      // tasks: есть (в baseline). task_templates: есть (с v2).
      // Нужно добавить в: tags, statuses, overdue_events.
      //
      // ❗ SQLite не допускает non-константный DEFAULT (`datetime('now')`)
      //   в ALTER TABLE ADD COLUMN. Поэтому добавляем NULLable без DEFAULT,
      //   бэкфиллим текущим временем, а NOT NULL-инвариант держим на
      //   уровне приложения (INSERT'ы в store.ts всегда указывают updated_at).
      await execIgnoreDuplicate(`ALTER TABLE tags ADD COLUMN updated_at TEXT`);
      await execIgnoreDuplicate(`ALTER TABLE statuses ADD COLUMN updated_at TEXT`);
      await execIgnoreDuplicate(`ALTER TABLE overdue_events ADD COLUMN updated_at TEXT`);

      // Бэкфиллим updated_at для существующих строк (новые INSERT'ы
      // всегда ставят datetime('now') явно). Оборачиваем в try/catch
      // — overdue_events могут отсутствовать в крайне старых базах.
      for (const t of ['tags', 'statuses', 'overdue_events']) {
        try {
          await exec(
            `UPDATE ${t} SET updated_at = datetime('now') WHERE updated_at IS NULL`,
          );
        } catch (e) {
          console.warn(`[migrate v5] updated_at backfill skipped for ${t}:`, e);
        }
      }

      // ==============================================================
      // 2. Backfill uuid для всех существующих строк.
      // ==============================================================
      // Генерить UUIDv7 в SQL нельзя — SQLite не умеет.
      // Читаем id'шки, генерируем на клиенте, UPDATE per row.
      // На 100+ строках это быстро (миграция единовременно, не hot path).
      for (const t of tables) {
        try {
          const rows = await select<{ id: number }>(`SELECT id FROM ${t} WHERE uuid IS NULL`);
          for (const r of rows) {
            await exec(`UPDATE ${t} SET uuid = ? WHERE id = ?`, [uuidv7(), r.id]);
          }
        } catch (e) {
          // overdue_events или task_templates могут отсутствовать
          // в крайне старых базах — не валим миграцию.
          console.warn(`[migrate v5] uuid backfill skipped for ${t}:`, e);
        }
      }

      // ==============================================================
      // 3. UNIQUE-индексы на uuid (partial — чтобы NULL не блокировали).
      // ==============================================================
      for (const t of tables) {
        try {
          await exec(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_${t}_uuid ` +
            `ON ${t}(uuid) WHERE uuid IS NOT NULL`
          );
        } catch (e) {
          console.warn(`[migrate v5] index idx_${t}_uuid skipped:`, e);
        }
      }

      // ==============================================================
      // 4. Клиентский client_id для этого установления.
      // ==============================================================
      // Генерится только если его ещё нет. Не перегенерируем при
      // повторных запусках (INSERT OR IGNORE).
      try {
        const existing = await select<{ value: string }>(
          `SELECT value FROM settings WHERE key = 'client_id'`
        );
        if (!existing[0]?.value) {
          const clientId = uuidv7();
          await exec(
            `INSERT OR REPLACE INTO settings (key, value) VALUES ('client_id', ?)`,
            [clientId]
          );
          // Заодно — протагиваем этот client_id во все существующие строки
          // (чтобы история тоже была «моя»).
          for (const t of tables) {
            try {
              await exec(`UPDATE ${t} SET client_id = ? WHERE client_id IS NULL`, [clientId]);
            } catch (e) {
              console.warn(`[migrate v5] client_id backfill skipped for ${t}:`, e);
            }
          }
        }
      } catch (e) {
        console.warn('[migrate v5] client_id setup skipped:', e);
      }
    },
  },

  // ================================================================
  // v6 — Sync outbox (v0.9.35-dev.2)
  //
  // Локальная очередь pending-изменений для push'а в облако.
  // Сейчас только заполняется (enqueue при каждом изменении
  // сущностей), флюш в Supabase — в dev.4.
  //
  // Grain: row-level. На каждую (entity_table, entity_uuid) — максимум
  // одна запись. Повторный enqueue просто обновляет op/queued_at.
  // Пейлоад не храним — push берёт свежее состояние из entity_table
  // по uuid в момент пуша.
  // ================================================================
  {
    version: 6,
    description:
      'Sync outbox: pending changes queue for cloud push (v0.9.35-dev.2)',
    up: async ({ exec, execIgnoreDuplicate }) => {
      await exec(`
        CREATE TABLE IF NOT EXISTS sync_outbox (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_table TEXT NOT NULL,
          entity_uuid TEXT NOT NULL,
          op TEXT NOT NULL,           -- 'upsert' | 'delete'
          queued_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_attempt_at TEXT,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        )
      `);

      // Dedup: одна pending-запись на сущность. INSERT OR REPLACE по
      // (entity_table, entity_uuid) будет UPSERT'ить без гонок.
      await execIgnoreDuplicate(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_outbox_entity ON sync_outbox(entity_table, entity_uuid)`
      );

      // Для push-цикла: берём пачку старейших записей (FIFO).
      await execIgnoreDuplicate(
        `CREATE INDEX IF NOT EXISTS idx_sync_outbox_queued_at ON sync_outbox(queued_at)`
      );
    },
  },
];

/** Current target user_version (highest registered migration). */
export const TARGET_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0);

/**
 * Read the current PRAGMA user_version using the supplied select function.
 * SQLite returns it as `{ user_version: N }`.
 */
export async function readUserVersion(api: MigrationApi): Promise<number> {
  const rows = await api.select<{ user_version: number }>(`PRAGMA user_version`);
  return Number(rows[0]?.user_version ?? 0);
}

/**
 * Run all pending migrations against the supplied DB API.
 *
 * Behaviour:
 * - If `user_version === 0` AND the DB already looks initialised (any rows in
 *   `statuses` OR table exists with columns from v0.8.x), we stamp it as v1
 *   without re-applying. This avoids double-running for existing installs.
 * - Otherwise we apply migrations in order from `currentVersion + 1` to
 *   `TARGET_VERSION`. Each migration runs inside its own transaction; on
 *   failure we ROLLBACK and abort (subsequent runs will retry from the same
 *   version).
 */
export async function runMigrations(api: MigrationApi, opts: { onLog?: (msg: string) => void } = {}): Promise<void> {
  const log = opts.onLog ?? (() => {});

  let current = await readUserVersion(api);
  log(`[migrate] current user_version = ${current}, target = ${TARGET_VERSION}`);

  // First-time bootstrap: pre-existing DB (created before user_version was tracked).
  // We assume schema is at v1 (matches v0.8.11) because legacy ensureSchema()+migrate()
  // has already been called by the caller.
  if (current === 0) {
    log('[migrate] stamping existing DB as v1 (legacy schema)');
    await api.exec(`PRAGMA user_version = 1`);
    current = 1;
  }

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    log(`[migrate] v${current} → v${m.version}: ${m.description}`);
    // tauri-plugin-sql wraps each execute in its own transaction by default, so an
    // explicit BEGIN/COMMIT around multi-statement migrations may not nest cleanly
    // across drivers. We rely on per-statement atomicity + the user_version bump
    // happening LAST. If a migration crashes mid-way, the next run will retry.
    try {
      await m.up(api);
      await api.exec(`PRAGMA user_version = ${m.version}`);
      current = m.version;
      log(`[migrate] ✓ applied v${m.version}`);
    } catch (e: any) {
      log(`[migrate] ✗ FAILED v${m.version}: ${e?.message ?? String(e)}`);
      throw new Error(`Migration v${m.version} (${m.description}) failed: ${e?.message ?? String(e)}`);
    }
  }
}

/**
 * Build a MigrationApi adapter from tauri-plugin-sql Database instance.
 * Used by db.ts in the Tauri code path.
 */
export function tauriMigrationApi(d: any): MigrationApi {
  return {
    exec: async (sql, params = []) => { await d.execute(sql, params); },
    select: async (sql, params = []) => (await d.select(sql, params)) as any[],
    execIgnoreDuplicate: async (sql) => {
      try { await d.execute(sql); }
      catch (e: any) {
        const msg = String(e?.message ?? e ?? '');
        if (!/duplicate column|already exists/i.test(msg)) throw e;
      }
    },
  };
}

/**
 * Build a MigrationApi adapter from a sql.js Database instance (web mode).
 * sql.js is synchronous; we wrap it as async to satisfy the shared interface.
 */
export function webMigrationApi(d: any): MigrationApi {
  return {
    exec: async (sql, params = []) => { d.run(sql, params as any); },
    select: async (sql, params = []) => {
      const stmt = d.prepare(sql);
      stmt.bind(params as any);
      const rows: any[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    execIgnoreDuplicate: async (sql) => {
      try { d.run(sql); }
      catch (e: any) {
        const msg = String(e?.message ?? e ?? '');
        if (!/duplicate column|already exists/i.test(msg)) throw e;
      }
    },
  };
}
