-- Composio trigger events already handled, by their webhook-id, so a retried delivery starts
-- nothing twice.
CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  trigger_slug TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_events_by_time ON agent_events (received_at);
