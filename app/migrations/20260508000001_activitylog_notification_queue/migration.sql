-- Add notification queuing fields to ActivityLog
ALTER TABLE "ActivityLog" ADD COLUMN "notificationRecipient" TEXT;
ALTER TABLE "ActivityLog" ADD COLUMN "notifiedAt" TIMESTAMP(3);
CREATE INDEX "ActivityLog_notificationRecipient_notifiedAt_idx" ON "ActivityLog"("notificationRecipient", "notifiedAt");
