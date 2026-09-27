-- CreateEnum
CREATE TYPE "GameAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');

-- CreateEnum
CREATE TYPE "GameRequestType" AS ENUM ('CREATE_ACCOUNT', 'RECHARGE', 'REDEEM', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "GameRequestStatus" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'GAME_RECHARGE';
ALTER TYPE "TransactionType" ADD VALUE 'GAME_REDEEM';

-- AlterTable
ALTER TABLE "UserGame" ADD COLUMN     "balanceSyncedAt" TIMESTAMP(3),
ADD COLUMN     "balanceSyncedById" TEXT,
ADD COLUMN     "status" "GameAccountStatus" NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "gameUsername" DROP NOT NULL,
ALTER COLUMN "gamePassword" DROP NOT NULL;

-- CreateTable
CREATE TABLE "GameRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userGameId" TEXT NOT NULL,
    "type" "GameRequestType" NOT NULL,
    "status" "GameRequestStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "completedAmount" DECIMAL(12,2),
    "transactionId" TEXT,
    "claimedById" TEXT,
    "claimedAt" TIMESTAMP(3),
    "handledById" TEXT,
    "agentNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GameRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameRequest_transactionId_key" ON "GameRequest"("transactionId");

-- CreateIndex
CREATE INDEX "GameRequest_status_createdAt_idx" ON "GameRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GameRequest_userGameId_status_idx" ON "GameRequest"("userGameId", "status");

-- AddForeignKey
ALTER TABLE "UserGame" ADD CONSTRAINT "UserGame_balanceSyncedById_fkey" FOREIGN KEY ("balanceSyncedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRequest" ADD CONSTRAINT "GameRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRequest" ADD CONSTRAINT "GameRequest_userGameId_fkey" FOREIGN KEY ("userGameId") REFERENCES "UserGame"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRequest" ADD CONSTRAINT "GameRequest_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRequest" ADD CONSTRAINT "GameRequest_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

