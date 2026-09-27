-- Rename the seeded support agents in place so existing chat threads stay attached.
UPDATE "SupportAgent" SET "name" = 'Zara' WHERE "name" = 'Maya Lin';
UPDATE "SupportAgent" SET "name" = 'Lana' WHERE "name" = 'Jordan Blake';
UPDATE "SupportAgent" SET "name" = 'Sophia' WHERE "name" = 'Priya Nair';
