-- Google Health: one connection per dataset and a synced copy of what the band records, so the
-- phone reads a year of history from D1 instead of asking Google. Google stays the source; every
-- row here is rewritten from it. Additive, like the migrations before it.
CREATE TABLE IF NOT EXISTS health_connections (
  dataset_id TEXT PRIMARY KEY,
  encrypted_refresh_token TEXT NOT NULL,
  token_key_version TEXT NOT NULL,
  granted_scopes TEXT NOT NULL,
  account_label TEXT,
  time_zone TEXT,
  device TEXT,
  history_from TEXT,
  last_sync_at TEXT,
  sync_started_at TEXT,
  sync_finished_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS health_oauth_states (
  state_hash TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  pkce_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS health_days (
  dataset_id TEXT NOT NULL,
  date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  steps INTEGER,
  distance_m REAL,
  calories_kcal REAL,
  fat_burn_minutes INTEGER,
  cardio_minutes INTEGER,
  peak_minutes INTEGER,
  resting_hr INTEGER,
  hrv_ms REAL,
  hr_min REAL,
  hr_avg REAL,
  hr_max REAL,
  weight_kg REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, date)
);

CREATE TABLE IF NOT EXISTS health_sleeps (
  dataset_id TEXT NOT NULL,
  id TEXT NOT NULL,
  date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  start_local TEXT NOT NULL,
  end_local TEXT NOT NULL,
  minutes_asleep INTEGER NOT NULL,
  minutes_awake INTEGER NOT NULL,
  minutes_in_bed INTEGER NOT NULL,
  deep_minutes INTEGER,
  light_minutes INTEGER,
  rem_minutes INTEGER,
  nap INTEGER NOT NULL DEFAULT 0,
  stages TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (dataset_id, id)
);

-- Five-minute heart rate averages, one JSON row per day.
CREATE TABLE IF NOT EXISTS health_heart (
  dataset_id TEXT NOT NULL,
  date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  points TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, date)
);

CREATE INDEX IF NOT EXISTS idx_health_days_updated ON health_days(dataset_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_health_sleeps_date ON health_sleeps(dataset_id, date);
CREATE INDEX IF NOT EXISTS idx_health_sleeps_updated ON health_sleeps(dataset_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_health_heart_updated ON health_heart(dataset_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_health_oauth_expiry ON health_oauth_states(expires_at);
