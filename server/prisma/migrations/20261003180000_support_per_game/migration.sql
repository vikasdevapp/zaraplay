-- Support chat is now per game (thread = player + game). The old SupportAgent persona link
-- becomes optional/legacy.

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "gameId" TEXT,
ALTER COLUMN "agentId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ChatMessage_gameId_userId_createdAt_idx" ON "ChatMessage"("gameId", "userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
