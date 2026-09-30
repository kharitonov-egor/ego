-- Tasks: Trello-style boards, lists, labels, and cards. A card keeps its checklists, attachments,
-- and activity log as JSON and is written as one piece. Deleting a board or a list keeps the rows
-- under it; every read joins on live parents. Files are in R2 under `tasks/`, and `task_media`
-- gets a row once one is fully uploaded. Additive.
CREATE TABLE IF NOT EXISTS task_boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  icon TEXT NOT NULL DEFAULT '' CHECK(length(icon) <= 16),
  position REAL NOT NULL,
  hide_done INTEGER NOT NULL DEFAULT 0 CHECK(hide_done IN (0, 1)),
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS task_lists (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES task_boards(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  position REAL NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_lists_board ON task_lists(board_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS task_labels (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES task_boards(id),
  name TEXT NOT NULL DEFAULT '' CHECK(length(name) <= 40),
  color TEXT NOT NULL CHECK(color IN ('green', 'yellow', 'orange', 'red', 'purple', 'blue', 'sky', 'pink')),
  position REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_labels_board ON task_labels(board_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS task_cards (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES task_boards(id),
  list_id TEXT NOT NULL REFERENCES task_lists(id),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
  description TEXT NOT NULL DEFAULT '',
  position REAL NOT NULL,
  label_ids TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('none', 'low', 'medium', 'high', 'urgent')),
  due_date TEXT CHECK(due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  due_time TEXT CHECK(due_time IS NULL OR due_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  reminder_minutes INTEGER,
  done_at TEXT,
  archived_at TEXT,
  checklists TEXT NOT NULL DEFAULT '[]',
  attachments TEXT NOT NULL DEFAULT '[]',
  activity TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_cards_list ON task_cards(list_id, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_cards_due ON task_cards(due_date) WHERE deleted_at IS NULL AND due_date IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_media (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size >= 0),
  created_at TEXT NOT NULL
);
