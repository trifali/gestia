-- CreateTable
CREATE TABLE "LeadStatusConfig" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LeadStatusConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadStatusConfig_companyId_idx" ON "LeadStatusConfig"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadStatusConfig_companyId_key_key" ON "LeadStatusConfig"("companyId", "key");

-- AddForeignKey
ALTER TABLE "LeadStatusConfig" ADD CONSTRAINT "LeadStatusConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
