-- CreateTable
CREATE TABLE "GatewayEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mchOrderNo" TEXT,
    "ip" TEXT,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GatewayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GatewayEvent_mchOrderNo_idx" ON "GatewayEvent"("mchOrderNo");

-- CreateIndex
CREATE INDEX "Transaction_gatewayProvider_status_idx" ON "Transaction"("gatewayProvider", "status");
