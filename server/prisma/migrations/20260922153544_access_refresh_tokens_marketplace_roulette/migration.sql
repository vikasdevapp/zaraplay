-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'MARKETPLACE_REDEMPTION';
ALTER TYPE "TransactionType" ADD VALUE 'ROULETTE_WIN';

-- CreateTable
CREATE TABLE "RoulettePrize" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "colorHex" TEXT NOT NULL DEFAULT '#8b5cf6',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoulettePrize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouletteSpin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prizeLabel" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouletteSpin_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RouletteSpin" ADD CONSTRAINT "RouletteSpin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
