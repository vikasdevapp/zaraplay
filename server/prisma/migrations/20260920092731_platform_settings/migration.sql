-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "minDeposit" DECIMAL(12,2) NOT NULL DEFAULT 10,
    "maxDeposit" DECIMAL(12,2) NOT NULL DEFAULT 10000,
    "minWithdrawal" DECIMAL(12,2) NOT NULL DEFAULT 20,
    "maxWithdrawal" DECIMAL(12,2) NOT NULL DEFAULT 5000,
    "signupBonusPercent" DECIMAL(6,2) NOT NULL DEFAULT 100,
    "weekendBonusPercent" DECIMAL(6,2) NOT NULL DEFAULT 50,
    "regularBonusPercent" DECIMAL(6,2) NOT NULL DEFAULT 20,
    "referralBonusPercent" DECIMAL(6,2) NOT NULL DEFAULT 100,
    "freeplaySignupGrant" DECIMAL(12,2) NOT NULL DEFAULT 5,
    "freeplayCashoutCap" DECIMAL(12,2) NOT NULL DEFAULT 20,
    "cashoutTierBoundary" DECIMAL(12,2) NOT NULL DEFAULT 35,
    "cashoutTier1MinMultiplier" DECIMAL(6,2) NOT NULL DEFAULT 5,
    "cashoutTier1MaxMultiplier" DECIMAL(6,2) NOT NULL DEFAULT 10,
    "cashoutTier2MinMultiplier" DECIMAL(6,2) NOT NULL DEFAULT 3,
    "ipSignupMaxPerDay" INTEGER NOT NULL DEFAULT 2,
    "ipBlockMessage" TEXT NOT NULL DEFAULT 'Only {max} accounts can be created per device/network each day. Please try again tomorrow.',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);
