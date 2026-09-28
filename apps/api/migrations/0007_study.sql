-- Canvas stays the source of the assignments. Only the done marks, which Canvas cannot report, live here.
CREATE TABLE IF NOT EXISTS study_completions (
  dataset_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (dataset_id, assignment_id)
);
