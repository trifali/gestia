/*
  Warnings:

  - A unique constraint covering the columns `[companyId,searchId,key]` on the table `LeadStatusConfig` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "LeadStatusConfig_companyId_key_key";

-- AlterTable
ALTER TABLE "LeadStatusConfig" ADD COLUMN     "searchId" TEXT;

-- CreateIndex
CREATE INDEX "LeadStatusConfig_searchId_idx" ON "LeadStatusConfig"("searchId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadStatusConfig_companyId_searchId_key_key" ON "LeadStatusConfig"("companyId", "searchId", "key");

-- AddForeignKey
ALTER TABLE "LeadStatusConfig" ADD CONSTRAINT "LeadStatusConfig_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "LeadSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
