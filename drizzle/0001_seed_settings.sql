-- Custom SQL migration file, put your code below! --
-- settings is a single row (id = 1) with column defaults.
INSERT INTO "settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
