-- Docket: HTML pages that coding agents upload with the docket CLI. Each upload of an existing
-- docket adds a version, and /docket/<id> always shows the latest. The HTML lives in R2 under
-- object_key; D1 keeps what the lists and the page server need.
CREATE TABLE IF NOT EXISTS dockets (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  public INTEGER NOT NULL DEFAULT 0,
  repository TEXT,
  latest_version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS dockets_by_dataset ON dockets (dataset_id, updated_at);

CREATE TABLE IF NOT EXISTS docket_versions (
  docket_id TEXT NOT NULL REFERENCES dockets (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  repository TEXT,
  commit_sha TEXT,
  ref TEXT,
  key_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (docket_id, version)
);

-- CLI keys reach dockets and nothing else. Only the hash is kept.
CREATE TABLE IF NOT EXISTS docket_keys (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

-- A browser's private-docket cookie belongs to its device, so revoking or signing out the device
-- ends it too.
ALTER TABLE devices ADD COLUMN docket_cookie_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS devices_by_docket_cookie ON devices (docket_cookie_hash)
  WHERE docket_cookie_hash IS NOT NULL;
