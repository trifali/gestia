-- CreateTable
CREATE TABLE "ProspectEmailTemplate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ProspectEmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProspectEmailTemplate_searchId_key" ON "ProspectEmailTemplate"("searchId");

-- CreateIndex
CREATE INDEX "ProspectEmailTemplate_companyId_idx" ON "ProspectEmailTemplate"("companyId");

-- AddForeignKey
ALTER TABLE "ProspectEmailTemplate" ADD CONSTRAINT "ProspectEmailTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectEmailTemplate" ADD CONSTRAINT "ProspectEmailTemplate_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "LeadSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
