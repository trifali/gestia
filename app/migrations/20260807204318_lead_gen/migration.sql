-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "LeadSearch" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'google_maps';

-- CreateTable
CREATE TABLE "LeadInboundWebhook" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "secretRotatedAt" TIMESTAMP(3),
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "receivedCount" INTEGER NOT NULL DEFAULT 0,
    "lastReceivedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "LeadInboundWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadInboundEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "webhookId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'captured',
    "errorMsg" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "sourceIp" TEXT,
    "leadIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "LeadInboundEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadInboundWebhook_searchId_key" ON "LeadInboundWebhook"("searchId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadInboundWebhook_publicId_key" ON "LeadInboundWebhook"("publicId");

-- CreateIndex
CREATE INDEX "LeadInboundWebhook_companyId_idx" ON "LeadInboundWebhook"("companyId");

-- CreateIndex
CREATE INDEX "LeadInboundEvent_webhookId_createdAt_idx" ON "LeadInboundEvent"("webhookId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadInboundEvent_webhookId_dedupeKey_key" ON "LeadInboundEvent"("webhookId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Lead_externalId_idx" ON "Lead"("externalId");

-- AddForeignKey
ALTER TABLE "LeadInboundWebhook" ADD CONSTRAINT "LeadInboundWebhook_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadInboundWebhook" ADD CONSTRAINT "LeadInboundWebhook_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "LeadSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadInboundEvent" ADD CONSTRAINT "LeadInboundEvent_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "LeadInboundWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
