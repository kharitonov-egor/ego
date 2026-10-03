-- Google Calendar: one connection per Google account, each account's calendar list, and the
-- events inside a rolling window, so the phone and the desktop read their weeks from D1. Google
-- stays the source: every write goes to Google first and its answer is written here.
CREATE TABLE IF NOT EXISTS calendar_accounts (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  token_key_version TEXT NOT NULL,
  granted_scopes TEXT NOT NULL,
  time_zone TEXT,
  last_sync_at TEXT,
  sync_started_at TEXT,
  sync_finished_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (dataset_id, id)
);

CREATE TABLE IF NOT EXISTS calendar_oauth_states (
  state_hash TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  pkce_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);

-- `info` is the calendar as devices see it. The sync token and window belong to the Worker.
CREATE TABLE IF NOT EXISTS calendar_lists (
  dataset_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  info TEXT NOT NULL,
  sync_token TEXT,
  window_from TEXT,
  window_to TEXT,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (dataset_id, account_id, id)
);

-- One row per event or occurrence of a repeating event. `starts_at` and `ends_at` place it on the
-- timeline for range reads; an all-day event spans its days in UTC.
CREATE TABLE IF NOT EXISTS calendar_events (
  dataset_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  google_updated TEXT NOT NULL,
  event TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (dataset_id, account_id, calendar_id, id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_updated ON calendar_events(dataset_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_range ON calendar_events(dataset_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_lists_updated ON calendar_lists(dataset_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_calendar_oauth_expiry ON calendar_oauth_states(expires_at);
