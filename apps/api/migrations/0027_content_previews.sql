CREATE TABLE IF NOT EXISTS content_previews (
  item_id TEXT PRIMARY KEY, url TEXT NOT NULL, token TEXT,
  status TEXT NOT NULL CHECK (status IN ('ready', 'applied', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, updated_at TEXT NOT NULL
);
