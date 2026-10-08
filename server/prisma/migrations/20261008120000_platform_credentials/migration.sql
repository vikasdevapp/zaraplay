-- Cash Frenzy provider + admin-managed encrypted platform credentials.
ALTER TYPE "GameAutomationProvider" ADD VALUE 'CASHFRENZY';

-- CreateTable
CREATE TABLE "PlatformCredential" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "agentId" TEXT NOT NULL DEFAULT '',
    "secret" TEXT NOT NULL DEFAULT '',
    "balanceDivisor" DECIMAL(14,4) NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformCredential_provider_key" ON "PlatformCredential"("provider");
