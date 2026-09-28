-- Gym log: categories, exercises, one row per logged set, and a per-day record that orders
-- exercises and groups supersets. Additive for money; every existing table keeps its rows.
CREATE TABLE IF NOT EXISTS gym_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
  color TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS gym_exercises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 100),
  category_id TEXT NOT NULL REFERENCES gym_categories(id),
  type TEXT NOT NULL CHECK(type IN ('weight_reps', 'weight_distance', 'weight_time', 'reps_distance',
    'reps_time', 'distance_time', 'weight', 'reps', 'distance', 'time')),
  weight_unit TEXT NOT NULL CHECK(weight_unit IN ('default', 'lbs', 'kg')),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS gym_sets (
  id TEXT PRIMARY KEY,
  exercise_id TEXT NOT NULL REFERENCES gym_exercises(id),
  date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  position INTEGER NOT NULL CHECK(position >= 0),
  weight REAL CHECK(weight IS NULL OR weight >= 0),
  weight_unit TEXT CHECK(weight_unit IS NULL OR weight_unit IN ('lbs', 'kg')),
  reps INTEGER CHECK(reps IS NULL OR reps >= 0),
  distance REAL CHECK(distance IS NULL OR distance >= 0),
  distance_unit TEXT CHECK(distance_unit IS NULL OR distance_unit IN ('mi', 'km', 'm')),
  duration_seconds INTEGER CHECK(duration_seconds IS NULL OR duration_seconds >= 0),
  comment TEXT NOT NULL DEFAULT '' CHECK(length(comment) <= 500),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  CHECK((weight IS NULL) = (weight_unit IS NULL)),
  CHECK((distance IS NULL) = (distance_unit IS NULL))
);

-- The ID is the date, so two devices planning the same day meet on one row.
CREATE TABLE IF NOT EXISTS gym_workouts (
  id TEXT PRIMARY KEY CHECK(id GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  exercise_order TEXT NOT NULL DEFAULT '[]',
  supersets TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_gym_exercises_category ON gym_exercises(category_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gym_sets_date ON gym_sets(date, exercise_id, position) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gym_sets_exercise ON gym_sets(exercise_id, date) WHERE deleted_at IS NULL;

-- The change log listed its entities in a CHECK, which SQLite cannot alter. The copy keeps every
-- sequence number and leaves entity names to the Worker, so the next app needs no rebuild.
CREATE TABLE changes_next (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('upsert', 'delete')),
  revision INTEGER NOT NULL,
  committed_at TEXT NOT NULL,
  payload TEXT
);
INSERT INTO changes_next (seq, entity, entity_id, action, revision, committed_at, payload)
  SELECT seq, entity, entity_id, action, revision, committed_at, payload FROM changes ORDER BY seq;
DROP TABLE changes;
ALTER TABLE changes_next RENAME TO changes;
CREATE INDEX IF NOT EXISTS idx_changes_entity ON changes(entity, entity_id, seq);
