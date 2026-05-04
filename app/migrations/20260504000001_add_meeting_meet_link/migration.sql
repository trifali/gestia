-- AlterTable: add attendeeEmails and meetLink to Meeting
ALTER TABLE "Meeting" ADD COLUMN "attendeeEmails" TEXT;
ALTER TABLE "Meeting" ADD COLUMN "meetLink" TEXT;
