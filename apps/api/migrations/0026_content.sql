CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS content_collections (
  id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS content_keys (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  dataset_id TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT
);
