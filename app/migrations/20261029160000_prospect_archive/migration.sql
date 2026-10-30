-- CreateTable
CREATE TABLE "ProspectArchive" (
    "id" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "placeId" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "name" TEXT NOT NULL,
    "searchId" TEXT,
    "boardTitle" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusLabel" TEXT,
    "source" TEXT NOT NULL,
    "leadCreatedAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "ProspectArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProspectArchive_companyId_placeId_idx" ON "ProspectArchive"("companyId", "placeId");

-- CreateIndex
CREATE INDEX "ProspectArchive_companyId_phone_idx" ON "ProspectArchive"("companyId", "phone");

-- CreateIndex
CREATE INDEX "ProspectArchive_companyId_email_idx" ON "ProspectArchive"("companyId", "email");

-- CreateIndex
CREATE INDEX "ProspectArchive_companyId_identifier_idx" ON "ProspectArchive"("companyId", "identifier");

-- AddForeignKey
ALTER TABLE "ProspectArchive" ADD CONSTRAINT "ProspectArchive_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

