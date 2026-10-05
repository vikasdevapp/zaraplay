-- Support ticket system: statuses + tickets, with messages linked to a ticket.

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('NEW', 'PENDING', 'SOLVED');

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameId" TEXT,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'NEW',
    "staffUnread" INTEGER NOT NULL DEFAULT 0,
    "staffLastReadAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "ticketId" TEXT;

-- CreateIndex
CREATE INDEX "SupportTicket_gameId_status_updatedAt_idx" ON "SupportTicket"("gameId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_status_idx" ON "SupportTicket"("userId", "status");

-- CreateIndex
CREATE INDEX "ChatMessage_ticketId_createdAt_idx" ON "ChatMessage"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: turn each existing (user, game) chat thread into a ticket, then link its messages.
INSERT INTO "SupportTicket" ("id", "userId", "gameId", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "userId", "gameId", 'PENDING', MIN("createdAt"), MAX("createdAt")
FROM "ChatMessage"
WHERE "gameId" IS NOT NULL
GROUP BY "userId", "gameId";

UPDATE "ChatMessage" m
SET "ticketId" = t."id"
FROM "SupportTicket" t
WHERE m."gameId" = t."gameId" AND m."userId" = t."userId" AND m."ticketId" IS NULL;
