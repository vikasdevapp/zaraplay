-- Minimum deposit lowered to $9.99 (the smallest fixed gateway amount).
-- AlterColumn default
ALTER TABLE "PlatformSettings" ALTER COLUMN "minDeposit" SET DEFAULT 9.99;

-- Bring the existing settings row down too, but only if it's still the old default (don't
-- override a value an admin deliberately changed).
UPDATE "PlatformSettings" SET "minDeposit" = 9.99 WHERE "id" = 'default' AND "minDeposit" = 10;
