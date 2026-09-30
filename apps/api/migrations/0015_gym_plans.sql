-- Named workout plans: an ordered list of exercises with superset groups that can start any day.
-- Exercise IDs sit in JSON the way gym_workouts keeps them, so a deleted exercise just stops showing.
CREATE TABLE IF NOT EXISTS gym_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
  exercise_order TEXT NOT NULL DEFAULT '[]',
  supersets TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);
