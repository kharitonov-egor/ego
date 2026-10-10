-- A board can move each card marked done to the top of its Done list. Additive.
ALTER TABLE task_boards ADD COLUMN move_done INTEGER NOT NULL DEFAULT 0 CHECK(move_done IN (0, 1));
