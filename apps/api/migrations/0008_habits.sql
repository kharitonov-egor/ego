-- Habits: the list, and one row per check-off, resisted urge, or slip. Additive; since 0005 the
-- change log accepts any entity name, so `changes` needs no rebuild.
CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
  icon TEXT NOT NULL CHECK(length(icon) BETWEEN 1 AND 16),
  kind TEXT NOT NULL CHECK(kind IN ('build', 'break')),
  start_date TEXT NOT NULL CHECK(start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  position INTEGER NOT NULL CHECK(position >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

-- Deleting a habit keeps its entries. Every read joins on live habits, so they stop counting.
CREATE TABLE IF NOT EXISTS habit_entries (
  id TEXT PRIMARY KEY,
  habit_id TEXT NOT NULL REFERENCES habits(id),
  date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  kind TEXT NOT NULL CHECK(kind IN ('done', 'resisted', 'slipped')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_habit_entries_habit ON habit_entries(habit_id, date) WHERE deleted_at IS NULL;
