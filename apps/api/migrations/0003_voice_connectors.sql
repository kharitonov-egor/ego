CREATE TABLE IF NOT EXISTS connector_accounts (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('google', 'wispr')),
  encrypted_refresh_token TEXT NOT NULL,
  token_key_version TEXT NOT NULL,
  granted_scopes TEXT NOT NULL,
  account_label TEXT,
  server_url TEXT,
  token_endpoint TEXT,
  oauth_client_id TEXT,
  allowed_tools TEXT,
  access_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE(dataset_id, provider)
);

CREATE TABLE IF NOT EXISTS connector_oauth_states (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('google', 'wispr')),
  dataset_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES devices(id),
  pkce_verifier TEXT NOT NULL,
  server_url TEXT,
  token_endpoint TEXT,
  authorization_endpoint TEXT,
  oauth_client_id TEXT,
  redirect_uri TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS live_tool_sessions (
  openai_session_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id),
  dataset_id TEXT NOT NULL,
  enabled_tools TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS live_tool_calls (
  call_id TEXT PRIMARY KEY,
  openai_session_id TEXT NOT NULL REFERENCES live_tool_sessions(openai_session_id),
  tool_name TEXT NOT NULL,
  approval_result TEXT NOT NULL CHECK(approval_result IN ('not_required', 'approved', 'rejected')),
  outcome TEXT NOT NULL CHECK(outcome IN ('succeeded', 'rejected', 'failed')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_connector_accounts_dataset ON connector_accounts(dataset_id, provider);
CREATE INDEX IF NOT EXISTS idx_connector_oauth_expiry ON connector_oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_live_tool_sessions_device ON live_tool_sessions(device_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_live_tool_calls_session ON live_tool_calls(openai_session_id, created_at);
