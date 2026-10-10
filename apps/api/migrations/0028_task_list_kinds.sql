-- A list is regular, the Inbox that quick add and the inbox endpoint write to, or the USF column
-- that also shows Canvas assignments. Additive.
ALTER TABLE task_lists ADD COLUMN kind TEXT NOT NULL DEFAULT 'cards' CHECK(kind IN ('cards', 'inbox', 'usf'));
