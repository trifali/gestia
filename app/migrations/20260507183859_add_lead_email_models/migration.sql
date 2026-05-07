-- CreateTable
CREATE TABLE "LeadEmailLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "cc" TEXT,
    "subject" TEXT NOT NULL,

    CONSTRAINT "LeadEmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEmailDraft" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "to" TEXT NOT NULL DEFAULT '',
    "cc" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "LeadEmailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadEmailLog_companyId_identifier_idx" ON "LeadEmailLog"("companyId", "identifier");

-- CreateIndex
CREATE INDEX "LeadEmailDraft_companyId_identifier_idx" ON "LeadEmailDraft"("companyId", "identifier");

-- CreateIndex
CREATE UNIQUE INDEX "LeadEmailDraft_companyId_identifier_key" ON "LeadEmailDraft"("companyId", "identifier");

-- AddForeignKey
ALTER TABLE "LeadEmailLog" ADD CONSTRAINT "LeadEmailLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEmailDraft" ADD CONSTRAINT "LeadEmailDraft_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
