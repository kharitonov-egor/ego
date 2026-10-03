-- Goals sit above boards. Milestones and explicit links stay with the goal so the first version
-- can sync as one record without changing task cards.
CREATE TABLE IF NOT EXISTS task_goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
  why TEXT NOT NULL DEFAULT '',
  horizon TEXT NOT NULL CHECK(horizon IN ('quarter', 'year', 'longTerm', 'someday')),
  target_date TEXT CHECK(target_date IS NULL OR target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'someday', 'achieved')),
  position REAL NOT NULL,
  review_date TEXT CHECK(review_date IS NULL OR review_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  milestones TEXT NOT NULL DEFAULT '[]',
  board_ids TEXT NOT NULL DEFAULT '[]',
  card_ids TEXT NOT NULL DEFAULT '[]',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_goals_position ON task_goals(position) WHERE deleted_at IS NULL;
