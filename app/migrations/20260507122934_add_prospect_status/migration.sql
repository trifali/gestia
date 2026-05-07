-- AlterTable: remove contact flags from Lead
ALTER TABLE "Lead" DROP COLUMN IF EXISTS "contactedByEmail",
DROP COLUMN IF EXISTS "contactedByPhone";

-- CreateTable: persistent prospect status across searches
CREATE TABLE "ProspectStatus" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'nouveau',
    "notes" TEXT,

    CONSTRAINT "ProspectStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProspectStatus_companyId_idx" ON "ProspectStatus"("companyId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "ProspectStatus_companyId_placeId_key" ON "ProspectStatus"("companyId", "placeId");

-- AddForeignKey
ALTER TABLE "ProspectStatus" ADD CONSTRAINT "ProspectStatus_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
