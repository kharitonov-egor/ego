-- Each exercise gets a short note on how the machine is set up: seat height, pins, pads. Additive.
ALTER TABLE gym_exercises ADD COLUMN machine_settings TEXT NOT NULL DEFAULT '' CHECK(length(machine_settings) <= 200);
