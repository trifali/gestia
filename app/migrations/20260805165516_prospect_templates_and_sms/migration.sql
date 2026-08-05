-- DropIndex
DROP INDEX "ProspectEmailTemplate_searchId_key";

-- AlterTable
ALTER TABLE "ProspectEmailTemplate" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'email',
ADD COLUMN     "defaultStatus" TEXT,
ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'Courriel';

-- CreateTable
CREATE TABLE "LeadSmsLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "fromNumber" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "providerId" TEXT,

    CONSTRAINT "LeadSmsLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadSmsLog_companyId_identifier_idx" ON "LeadSmsLog"("companyId", "identifier");

-- CreateIndex
CREATE INDEX "ProspectEmailTemplate_searchId_channel_idx" ON "ProspectEmailTemplate"("searchId", "channel");

-- AddForeignKey
ALTER TABLE "LeadSmsLog" ADD CONSTRAINT "LeadSmsLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
