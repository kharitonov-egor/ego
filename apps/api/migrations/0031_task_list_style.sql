-- Each list can have a color, an emoji, and a colored outline. Additive. The USF column's green,
-- drawn by the app until now, becomes its stored color so it can be changed.
ALTER TABLE task_lists ADD COLUMN color TEXT;
ALTER TABLE task_lists ADD COLUMN icon TEXT NOT NULL DEFAULT '';
ALTER TABLE task_lists ADD COLUMN border INTEGER NOT NULL DEFAULT 0 CHECK(border IN (0, 1));
UPDATE task_lists SET color = '#006747' WHERE kind = 'usf';
