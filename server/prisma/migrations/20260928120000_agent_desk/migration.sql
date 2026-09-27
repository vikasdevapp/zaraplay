-- CreateEnum
CREATE TYPE "GameTxType" AS ENUM ('RECHARGE', 'BONUS', 'REDEEM', 'FREEPLAY');

-- CreateEnum
CREATE TYPE "GameTxSource" AS ENUM ('PAGE', 'PERSONAL', 'WEB');

-- DropForeignKey
ALTER TABLE "UserGame" DROP CONSTRAINT "UserGame_userId_fkey";

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "backendBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "backendLowAt" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "backendUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UserGame" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "playerName" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "GameTransaction" (
    "id" TEXT NOT NULL,
    "type" "GameTxType" NOT NULL,
    "source" "GameTxSource" NOT NULL,
    "gameId" TEXT NOT NULL,
    "userGameId" TEXT NOT NULL,
    "gameUsername" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "staffId" TEXT,
    "gameRequestId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackendTopUp" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "balanceAfter" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "staffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackendTopUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameTransaction_type_createdAt_idx" ON "GameTransaction"("type", "createdAt");

-- CreateIndex
CREATE INDEX "GameTransaction_gameId_createdAt_idx" ON "GameTransaction"("gameId", "createdAt");

-- CreateIndex
CREATE INDEX "GameTransaction_staffId_createdAt_idx" ON "GameTransaction"("staffId", "createdAt");

-- CreateIndex
CREATE INDEX "GameTransaction_userGameId_createdAt_idx" ON "GameTransaction"("userGameId", "createdAt");

-- CreateIndex
CREATE INDEX "BackendTopUp_gameId_createdAt_idx" ON "BackendTopUp"("gameId", "createdAt");

-- Older auto-generated logins could, in theory, collide within a game; suffix any duplicates
-- (keeping the oldest as-is) so the uniqueness rule below can be created.
UPDATE "UserGame" u SET "gameUsername" = u."gameUsername" || '-' || substr(u.id, 1, 6)
FROM (
  SELECT id, row_number() OVER (PARTITION BY "gameId", "gameUsername" ORDER BY "createdAt") AS rn
  FROM "UserGame" WHERE "gameUsername" IS NOT NULL
) d
WHERE u.id = d.id AND d.rn > 1;

-- CreateIndex
CREATE UNIQUE INDEX "UserGame_gameId_gameUsername_key" ON "UserGame"("gameId", "gameUsername");

-- AddForeignKey
ALTER TABLE "UserGame" ADD CONSTRAINT "UserGame_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGame" ADD CONSTRAINT "UserGame_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameTransaction" ADD CONSTRAINT "GameTransaction_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameTransaction" ADD CONSTRAINT "GameTransaction_userGameId_fkey" FOREIGN KEY ("userGameId") REFERENCES "UserGame"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameTransaction" ADD CONSTRAINT "GameTransaction_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackendTopUp" ADD CONSTRAINT "BackendTopUp_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackendTopUp" ADD CONSTRAINT "BackendTopUp_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

