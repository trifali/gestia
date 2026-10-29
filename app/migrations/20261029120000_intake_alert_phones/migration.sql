-- AlterTable
ALTER TABLE "LeadInboundWebhook" ADD COLUMN     "alertPhones" TEXT[] DEFAULT ARRAY[]::TEXT[];
