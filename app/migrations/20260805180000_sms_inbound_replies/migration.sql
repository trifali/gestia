-- AlterTable
ALTER TABLE "LeadSmsLog" ADD COLUMN     "direction" TEXT NOT NULL DEFAULT 'outbound',
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT;

-- CreateTable
CREATE TABLE "SmsInboundUnmatched" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerId" TEXT,
    "fromNumber" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "SmsInboundUnmatched_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsInboundUnmatched_providerId_key" ON "SmsInboundUnmatched"("providerId");

-- CreateIndex
CREATE INDEX "SmsInboundUnmatched_createdAt_idx" ON "SmsInboundUnmatched"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSmsLog_providerId_key" ON "LeadSmsLog"("providerId");

-- CreateIndex
CREATE INDEX "LeadSmsLog_to_direction_createdAt_idx" ON "LeadSmsLog"("to", "direction", "createdAt");
