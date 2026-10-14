-- A board can show its cards' labels as bare color lines instead of named chips. Additive.
ALTER TABLE task_boards ADD COLUMN label_style TEXT NOT NULL DEFAULT 'names' CHECK(label_style IN ('names', 'lines'));
