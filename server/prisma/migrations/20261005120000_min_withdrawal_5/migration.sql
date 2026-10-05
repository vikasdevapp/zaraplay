-- Minimum real-money cashout lowered to $5.
-- AlterColumn default
ALTER TABLE "PlatformSettings" ALTER COLUMN "minWithdrawal" SET DEFAULT 5;

-- Bring the existing settings row down too, but only if it's still the old default.
UPDATE "PlatformSettings" SET "minWithdrawal" = 5 WHERE "id" = 'default' AND "minWithdrawal" = 20;
