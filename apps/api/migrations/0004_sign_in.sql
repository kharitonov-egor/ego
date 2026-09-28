-- Google sign-in enrols a device without the enrolment script. Additive, like 0002 and 0003.
ALTER TABLE devices ADD COLUMN account_email TEXT;

CREATE TABLE IF NOT EXISTS sign_in_requests (
  state_hash TEXT PRIMARY KEY,
  exchange_secret_hash TEXT NOT NULL,
  google_verifier TEXT NOT NULL,
  device_name TEXT NOT NULL,
  client_hash TEXT NOT NULL,
  callback_at TEXT,
  code_hash TEXT UNIQUE,
  account_email TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sign_in_requests_expiry ON sign_in_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_sign_in_requests_client ON sign_in_requests(client_hash, created_at);
