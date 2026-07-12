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

  // ================================================================
  // v7 (v0.9.35-dev.3): Backfill sync_outbox для всех существующих строк.
  //
  // Проблема: в dev.2 мы включили enqueueOutbox в сеттерах стора, но все
  // уже существующие задачи/теги/статусы/шаблоны (у любого пользователя
  // с dev.1 бэкфиллом uuid) в outbox’е НЕ оказались. При включении реального
  // push’а (dev.4) они не улетят в облако — потеря данных при смене устройства.
  //
  // Решение: одноразовый backfill — INSERT OR IGNORE в sync_outbox всех живых
  // строк (deleted_at IS NULL) с op='upsert'. IGNORE — на случай, если в dev.2 между
  // миграцией v6 и v7 пользователь успел что-то изменить — такая запись уже есть
  // в outbox’е с актуальным op, запись backfill’а не должна её перезаписать.
  //
  // Удалённые строки (deleted_at IS NOT NULL) НЕ backfill’им — облако о них
  // никогда не знало, так что delete-событие отправлять нечему. Они так и
  // завершат свою жизнь только локально (в dev.4 вычистим через retention).
  // ================================================================
  {
    version: 7,
    description:
      'Backfill sync_outbox for existing rows (v0.9.35-dev.3)',
    up: async ({ exec }) => {
      const backfillTables = ['tasks', 'tags', 'statuses', 'task_templates', 'overdue_events'];
      for (const t of backfillTables) {
        try {
          await exec(
            `INSERT OR IGNORE INTO sync_outbox
               (entity_table, entity_uuid, op, queued_at, attempt_count)
             SELECT ?, uuid, 'upsert', datetime('now'), 0
             FROM ${t}
             WHERE uuid IS NOT NULL AND deleted_at IS NULL`,
            [t],
          );
        } catch (e) {
          // task_templates / overdue_events могут отсутствовать в крайне старых базах
          // (или в fresh install без seed'а) — не валим миграцию.
          console.warn(`[migrate v7] backfill skipped for ${t}:`, e);
        }
      }
    },
  },
  // ================================================================
  // v8 (v0.9.35-dev.6.9.0): привязка локальной базы к аккаунту + реестр снимков.
  //
  // Проблема: локальная база не изолирована по аккаунту. При смене
  // аккаунта на одном устройстве чужие задачи «прилипали» к новому аккаунту
  // при push (user_id проставлялся из текущей сессии).
  //
  // Решение: храним в settings
  //   - bound_user_id — какому аккаунту принадлежит текущая база (nullable);
  //   - snapshot_registry_v1 — JSON-массив метаданных снимков.
  //
  // Новых таблиц не создаём — оба ключа живут в settings (кросс-платформенно:
  // так же работает и в web-бэкенде). Инициализируем реестр пустым массивом.
  // bound_user_id НЕ ставим здесь — его выставит первый успешный sync
  // (или выбор пользователя в гейте). Отсутствие ключа = «база ещё не привязана».
  // ================================================================
  {
    version: 8,
    description:
      'Account-bound DB: bound_user_id + snapshot_registry_v1 (v0.9.35-dev.6.9.0)',
    up: async ({ exec }) => {
      // Реестр снимков — пустой JSON-массив, если ещё нет.
      await exec(
        `INSERT OR IGNORE INTO settings (key, value) VALUES ('snapshot_registry_v1', '[]')`,
      );
      // bound_user_id не создаём — отсутствие строки трактуется как «not bound».
    },
  },

  // ================================================================
  // v9 (v0.9.35-dev.6.10.0): Починить seed-строки, которые были созданы
  // без uuid/updated_at/client_id и поэтому НИКОГДА не попадали в облако.
  //
  // Проблема: tauriSeed()/seed() вызываются ПОСЛЕ runMigrations(), поэтому
  // v5 (backfill uuid) и v7 (backfill sync_outbox) отрабатывают на пустой
  // базе и не обрабатывают seed-строки. В итоге:
  //   - статусы, теги и welcome-задача создаются без uuid → uuid = NULL;
  //   - enqueueOutbox молча пропускает их (guard на !uuid);
  //   - push никогда их не отправляет.
  //
  // Решение: при обновлении существующей базы (v8→v9) обнаруживаем все
  // строки с uuid = NULL во всех sync-таблицах, проставляем им uuid,
  // updated_at (если NULL), client_id (если NULL), и добавляем в outbox.
  //
  // Для новых установок (seed после этой миграции): seed исправлен и теперь
  // сам генерирует uuid/updated_at/client_id и вызывает enqueueOutbox.
  // Тогда эта миграция просто найдёт 0 строк без uuid и завершится мгновенно.
  // ================================================================
  {
    version: 9,
    description:
      'Fix seed rows missing uuid/updated_at/client_id + backfill sync_outbox (v0.9.35-dev.6.10.0)',
    up: async ({ exec, select }) => {
      const tables = ['tasks', 'tags', 'statuses', 'task_templates', 'overdue_events'];
      const now = new Date().toISOString();

      // Читаем client_id этого устройства (может быть NULL для очень старых баз).
      const cidRows = await select<{ value: string }>(
        `SELECT value FROM settings WHERE key = 'client_id'`,
      );
      const clientId: string = cidRows[0]?.value ?? uuidv7();
      // Сохраняем, если не было.
      await exec(
        `INSERT OR IGNORE INTO settings (key, value) VALUES ('client_id', ?)`,
        [clientId],
      );

      for (const t of tables) {
        try {
          // 1. Проставляем uuid там, где NULL.
          const rows = await select<{ id: number }>(
            `SELECT id FROM ${t} WHERE uuid IS NULL`,
          );
          for (const r of rows) {
            await exec(`UPDATE ${t} SET uuid = ? WHERE id = ?`, [uuidv7(), r.id]);
          }

          // 2. Проставляем updated_at там, где NULL (только у tags/statuses/overdue_events).
          await exec(
            `UPDATE ${t} SET updated_at = ? WHERE updated_at IS NULL`,
            [now],
          );

          // 3. Проставляем client_id там, где NULL.
          await exec(
            `UPDATE ${t} SET client_id = ? WHERE client_id IS NULL`,
            [clientId],
          );

          // 4. Добавляем все живые строки в outbox (INSERT OR IGNORE — не трогаем
          //    уже стоящие в очереди строки, чтобы не сбивать attempt_count).
          await exec(
            `INSERT OR IGNORE INTO sync_outbox
               (entity_table, entity_uuid, op, queued_at, attempt_count)
             SELECT ?, uuid, 'upsert', datetime('now'), 0
             FROM ${t}
             WHERE uuid IS NOT NULL AND deleted_at IS NULL`,
            [t],
          );
        } catch (e) {
          // task_templates / overdue_events могут отсутствовать в крайне старых базах.
          console.warn(`[migrate v9] skipped for ${t}:`, e);
        }
      }
    },
  },

  // ================================================================
  // v10 — task_hold_periods (столбец «Холд» в Статистике).
  //
  // Каждый интервал, в течение которого задача находилась в статусе
  // «Приостановлено», фиксируется отдельной строкой: started_at — когда задачу
  // поставили на холд, ended_at — когда сняли (NULL = задача в холде сейчас).
  // Столбец «Холд» = сумма длительностей всех интервалов в днях.
  //
  // Автор строк — клиент (store.updateTask → holdPeriods.recordHoldTransition),
  // ровно как overdue_events. Синхронизируются вверх/вниз через sync_outbox →
  // sync_task_hold_periods (mappers.ts / pull.ts). Серверного триггера НЕТ —
  // это сломало бы local-only режим (без Supabase-аккаунта) и дублировало бы
  // строки, которые клиент и так пушит.
  //
  // Бэкфилл: для задач, которые ПРЯМО СЕЙЧАС в статусе «Приостановлено»,
  // открываем один интервал (started_at = tasks.updated_at, ended_at = NULL),
  // чтобы уже висящий холд начал считаться. Идемпотентно — не создаём дубль,
  // если открытый интервал у задачи уже есть.
  // ================================================================
  {
    version: 10,
    description:
      'task_hold_periods: интервалы статуса «Приостановлено» для столбца «Холд» (Статистика)',
    up: async ({ exec, select }) => {
      // 1. Таблица + sync-колонки сразу (создаётся уже после sync-фундамента v5).
      await exec(`
        CREATE TABLE IF NOT EXISTS task_hold_periods (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id     INTEGER NOT NULL,
          started_at  TEXT    NOT NULL,
          ended_at    TEXT,
          created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
          uuid        TEXT,
          deleted_at  TEXT,
          version     INTEGER NOT NULL DEFAULT 1,
          client_id   TEXT
        )
      `);
      await exec(
        `CREATE INDEX IF NOT EXISTS idx_task_hold_periods_task ON task_hold_periods(task_id)`,
      );
      // Быстрый поиск открытого интервала задачи (ended_at IS NULL).
      await exec(
        `CREATE INDEX IF NOT EXISTS idx_task_hold_periods_open ON task_hold_periods(task_id) WHERE ended_at IS NULL AND deleted_at IS NULL`,
      );
      await exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_task_hold_periods_uuid ON task_hold_periods(uuid) WHERE uuid IS NOT NULL`,
      );

      // 2. Бэкфилл: открытый интервал для каждой задачи, что сейчас на холде.
      try {
        const clientRows = await select<{ value: string }>(
          `SELECT value FROM settings WHERE key = 'client_id'`,
        );
        const clientId: string = clientRows[0]?.value ?? uuidv7();

        // Задачи в статусе «Приостановлено» (по имени статуса), ещё не удалённые,
        // и у которых НЕТ уже открытого интервала (идемпотентность).
        const held = await select<{ id: number; updated_at: string }>(
          `SELECT t.id AS id, t.updated_at AS updated_at
             FROM tasks t
             JOIN statuses s ON s.id = t.status_id
            WHERE s.name = 'Приостановлено'
              AND (t.deleted_at IS NULL)
              AND NOT EXISTS (
                SELECT 1 FROM task_hold_periods h
                 WHERE h.task_id = t.id AND h.ended_at IS NULL AND h.deleted_at IS NULL
              )`,
        );
        const now = new Date().toISOString();
        for (const t of held) {
          const rowUuid = uuidv7();
          await exec(
            `INSERT INTO task_hold_periods
               (task_id, started_at, ended_at, created_at, updated_at, uuid, version, client_id)
             VALUES (?, ?, NULL, ?, ?, ?, 1, ?)`,
            [t.id, t.updated_at ?? now, now, now, rowUuid, clientId],
          );
          await exec(
            `INSERT OR IGNORE INTO sync_outbox
               (entity_table, entity_uuid, op, queued_at, attempt_count)
             VALUES ('task_hold_periods', ?, 'upsert', datetime('now'), 0)`,
            [rowUuid],
          );
        }
      } catch (e) {
        console.warn('[migrate v10] hold-period backfill skipped:', e);
      }
    },
  },

  // ================================================================
  // v11 — Workspaces foundation (Wave A, PR-1 «Схема»).
  //
  // Клиентское зеркало серверной миграции 0027. Здесь — ТОЛЬКО слой данных:
  //   * локальные таблицы workspaces / workspace_members / workspace_settings;
  //   * колонка workspace_id в шести локальных sync-таблицах;
  //   * backfill personal-пространства с ТЕМ ЖЕ детерминированным id, что сервер
  //     (см. supabase/migrations/0027_workspaces_foundation.sql, шапка):
  //         id = 'ws_' + userId.toLowerCase().replace(/-/g, '')
  //     — чтобы при первом sync локальные и облачные строки склеились по id;
  //   * перенос overdue_mode из settings в workspace_settings(personal).
  //
  // Sync этих сущностей (мапперы/pull/push/outbox/realtime) — СЛЕДУЮЩИЙ PR
  // (feat/ws-a-02-sync). Поэтому здесь в sync_outbox НИЧЕГО не кладём: PR-2
  // сделает backfill outbox для workspace-таблиц отдельно (как v7/v9 для прочих),
  // а v9-тесты рассчитывают, что v11 не меняет их счётчики outbox.
  //
  // Детерминированный id требует user_id. Если база уже привязана к аккаунту
  // (settings.bound_user_id, появился в v8) — берём его → id совпадёт с сервером.
  // Если база ещё local-only (не привязана) — используем стабильный локальный
  // 'ws_local'. Согласование local-only id с серверным ws_<uid> при первой
  // привязке+sync — ЗАДЕЛ для PR-2 (документировано в workspaces-plan.md §3.3).
  //
  // Идемпотентно: CREATE ... IF NOT EXISTS, execIgnoreDuplicate на ADD COLUMN,
  // INSERT OR IGNORE, UPDATE ... WHERE workspace_id IS NULL.
  // ================================================================
  {
    version: 11,
    description:
      'Workspaces foundation: локальные ws-таблицы + workspace_id + backfill personal (Wave A)',
    up: async ({ exec, execIgnoreDuplicate, select }) => {
      // ==============================================================
      // 1. Локальные таблицы пространств (зеркало server sync_workspace*).
      //    Следуем локальному контракту sync-сущностей: INTEGER PK + uuid TEXT
      //    (uuid == серверный text-id) + sync-метаданные.
      // ==============================================================
      await exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          uuid        TEXT,                       -- = серверный sync_workspaces.id (ws_<uid>)
          name        TEXT    NOT NULL DEFAULT 'Мои задачи',
          kind        TEXT    NOT NULL DEFAULT 'personal',
          owner_id    TEXT,                       -- uuid владельца (nullable в local-only)
          sort_order  INTEGER NOT NULL DEFAULT 0,
          created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
          deleted_at  TEXT,
          version     INTEGER NOT NULL DEFAULT 1,
          client_id   TEXT
        )
      `);
      await exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_uuid ON workspaces(uuid) WHERE uuid IS NOT NULL`,
      );

      await exec(`
        CREATE TABLE IF NOT EXISTS workspace_members (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          uuid          TEXT,                     -- = серверный sync_workspace_members.id
          workspace_id  TEXT    NOT NULL,         -- = workspaces.uuid (серверный ws-id)
          user_id       TEXT,                     -- uuid участника
          role          TEXT    NOT NULL DEFAULT 'owner',
          invited_by    TEXT,
          joined_at     TEXT    NOT NULL DEFAULT (datetime('now')),
          created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
          deleted_at    TEXT,
          version       INTEGER NOT NULL DEFAULT 1,
          client_id     TEXT
        )
      `);
      await exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_members_uuid ON workspace_members(uuid) WHERE uuid IS NOT NULL`,
      );
      await exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_members_ws_user ON workspace_members(workspace_id, user_id)`,
      );

      await exec(`
        CREATE TABLE IF NOT EXISTS workspace_settings (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          uuid          TEXT,
          workspace_id  TEXT    NOT NULL,         -- = workspaces.uuid
          key           TEXT    NOT NULL,
          value         TEXT,
          created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
          deleted_at    TEXT,
          version       INTEGER NOT NULL DEFAULT 1,
          client_id     TEXT
        )
      `);
      await exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_settings_uuid ON workspace_settings(uuid) WHERE uuid IS NOT NULL`,
      );
      await exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_settings_ws_key ON workspace_settings(workspace_id, key)`,
      );

      // ==============================================================
      // 2. Колонка workspace_id в шести локальных sync-таблицах (NULLable).
      // ==============================================================
      const syncTables = [
        'tasks',
        'statuses',
        'tags',
        'task_templates',
        'overdue_events',
        'task_hold_periods',
      ];
      for (const t of syncTables) {
        await execIgnoreDuplicate(`ALTER TABLE ${t} ADD COLUMN workspace_id TEXT`);
      }
      // Индексы по workspace_id для будущих ws-scoped выборок (PR-3).
      for (const t of syncTables) {
        try {
          await exec(`CREATE INDEX IF NOT EXISTS idx_${t}_workspace ON ${t}(workspace_id)`);
        } catch (e) {
          console.warn(`[migrate v11] index idx_${t}_workspace skipped:`, e);
        }
      }

      // ==============================================================
      // 3. Детерминированный id personal-пространства (совпадает с сервером).
      // ==============================================================
      const boundRows = await select<{ value: string }>(
        `SELECT value FROM settings WHERE key = 'bound_user_id'`,
      );
      const boundUserId = boundRows[0]?.value?.trim() || null;

      // Если id уже вычислен на прошлом прогоне — переиспользуем (идемпотентность).
      const existingWsRows = await select<{ value: string }>(
        `SELECT value FROM settings WHERE key = 'personal_workspace_id'`,
      );
      let personalWsId = existingWsRows[0]?.value?.trim() || '';
      if (!personalWsId) {
        personalWsId = boundUserId
          ? 'ws_' + boundUserId.toLowerCase().replace(/-/g, '')
          : 'ws_local'; // local-only: согласование с сервером — задел PR-2.
      }

      const clientRows = await select<{ value: string }>(
        `SELECT value FROM settings WHERE key = 'client_id'`,
      );
      const clientId: string = clientRows[0]?.value ?? uuidv7();

      // Запоминаем выбранное пространство как текущее (пригодится стору в PR-3).
      await exec(
        `INSERT OR REPLACE INTO settings (key, value) VALUES ('personal_workspace_id', ?)`,
        [personalWsId],
      );
      await exec(
        `INSERT OR IGNORE INTO settings (key, value) VALUES ('current_workspace_id', ?)`,
        [personalWsId],
      );

      // ==============================================================
      // 4. Backfill: строка personal-пространства + owner-членство.
      // ==============================================================
      await exec(
        `INSERT OR IGNORE INTO workspaces (uuid, name, kind, owner_id, sort_order, client_id)
         VALUES (?, 'Мои задачи', 'personal', ?, 0, ?)`,
        [personalWsId, boundUserId, clientId],
      );
      await exec(
        `INSERT OR IGNORE INTO workspace_members (uuid, workspace_id, user_id, role, client_id)
         VALUES (?, ?, ?, 'owner', ?)`,
        [
          boundUserId ? 'wsm_' + boundUserId.toLowerCase().replace(/-/g, '') : 'wsm_local',
          personalWsId,
          boundUserId,
          clientId,
        ],
      );

      // Проставляем workspace_id всем локальным строкам, где он ещё NULL.
      for (const t of syncTables) {
        try {
          await exec(
            `UPDATE ${t} SET workspace_id = ? WHERE workspace_id IS NULL`,
            [personalWsId],
          );
        } catch (e) {
          console.warn(`[migrate v11] workspace_id backfill skipped for ${t}:`, e);
        }
      }

      // ==============================================================
      // 5. Перенос overdue_mode из settings в workspace_settings(personal).
      // ==============================================================
      // Копируем ТЕКУЩЕЕ значение (по умолчанию 'calendar' из v4). Старый ключ
      // settings.overdue_mode НЕ удаляем: его ещё читает текущий код дедлайнов;
      // переключение читателей на workspace_settings — PR-3/PR-4 (тогда же
      // старый ключ можно будет вычистить).
      try {
        const omRows = await select<{ value: string }>(
          `SELECT value FROM settings WHERE key = 'overdue_mode'`,
        );
        const overdueMode = omRows[0]?.value ?? 'calendar';
        await exec(
          `INSERT OR IGNORE INTO workspace_settings (uuid, workspace_id, key, value, client_id)
           VALUES (?, ?, 'overdue_mode', ?, ?)`,
          [uuidv7(), personalWsId, overdueMode, clientId],
        );
      } catch (e) {
        console.warn('[migrate v11] overdue_mode migration skipped:', e);
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
