import type { LocalDatabase } from './types'

/**
 * Local migrations are the phone's own concern. The server owns the remote schema, so these
 * statements only have to describe what this device stores.
 */
export const LOCAL_MIGRATIONS: readonly string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      opening_balance_cents INTEGER NOT NULL,
      opening_date TEXT NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      icon TEXT NOT NULL,
      color TEXT NOT NULL,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      account_id TEXT NOT NULL,
      destination_account_id TEXT,
      category_id TEXT,
      amount_cents INTEGER NOT NULL,
      date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      merchant TEXT NOT NULL,
      purchase_date TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      subtotal_cents INTEGER NOT NULL,
      discount_cents INTEGER NOT NULL,
      tax_cents INTEGER NOT NULL,
      fees_cents INTEGER NOT NULL,
      total_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT,
      items_loaded INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS receipt_items (
      id TEXT PRIMARY KEY,
      purchase_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price_cents INTEGER,
      gross_price_cents INTEGER NOT NULL,
      discount_cents INTEGER NOT NULL,
      line_total_cents INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY,
      month TEXT NOT NULL UNIQUE,
      planned_income_cents INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS budget_allocations (
      id TEXT PRIMARY KEY,
      budget_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      amount_cents INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS outbox (
      operation_id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      expected_revision INTEGER,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      server_record TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS sync_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      dataset_id TEXT NOT NULL,
      server_sequence INTEGER NOT NULL DEFAULT 0,
      bootstrapped_at TEXT,
      last_synced_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_local_transactions_feed
      ON transactions(date DESC, created_at DESC, id DESC) WHERE deleted_at IS NULL`,
    'CREATE INDEX IF NOT EXISTS idx_local_purchases_transaction ON purchases(transaction_id)',
    'CREATE INDEX IF NOT EXISTS idx_local_receipt_items_purchase ON receipt_items(purchase_id, position)',
    'CREATE INDEX IF NOT EXISTS idx_local_outbox_created ON outbox(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_local_outbox_entity ON outbox(entity, entity_id)'
  ],
  [
    'ALTER TABLE sync_state ADD COLUMN bootstrap_version INTEGER NOT NULL DEFAULT 0',
    `CREATE INDEX IF NOT EXISTS idx_local_transactions_account
      ON transactions(account_id) WHERE deleted_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_local_transactions_destination
      ON transactions(destination_account_id) WHERE deleted_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_local_transactions_category
      ON transactions(category_id) WHERE deleted_at IS NULL`,
    'CREATE INDEX IF NOT EXISTS idx_local_budget_allocations_budget ON budget_allocations(budget_id)'
  ],
  [
    `CREATE TABLE IF NOT EXISTS gym_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS gym_exercises (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category_id TEXT NOT NULL,
      type TEXT NOT NULL,
      weight_unit TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS gym_sets (
      id TEXT PRIMARY KEY,
      exercise_id TEXT NOT NULL,
      date TEXT NOT NULL,
      position INTEGER NOT NULL,
      weight REAL,
      weight_unit TEXT,
      reps INTEGER,
      distance REAL,
      distance_unit TEXT,
      duration_seconds INTEGER,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS gym_workouts (
      id TEXT PRIMARY KEY,
      exercise_order TEXT NOT NULL DEFAULT '[]',
      supersets TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    )`,
    'CREATE INDEX IF NOT EXISTS idx_local_gym_exercises_category ON gym_exercises(category_id) WHERE deleted_at IS NULL',
    'CREATE INDEX IF NOT EXISTS idx_local_gym_sets_date ON gym_sets(date, exercise_id, position) WHERE deleted_at IS NULL',
    'CREATE INDEX IF NOT EXISTS idx_local_gym_sets_exercise ON gym_sets(exercise_id, date) WHERE deleted_at IS NULL'
  ],
  [
    `CREATE TABLE IF NOT EXISTS mood_entries (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      mood INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    )`
  ],
  [
    `CREATE TABLE IF NOT EXISTS study_assignments (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      course TEXT,
      due_at TEXT,
      due_date TEXT,
      url TEXT,
      description TEXT NOT NULL DEFAULT '',
      done_at TEXT,
      done_pending INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS study_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      fetched_at TEXT
    )`
  ],
  [
    `CREATE INDEX IF NOT EXISTS idx_local_purchases_feed
      ON purchases(purchase_date DESC, created_at DESC, id DESC) WHERE deleted_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_local_gym_sets_exercise_feed
      ON gym_sets(exercise_id, date DESC, position, created_at, id) WHERE deleted_at IS NULL`
  ],
  [
    `CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      kind TEXT NOT NULL,
      start_date TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS habit_entries (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL,
      date TEXT NOT NULL,
      kind TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT
    )`,
    'CREATE INDEX IF NOT EXISTS idx_local_habit_entries_habit ON habit_entries(habit_id, date) WHERE deleted_at IS NULL'
  ],
  [
    "ALTER TABLE habits ADD COLUMN target INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE habits ADD COLUMN period TEXT NOT NULL DEFAULT 'day'",
    'ALTER TABLE habits ADD COLUMN started_at TEXT',
    'ALTER TABLE habit_entries ADD COLUMN logged_at TEXT'
  ],
  [
    `CREATE TABLE IF NOT EXISTS health_days (
      date TEXT PRIMARY KEY,
      steps INTEGER,
      distance_m REAL,
      calories_kcal REAL,
      fat_burn_minutes INTEGER,
      cardio_minutes INTEGER,
      peak_minutes INTEGER,
      resting_hr INTEGER,
      hrv_ms REAL,
      hr_min REAL,
      hr_avg REAL,
      hr_max REAL,
      weight_kg REAL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS health_sleeps (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      start_local TEXT NOT NULL,
      end_local TEXT NOT NULL,
      minutes_asleep INTEGER NOT NULL,
      minutes_awake INTEGER NOT NULL,
      minutes_in_bed INTEGER NOT NULL,
      deep_minutes INTEGER,
      light_minutes INTEGER,
      rem_minutes INTEGER,
      nap INTEGER NOT NULL DEFAULT 0,
      stages TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    )`,
    'CREATE INDEX IF NOT EXISTS idx_local_health_sleeps_date ON health_sleeps(date)',
    `CREATE TABLE IF NOT EXISTS health_heart (
      date TEXT PRIMARY KEY,
      points TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS health_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      connection TEXT,
      server_time TEXT,
      fetched_at TEXT
    )`
  ]
]

export async function migrate(db: LocalDatabase): Promise<number> {
  const rows = await db.all<{ user_version: number }>('PRAGMA user_version')
  const version = rows[0]?.user_version ?? 0
  for (let index = version; index < LOCAL_MIGRATIONS.length; index += 1) {
    await db.transaction(async (tx) => {
      for (const statement of LOCAL_MIGRATIONS[index]) await tx.run(statement)
    })
    await db.run(`PRAGMA user_version = ${index + 1}`)
  }
  return LOCAL_MIGRATIONS.length
}
