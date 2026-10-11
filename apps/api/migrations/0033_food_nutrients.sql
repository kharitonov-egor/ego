-- Saturated fat and fiber in grams and sodium in milligrams for each entry, null when unknown. Parts
-- carry the same three numbers inside their JSON. The targets add a sodium limit, a saturated fat
-- limit as a percent of calories, and a fiber minimum. Additive.
ALTER TABLE food_entries ADD COLUMN saturated_fat REAL CHECK(saturated_fat IS NULL OR saturated_fat >= 0);
ALTER TABLE food_entries ADD COLUMN fiber REAL CHECK(fiber IS NULL OR fiber >= 0);
ALTER TABLE food_entries ADD COLUMN sodium REAL CHECK(sodium IS NULL OR sodium >= 0);

ALTER TABLE food_goals ADD COLUMN sodium REAL;
ALTER TABLE food_goals ADD COLUMN saturated_fat_percent REAL;
ALTER TABLE food_goals ADD COLUMN fiber REAL;
