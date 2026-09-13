-- Additive sync metadata. Existing rows keep their values and stay readable by the
-- legacy clients until they move to this API.
ALTER TABLE accounts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE accounts ADD COLUMN deleted_at TEXT;
ALTER TABLE categories ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE categories ADD COLUMN deleted_at TEXT;
ALTER TABLE transactions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE transactions ADD COLUMN deleted_at TEXT;
ALTER TABLE purchases ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE purchases ADD COLUMN deleted_at TEXT;
ALTER TABLE budgets ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE budgets ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL CHECK(entity IN ('account', 'category', 'transaction', 'purchase', 'budget')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('upsert', 'delete')),
  revision INTEGER NOT NULL,
  committed_at TEXT NOT NULL,
  payload TEXT
);

CREATE TABLE IF NOT EXISTS operations (
  operation_id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  server_sequence INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  dataset_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_transactions_feed
  ON transactions(date DESC, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_purchases_transaction ON purchases(transaction_id) WHERE deleted_at IS NULL;
