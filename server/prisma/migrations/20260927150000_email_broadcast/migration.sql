-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BroadcastMessage" ADD COLUMN     "deliveredCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failedCount" INTEGER NOT NULL DEFAULT 0;


-- Email broadcasts sent before SES was wired up were only recorded, never delivered.
UPDATE "BroadcastMessage" SET "failedCount" = "recipientCount" WHERE "channel" = 'EMAIL';
