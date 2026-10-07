-- Web Push for the browser app. Each subscription belongs to the device that made it, so signing
-- that browser out stops its notifications too.
CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_sent_at TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS web_push_by_dataset ON web_push_subscriptions (dataset_id) WHERE revoked_at IS NULL;

-- Set once a notification has gone out as a push, so the cron sends each one at most once.
ALTER TABLE agent_notifications ADD COLUMN pushed_at TEXT;
CREATE INDEX IF NOT EXISTS agent_notifications_unpushed ON agent_notifications (deliver_at) WHERE pushed_at IS NULL AND silent = 0;
