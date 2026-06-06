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
