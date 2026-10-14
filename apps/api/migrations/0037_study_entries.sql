-- Assignments, exams, and deadlines added in Ego beside the Canvas feed. A due time is a UTC instant in
-- due_at; an item with no time keeps only its day in due_date. Additive.
CREATE TABLE IF NOT EXISTS study_entries (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('assignment', 'exam', 'deadline')),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
  course TEXT,
  due_at TEXT,
  due_date TEXT CHECK(due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  notes TEXT NOT NULL DEFAULT '',
  done_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  CHECK((due_at IS NULL) <> (due_date IS NULL))
);
