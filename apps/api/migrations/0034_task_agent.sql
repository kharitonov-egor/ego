-- An agent list hands each card to a T3 thread on Jarvis. SQLite cannot widen a CHECK in place, so
-- the kind column is rebuilt with 'agent' allowed and its values copied across.
ALTER TABLE task_lists ADD COLUMN kind_next TEXT NOT NULL DEFAULT 'cards'
  CHECK(kind_next IN ('cards', 'inbox', 'usf', 'work', 'agent'));
UPDATE task_lists SET kind_next = kind;
ALTER TABLE task_lists DROP COLUMN kind;
ALTER TABLE task_lists RENAME COLUMN kind_next TO kind;

-- One row per card in an agent list. The row goes when the card leaves the list, so dragging it back
-- in starts a new run. 'sent' and 'working' hold one of Jarvis's few slots.
CREATE TABLE IF NOT EXISTS task_agent_runs (
  card_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('queued', 'sent', 'working', 'asking', 'pr', 'failed')),
  branch TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  sent_at TEXT,
  reported_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  pr_url TEXT,
  note TEXT,
  updated_at TEXT NOT NULL
);
