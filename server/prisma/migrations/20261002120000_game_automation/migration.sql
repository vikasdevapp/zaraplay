-- CreateEnum
CREATE TYPE "GameAutomationProvider" AS ENUM ('JUWA');

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "automationProvider" "GameAutomationProvider";

-- AlterTable
ALTER TABLE "UserGame" ADD COLUMN     "gameUserId" TEXT;

