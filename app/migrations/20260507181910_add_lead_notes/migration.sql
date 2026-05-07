-- CreateTable
CREATE TABLE "LeadNote" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "LeadNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadNote_companyId_identifier_idx" ON "LeadNote"("companyId", "identifier");

-- AddForeignKey
ALTER TABLE "LeadNote" ADD CONSTRAINT "LeadNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
