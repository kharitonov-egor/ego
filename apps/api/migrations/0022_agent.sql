-- The agent: keys that let Claude reach Ego over MCP, short notes both the chat and Claude keep
-- about the user, and the agent's settings as one JSON document per dataset.

-- MCP keys reach /mcp and nothing else. Only the hash is kept.
CREATE TABLE IF NOT EXISTS agent_keys (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

-- `source` says who wrote the note: the in-app chat, Claude over MCP, or the user in Memory.
CREATE TABLE IF NOT EXISTS agent_memories (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('chat', 'agent', 'user')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS agent_memories_by_dataset ON agent_memories (dataset_id, deleted_at, updated_at);

CREATE TABLE IF NOT EXISTS agent_settings (
  dataset_id TEXT PRIMARY KEY,
  settings TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
