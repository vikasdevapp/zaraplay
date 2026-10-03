-- Support chat photo attachments, and allow image-only messages (empty body).
-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "imageUrl" TEXT,
ALTER COLUMN "body" SET DEFAULT '';
