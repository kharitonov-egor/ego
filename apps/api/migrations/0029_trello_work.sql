-- A Work list mirrors two lists on the work Trello board. SQLite cannot widen a CHECK in place, so
-- the kind column is rebuilt with 'work' allowed and its values copied across.
ALTER TABLE task_lists ADD COLUMN kind_next TEXT NOT NULL DEFAULT 'cards'
  CHECK(kind_next IN ('cards', 'inbox', 'usf', 'work'));
UPDATE task_lists SET kind_next = kind;
ALTER TABLE task_lists DROP COLUMN kind;
ALTER TABLE task_lists RENAME COLUMN kind_next TO kind;

-- One row per mirrored card. `base` is the JSON both sides last agreed on, so a sync can tell which
-- side changed a field since then.
CREATE TABLE IF NOT EXISTS trello_work_cards (
  trello_id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL UNIQUE,
  base TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A single row. The lock keeps two syncs from creating the same Trello card twice, and `rerun`
-- asks the one holding it to go again for an edit that arrived meanwhile.
CREATE TABLE IF NOT EXISTS trello_work_sync (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  time_zone TEXT,
  locked_until TEXT,
  rerun INTEGER NOT NULL DEFAULT 0 CHECK(rerun IN (0, 1)),
  synced_at TEXT,
  problem TEXT
);
