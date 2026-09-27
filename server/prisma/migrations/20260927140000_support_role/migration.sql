-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPPORT';

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "sentById" TEXT;

-- CreateIndex
CREATE INDEX "ChatMessage_sentById_createdAt_idx" ON "ChatMessage"("sentById", "createdAt");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

