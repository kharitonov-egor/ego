-- Sheets: small spreadsheets. A sheet keeps its columns, row types, and saved sort and filters as
-- JSON and is written as one piece. A row keeps its cells as JSON keyed by column ID. Deleting a
-- sheet keeps its rows; every read joins on a live sheet. Additive.
CREATE TABLE IF NOT EXISTS sheets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  icon TEXT NOT NULL DEFAULT '' CHECK(length(icon) <= 16),
  position REAL NOT NULL,
  columns TEXT NOT NULL DEFAULT '[]',
  types_enabled INTEGER NOT NULL DEFAULT 0 CHECK(types_enabled IN (0, 1)),
  row_types TEXT NOT NULL DEFAULT '[]',
  view TEXT NOT NULL DEFAULT '{}',
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS sheet_rows (
  id TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL REFERENCES sheets(id),
  type_id TEXT,
  cells TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sheet_rows_sheet ON sheet_rows(sheet_id) WHERE deleted_at IS NULL;
