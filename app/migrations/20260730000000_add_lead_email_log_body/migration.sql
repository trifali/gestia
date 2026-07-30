-- AlterTable
ALTER TABLE "LeadEmailLog" ADD COLUMN     "body" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "fromEmail" TEXT,
ADD COLUMN     "fromName" TEXT,
ADD COLUMN     "replyTo" TEXT;
