-- CreateTable
CREATE TABLE "LeadSourceConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "order" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "learned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LeadSourceConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadSourceConfig_companyId_idx" ON "LeadSourceConfig"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSourceConfig_companyId_key_key" ON "LeadSourceConfig"("companyId", "key");

-- AddForeignKey
ALTER TABLE "LeadSourceConfig" ADD CONSTRAINT "LeadSourceConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
