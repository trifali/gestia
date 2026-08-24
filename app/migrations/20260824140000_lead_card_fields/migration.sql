-- CreateTable
CREATE TABLE "LeadCardFieldConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "searchId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "onCard" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LeadCardFieldConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadCardFieldConfig_companyId_idx" ON "LeadCardFieldConfig"("companyId");

-- CreateIndex
CREATE INDEX "LeadCardFieldConfig_searchId_idx" ON "LeadCardFieldConfig"("searchId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCardFieldConfig_companyId_searchId_key_key" ON "LeadCardFieldConfig"("companyId", "searchId", "key");

-- AddForeignKey
ALTER TABLE "LeadCardFieldConfig" ADD CONSTRAINT "LeadCardFieldConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCardFieldConfig" ADD CONSTRAINT "LeadCardFieldConfig_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "LeadSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
