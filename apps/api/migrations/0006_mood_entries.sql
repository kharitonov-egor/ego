-- Health starts with one mood entry per day, keyed by date like a budget month. Additive; since
-- 0005 the change log accepts any entity name, so `changes` needs no rebuild.
CREATE TABLE IF NOT EXISTS mood_entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL UNIQUE CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  mood INTEGER NOT NULL CHECK(mood BETWEEN 1 AND 5),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 2000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);
