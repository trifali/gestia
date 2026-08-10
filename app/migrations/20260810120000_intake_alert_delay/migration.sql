-- AlterTable
ALTER TABLE "LeadInboundWebhook" ADD COLUMN     "alertDelayMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "smsNotifiedAt" TIMESTAMP(3);
