-- AlterTable: add Google Calendar fields to User
ALTER TABLE "User" ADD COLUMN "googleCalendarAccessToken" TEXT;
ALTER TABLE "User" ADD COLUMN "googleCalendarRefreshToken" TEXT;
ALTER TABLE "User" ADD COLUMN "googleCalendarTokenExpiry" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "googleCalendarEmail" TEXT;

-- AlterTable: add googleCalendarEventId to Meeting
ALTER TABLE "Meeting" ADD COLUMN "googleCalendarEventId" TEXT;
