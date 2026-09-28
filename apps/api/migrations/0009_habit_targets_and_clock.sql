-- How often a habit to build is due: `target` check-offs a day, or `target` days a week. Existing
-- habits become once a day, which is what they meant before.
ALTER TABLE habits ADD COLUMN target INTEGER NOT NULL DEFAULT 1 CHECK(target BETWEEN 1 AND 10);
ALTER TABLE habits ADD COLUMN period TEXT NOT NULL DEFAULT 'day' CHECK(period IN ('day', 'week'));

-- The exact moment a habit to break was quit, and the phone's own time for each restart, so the
-- Quit clock can count to the second. Null keeps the older day-only reading.
ALTER TABLE habits ADD COLUMN started_at TEXT;
ALTER TABLE habit_entries ADD COLUMN logged_at TEXT;
