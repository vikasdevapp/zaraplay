-- Per-game staff hierarchy: an AGENT owns games; support staff are created by that agent and
-- scoped to one of its games.

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "agentId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "staffGameId" TEXT;

-- CreateIndex
CREATE INDEX "Game_agentId_idx" ON "Game"("agentId");

-- CreateIndex
CREATE INDEX "User_managerId_idx" ON "User"("managerId");

-- CreateIndex
CREATE INDEX "User_staffGameId_idx" ON "User"("staffGameId");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_staffGameId_fkey" FOREIGN KEY ("staffGameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
