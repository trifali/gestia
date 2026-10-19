-- AlterTable
ALTER TABLE "LeadInboundWebhook" ADD COLUMN     "autoReply" JSONB NOT NULL DEFAULT '{}';
