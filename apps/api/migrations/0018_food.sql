-- Food: what was eaten, what is in the fridge, and the daily targets. An entry keeps its own
-- totals and its parts as JSON, and its photo as JSON pointing into R2 under `food/`. `food_media`
-- gets a row once a photo is fully uploaded. Additive.
CREATE TABLE IF NOT EXISTS food_entries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  eaten_at TEXT NOT NULL,
  serving TEXT NOT NULL DEFAULT '',
  calories REAL NOT NULL CHECK(calories >= 0),
  protein REAL NOT NULL CHECK(protein >= 0),
  carbs REAL NOT NULL CHECK(carbs >= 0),
  fat REAL NOT NULL CHECK(fat >= 0),
  parts TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL,
  barcode TEXT,
  photo TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_food_entries_date ON food_entries(date, eaten_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS fridge_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  icon TEXT NOT NULL DEFAULT '' CHECK(length(icon) <= 16),
  brand TEXT,
  barcode TEXT,
  source TEXT NOT NULL,
  purchase_id TEXT,
  added_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

-- One row, `daily`. A null column means no target for that number.
CREATE TABLE IF NOT EXISTS food_goals (
  id TEXT PRIMARY KEY,
  calories REAL,
  protein REAL,
  carbs REAL,
  fat REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS food_media (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size >= 0),
  created_at TEXT NOT NULL
);
