-- AlterTable
ALTER TABLE "ClientFile" ADD COLUMN "sourceTemplateId" TEXT;
ALTER TABLE "ClientFile" ADD COLUMN "sourceTemplateType" TEXT;

-- AddForeignKey
ALTER TABLE "ClientFile" ADD CONSTRAINT "ClientFile_sourceTemplateId_fkey" FOREIGN KEY ("sourceTemplateId") REFERENCES "DocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
