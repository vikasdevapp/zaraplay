-- CreateTable
CREATE TABLE "VipTier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '⭐',
    "colorHex" TEXT NOT NULL DEFAULT '#D4AF37',
    "minDeposit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "minReferrals" INTEGER NOT NULL DEFAULT 0,
    "perks" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VipTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Starter',
    "fpCost" DECIMAL(12,2) NOT NULL,
    "cashValue" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceItem_pkey" PRIMARY KEY ("id")
);
