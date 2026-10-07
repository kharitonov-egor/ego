-- Standing goals: what the agent does while the user is away, each run it made, and the
-- notifications its messages send. The agent posts into one pinned chat per dataset.

-- 'agent' marks the pinned Agent chat. There is at most one live one per dataset.
ALTER TABLE assistant_chats ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat';
CREATE UNIQUE INDEX IF NOT EXISTS assistant_chats_one_agent ON assistant_chats (dataset_id)
  WHERE kind = 'agent' AND deleted_at IS NULL;

-- Set on what the agent posted, so the chat can show which goal said it.
ALTER TABLE assistant_messages ADD COLUMN goal_id TEXT;

-- A proposal's rows share batch_id and wait for their own Confirm, apart from the chat's
-- three-second card. They expire unanswered at expires_at.
ALTER TABLE assistant_tool_calls ADD COLUMN batch_id TEXT;
ALTER TABLE assistant_tool_calls ADD COLUMN expires_at TEXT;
CREATE INDEX IF NOT EXISTS assistant_tool_calls_by_batch ON assistant_tool_calls (batch_id) WHERE batch_id IS NOT NULL;

-- `trigger` is JSON in the AgentTrigger shape. next_run_at is the minute the goal is due;
-- goals with a set time are queued a little before it.
CREATE TABLE IF NOT EXISTS agent_goals (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'done')),
  muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0, 1)),
  time_zone TEXT NOT NULL,
  next_run_at TEXT,
  last_run_at TEXT,
  last_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS agent_goals_due ON agent_goals (status, next_run_at) WHERE deleted_at IS NULL;

-- A run is queued by the cron, Run now, or a delegated task, fired to the Claude routine, and
-- claimed by the routine's start_runs call.
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  goal_id TEXT NOT NULL REFERENCES agent_goals (id),
  reason TEXT NOT NULL CHECK(reason IN ('schedule', 'now', 'delegate', 'event')),
  event TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed')),
  deliver_at TEXT,
  summary TEXT,
  session_url TEXT,
  created_at TEXT NOT NULL,
  fired_at TEXT,
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS agent_runs_by_goal ON agent_runs (goal_id, created_at);
CREATE INDEX IF NOT EXISTS agent_runs_open ON agent_runs (dataset_id, status);

-- Each device reads these after its own cursor and shows the ones that are not silent.
CREATE TABLE IF NOT EXISTS agent_notifications (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id TEXT,
  goal_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  deliver_at TEXT NOT NULL,
  silent INTEGER NOT NULL DEFAULT 0 CHECK(silent IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS agent_notifications_by_dataset ON agent_notifications (dataset_id, created_at, id);
