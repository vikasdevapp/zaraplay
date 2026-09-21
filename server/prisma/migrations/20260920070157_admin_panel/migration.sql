-- CreateEnum
CREATE TYPE "BroadcastChannel" AS ENUM ('SMS', 'EMAIL');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'ADMIN_ADJUSTMENT';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "adminNote" TEXT,
ADD COLUMN     "forfeitedAmount" DECIMAL(12,2),
ADD COLUMN     "payoutAmount" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "BroadcastMessage" (
    "id" TEXT NOT NULL,
    "channel" "BroadcastChannel" NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastMessage_pkey" PRIMARY KEY ("id")
);
