-- Android preview builds as the EAS build webhook reports them, so the phone can offer the newest.
CREATE TABLE IF NOT EXISTS app_builds (
  id TEXT PRIMARY KEY,
  app_version TEXT NOT NULL,
  build_number INTEGER NOT NULL,
  apk_url TEXT NOT NULL,
  title TEXT,
  git_commit TEXT,
  completed_at TEXT NOT NULL,
  expires_at TEXT
);
