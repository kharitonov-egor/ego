-- The AI assistant: chats, their messages in the shape the model reads them, and one row per
-- tool call so a write can wait for the Confirm card and be taken back afterwards. Additive, like
-- the migrations before it.
CREATE TABLE IF NOT EXISTS assistant_chats (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

-- `shown` marks what the phone lists: the user's messages and the final reply of each turn. The
-- model's tool calls and their results stay in `payload` for the next turn's context.
CREATE TABLE IF NOT EXISTS assistant_messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES assistant_chats(id),
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
  shown INTEGER NOT NULL DEFAULT 0 CHECK(shown IN (0, 1)),
  text TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  trail TEXT NOT NULL DEFAULT '[]',
  has_image INTEGER NOT NULL DEFAULT 0 CHECK(has_image IN (0, 1)),
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(chat_id, seq)
);

-- `call_id` is Ego's own key; `tool_call_id` is the id the model gave the call in the transcript.
CREATE TABLE IF NOT EXISTS assistant_tool_calls (
  call_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES assistant_chats(id),
  message_id TEXT,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'succeeded', 'failed', 'rejected', 'undone')),
  label TEXT,
  undo TEXT,
  card TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_assistant_chats_dataset ON assistant_chats(dataset_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_chat ON assistant_messages(chat_id, seq);
CREATE INDEX IF NOT EXISTS idx_assistant_tool_calls_chat ON assistant_tool_calls(chat_id, status);
CREATE INDEX IF NOT EXISTS idx_assistant_tool_calls_message ON assistant_tool_calls(message_id);
