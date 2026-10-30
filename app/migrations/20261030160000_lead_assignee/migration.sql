-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignee" TEXT;

-- AlterTable
ALTER TABLE "LeadNote" ADD COLUMN     "authorName" TEXT;
