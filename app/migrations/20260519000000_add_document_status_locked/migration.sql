-- Add statusLocked field to Document to allow protecting a document from cron auto-status changes
ALTER TABLE "Document" ADD COLUMN "statusLocked" BOOLEAN NOT NULL DEFAULT false;
