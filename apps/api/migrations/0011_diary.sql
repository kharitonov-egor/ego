-- Diary: a chat with yourself. Formatting and attachments are JSON on the message, which is
-- written and read as one piece. The files are in R2; `diary_media` gets a row once one is fully
-- uploaded, so a message can only point at files that are really there. Additive, like the
-- migrations before it.
CREATE TABLE IF NOT EXISTS diary_messages (
  id TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  entities TEXT NOT NULL DEFAULT '[]',
  attachments TEXT NOT NULL DEFAULT '[]',
  reply_to_id TEXT,
  forwarded INTEGER NOT NULL DEFAULT 0 CHECK(forwarded IN (0, 1)),
  forwarded_from TEXT,
  pinned_at TEXT,
  edited_at TEXT,
  source TEXT NOT NULL CHECK(source IN ('app', 'telegram')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_diary_messages_sent ON diary_messages(sent_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS diary_media (
  id TEXT PRIMARY KEY,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size >= 0),
  created_at TEXT NOT NULL
);
